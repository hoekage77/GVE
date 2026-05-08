/**
 * Skill Metrics Store — Rolling-window execution metrics per skill.
 *
 * Tracks success rate, average duration, and recent errors for each skill.
 * Feeds back into the skill registry's executionReliability score.
 */

interface ExecutionRecord {
  success: boolean;
  durationMs: number;
  errorCode?: string | null;
  gpuRenderer?: string | null;
  timestamp: number;
}

interface SkillMetrics {
  skillId: string;
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  recentExecutions: ExecutionRecord[];
  averageDurationMs: number;
  lastExecutionAt: number | null;
  topErrorCodes: Map<string, number>;
}

const DEFAULT_WINDOW_SIZE = 50;
const MIN_SAMPLES_FOR_RELIABILITY = 5;

class SkillMetricsStore {
  private metrics = new Map<string, SkillMetrics>();
  private windowSize: number;

  constructor(windowSize = DEFAULT_WINDOW_SIZE) {
    this.windowSize = windowSize;
  }

  record(skillId: string, result: { success: boolean; durationMs: number; errorCode?: string | null; gpuRenderer?: string | null }): void {
    const now = Date.now();
    let metrics = this.metrics.get(skillId);

    if (!metrics) {
      metrics = {
        skillId,
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        recentExecutions: [],
        averageDurationMs: 0,
        lastExecutionAt: null,
        topErrorCodes: new Map()
      };
      this.metrics.set(skillId, metrics);
    }

    metrics.totalExecutions += 1;
    metrics.lastExecutionAt = now;

    if (result.success) {
      metrics.successCount += 1;
    } else {
      metrics.failureCount += 1;
      if (result.errorCode) {
        const current = metrics.topErrorCodes.get(result.errorCode) ?? 0;
        metrics.topErrorCodes.set(result.errorCode, current + 1);
      }
    }

    metrics.recentExecutions.push({
      success: result.success,
      durationMs: result.durationMs,
      errorCode: result.errorCode ?? null,
      gpuRenderer: result.gpuRenderer ?? null,
      timestamp: now
    });

    // Trim rolling window
    if (metrics.recentExecutions.length > this.windowSize) {
      const removed = metrics.recentExecutions.shift()!;
      if (removed.success) {
        metrics.successCount -= 1;
      } else {
        metrics.failureCount -= 1;
        if (removed.errorCode) {
          const current = metrics.topErrorCodes.get(removed.errorCode) ?? 1;
          if (current <= 1) metrics.topErrorCodes.delete(removed.errorCode);
          else metrics.topErrorCodes.set(removed.errorCode, current - 1);
        }
      }
    }

    // Recalculate average duration
    const totalDuration = metrics.recentExecutions.reduce((sum, r) => sum + r.durationMs, 0);
    metrics.averageDurationMs = metrics.recentExecutions.length > 0
      ? Math.round(totalDuration / metrics.recentExecutions.length)
      : 0;
  }

  getReliability(skillId: string): number | null {
    const metrics = this.metrics.get(skillId);
    if (!metrics || metrics.recentExecutions.length < MIN_SAMPLES_FOR_RELIABILITY) {
      return null;
    }
    return Math.round((metrics.successCount / metrics.recentExecutions.length) * 100) / 100;
  }

  getMetrics(skillId: string): SkillMetrics | null {
    return this.metrics.get(skillId) ?? null;
  }

  getAllMetrics(): SkillMetrics[] {
    return Array.from(this.metrics.values());
  }

  getSnapshot(): Record<string, { reliability: number | null; avgDurationMs: number; executions: number }> {
    const snapshot: Record<string, any> = {};
    for (const [skillId, metrics] of this.metrics) {
      snapshot[skillId] = {
        reliability: this.getReliability(skillId),
        avgDurationMs: metrics.averageDurationMs,
        executions: metrics.recentExecutions.length,
        failures: metrics.failureCount,
        lastExecutionAt: metrics.lastExecutionAt
      };
    }
    return snapshot;
  }

  reset(skillId?: string): void {
    if (skillId) {
      this.metrics.delete(skillId);
    } else {
      this.metrics.clear();
    }
  }
}

// Singleton instance for the application
const globalMetricsStore = new SkillMetricsStore();

export function getSkillMetricsStore(): SkillMetricsStore {
  return globalMetricsStore;
}

export function recordSkillExecution(
  skillId: string,
  result: { success: boolean; durationMs: number; errorCode?: string | null; gpuRenderer?: string | null }
): void {
  globalMetricsStore.record(skillId, result);
}

export function getSkillReliability(skillId: string): number | null {
  return globalMetricsStore.getReliability(skillId);
}

export { SkillMetricsStore };
export type { SkillMetrics, ExecutionRecord };