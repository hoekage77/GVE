/**
 * Multi-Agent Integration Module
 *
 * Bridges the multi-agent framework with the quality loop in sandbox-execution.ts.
 * Uses real LLM calls through the PoolBasedLLMProvider.
 */

import "./env.js";
import {
  createWorkflowCoordinator,
  listAvailableAgents,
  type WorkflowContext,
  type WorkflowResult,
  type SynthesizedRecommendation,
} from "./multi-agent-framework.js";
import { getPoolBasedProvider } from "./pool-based-llm-provider.js";
import { AgentMemory } from "./agent-memory.js";

// ─── Agent Memory Singleton ───────────────────────────────────────────────────

let _sharedAgentMemory: AgentMemory | null = null;

export function initializeAgentMemory(sessionId: string, skill: { id?: string } | null): AgentMemory {
  _sharedAgentMemory = new AgentMemory(sessionId, skill?.id ?? "unknown");
  return _sharedAgentMemory;
}

export function getAgentMemory(): AgentMemory {
  if (!_sharedAgentMemory) {
    _sharedAgentMemory = new AgentMemory("session-default", "unknown");
  }
  return _sharedAgentMemory;
}

// ─── Analysis Result Shape ────────────────────────────────────────────────────

export interface AgentAnalysisResult {
  success: boolean;
  results: WorkflowResult["results"];
  recommendations: SynthesizedRecommendation[];
  totalPotentialImprovement: number;
  durationMs: number;
  agents: number;
  error?: string;
}

// ─── Core Analysis ────────────────────────────────────────────────────────────

export async function analyzeCodeWithAgents(
  code: string,
  scenePrompt: string,
  context: {
    quality?: number;
    iteration?: number;
    skill?: string;
    maxIterations?: number;
  } = {}
): Promise<AgentAnalysisResult> {
  const quality = context.quality ?? 70;
  const iteration = context.iteration ?? 1;

  try {
    const llmProvider = getPoolBasedProvider();
    const coordinator = createWorkflowCoordinator(llmProvider);

    console.log(`[Agents] Analyzing code (iteration ${iteration}, quality ${quality})`);

    const workflowContext: WorkflowContext = {
      scenePrompt: scenePrompt ?? "Visual scene",
      currentScene: { code, quality },
    };

    const startMs = Date.now();
    const result = await coordinator.executeWorkflow(workflowContext, {
      parallel: true,
      agents: ["architect", "materialDesigner", "animator", "optimizer", "tester"],
    });
    const durationMs = Date.now() - startMs;

    const memory = getAgentMemory();
    memory.recordIteration(
      iteration,
      code,
      quality,
      [],
      result.recommendations,
      durationMs
    );

    console.log(`[Agents] Analysis complete in ${durationMs}ms`);
    console.log(`[Agents] Recommendations: ${result.recommendations.length}`);

    return {
      success: true,
      results: result.results,
      recommendations: result.recommendations,
      totalPotentialImprovement: result.totalPotentialImprovement,
      durationMs,
      agents: Object.keys(result.results).length,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Agents] Analysis failed:", msg);
    return {
      success: false,
      results: {},
      recommendations: [],
      totalPotentialImprovement: 0,
      durationMs: 0,
      agents: 0,
      error: msg,
    };
  }
}

// ─── Patch Goal Generation ────────────────────────────────────────────────────

export interface PatchGoal {
  id: string;
  category: string;
  severity: "high" | "medium" | "low";
  description: string;
  agent: string;
  impact: number;
  confidence: number;
  priority: number;
}

export function generatePatchGoalsFromAgents(
  agentAnalysis: AgentAnalysisResult,
  _code: string
): PatchGoal[] {
  if (!agentAnalysis.success || !agentAnalysis.recommendations.length) return [];

  return agentAnalysis.recommendations
    .slice(0, 8)
    .map((rec, index) => ({
      id: `agent-${rec.agent}-${index}`,
      category: rec.category ?? "Enhancement",
      severity: (rec.impact > 15 ? "high" : rec.impact > 8 ? "medium" : "low") as "high" | "medium" | "low",
      description: rec.action,
      agent: rec.agent,
      impact: rec.impact,
      confidence: rec.confidence ?? 0.8,
      priority: index + 1,
    }));
}

// ─── Iteration Decision ───────────────────────────────────────────────────────

