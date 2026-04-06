import { getSkillRuntimeProfile } from "./skill-loader.js";
import { SandboxPoolManager } from "@visual-runtime/sandbox-pool";

function parsePositiveIntEnv(rawValue, fallbackValue, minimum = 1) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }

  return Math.max(minimum, parsed);
}

// We maintain a single instance of the on-demand pool manager
const poolManager = new SandboxPoolManager();
const runtimeAcquireBudgetMs = parsePositiveIntEnv(
  process.env.RUNTIME_ACQUIRE_BUDGET_MS,
  12_000,
  1_000
);

function cloneAcquireDiagnostics(diagnostics) {
  if (!diagnostics || typeof diagnostics !== "object") {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(diagnostics));
  } catch {
    return null;
  }
}

function resolveAcquireDeadlineAtMs(turnDeadlineAtMs) {
  const now = Date.now();
  const acquireBudgetDeadlineAtMs = now + runtimeAcquireBudgetMs;
  const turnDeadline = Number.isFinite(turnDeadlineAtMs) ? turnDeadlineAtMs : Number.POSITIVE_INFINITY;
  const resolved = Math.min(acquireBudgetDeadlineAtMs, turnDeadline);
  return Number.isFinite(resolved) ? resolved : null;
}

function remainingBudgetMs(deadlineAtMs) {
  if (!Number.isFinite(deadlineAtMs)) {
    return Number.POSITIVE_INFINITY;
  }

  return deadlineAtMs - Date.now();
}

export function getSandboxRuntimeMetrics() {
  return poolManager.getMetricsSnapshot();
}

export function warmupSandboxForSkill(skillId) {
  if (!skillId) {
    return;
  }

  poolManager.requestWarmup(skillId);
}

export async function shutdownSandboxRuntime(options = {}) {
  await poolManager.shutdown(options);
}

export async function executeSkillRuntime({ skillId, code, timeoutMs, maxFrames, turnDeadlineAtMs = null }) {
  const skill = getSkillRuntimeProfile(skillId);
  const startedAt = Date.now();
  const acquireDeadlineAtMs = resolveAcquireDeadlineAtMs(turnDeadlineAtMs);

  try {
    const acquireBudgetMs = remainingBudgetMs(acquireDeadlineAtMs);
    if (acquireBudgetMs <= 0) {
      const budgetError = new Error("Runtime budget exhausted before sandbox acquisition.");
      budgetError.code = "RUNTIME_BUDGET_EXHAUSTED";
      throw budgetError;
    }

    // Acquire a daytona sandbox (on-demand)
    const sandboxEnv = await poolManager.acquire({
      skillId,
      turnDeadlineAtMs: acquireDeadlineAtMs
    });
    const acquireDiagnostics = cloneAcquireDiagnostics(sandboxEnv?._acquireDiagnostics);
    console.log(`[RT] [TRACE] Acquired sandbox ${sandboxEnv.workspaceId} for ${skillId}.`);

    const executionBudgetMs = remainingBudgetMs(turnDeadlineAtMs);
    if (executionBudgetMs <= 0) {
      await poolManager.release(sandboxEnv);
      const budgetError = new Error("Runtime budget exhausted before sandbox execution.");
      budgetError.code = "RUNTIME_BUDGET_EXHAUSTED";
      throw budgetError;
    }

    const boundedExecutionBudgetMs = Number.isFinite(executionBudgetMs)
      ? Math.max(1, Math.floor(executionBudgetMs))
      : null;
    const configuredExecutionTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : null;
    const effectiveTimeoutMs = configuredExecutionTimeoutMs !== null
      ? Math.max(1, boundedExecutionBudgetMs !== null ? Math.min(configuredExecutionTimeoutMs, boundedExecutionBudgetMs) : configuredExecutionTimeoutMs)
      : (boundedExecutionBudgetMs ?? 2200);

    // Prepare execution payload for the isolated container
    const payload = JSON.stringify({
      skill,
      code,
      timeoutMs: effectiveTimeoutMs,
      maxFrames
    });

    console.log(`[RT] [TRACE] Executing payload on ${sandboxEnv.workspaceId}...`);
    // Execute the payload inside Daytona Node environment safely
    const resultObj = await sandboxEnv.execute(payload);

    console.log(`[RT] [TRACE] Execution finished. Success: ${resultObj.success}, RenderCount: ${resultObj.renderCount}.`);

    // Reap the sandbox instance
    await poolManager.release(sandboxEnv);

    const normalizedRenderCount = Number(resultObj.renderCount || 0);
    const noRenderWarning = resultObj.success && normalizedRenderCount === 0
      ? "Runtime executed successfully but produced zero renders."
      : null;

    // Reconstruct the response required by Orchestrator
    return {
      success: resultObj.success,
      status: resultObj.status,
      previewUrl: resultObj.success ? "about:blank" : null,
      skillId: skill.id,
      skillName: skill.name,
      dependencyCount: skill.dependencies.length,
      durationMs: Date.now() - startedAt,
      renderCount: normalizedRenderCount,
      frameCount: resultObj.frameCount || 0,
      logs: resultObj.logs || [],
      summary: resultObj.summary || { childCount: 0, types: [] },
      frameBudgetReached: resultObj.frameBudgetReached || false,
      warning: noRenderWarning ?? resultObj.warning ?? null,
      warningCode: noRenderWarning ? "RUNTIME_NO_RENDER_ACTIVITY" : null,
      error: resultObj.error || null,
      errorCode: null,
      acquireDiagnostics
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const acquireDiagnostics = cloneAcquireDiagnostics(error?.acquireDiagnostics);
    return {
      success: false,
      status: "error",
      previewUrl: null,
      skillId: skill.id,
      skillName: skill.name,
      dependencyCount: skill.dependencies.length,
      durationMs,
      renderCount: 0,
      frameCount: 0,
      logs: [],
      error: error?.message || String(error),
      errorCode: error?.code ? String(error.code) : null,
      warningCode: null,
      acquireDiagnostics
    };
  }
}
