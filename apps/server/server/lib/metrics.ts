// @ts-nocheck
export const metrics = {
  sessionsCreated: 0,
  plansCreated: 0,
  tasksExecuted: 0,
  generations: 0,
  modifications: 0,
  undos: 0,
  redos: 0,
  revisionNavigations: 0,
  versionNavigations: 0,
  artifactNavigations: 0,
  errors: 0,
  latencies: []
};

export function recordLatency(durationMs: number) {
  metrics.latencies.push(durationMs);
  if (metrics.latencies.length > 500) {
    metrics.latencies = metrics.latencies.slice(-500);
  }
}

export function computeP95Latency() {
  if (metrics.latencies.length === 0) return 0;
  const sorted = [...metrics.latencies].sort((a, b) => a - b);
  const index = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(index, sorted.length - 1)];
}
