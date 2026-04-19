/**
 * Mode Decision Engine — Autonomous vs. Assisted vs. Strict execution modes.
 *
 * Implements the decision logic for how iterations should proceed
 * based on the execution mode.
 */

// ─── Types ───────────────────────────────────────────────────────────

export type ExecutionMode = "autonomous" | "assisted" | "strict";

export interface ModeConfig {
  mode: ExecutionMode;
  maxIterations: number;
  qualityThreshold: number;
  enableAutoPatch: boolean;
  userApprovalRequired: boolean;
  description: string;
}

interface PatchGoal {
  category?: string;
  issue?: string;
  suggestion?: string;
  [key: string]: unknown;
}

interface AgentMemory {
  failedApproaches?: string[];
  getScoreProgression?: () => number[];
  getAveragePatchEffectiveness?: () => number;
}

interface IterationStopContext {
  currentScore: number;
  iterationNum: number;
  maxIterations: number;
  qualityThreshold: number;
  mode: ExecutionMode;
  patchGoals?: PatchGoal[];
  agentMemory?: AgentMemory;
  userApproved?: boolean;
}

interface IterationDecision {
  shouldStop: boolean;
  reason: string;
  action: string;
  message: string;
  nextAction?: string;
  proposedPatches?: PatchGoal[];
  confidence?: string;
}

interface ApprovalPromptContext {
  currentScore: number;
  qualityThreshold: number;
  iterationNum: number;
  patchGoals?: PatchGoal[];
  previousScores?: number[];
}

interface AutonomousStrategyContext {
  currentScore: number;
  previousScores?: number[];
  patchGoals?: PatchGoal[];
  agentMemory?: AgentMemory;
  iterationNum: number;
  maxIterations: number;
}

// ─── Mode Configurations ─────────────────────────────────────────────

export const MODE_CONFIGS: Record<ExecutionMode, ModeConfig> = {
  autonomous: {
    mode: "autonomous",
    maxIterations: 3,
    qualityThreshold: 85,
    enableAutoPatch: true,
    userApprovalRequired: false,
    description: "Agent self-directs improvements without user input"
  },

  assisted: {
    mode: "assisted",
    maxIterations: 2,
    qualityThreshold: 75,
    enableAutoPatch: true,
    userApprovalRequired: true,
    description: "Agent proposes patches, user approves each iteration"
  },

  strict: {
    mode: "strict",
    maxIterations: 1,
    qualityThreshold: 60,
    enableAutoPatch: false,
    userApprovalRequired: true,
    description: "User maintains full control, no auto-patches"
  }
};

// ─── Public API ──────────────────────────────────────────────────────

export function determineModeFromQuality(quality: string): ExecutionMode {
  switch (quality) {
    case "draft":
      return "strict";
    case "high":
      return "autonomous";
    case "standard":
    default:
      return "assisted";
  }
}

export function shouldIterationStop(context: IterationStopContext): IterationDecision {
  const {
    currentScore,
    iterationNum,
    maxIterations,
    qualityThreshold,
    mode,
    patchGoals = [],
    agentMemory,
    userApproved = false
  } = context;

  if (currentScore >= qualityThreshold) {
    return { shouldStop: true, reason: "threshold_met", action: "finalize", message: `Quality threshold reached (${currentScore} >= ${qualityThreshold})` };
  }

  if (iterationNum >= maxIterations) {
    return { shouldStop: true, reason: "budget_exhausted", action: "finalize", message: `Maximum iterations reached (${iterationNum}/${maxIterations})` };
  }

  if (!patchGoals || patchGoals.length === 0) {
    return { shouldStop: true, reason: "no_fix_available", action: "finalize", message: "No fixable issues detected" };
  }

  if (agentMemory?.failedApproaches && patchGoals.length > 0) {
    const suggestedFixes = patchGoals.map(g => g.suggestion ?? "").join(" ");
    const isRepeating = agentMemory.failedApproaches.some(
      failed => suggestedFixes.toLowerCase().includes(failed.toLowerCase())
    );

    if (isRepeating) {
      return { shouldStop: true, reason: "repeating_failure", action: "error_with_warning", message: "Same fixes were tried before and failed" };
    }
  }

  switch (mode) {
    case "strict":
      return { shouldStop: false, reason: "awaiting_user_decision", action: "pause_for_approval", message: "Awaiting user decision", nextAction: "User must approve or reject iteration" };

    case "assisted":
      if (iterationNum === 1) {
        return { shouldStop: false, reason: "awaiting_user_approval", action: "pause_for_approval", message: "User approval required to continue", proposedPatches: patchGoals, nextAction: "Waiting for user to approve/reject patches" };
      }
      if (userApproved) {
        return { shouldStop: false, reason: "user_approved", action: "continue", message: "User approved, continuing iteration" };
      }
      return { shouldStop: false, reason: "autonomous_improvement", action: "continue", message: "Continuing with assisted patches" };

    case "autonomous": {
      const scores = agentMemory?.getScoreProgression?.() || [currentScore];
      const prevScore = scores.length > 1 ? scores[scores.length - 2]! : currentScore;
      const improving = currentScore > prevScore;

      if (improving) {
        return { shouldStop: false, reason: "autonomous_improvement", action: "continue_autonomous", message: `Autonomous: Score improving (${prevScore} → ${currentScore}), continuing`, confidence: "high" };
      }

      if (iterationNum < maxIterations - 1) {
        return { shouldStop: false, reason: "autonomous_retry", action: "continue_experimental", message: "Autonomous: Score stalled, attempting experimental patch", confidence: "medium" };
      }

      return { shouldStop: true, reason: "no_improvement_stalled", action: "finalize", message: "Autonomous: No improvement detected, finalizing" };
    }

    default:
      return { shouldStop: false, reason: "unknown", action: "continue", message: "Continuing iteration" };
  }
}

