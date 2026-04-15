/**
 * Multi-Agent Integration Module
 *
 * Integrates the 5-agent framework into the quality loop for
 * enhanced patch generation and code improvement recommendations.
 *
 * Flow:
 * - After code execution and quality scoring
 * - Agent analysis happens in parallel
 * - Recommendations are synthesized into patches
 * - Applied in next iteration (if auto-patch enabled)
 */

import "./env.js";
import { createWorkflowCoordinator, listAvailableAgents } from "./multi-agent-framework.js";
import { createPoolBasedProvider, getPoolBasedProvider } from "./pool-based-llm-provider.js";
import { AgentMemory } from "./agent-memory.js";

// ─── Initialize Agent Memory ────────────────────────────────────────

let _sharedAgentMemory = null;

export function initializeAgentMemory(sessionId, skill) {
  _sharedAgentMemory = new AgentMemory(sessionId, skill?.id ?? "unknown");
  return _sharedAgentMemory;
}

export function getAgentMemory() {
  if (!_sharedAgentMemory) {
    _sharedAgentMemory = new AgentMemory("session-default", "unknown");
  }
  return _sharedAgentMemory;
}

// ─── Multi-Agent Analysis ──────────────────────────────────────────

/**
 * Execute multi-agent analysis on current code iteration
 * 
 * @param {string} code - Current scene code
 * @param {string} scenePrompt - User's scene description
 * @param {object} context - { skill, quality, iteration, executionResult }
 * @returns {Promise<object>} Analysis results with recommendations
 */
