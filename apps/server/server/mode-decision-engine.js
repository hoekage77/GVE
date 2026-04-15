/**
 * Mode Decision Engine - Autonomous vs. Assisted vs. Strict execution modes
 *
 * This module implements the decision logic for how iterations should proceed
 * based on the execution mode. It handles:
 * - Autonomous: Agent self-directs improvements
 * - Assisted: Agent proposes, user approves
 * - Strict: User maintains full control
 */

/**
 * @typedef {Object} ModeConfig
 * @property {'autonomous' | 'assisted' | 'strict'} mode
 * @property {number} maxIterations
 * @property {number} qualityThreshold
 * @property {boolean} enableAutoPatch
 * @property {boolean} userApprovalRequired
 */

/** Mode configurations */
export const MODE_CONFIGS = {
  autonomous: {
    mode: 'autonomous',
    maxIterations: 3,
    qualityThreshold: 85,
    enableAutoPatch: true,
    userApprovalRequired: false,
    description: 'Agent self-directs improvements without user input'
  },

  assisted: {
    mode: 'assisted',
    maxIterations: 2,
    qualityThreshold: 75,
    enableAutoPatch: true,
    userApprovalRequired: true,
    description: 'Agent proposes patches, user approves each iteration'
  },

  strict: {
    mode: 'strict',
    maxIterations: 1,
    qualityThreshold: 60,
    enableAutoPatch: false,
    userApprovalRequired: true,
    description: 'User maintains full control, no auto-patches'
  }
};

/**
 * Determine execution mode from quality tier
 * @param {'draft' | 'standard' | 'high'} quality - Quality tier from user
 * @returns {'autonomous' | 'assisted' | 'strict'}
 */
export function determineModeFromQuality(quality) {
  switch (quality) {
    case 'draft':
      return 'strict'; // No iteration
    case 'high':
      return 'autonomous'; // Max iterations, auto-patch
    case 'standard':
    default:
      return 'assisted'; // Balanced: iterate but ask approval
  }
}

/**
 * Determine if iteration should stop
 * @param {Object} context - Decision context
 * @returns {Object} - { shouldStop: boolean, reason: string, action: string }
 */
export function shouldIterationStop(context) {
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

  const config = MODE_CONFIGS[mode];

  // Stop condition 1: Quality threshold met
  if (currentScore >= qualityThreshold) {
    return {
      shouldStop: true,
      reason: 'threshold_met',
      action: 'finalize',
      message: `Quality threshold reached (${currentScore} >= ${qualityThreshold})`
    };
  }

  // Stop condition 2: Max iterations exhausted
  if (iterationNum >= maxIterations) {
    return {
      shouldStop: true,
      reason: 'budget_exhausted',
      action: 'finalize',
      message: `Maximum iterations reached (${iterationNum}/${maxIterations})`
    };
  }

  // Stop condition 3: No fixable issues
  if (!patchGoals || patchGoals.length === 0) {
    return {
      shouldStop: true,
      reason: 'no_fix_available',
      action: 'finalize',
      message: 'No fixable issues detected'
    };
  }

  // Stop condition 4: Repeating failure pattern (in agent memory)
  if (agentMemory?.failedApproaches && patchGoals.length > 0) {
    const suggestedFixes = patchGoals.map(g => g.suggestion).join(' ');
    const isRepeating = agentMemory.failedApproaches.some(
      failed => suggestedFixes.toLowerCase().includes(failed.toLowerCase())
    );

    if (isRepeating) {
      return {
        shouldStop: true,
        reason: 'repeating_failure',
        action: 'error_with_warning',
        message: 'Same fixes were tried before and failed'
      };
    }
  }

  // Mode-specific decision logic
  switch (mode) {
    case 'strict':
      // Strict mode: Always require user decision
      return {
        shouldStop: false,
        reason: 'awaiting_user_decision',
        action: 'pause_for_approval',
        message: 'Awaiting user decision',
        nextAction: 'User must approve or reject iteration'
      };

    case 'assisted':
      // Assisted mode: Ask user for approval
      if (iterationNum === 1) {
        // After first iteration, ask if user wants to continue
        return {
          shouldStop: false,
          reason: 'awaiting_user_approval',
          action: 'pause_for_approval',
          message: 'User approval required to continue',
          proposedPatches: patchGoals,
          nextAction: 'Waiting for user to approve/reject patches'
        };
      }
      // If user approved in previous iteration, continue
      if (userApproved) {
        return {
          shouldStop: false,
          reason: 'user_approved',
          action: 'continue',
          message: 'User approved, continuing iteration'
        };
      }
      // Shouldn't reach here, but fall through to continue
      return {
        shouldStop: false,
        reason: 'autonomous_improvement',
        action: 'continue',
        message: 'Continuing with assisted patches'
      };

    case 'autonomous': {
      // Autonomous mode: Agent decides
      // Calculate improvement trend
      const scores = agentMemory?.getScoreProgression?.() || [currentScore];
      const prevScore = scores.length > 1 ? scores[scores.length - 2] : currentScore;
      const improving = currentScore > prevScore;

      // If improving, keep going
      if (improving) {
        return {
          shouldStop: false,
          reason: 'autonomous_improvement',
          action: 'continue_autonomous',
          message: `Autonomous: Score improving (${prevScore} → ${currentScore}), continuing`,
          confidence: 'high'
        };
      }

      // If not improving but still have attempts, try once more
      if (iterationNum < maxIterations - 1) {
        return {
          shouldStop: false,
          reason: 'autonomous_retry',
          action: 'continue_experimental',
          message: 'Autonomous: Score stalled, attempting experimental patch',
          confidence: 'medium'
        };
      }

      // No improvement and one attempt left
      return {
        shouldStop: true,
        reason: 'no_improvement_stalled',
        action: 'finalize',
        message: 'Autonomous: No improvement detected, finalizing'
      };
    }

    default:
      return {
        shouldStop: false,
        reason: 'unknown',
        action: 'continue',
        message: 'Continuing iteration'
      };
  }
}