export function createApprovalPrompt(context: ApprovalPromptContext) {
  const { currentScore, qualityThreshold, iterationNum, patchGoals = [], previousScores = [] } = context;

  const scoreGap = qualityThreshold - currentScore;
  const trend = previousScores.length > 1
    ? previousScores[previousScores.length - 1]! > previousScores[previousScores.length - 2]! ? "📈 improving" : "📉 declining"
    : "➡️  stable";

  return {
    title: `Iteration ${iterationNum} - Approval Required`,
    currentScore: `${currentScore}/100`,
    qualityThreshold: `${qualityThreshold}/100`,
    scoreGap: `${scoreGap} points needed`,
    trend,
    proposedFixes: patchGoals.slice(0, 5).map(g => ({ category: g.category, issue: g.issue, suggestion: g.suggestion })),
    options: [
      { id: "approve", label: "Approve & Continue", description: "Apply patches and continue to next iteration" },
      { id: "reject", label: "Reject & Finalize", description: "Use current result without more patching" },
      { id: "custom", label: "Custom Instruction", description: "Provide specific guidance for next iteration" }
    ]
  };
}

export function processUserDecision(decision: string, customInstruction: string | null = null): { shouldContinue: boolean; instruction: string } {
  switch (decision) {
    case "approve":
      return { shouldContinue: true, instruction: "Apply proposed patches and continue iteration" };
    case "reject":
      return { shouldContinue: false, instruction: "Finalize current result without further patching" };
    case "custom":
      if (!customInstruction) return { shouldContinue: false, instruction: "No custom instruction provided, finalizing" };
      return { shouldContinue: true, instruction: `Custom guidance for LLM: ${customInstruction}` };
    default:
      return { shouldContinue: false, instruction: "Invalid decision" };
  }
}

export function getAutonomousStrategy(context: AutonomousStrategyContext): { strategy: string; confidence: number; explanation: string } {
  const { currentScore, previousScores = [], agentMemory, iterationNum, maxIterations } = context;

  const trend = previousScores.length > 1
    ? previousScores[previousScores.length - 1]! - previousScores[previousScores.length - 2]!
    : 0;

  const effectiveness = agentMemory?.getAveragePatchEffectiveness?.() || 0;

  if (trend > 5) return { strategy: "accelerate", confidence: 0.9, explanation: "Score improving steadily, increase patch ambition" };
  if (trend > 0) return { strategy: "continue", confidence: 0.7, explanation: "Modest improvement, continue with similar patches" };
  if (trend === 0 && effectiveness > 0.5) return { strategy: "experimental", confidence: 0.6, explanation: "Stalled but patches have potential, try experimental combinations" };
  if (iterationNum >= maxIterations - 1) return { strategy: "finale", confidence: 0.5, explanation: "Final iteration, apply all promising patches" };

  return { strategy: "stop", confidence: 0.8, explanation: "No progress detected, should finalize" };
}

export function buildModeConfig(mode: string, overrides: Partial<ModeConfig> = {}): ModeConfig {
  return {
    ...(MODE_CONFIGS[mode as ExecutionMode] || MODE_CONFIGS.assisted),
    ...overrides
  };
}

export function isValidMode(mode: string): mode is ExecutionMode {
  return Object.keys(MODE_CONFIGS).includes(mode);
}

export function getAvailableModes() {
  return Object.entries(MODE_CONFIGS).map(([key, config]) => ({ id: key, ...config }));
}
