/**
 * Agent Memory - Session-scoped learning system for agentic quality loops
 *
 * This module tracks iterations, successful patches, and failed approaches
 * to enable agents to learn and avoid repetition within a session.
 *
 * Features:
 * - Iteration history tracking
 * - Pattern learning and success rate tracking
 * - Failure detection and avoidance
 * - Conversation context maintenance
 * - Context summarization for next iteration
 */

/**
 * @typedef {Object} IterationRecord
 * @property {number} iterationNum - Iteration number (1, 2, 3...)
 * @property {string} codeSnippet - First 200 chars of generated code
 * @property {number} score - Quality score (0-100)
 * @property {Array<string>} issues - Quality issues detected
 * @property {Array<string>} patchesApplied - Applied patch descriptions
 * @property {number} timestamp - When iteration completed
 * @property {number} durationMs - How long iteration took
 */

/**
 * @typedef {Object} PatchAttempt
 * @property {string} category - Issue category
 * @property {string} description - What was tried
 * @property {boolean} successful - Did it improve score?
 * @property {number} scoreImpact - How much score changed
 * @property {number} timestamp - When attempted
 */

/**
 * @typedef {Object} ConversationTurn
 * @property {string} role - 'user' | 'agent' | 'system'
 * @property {string} content - Message content
 * @property {number} timestamp - When sent
 */

export class AgentMemory {
  /**
   * Create a new agent memory instance
   * @param {string} sessionId - Unique session identifier
   * @param {string} skill - Skill being used (threejs, p5js, etc.)
   * @param {Object} [options] - Configuration options
   */
  constructor(sessionId, skill, options = {}) {
    this.sessionId = sessionId;
    this.skill = skill;
    this.maxHistorySize = options.maxHistorySize || 10;
    this.maxConversationSize = options.maxConversationSize || 50;

    this.iterationHistory = [];
    this.attemptedPatches = [];
    this.failedApproaches = [];
    this.successPatterns = {}; // { category → cumulative score impact }
    this.conversationContext = [];

    this.createdAt = Date.now();
  }

  /**
   * Record a completed iteration
   * @param {number} iteration - Iteration number
   * @param {string} code - Generated code
   * @param {number} score - Quality score
   * @param {Array<string>} issues - Detected issues
   * @param {Array<Object>} patches - Applied patches
   * @param {number} durationMs - How long it took
   */
  recordIteration(iteration, code, score, issues, patches, durationMs) {
    const record = {
      iterationNum: iteration,
      codeSnippet: code.substring(0, 200),
      score,
      issues: issues || [],
      patchesApplied: (patches || []).map(p => p.explanation),
      timestamp: Date.now(),
      durationMs
    };

    this.iterationHistory.push(record);

    // Keep history bounded
    if (this.iterationHistory.length > this.maxHistorySize) {
      this.iterationHistory.shift();
    }

    return record;
  }

  /**
   * Record the outcome of a patch attempt
   * @param {string} category - Issue category (structure, performance, visual, api)
   * @param {string} description - What was attempted
   * @param {boolean} successful - Did it improve?
   * @param {number} scoreImpact - Score change
   */
  recordPatchOutcome(category, description, successful, scoreImpact) {
    const attempt = {
      category,
      description: description.substring(0, 100),
      successful,
      scoreImpact,
      timestamp: Date.now()
    };

    this.attemptedPatches.push(attempt);

    // Update success patterns
    if (!this.successPatterns[category]) {
      this.successPatterns[category] = { count: 0, totalImpact: 0 };
    }

    if (successful && scoreImpact > 0) {
      this.successPatterns[category].count += 1;
      this.successPatterns[category].totalImpact += scoreImpact;
    }

    // Keep history bounded
    if (this.attemptedPatches.length > this.maxHistorySize * 2) {
      this.attemptedPatches.shift();
    }

    return attempt;
  }

  /**
   * Record a failed approach to avoid repeating
   * @param {string} description - Description of what failed
   */
  recordFailedApproach(description) {
    const normalized = description.toLowerCase().trim();

    if (!this.failedApproaches.includes(normalized)) {
      this.failedApproaches.push(normalized);

      // Keep list bounded
      if (this.failedApproaches.length > 20) {
        this.failedApproaches.shift();
      }
    }
  }

  /**
   * Check if an approach has been tried and failed before
   * @param {string} description - Proposed approach
   * @returns {boolean}
   */
  hasTriedApproach(description) {
    const normalized = description.toLowerCase().trim();
    return this.failedApproaches.some(
      failed => failed.includes(normalized) || normalized.includes(failed)
    );
  }

  /**
   * Add conversation turn to context
   * @param {string} role - 'user' | 'agent' | 'system'
   * @param {string} content - Message content
   */
  addConversationTurn(role, content) {
    this.conversationContext.push({
      role,
      content: content.substring(0, 200),
      timestamp: Date.now()
    });

    // Keep conversation bounded
    if (this.conversationContext.length > this.maxConversationSize) {
      this.conversationContext.shift();
    }
  }

