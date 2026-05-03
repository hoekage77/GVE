/**
 * Sandbox Execution — High-level API for containerized code execution
 */

import { createSandbox, executeInSandbox, buildScenePreview, cleanupSessionSandbox, getSandboxMetrics, getSandboxFile, listSandboxFiles } from "./manager.js";
import { installToolsInSandbox, getRecommendedTools, getInstallTimeEstimate, validateToolCombination } from "../agents/tool-registry.js";
import { analyzeQuality, generatePatchGoals, getQualityLabel } from "../quality/analyzer.js";
import { validateCode } from "../quality/validator.js";
import { shouldIterationStop, determineModeFromQuality } from "../quality/mode-engine.js";
import { resolveIterationConfig } from "../pipeline/runtime-executor.js";
import { SandboxPoolManager, createArtifactStorage } from "@visual-runtime/sandbox-pool";
import { PatchGenerator, applyPatches, summarizePatches } from "../quality/patcher.js";
import { AgentMemory, createMemoryContext } from "../agents/memory.js";
import { getPoolBasedProvider } from "../llm/fetch.js";
import { broadcastEvent } from "../ws/streaming.js";
import { type Workspace, listFiles, getFile } from "../pipeline/workspace.js";
import { MultiFilePatchGenerator, applyMultiFilePatches } from "../pipeline/multi-file-patcher.js";
import { computeProjectQuality } from "../quality/cross-file-analyzer.js";

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
  workspace?: Workspace;
}

