import { getSkillRuntimeProfile } from "./skill-loader.js";
import { SandboxPoolManager } from "@visual-runtime/sandbox-pool";

// We maintain a single instance of the on-demand pool manager
const poolManager = new SandboxPoolManager();

export function getSandboxRuntimeMetrics() {
  return poolManager.getMetricsSnapshot();
}

export async function executeSkillRuntime({ skillId, code, timeoutMs, maxFrames }) {
  const skill = getSkillRuntimeProfile(skillId);
  const startedAt = Date.now();

  try {
    // Acquire a daytona sandbox (on-demand)
    const sandboxEnv = await poolManager.acquire({ skillId });
    console.log(`[RT] [TRACE] Acquired sandbox ${sandboxEnv.workspaceId} for ${skillId}.`);

    // Prepare execution payload for the isolated container
    const payload = JSON.stringify({
      skill,
      code,
      timeoutMs,
      maxFrames
    });

    console.log(`[RT] [TRACE] Executing payload on ${sandboxEnv.workspaceId}...`);
    // Execute the payload inside Daytona Node environment safely
    const resultObj = await sandboxEnv.execute(payload);

    console.log(`[RT] [TRACE] Execution finished. Success: ${resultObj.success}, RenderCount: ${resultObj.renderCount}.`);

    // Reap the sandbox instance
    await poolManager.release(sandboxEnv);

    // Reconstruct the response required by Orchestrator
    return {
      success: resultObj.success,
      status: resultObj.status,
      previewUrl: resultObj.success ? "about:blank" : null,
      skillId: skill.id,
      skillName: skill.name,
      dependencyCount: skill.dependencies.length,
      durationMs: Date.now() - startedAt,
      renderCount: resultObj.renderCount || 0,
      frameCount: resultObj.frameCount || 0,
      logs: resultObj.logs || [],
      summary: resultObj.summary || { childCount: 0, types: [] },
      frameBudgetReached: resultObj.frameBudgetReached || false,
      warning: resultObj.warning || null,
      error: resultObj.error || null
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
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
      error: error?.message || String(error)
    };
  }
}
