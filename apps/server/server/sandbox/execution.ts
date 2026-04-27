/**
 * Sandbox Execution — High-level API for containerized code execution
 */

import { createSandbox, executeInSandbox, buildScenePreview, cleanupSessionSandbox, getSandboxMetrics, getSandboxFile, listSandboxFiles } from "./manager.js";
import { installToolsInSandbox, getRecommendedTools, getInstallTimeEstimate, validateToolCombination } from "../agents/tool-registry.js";
import { analyzeQuality, generatePatchGoals, shouldStopIteration, getQualityLabel } from "../quality/analyzer.js";
import { validateCode } from "../quality/validator.js";
import { SandboxPoolManager, createArtifactStorage } from "@visual-runtime/sandbox-pool";
import { PatchGenerator, applyPatches, summarizePatches } from "../quality/patcher.js";
import { AgentMemory, createMemoryContext } from "../agents/memory.js";
import { getPoolBasedProvider } from "../llm/fetch.js";
import { initializeAgentMemory, analyzeCodeWithAgents, generatePatchGoalsFromAgents, shouldContinueIterating, type IterationDecision } from "../agents/integration.js";
import { broadcastEvent } from "../ws/streaming.js";

function sanitizeError(error: any, category = "general"): { userMessage: string; logMessage: string } {
  const fullMessage = error instanceof Error ? error.message : String(error);
  
  if (fullMessage.includes("EROFS") || fullMessage.includes("read-only")) {
    return { userMessage: "Sandbox environment is temporarily unavailable.", logMessage: fullMessage };
  }
  if (fullMessage.includes("npm") || fullMessage.includes("install")) {
    return { userMessage: "Failed to install required dependencies.", logMessage: fullMessage };
  }
  if (fullMessage.includes("docker") || fullMessage.includes("container")) {
    return { userMessage: "Sandbox execution failed.", logMessage: fullMessage };
  }
  if (fullMessage.includes("SyntaxError") || fullMessage.includes("ParseError")) {
    return { userMessage: "Syntax error detected in the generated code.", logMessage: fullMessage };
  }
  
  return { userMessage: "An error occurred. Please try again.", logMessage: fullMessage };
}

const DEFAULT_ITERATION_CONFIG = {
  maxIterations: 3,
  qualityThreshold: 75,
  enableAutoPatch: true,
  timeoutPerIterationMs: 60000,
  preferredSandbox: "docker"
};

const executionSessions = new Map<string, any>();

export interface ExecutionRequest {
  sessionId: string;
  code: string | any;
  skill: string | any;
  prompt: string;
  tools?: string[];
  config?: any;
}