export async function executeWithQualityLoop(request: ExecutionRequest, onProgress?: (e: any) => void): Promise<any> {
  const { sessionId, code: initialCode, skill, prompt, tools = [], config = {}, workspace } = request;
  const baseConfig = { ...DEFAULT_ITERATION_CONFIG, ...config };
  const quality = config?.quality ?? "standard";
  const executionMode = determineModeFromQuality(quality);
  const modeConfig = resolveIterationConfig(quality);
  const iterationConfig = {
    ...baseConfig,
    maxIterations: modeConfig.maxIterations,
    qualityThreshold: modeConfig.threshold,
    enableAutoPatch: modeConfig.autoPatch,
    mode: executionMode
  };
  const iterations: any[] = [];
  let currentCode = initialCode;
  let currentWorkspace: Workspace | undefined = workspace ?? undefined;

  // If workspace mode, derive currentCode from entry point
  if (currentWorkspace) {
    const entry = getFile(currentWorkspace, currentWorkspace.entryPoint);
    if (entry) currentCode = entry.content;
  }

  const artifactStorage = createArtifactStorage({ backend: 'filesystem', basePath: process.env.ARTIFACTS_PATH || './artifacts' });
  await artifactStorage.initialize();

  const agentMemory = new AgentMemory(sessionId, skill);
  const patchGenerator = new PatchGenerator(getPoolBasedProvider(), { maxPatchRetries: 2, patchTimeoutMs: 120000 });
  const multiFilePatchGenerator = currentWorkspace ? new MultiFilePatchGenerator(patchGenerator) : null;

  onProgress?.({ type: "sandbox:creating", sessionId });

  let sandbox;
  try {
    const recommendedTools = getRecommendedTools(skill);
    // Normalize tools to plain npm package name strings — the graph layer may pass
    // objects ({ name, version }) while the tool-registry returns plain strings.
    const normalizedTools = [...new Set(
      [...recommendedTools, ...tools].map((t: any) =>
        typeof t === "string" ? t : (t?.npmPackage ?? t?.name ?? String(t))
      )
    )];
    sandbox = await createSandbox({ sessionId, tools: normalizedTools, timeoutMs: iterationConfig.timeoutPerIterationMs });
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
      const sandboxFiles = currentWorkspace
        ? Object.fromEntries(listFiles(currentWorkspace).map(f => [f.path, f.content]))
        : undefined;
      executionResult = await executeInSandbox({ sessionId, code: currentCode, skill, timeoutMs: iterationConfig.timeoutPerIterationMs, files: sandboxFiles });
    } catch (error) {
      executionResult = { success: false, logs: [], error: sanitizeError(error, 'execution').userMessage, durationMs: 0 };
    }

    const qualitySignals = analyzeQuality({ code: currentCode, skill, prompt, executionResult });

    // ── Cross-file quality analysis (workspace mode) ──
    let projectQualityReport: any = null;
    if (currentWorkspace) {
      const fileScores: Record<string, number> = {};
      for (const f of listFiles(currentWorkspace)) {
        fileScores[f.path] = qualitySignals.composite ?? 0;
      }
      projectQualityReport = computeProjectQuality(currentWorkspace, fileScores);
      // Blend project cohesion into composite score (60% file + 40% cohesion)
      const blendedScore = Math.round(
        (qualitySignals.composite ?? 0) * 0.6 + (projectQualityReport.compositeScore ?? 0) * 0.4
      );
      qualitySignals.composite = blendedScore;
      broadcastEvent("workspace:analysis", {
        sessionId,
        iteration: iter,
        cohesionScore: projectQualityReport.importGraph?.cohesionScore,
        compositeScore: blendedScore,
        weakestFiles: projectQualityReport.weakestFiles,
        recommendations: projectQualityReport.recommendations
      });
    }

    const patchGoals = generatePatchGoals(qualitySignals, iterationConfig.qualityThreshold);
    onProgress?.({ type: "sandbox:analyzing", sessionId, iteration: iter });

    const iterationResult = { iterationNumber: iter, code: currentCode, quality: qualitySignals, score: qualitySignals.composite, patchGoals, durationMs: Date.now() - iterationStart };
    iterations.push(iterationResult);

    const stopDecision = shouldIterationStop({
      currentScore: qualitySignals.composite ?? 0,
      iterationNum: iter,
      maxIterations: iterationConfig.maxIterations,
      qualityThreshold: iterationConfig.qualityThreshold,
      mode: executionMode,
      patchGoals: patchGoals as any[]
    });
    const isSuccess = stopDecision.reason === "quality-threshold-met";
    const shouldContinue = !stopDecision.shouldStop;

    // Broadcast analysis results to frontend panels
    broadcastEvent("agent:analysis_complete", {
      sessionId,
      results: {
        struct: { id: "struct", name: "Struct Agent", score: qualitySignals.static?.score ?? 0, findings: qualitySignals.static ? [`Syntax: ${qualitySignals.static.syntaxValid ? 'valid' : 'invalid'}`, `Complexity: ${qualitySignals.static.complexity}`] : [], recommendations: patchGoals.filter(g => g.category === 'syntax' || g.category === 'security').map(g => g.description ?? '') },
        runtime: { id: "runtime", name: "Runtime Agent", score: qualitySignals.runtime?.score ?? 0, findings: qualitySignals.runtime ? [`FPS: ${qualitySignals.runtime.fps}`, `Errors: ${qualitySignals.runtime.errorCount}`] : [], recommendations: patchGoals.filter(g => g.category === 'performance' || g.category === 'runtime').map(g => g.description ?? '') },
        visual: { id: "visual", name: "Visual Agent", score: qualitySignals.visual?.score ?? 0, findings: qualitySignals.visual ? [`Materials: ${qualitySignals.visual.materialRichness}`, `Lighting: ${qualitySignals.visual.lightingComplexity}`] : [], recommendations: patchGoals.filter(g => g.category === 'visual' || g.category === 'motion').map(g => g.description ?? '') },
        semantic: { id: "semantic", name: "Semantic Agent", score: qualitySignals.semantic?.score ?? 0, findings: qualitySignals.semantic?.missingElements ? [`Missing elements: ${(qualitySignals.semantic.missingElements || []).join(', ') || 'none'}`] : [], recommendations: patchGoals.filter(g => g.category === 'semantic').map(g => g.description ?? '') }
      },
      consensus: qualitySignals.composite ?? 0,
      recommendations: patchGoals.map(g => ({ action: g.description, category: g.category, impact: g.severity === 'critical' ? 3 : g.severity === 'warning' ? 2 : 1 })),
      iteration: iter,
      score: qualitySignals.composite,
      totalPotentialImprovement: patchGoals.reduce((sum, g) => sum + (g.severity === 'critical' ? 15 : g.severity === 'warning' ? 8 : 4), 0),
      durationMs: Date.now() - iterationStart,
      shouldContinue,
      stopReason: shouldContinue ? null : (isSuccess ? "quality-threshold-met" : (patchGoals.length === 0 ? "no-improvement-possible" : "max-iterations-reached"))
    });

    broadcastEvent("iteration:update", {
      sessionId,
      iteration: {
        iterationNumber: iter,
        qualitySignals,
        isFinal: !shouldContinue,
        generationDurationMs: 0,
        validationDurationMs: Date.now() - iterationStart,
        patchGoals
      },
      progress: {
        current: iter,
        total: iterationConfig.maxIterations,
        phase: shouldContinue ? "patching" : "finalizing"
      }
    });

    if (!shouldContinue) {
      await cleanupSessionSandbox(sessionId);
      const entry = currentWorkspace ? getFile(currentWorkspace, currentWorkspace.entryPoint) : null;
      return {
        success: isSuccess,
        sessionId,
        finalIteration: iter,
        finalScore: qualitySignals.composite,
        stopReason: isSuccess ? "quality-threshold-met" : "max-iterations-reached",
        iterations,
        prePatchedCode: entry ? entry.content : currentCode,
        workspace: currentWorkspace,
        error: isSuccess ? undefined : `Quality threshold not met (Score: ${qualitySignals.composite}/${iterationConfig.qualityThreshold})`
      };
    }

    // Attempt to patch the code for the next iteration using combined goals
    if (iterationConfig.enableAutoPatch && iter < iterationConfig.maxIterations) {
      if (patchGoals.length > 0) {
        onProgress?.({ type: "sandbox:patching", sessionId, iteration: iter });
        broadcastEvent("agent:activity", {
          sessionId,
          step: "execute_code",
          status: "running",
          tone: "progress",
          text: `Self-correcting code (Iteration ${iter})...`,
          technicalDetail: `Applying patches for ${patchGoals.length} improvement goals.`
        });
        try {
          if (currentWorkspace && multiFilePatchGenerator) {
            // ── Workspace-aware multi-file patching ──
            const mfResult = await multiFilePatchGenerator.generatePatches(
              currentWorkspace,
              patchGoals as any[],
              undefined, // TODO: unify AgentMemory types across agents/memory.ts and quality/patcher.ts
              { currentScore: qualitySignals.composite, skill }
            );
            if (mfResult.patches.length > 0) {
              currentWorkspace = applyMultiFilePatches(currentWorkspace, mfResult.patches);
              const entry = getFile(currentWorkspace, currentWorkspace.entryPoint);
              if (entry) currentCode = entry.content;
              broadcastEvent("workspace:update", {
                sessionId,
                iteration: iter,
                patchCount: mfResult.patches.length,
                summary: mfResult.summary,
                fileList: Object.keys(currentWorkspace.files)
              });
              for (const p of mfResult.patches) {
                broadcastEvent("file:patched", {
                  sessionId,
                  path: p.kind === "rename" ? `${p.filePath} → ${p.newPath}` : p.filePath,
                  kind: p.kind,
                  explanation: p.explanation
                });
              }
            }
          } else {
            // ── Legacy single-file patching ──
            const projectState = { files: [{ path: "index.js", content: currentCode }] };
            const patches = await patchGenerator.generatePatches(
              currentCode,
              projectState,
              patchGoals as any[],
              undefined,
              { currentScore: qualitySignals.composite, skill }
            );
            if (patches && patches.length > 0 && patches[0]?.patchedCode) {
              currentCode = patches[0]!.patchedCode;
            }
          }
        } catch (patchErr) {
          console.error(`[SandboxExecution] Patching failed on iter ${iter}:`, patchErr);
        }
      }
    }
  }

  await cleanupSessionSandbox(sessionId);
  const entry = currentWorkspace ? getFile(currentWorkspace, currentWorkspace.entryPoint) : null;
  return {
    success: false,
    sessionId,
    finalIteration: iterations.length,
    stopReason: "budget_exhausted",
    iterations,
    prePatchedCode: entry ? entry.content : currentCode,
    workspace: currentWorkspace,
    error: "Max iterations reached without meeting quality threshold"
  };
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