/**
 * Create user-facing decision prompt
 * Used in "assisted" mode to ask for approval
 * @param {Object} context
 * @returns {Object} - Structured decision prompt
 */
export function createApprovalPrompt(context) {
  const {
    currentScore,
    qualityThreshold,
    iterationNum,
    patchGoals = [],
    previousScores = []
  } = context;

  const scoreGap = qualityThreshold - currentScore;
  const trend = previousScores.length > 1
    ? previousScores[previousScores.length - 1] > previousScores[previousScores.length - 2]
      ? '📈 improving'
      : '📉 declining'
    : '➡️  stable';

  return {
    title: `Iteration ${iterationNum} - Approval Required`,
    currentScore: `${currentScore}/100`,
    qualityThreshold: `${qualityThreshold}/100`,
    scoreGap: `${scoreGap} points needed`,
    trend,
    proposedFixes: patchGoals.slice(0, 5).map(g => ({
      category: g.category,
      issue: g.issue,
      suggestion: g.suggestion
    })),
    options: [
      {
        id: 'approve',
        label: 'Approve & Continue',
        description: 'Apply patches and continue to next iteration'
      },
      {
        id: 'reject',
        label: 'Reject & Finalize',
        description: 'Use current result without more patching'
      },
      {
        id: 'custom',
        label: 'Custom Instruction',
        description: 'Provide specific guidance for next iteration'
      }
    ]
  };
}

/**
 * Process user decision for assisted mode
 * @param {string} decision - 'approve' | 'reject' | 'custom'
 * @param {string} [customInstruction] - Custom instruction if decision is 'custom'
 * @returns {Object} - { shouldContinue, instruction }
 */
export function processUserDecision(decision, customInstruction = null) {
  switch (decision) {
    case 'approve':
      return {
        shouldContinue: true,
        instruction: 'Apply proposed patches and continue iteration'
      };

    case 'reject':
      return {
        shouldContinue: false,
        instruction: 'Finalize current result without further patching'
      };

    case 'custom':
      if (!customInstruction) {
        return {
          shouldContinue: false,
          instruction: 'No custom instruction provided, finalizing'
        };
      }
      return {
        shouldContinue: true,
        instruction: `Custom guidance for LLM: ${customInstruction}`
      };

    default:
      return {
        shouldContinue: false,
        instruction: 'Invalid decision'
      };
  }
}

/**
 * Autonomous mode: Calculate next action heuristics
 * Used internally to decide iteration strategy
 * @param {Object} context
 * @returns {Object} - { strategy, confidence, explanation }
 */
export function getAutonomousStrategy(context) {
  const {
    currentScore,
    previousScores = [],
    patchGoals = [],
    agentMemory,
    iterationNum,
    maxIterations
  } = context;

  // Score trend analysis
  const trend = previousScores.length > 1
    ? previousScores[previousScores.length - 1] - previousScores[previousScores.length - 2]
    : 0;

  // Pattern effectiveness
  const effectiveness = agentMemory?.getAveragePatchEffectiveness?.() || 0;

  // Decision heuristics
  if (trend > 5) {
    // Good progress, keep going
    return {
      strategy: 'accelerate',
      confidence: 0.9,
      explanation: 'Score improving steadily, increase patch ambition'
    };
  }

  if (trend > 0) {
    // Some progress, continue carefully
    return {
      strategy: 'continue',
      confidence: 0.7,
      explanation: 'Modest improvement, continue with similar patches'
    };
  }

  if (trend === 0 && effectiveness > 0.5) {
    // Stalled but patches have worked before
    return {
      strategy: 'experimental',
      confidence: 0.6,
      explanation: 'Stalled but patches have potential, try experimental combinations'
    };
  }

  if (iterationNum >= maxIterations - 1) {
    // Last chance
    return {
      strategy: 'finale',
      confidence: 0.5,
      explanation: 'Final iteration, apply all promising patches'
    };
  }

  // No progress, probably should stop
  return {
    strategy: 'stop',
    confidence: 0.8,
    explanation: 'No progress detected, should finalize'
  };
}

/**
 * Build mode-aware iteration config
 * @param {string} mode - Execution mode
 * @param {Object} [overrides] - Override specific settings
 * @returns {ModeConfig}
 */
export function buildModeConfig(mode, overrides = {}) {
  return {
    ...MODE_CONFIGS[mode] || MODE_CONFIGS.assisted,
    ...overrides
  };
}

/**
 * Validate mode value
 * @param {string} mode
 * @returns {boolean}
 */
export function isValidMode(mode) {
  return Object.keys(MODE_CONFIGS).includes(mode);
}

/**
 * Get all available modes
 * @returns {Array<Object>} - Array of mode info
 */
export function getAvailableModes() {
  return Object.entries(MODE_CONFIGS).map(([key, config]) => ({
    id: key,
    ...config
  }));
}