export async function executeWithQualityLoop(request: ExecutionRequest, onProgress?: (e: any) => void): Promise<any> {
  const { sessionId, code: initialCode, skill, prompt, tools = [], config = {} } = request;
  const iterationConfig = { ...DEFAULT_ITERATION_CONFIG, ...config };
  const iterations: any[] = [];
  let currentCode = initialCode;

  const artifactStorage = createArtifactStorage({ backend: 'filesystem', basePath: process.env.ARTIFACTS_PATH || './artifacts' });
  await artifactStorage.initialize();

  const agentMemory = new AgentMemory(sessionId, skill);
  const frameworkMemory = initializeAgentMemory(sessionId, skill);
  const patchGenerator = new PatchGenerator(getPoolBasedProvider(), { maxPatchRetries: 2, patchTimeoutMs: 120000 });

  onProgress?.({ type: "sandbox:creating", sessionId });

  let sandbox;
  try {
    const recommendedTools = getRecommendedTools(skill);
    sandbox = await createSandbox({ sessionId, tools: [...new Set([...recommendedTools, ...tools])], timeoutMs: iterationConfig.timeoutPerIterationMs });
  } catch (error: any) {
    return { success: false, sessionId, error: sanitizeError(error, 'sandbox-creation').userMessage, iterations: [] };
  }

  for (let iter = 1; iter <= iterationConfig.maxIterations; iter++) {
    const iterationStart = Date.now();
    const staticValidation = await validateCode(currentCode, skill);
    
    if (!staticValidation.valid) {
      return { success: false, sessionId, finalIteration: iter, stopReason: "unrecoverable", iterations, error: "Static validation failed" };
    }

    let executionResult: any;
    try {
      onProgress?.({ type: "sandbox:executing", sessionId, iteration: iter });
      executionResult = await executeInSandbox({ sessionId, code: currentCode, skill, timeoutMs: iterationConfig.timeoutPerIterationMs });
    } catch (error) {
      executionResult = { success: false, logs: [], error: sanitizeError(error, 'execution').userMessage, durationMs: 0 };
    }

    const qualitySignals = analyzeQuality({ code: currentCode, skill, prompt, executionResult });
    const patchGoals = generatePatchGoals(qualitySignals, iterationConfig.qualityThreshold);
    onProgress?.({ type: "sandbox:analyzing", sessionId, iteration: iter });
    const agentAnalysis: any = await analyzeCodeWithAgents(currentCode, prompt, { skill, quality: qualitySignals.composite, iteration: iter, maxIterations: iterationConfig.maxIterations });
    const agentPatchGoals = generatePatchGoalsFromAgents(agentAnalysis, currentCode);

    const iterationResult = { iterationNumber: iter, code: currentCode, quality: qualitySignals, score: qualitySignals.composite, patchGoals, durationMs: Date.now() - iterationStart };
    iterations.push(iterationResult);

    const agentDecision: IterationDecision = shouldContinueIterating(qualitySignals.composite ?? 0, iter, iterationConfig.maxIterations, iterationConfig.qualityThreshold, agentAnalysis.totalPotentialImprovement ?? 0);

    // Broadcast real agent analysis results to frontend panels
    broadcastEvent("agent:analysis_complete", {
      sessionId,
      results: agentAnalysis.results || {},
      consensus: typeof agentAnalysis.agents === "number" && agentAnalysis.agents > 0 
        ? Math.round(Object.values(agentAnalysis.results || {}).reduce((sum: number, a: any) => sum + (a.confidence || a.score || 0) * 100, 0) / agentAnalysis.agents)
        : 0,
      recommendations: agentAnalysis.recommendations ?? [],
      iteration: iter,
      score: qualitySignals.composite,
      totalPotentialImprovement: agentAnalysis.totalPotentialImprovement ?? 0,
      durationMs: agentAnalysis.durationMs ?? 0,
      shouldContinue: agentDecision.shouldContinue,
      stopReason: agentDecision.shouldContinue ? null : agentDecision.reason
    });

    broadcastEvent("iteration:update", {
      sessionId,
      iteration: {
        iterationNumber: iter,
        qualitySignals,
        isFinal: !agentDecision.shouldContinue,
        generationDurationMs: agentAnalysis.durationMs,
        validationDurationMs: Date.now() - iterationStart,
        patchGoals
      },
      progress: {
        current: iter,
        total: iterationConfig.maxIterations,
        phase: agentDecision.shouldContinue ? "patching" : "finalizing"
      }
    });

    if (!agentDecision.shouldContinue) {
      await cleanupSessionSandbox(sessionId);
      const isSuccess = (qualitySignals.composite ?? 0) >= iterationConfig.qualityThreshold;
      return { 
        success: isSuccess, 
        sessionId, 
        finalIteration: iter, 
        finalScore: qualitySignals.composite, 
        stopReason: agentDecision.reason, 
        iterations,
        error: isSuccess ? undefined : `Quality threshold not met (Score: ${qualitySignals.composite}/${iterationConfig.qualityThreshold})`
      };
    }

    // Attempt to patch the code for the next iteration using combined goals
    if (iterationConfig.enableAutoPatch && iter < iterationConfig.maxIterations) {
      const allGoals = [...agentPatchGoals, ...patchGoals];
      if (allGoals.length > 0) {
        onProgress?.({ type: "sandbox:patching", sessionId, iteration: iter });
        broadcastEvent("agent:activity", {
          sessionId,
          step: "execute_code",
          status: "running",
          tone: "progress",
          text: `Self-correcting code (Iteration ${iter})...`,
          technicalDetail: `Applying patches for ${allGoals.length} improvement goals.`
        });
        try {
          const projectState = { files: [{ path: "index.js", content: currentCode }] };
          const patches = await patchGenerator.generatePatches(
            currentCode,
            projectState,
            allGoals as any[],
            undefined,
            { currentScore: qualitySignals.composite, skill }
          );
          if (patches && patches.length > 0 && patches[0]?.patchedCode) {
            currentCode = patches[0]!.patchedCode;
          }
        } catch (patchErr) {
          console.error(`[SandboxExecution] Patching failed on iter ${iter}:`, patchErr);
        }
      }
    }
  }

  await cleanupSessionSandbox(sessionId);
  return { success: false, sessionId, finalIteration: iterations.length, stopReason: "budget_exhausted", iterations, error: "Max iterations reached without meeting quality threshold" };
}

export async function executeOnce(request: ExecutionRequest): Promise<any> {
  const { sessionId, code, skill, tools = [] } = request;
  try {
    await createSandbox({ sessionId, tools });
    const result = await executeInSandbox({ sessionId, code, skill });
    await cleanupSessionSandbox(sessionId);
    return { success: result.success, result };
  } catch (error) {
    return { success: false, error: sanitizeError(error, 'quick-execution').userMessage };
  }
}

export function getExecutionStatus(sessionId: string) { return executionSessions.get(sessionId) || null; }
export async function abortExecution(sessionId: string) { await cleanupSessionSandbox(sessionId); executionSessions.delete(sessionId); }
export function validateExecutionRequest(request: ExecutionRequest) { return { valid: !!(request.sessionId && request.code && request.skill && request.prompt), errors: [] }; }