export interface IterationDecision {
  shouldContinue: boolean;
  reason: string;
  score?: number;
  threshold?: number;
  iteration?: number;
  maxIterations?: number;
  potentialImprovement?: number;
  projectedScore?: number;
}

export function shouldContinueIterating(
  currentScore: number,
  iteration: number,
  maxIterations: number,
  qualityThreshold: number,
  potentialImprovement = 0
): IterationDecision {
  if (currentScore >= qualityThreshold) {
    return { shouldContinue: false, reason: "quality-threshold-met", score: currentScore, threshold: qualityThreshold };
  }
  if (iteration >= maxIterations) {
    return { shouldContinue: false, reason: "max-iterations-reached", iteration, maxIterations };
  }
  if (potentialImprovement <= 0) {
    return { shouldContinue: false, reason: "no-improvement-possible", score: currentScore, potentialImprovement };
  }

  const projectedScore = Math.min(100, currentScore + potentialImprovement);
  if (projectedScore >= qualityThreshold) {
    return { shouldContinue: true, reason: "projected-improvement-available", score: currentScore, potentialImprovement, projectedScore };
  }

  return { shouldContinue: true, reason: "improvement-available", score: currentScore, potentialImprovement, iteration, maxIterations };
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function formatAgentAnalysisSummary(agentAnalysis: AgentAnalysisResult): string {
  if (!agentAnalysis.success) {
    return `❌ Analysis failed: ${agentAnalysis.error ?? "Unknown error"}`;
  }

  const agentCount = agentAnalysis.agents ?? 0;
  const recCount = agentAnalysis.recommendations.length;
  const improvement = agentAnalysis.totalPotentialImprovement ?? 0;
  const duration = agentAnalysis.durationMs ?? 0;

  const topIssues = agentAnalysis.recommendations
    .slice(0, 3)
    .map((r) => `${r.agent} (+${r.impact})`)
    .join(", ");

  return (
    `✨ Agents analyzed (${agentCount} agents, ${duration}ms):\n` +
    `   • Recommendations: ${recCount}\n` +
    `   • Potential improvement: +${improvement} points\n` +
    `   • Top issues: ${topIssues || "None"}`
  );
}

// ─── Status ───────────────────────────────────────────────────────────────────

export function getAgentFrameworkStatus() {
  const provider = getPoolBasedProvider();
  const providerStatus = provider.status();
  const memory = getAgentMemory();
  const agents = listAvailableAgents();

  return {
    enabled: true,
    agents: agents.map((a) => a.id),
    agentCount: agents.length,
    provider: {
      type: "pool-based",
      healthy: providerStatus.pool?.providers?.some((p: { state: string }) => p.state === "healthy") ?? false,
      totalRequests: providerStatus.stats?.totalRequests ?? 0,
      successRate: providerStatus.stats?.successRate ?? "N/A",
      avgLatencyMs: providerStatus.stats?.avgLatencyMs ?? 0,
    },
    memory: {
      iterationsTracked: (memory as any)?.iterationHistory?.length ?? 0,
      learningsRecorded: Object.keys((memory as any)?.successPatterns ?? {}).length,
    },
  };
}

// ─── High-Level Iteration Enhancer ───────────────────────────────────────────

export interface IterationEnhancement {
  agentAnalysis: AgentAnalysisResult;
  agentPatchGoals: PatchGoal[];
  decision: IterationDecision;
  summary: string;
}

export async function enhanceIterationWithAgents(
  code: string,
  prompt: string,
  qualitySignals: { composite?: number },
  context: { iteration?: number; maxIterations?: number; qualityThreshold?: number; skill?: string } = {}
): Promise<IterationEnhancement> {
  const iteration = context.iteration ?? 1;
  const quality = qualitySignals?.composite ?? 0;

  const agentAnalysis = await analyzeCodeWithAgents(code, prompt, { ...context, quality, iteration });
  const agentPatchGoals = generatePatchGoalsFromAgents(agentAnalysis, code);
  const decision = shouldContinueIterating(
    quality,
    iteration,
    context.maxIterations ?? 1,
    context.qualityThreshold ?? 75,
    agentAnalysis.totalPotentialImprovement ?? 0
  );

  return {
    agentAnalysis,
    agentPatchGoals,
    decision,
    summary: formatAgentAnalysisSummary(agentAnalysis),
  };
}
