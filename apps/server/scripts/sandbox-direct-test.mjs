import "../server/env.js";
import { SandboxPoolManager } from "@visual-runtime/sandbox-pool";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPrewarm(manager, maxWaitMs = 90000) {
  const startedAt = Date.now();
  const deadline = startedAt + maxWaitMs;

  while (Date.now() < deadline) {
    const metrics = manager.getMetricsSnapshot();
    if (metrics.idleSandboxes > 0) {
      return {
        ready: true,
        waitedMs: Date.now() - startedAt
      };
    }
    await wait(1000);
  }

  return {
    ready: false,
    waitedMs: Date.now() - startedAt
  };
}

const manager = new SandboxPoolManager();
const startedAt = Date.now();

try {
  manager.requestWarmup("sandbox-direct-script");
  const prewarm = await waitForPrewarm(manager, 90000);

  const deadline = Date.now() + 120000;
  const first = await manager.acquire({
    skillId: "threejs",
    turnDeadlineAtMs: deadline
  });
  await manager.release(first);

  const second = await manager.acquire({
    skillId: "threejs",
    turnDeadlineAtMs: deadline
  });
  await manager.release(second);

  const summary = {
    ok: true,
    elapsedMs: Date.now() - startedAt,
    prewarmReady: prewarm.ready,
    prewarmWaitMs: prewarm.waitedMs,
    firstSource: first._source,
    secondSource: second._source,
    reusedSameWorkspace: first.workspaceId === second.workspaceId,
    metrics: manager.getMetricsSnapshot()
  };

  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        error: error?.message || String(error),
        metrics: manager.getMetricsSnapshot()
      },
      null,
      2
    )
  );
  process.exitCode = 1;
} finally {
  await manager.shutdown({ deleteIdleSandboxes: true });
}
