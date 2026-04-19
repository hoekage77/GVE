/**
 * Agent Memory - Session-scoped learning system for agentic quality loops
 */

export interface IterationRecord {
  iterationNum: number;
  codeSnippet: string;
  score: number;
  issues: string[];
  patchesApplied: string[];
  timestamp: number;
  durationMs: number;
}

export interface PatchAttempt {
  category: string;
  description: string;
  successful: boolean;
  scoreImpact: number;
  timestamp: number;
}

export interface ConversationTurn {
  role: "user" | "agent" | "system";
  content: string;
  timestamp: number;
}

export class AgentMemory {
  sessionId: string;
  skill: string;
  maxHistorySize: number;
  maxConversationSize: number;

  iterationHistory: IterationRecord[];
  attemptedPatches: PatchAttempt[];
  failedApproaches: string[];
  successPatterns: Record<string, { count: number; totalImpact: number }>;
  conversationContext: ConversationTurn[];
  createdAt: number;

  constructor(sessionId: string, skill: string, options: any = {}) {
    this.sessionId = sessionId;
    this.skill = skill;
    this.maxHistorySize = options.maxHistorySize || 10;
    this.maxConversationSize = options.maxConversationSize || 50;

    this.iterationHistory = [];
    this.attemptedPatches = [];
    this.failedApproaches = [];
    this.successPatterns = {};
    this.conversationContext = [];

    this.createdAt = Date.now();
  }

  recordIteration(iteration: number, code: string, score: number, issues: string[], patches: any[], durationMs: number): IterationRecord {
    const record: IterationRecord = {
      iterationNum: iteration,
      codeSnippet: code.substring(0, 200),
      score,
      issues: issues || [],
      patchesApplied: (patches || []).map(p => p.explanation),
      timestamp: Date.now(),
      durationMs
    };

    this.iterationHistory.push(record);

    if (this.iterationHistory.length > this.maxHistorySize) {
      this.iterationHistory.shift();
    }

    return record;
  }

  recordPatchOutcome(category: string, description: string, successful: boolean, scoreImpact: number): PatchAttempt {
    const attempt: PatchAttempt = {
      category,
      description: description.substring(0, 100),
      successful,
      scoreImpact,
      timestamp: Date.now()
    };

    this.attemptedPatches.push(attempt);

    if (!this.successPatterns[category]) {
      this.successPatterns[category] = { count: 0, totalImpact: 0 };
    }

    if (successful && scoreImpact > 0) {
      this.successPatterns[category].count += 1;
      this.successPatterns[category].totalImpact += scoreImpact;
    }

    if (this.attemptedPatches.length > this.maxHistorySize * 2) {
      this.attemptedPatches.shift();
    }

    return attempt;
  }

  recordFailedApproach(description: string): void {
    const normalized = description.toLowerCase().trim();

    if (!this.failedApproaches.includes(normalized)) {
      this.failedApproaches.push(normalized);

      if (this.failedApproaches.length > 20) {
        this.failedApproaches.shift();
      }
    }
  }

  hasTriedApproach(description: string): boolean {
    const normalized = description.toLowerCase().trim();
    return this.failedApproaches.some(failed => failed.includes(normalized) || normalized.includes(failed));
  }

  addConversationTurn(role: "user" | "agent" | "system", content: string): void {
    this.conversationContext.push({
      role,
      content: content.substring(0, 200),
      timestamp: Date.now()
    });

    if (this.conversationContext.length > this.maxConversationSize) {
      this.conversationContext.shift();
    }
  }

  getConversationHistory(maxTurns = 10): string {
    const turns = this.conversationContext.slice(-maxTurns);
    return turns.map(turn => `${turn.role}: ${turn.content}`).join('\n');
  }

  getScoreProgression(): number[] {
    return this.iterationHistory.map(i => i.score);
  }

  getBestScore(): number {
    if (this.iterationHistory.length === 0) return 0;
    return Math.max(...this.iterationHistory.map(i => i.score));
  }

  getAveragePatchEffectiveness(): number {
    if (this.attemptedPatches.length === 0) return 0;

    const successful = this.attemptedPatches.filter(p => p.successful);
    if (successful.length === 0) return 0;

    const totalImpact = successful.reduce((sum, p) => sum + p.scoreImpact, 0);
    return totalImpact / successful.length;
  }

  getContextForNextIteration(): any {
    const scores = this.getScoreProgression();
    const trend = scores.length >= 2
      ? scores[scores.length - 1]! > scores[scores.length - 2]!
        ? 'improving'
        : 'declining'
      : 'neutral';

    const topCategories = Object.entries(this.successPatterns)
      .map(([cat, data]) => ({
        category: cat,
        avgImpact: data!.count > 0 ? data!.totalImpact / data!.count : 0,
        count: data!.count
      }))
      .filter(c => c.count > 0)
      .sort((a, b) => b.avgImpact - a.avgImpact)
      .slice(0, 3)
      .map(c => `${c.category} (+${c.avgImpact.toFixed(1)} avg)`);

    const recentIssues = this.iterationHistory.length > 0
      ? this.iterationHistory[this.iterationHistory.length - 1]!.issues
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

  getSummary(): any {
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

  toJSON(): any {
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

  clear(): void {
    this.iterationHistory = [];
    this.attemptedPatches = [];
    this.failedApproaches = [];
    this.successPatterns = {};
    this.conversationContext = [];
  }
}

export function createMemoryContext(memory: AgentMemory): string {
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
    context.topPerformingPatches.forEach((p: string) => {
      prompt += `- ${p}\n`;
    });
  }

  if (context.failedApproaches.length > 0) {
    prompt += `\nDo NOT repeat these failed approaches:\n`;
    context.failedApproaches.forEach((f: string) => {
      prompt += `- ${f}\n`;
    });
  }

  if (context.recentIssues.length > 0) {
    prompt += `\nCurrent issues to fix:\n`;
    context.recentIssues.forEach((issue: string) => {
      prompt += `- ${issue}\n`;
    });
  }

  return prompt;
}