  /**
   * Get conversation history as formatted string
   * @param {number} [maxTurns] - Max turns to include
   * @returns {string}
   */
  getConversationHistory(maxTurns = 10) {
    const turns = this.conversationContext.slice(-maxTurns);
    return turns
      .map(turn => `${turn.role}: ${turn.content}`)
      .join('\n');
  }

  /**
   * Get score progression
   * @returns {Array<number>}
   */
  getScoreProgression() {
    return this.iterationHistory.map(i => i.score);
  }

  /**
   * Get best score achieved
   * @returns {number}
   */
  getBestScore() {
    if (this.iterationHistory.length === 0) return 0;
    return Math.max(...this.iterationHistory.map(i => i.score));
  }

  /**
   * Get average patch effectiveness
   * @returns {number}
   */
  getAveragePatchEffectiveness() {
    if (this.attemptedPatches.length === 0) return 0;

    const successful = this.attemptedPatches.filter(p => p.successful);
    if (successful.length === 0) return 0;

    const totalImpact = successful.reduce((sum, p) => sum + p.scoreImpact, 0);
    return totalImpact / successful.length;
  }

  /**
   * Get context for next iteration
   * Creates a summary suitable for LLM prompt injection
   * @returns {Object}
   */
  getContextForNextIteration() {
    const scores = this.getScoreProgression();
    const trend = scores.length >= 2
      ? scores[scores.length - 1] > scores[scores.length - 2]
        ? 'improving'
        : 'declining'
      : 'neutral';

    // Best performing categories
    const topCategories = Object.entries(this.successPatterns)
      .map(([cat, data]) => ({
        category: cat,
        avgImpact: data.count > 0 ? data.totalImpact / data.count : 0,
        count: data.count
      }))
      .filter(c => c.count > 0)
      .sort((a, b) => b.avgImpact - a.avgImpact)
      .slice(0, 3)
      .map(c => `${c.category} (+${c.avgImpact.toFixed(1)} avg)`);

    // Recent issues
    const recentIssues = this.iterationHistory.length > 0
      ? this.iterationHistory[this.iterationHistory.length - 1].issues
      : [];

    return {
      iterationCount: this.iterationHistory.length,
      scoreTrend: trend,
      previousScores: scores,
      bestScore: this.getBestScore(),
      topPerformingPatches: topCategories,
      recentIssues: recentIssues,
      conversationContext: this.getConversationHistory(5),
      failedApproaches: this.failedApproaches.slice(-5),
      averagePatchEffectiveness: this.getAveragePatchEffectiveness()
    };
  }

  /**
   * Get memory summary for logging
   * @returns {Object}
   */
  getSummary() {
    return {
      sessionId: this.sessionId,
      skill: this.skill,
      createdAt: this.createdAt,
      durationMs: Date.now() - this.createdAt,
      iterationCount: this.iterationHistory.length,
      scoreProgression: this.getScoreProgression(),
      bestScore: this.getBestScore(),
      patchAttempts: this.attemptedPatches.length,
      successfulPatches: this.attemptedPatches.filter(p => p.successful).length,
      failedApproaches: this.failedApproaches.length,
      conversationTurns: this.conversationContext.length
    };
  }

  /**
   * Export memory as JSON
   * @returns {Object}
   */
  toJSON() {
    return {
      sessionId: this.sessionId,
      skill: this.skill,
      createdAt: this.createdAt,
      iterationHistory: this.iterationHistory,
      attemptedPatches: this.attemptedPatches,
      failedApproaches: this.failedApproaches,
      successPatterns: this.successPatterns,
      conversationContext: this.conversationContext
    };
  }

  /**
   * Clear all memory (use with caution)
   */
  clear() {
    this.iterationHistory = [];
    this.attemptedPatches = [];
    this.failedApproaches = [];
    this.successPatterns = {};
    this.conversationContext = [];
  }
}

/**
 * Create context injections for LLM prompts
 * @param {AgentMemory} memory - Agent memory instance
 * @returns {string} - Formatted context for prompt
 */
export function createMemoryContext(memory) {
  const context = memory.getContextForNextIteration();

  let prompt = '';

  if (context.iterationCount > 1) {
    prompt += `You are improving generated code. Progress so far:\n`;
    prompt += `- Iterations: ${context.iterationCount}\n`;
    prompt += `- Score trend: ${context.scoreTrend} (best: ${context.bestScore}/100)\n`;
    prompt += `- Previous scores: [${context.previousScores.join(', ')}]\n`;
  }

  if (context.topPerformingPatches.length > 0) {
    prompt += `\nSuccessful improvements in this session:\n`;
    context.topPerformingPatches.forEach(p => {
      prompt += `- ${p}\n`;
    });
  }

  if (context.failedApproaches.length > 0) {
    prompt += `\nDo NOT repeat these failed approaches:\n`;
    context.failedApproaches.forEach(f => {
      prompt += `- ${f}\n`;
    });
  }

  if (context.recentIssues.length > 0) {
    prompt += `\nCurrent issues to fix:\n`;
    context.recentIssues.forEach(issue => {
      prompt += `- ${issue}\n`;
    });
  }

  return prompt;
}