export async function analyzeCodeWithAgents(code, scenePrompt, context = {}) {
  const quality = context.quality ?? 70;
  const iteration = context.iteration ?? 1;
  const skill = context.skill;

  try {
    // Get or create provider
    const llmProvider = getPoolBasedProvider();
    
    // Create coordinator
    const coordinator = createWorkflowCoordinator(llmProvider);
    
    console.log(`[Agents] Analyzing code (iteration ${iteration}, quality ${quality})`);

    // Execute multi-agent analysis
    const startMs = Date.now();
    const result = await coordinator.executeWorkflow(
      {
        scenePrompt: scenePrompt ?? "Visual scene",
        currentScene: { code, quality }
      },
      {
        parallel: true,
        agents: ['architect', 'materialDesigner', 'animator', 'optimizer', 'tester']
      }
    );

    const durationMs = Date.now() - startMs;

    // Record in memory
    const memory = getAgentMemory();
    memory.recordIteration({
      iteration,
      quality,
      agents: result.results,
      recommendations: result.recommendations,
      durationMs
    });

    console.log(`[Agents] Analysis complete in ${durationMs}ms`);
    console.log(`[Agents] Recommendations: ${result.recommendations?.length ?? 0}`);

    return {
      success: true,
      results: result.results,
      recommendations: result.recommendations || [],
      totalPotentialImprovement: result.totalPotentialImprovement ?? 0,
      durationMs,
      agents: Object.keys(result.results || {}).length
    };

  } catch (error) {
    console.error("[Agents] Analysis failed:", error instanceof Error ? error.message : String(error));
    
    // Return graceful fallback
    return {
      success: false,
      results: {},
      recommendations: [],
      totalPotentialImprovement: 0,
      durationMs: 0,
      agents: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// ─── Convert Agent Recommendations to Patches ───────────────────────

/**
 * Convert agent recommendations into actionable patch goals
 * 
 * @param {object} agentAnalysis - Result from analyzeCodeWithAgents()
 * @param {string} code - Current code
 * @returns {Array<object>} Array of patch goals
 */
export function generatePatchGoalsFromAgents(agentAnalysis, code) {
  if (!agentAnalysis.success || !agentAnalysis.recommendations) {
    return [];
  }

  return agentAnalysis.recommendations
    .sort((a, b) => b.impact - a.impact)  // Prioritize high-impact
    .slice(0, 8)  // Limit to 8 patches per iteration
    .map((rec, index) => ({
      id: `agent-${rec.agent}-${index}`,
      category: rec.category ?? "Enhancement",
      severity: rec.impact > 15 ? "high" : rec.impact > 8 ? "medium" : "low",
      description: rec.action ?? rec.suggestion,
      agent: rec.agent,
      impact: rec.impact,
      confidence: rec.confidence ?? 0.8,
      priority: index + 1
    }));
}

// ─── Decision Logic ────────────────────────────────────────────────

/**
 * Decide whether to continue iterating or stop
 * Enhanced with agent insights
 * 
 * @param {number} currentScore - Current quality score (0-100)
 * @param {number} iteration - Current iteration number
 * @param {number} maxIterations - Maximum iterations allowed
 * @param {number} qualityThreshold - Target quality score
 * @param {number} potentialImprovement - Potential improvement from agents
 * @returns {object} { shouldStop, reason }
 */
export function shouldContinueIterating(
  currentScore,
  iteration,
  maxIterations,
  qualityThreshold,
  potentialImprovement = 0
) {
  // Success condition - quality threshold met
  if (currentScore >= qualityThreshold) {
    return {
      shouldContinue: false,
      reason: "quality-threshold-met",
      score: currentScore,
      threshold: qualityThreshold
    };
  }

  // Budget exhausted
  if (iteration >= maxIterations) {
    return {
      shouldContinue: false,
      reason: "max-iterations-reached",
      iteration,
      maxIterations
    };
  }

  // No potential improvement from agents
  if (potentialImprovement <= 0) {
    return {
      shouldContinue: false,
      reason: "no-improvement-possible",
      score: currentScore,
      potentialImprovement
    };
  }

  // Would exceed quality threshold with improvements
  const projectedScore = Math.min(100, currentScore + potentialImprovement);
  if (projectedScore >= qualityThreshold) {
    return {
      shouldContinue: true,
      reason: "projected-improvement-available",
      score: currentScore,
      potentialImprovement,
      projectedScore
    };
  }

  // Default - continue iterating
  return {
    shouldContinue: true,
    reason: "improvement-available",
    score: currentScore,
    potentialImprovement,
    iteration,
    maxIterations
  };
}

// ─── Status and Reporting ──────────────────────────────────────────

/**
 * Get agent analysis summary for progress reporting
 * 
 * @param {object} agentAnalysis - Result from analyzeCodeWithAgents()
 * @returns {string} Human-readable summary
 */
export function formatAgentAnalysisSummary(agentAnalysis) {
  if (!agentAnalysis.success) {
    return `❌ Analysis failed: ${agentAnalysis.error || "Unknown error"}`;
  }

  const agentCount = agentAnalysis.agents ?? 0;
  const recCount = agentAnalysis.recommendations?.length ?? 0;
  const improvement = agentAnalysis.totalPotentialImprovement ?? 0;
  const duration = agentAnalysis.durationMs ?? 0;

  return `✨ Agents analyzed (${agentCount} agents, ${duration}ms):\n` +
    `   • Recommendations: ${recCount}\n` +
    `   • Potential improvement: +${improvement} points\n` +
    `   • Top issues: ${agentAnalysis.recommendations?.slice(0, 3)
      .map(r => `${r.agent} (+${r.impact})`)
      .join(", ") ?? "None"}`;
}

/**
 * Get overall agent framework status
 * 
 * @returns {object} Status object
 */
export function getAgentFrameworkStatus() {
  const provider = getPoolBasedProvider();
  const providerStatus = provider.status();
  const memory = getAgentMemory();
  const agents = listAvailableAgents();

  return {
    enabled: true,
    agents: agents.map(a => a.id),
    agentCount: agents.length,
    provider: {
      type: "pool-based",
      healthy: providerStatus.pool?.providers?.some(p => p.state === "healthy") ?? false,
      totalRequests: providerStatus.stats?.totalRequests ?? 0,
      successRate: providerStatus.stats?.successRate ?? "N/A",
      avgLatencyMs: providerStatus.stats?.avgLatencyMs ?? 0
    },
    memory: {
      iterationsTracked: memory?.iterations?.length ?? 0,
      learningsRecorded: memory?.learnings?.size ?? 0
    }
  };
}

// ─── Export for Use in Quality Loop ────────────────────────────────

/**
 * Integration wrapper for quality loop
 * Call this in sandbox-execution.js after scoring but before patching
 * 
 * @param {string} code - Current code
 * @param {string} prompt - User prompt/scene description
 * @param {object} qualitySignals - Quality analysis from analyzeQuality()
 * @param {object} context - { skill, iteration, maxIterations, threshold }
 * @returns {Promise<object>} Enhanced iteration context with agent insights
 */
export async function enhanceIterationWithAgents(code, prompt, qualitySignals, context = {}) {
  const iteration = context.iteration ?? 1;
  const quality = qualitySignals?.composite ?? 0;

  // Analyze with agents
  const agentAnalysis = await analyzeCodeWithAgents(code, prompt, {
    ...context,
    quality,
    iteration
  });

  // Convert to patch goals
  const agentPatchGoals = generatePatchGoalsFromAgents(agentAnalysis, code);

  // Decide if we should continue
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
    summary: formatAgentAnalysisSummary(agentAnalysis)
  };
}

export default {
  initializeAgentMemory,
  getAgentMemory,
  analyzeCodeWithAgents,
  generatePatchGoalsFromAgents,
  shouldContinueIterating,
  formatAgentAnalysisSummary,
  getAgentFrameworkStatus,
  enhanceIterationWithAgents
};
