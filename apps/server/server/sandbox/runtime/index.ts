/**
 * Runtime Factory — Selects and instantiates the appropriate SkillRuntime.
 *
 * Environment variable `SKILL_RUNTIME` controls the backend:
 *   - "daytona"  → DaytonaSkillRuntime (default for production)
 *   - "docker"   → DockerSkillRuntime (default for dev/test)
 *   - "auto"     → Daytona if healthy, else Docker fallback
 *
 * Client-side rendering (edge rendering) for JS skills:
 *   When `CLIENT_RENDERING_ENABLED=true`, JavaScript skills (threejs, p5js,
 *   d3js, animejs) skip the backend sandbox and defer execution to the browser.
 *   The browser validates code with real WebGL/Canvas and reports back via
 *   WebSocket. This eliminates the mocked Node.js VM round-trip and uses the
 *   actual rendering engine for validation.
 */

import { DockerSkillRuntime } from "./docker-runtime.js";
import { DaytonaSkillRuntime, shutdownSandboxRuntime } from "./daytona-runtime.js";
import { ClientRenderingRuntime } from "./client-rendering-runtime.js";
import type { SkillRuntime } from "./types.js";

let cachedRuntime: SkillRuntime | null = null;
let clientRenderingRuntime: ClientRenderingRuntime | null = null;

const clientRenderingEnabled =
  process.env.CLIENT_RENDERING_ENABLED === "true" ||
  process.env.CLIENT_RENDERING_ENABLED === "1";

const JS_SKILL_IDS = new Set(["threejs", "p5js", "p5.js", "d3js", "d3", "animejs", "anime.js"]);

export function createSkillRuntime(preferred?: string, skillId?: string): SkillRuntime {
  const env = preferred ?? process.env.SKILL_RUNTIME ?? "docker";

  // Edge rendering: for JS skills, use browser-side validation when enabled
  if (clientRenderingEnabled && skillId && JS_SKILL_IDS.has(skillId)) {
    if (!clientRenderingRuntime) {
      clientRenderingRuntime = new ClientRenderingRuntime();
    }
    return clientRenderingRuntime;
  }

  if (env === "daytona") {
    cachedRuntime = new DaytonaSkillRuntime();
    return cachedRuntime;
  }

  if (env === "docker") {
    cachedRuntime = new DockerSkillRuntime();
    return cachedRuntime;
  }

  // "auto" — prefer Daytona if healthy, otherwise Docker
  cachedRuntime = new DaytonaSkillRuntime();
  return cachedRuntime;
}

export function getCachedRuntime(): SkillRuntime | null {
  return cachedRuntime;
}

export function resetCachedRuntime(): void {
  cachedRuntime = null;
}

export async function shutdownAllRuntimes(): Promise<void> {
  if (cachedRuntime?.provider === "daytona") {
    await shutdownSandboxRuntime();
  }
  cachedRuntime = null;
}

export { DockerSkillRuntime, DaytonaSkillRuntime, ClientRenderingRuntime };
export * from "./types.js";
export {
  storeClientValidationResult,
  getClientValidationResults,
  getLatestClientValidationResult,
  hasClientValidationFailed,
  getClientErrorContext,
  clearClientValidationCache
} from "./client-validation-cache.js";