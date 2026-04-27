/**
 * Skill Runtime
 *
 * Executes specific skills within the sandbox environment, providing adapters for
 * Python/Manim and other specialized tools. Integrates with Daytona Pool Manager.
 */

import { getSkillRuntimeProfile } from "../skills/loader.js";
import { persistMediaArtifact } from "../routes/media.js";
import { SandboxPoolManager, toolRegistry } from "@visual-runtime/sandbox-pool";
import { DedicatedSandboxManager, setDedicatedSandboxInstance } from "./dedicated-manager.js";
import { traceEvent } from "../trace/events.js";
import { getTraceContext } from "../trace/context.js";

function parsePositiveIntEnv(rawValue: string | undefined | null, fallbackValue: number, minimum = 1): number {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }
  return Math.max(minimum, parsed);
}

function parseBooleanEnv(rawValue: string | undefined | null | boolean, fallbackValue: boolean): boolean {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return fallbackValue;
  }
  const normalized = String(rawValue).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallbackValue;
}

function escapeDoubleQuotedShellValue(value: string | undefined | null): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
}

const poolManager = new SandboxPoolManager();
const dedicatedSandboxManager = new DedicatedSandboxManager(poolManager);
setDedicatedSandboxInstance(dedicatedSandboxManager);

const runtimeAcquireBudgetMs = parsePositiveIntEnv(process.env.RUNTIME_ACQUIRE_BUDGET_MS, 12_000, 1_000);
const manimRenderWidth = parsePositiveIntEnv(process.env.MANIM_RENDER_WIDTH, 1920, 320);
const manimRenderHeight = parsePositiveIntEnv(process.env.MANIM_RENDER_HEIGHT, 1080, 240);
const manimRenderFps = parsePositiveIntEnv(process.env.MANIM_RENDER_FPS, 60, 12);
const manimInstallOnDemand = parseBooleanEnv(process.env.MANIM_PIP_INSTALL_ON_DEMAND, true);
const manimPipPackage = String(process.env.MANIM_PIP_PACKAGE ?? "manim==0.20.1").trim() || "manim==0.20.1";
const manimLatexInstallOnDemand = parseBooleanEnv(process.env.MANIM_LATEX_INSTALL_ON_DEMAND, true);
const defaultManimLatexAptPackages = "texlive-latex-base texlive-latex-extra texlive-fonts-recommended dvisvgm";
const manimLatexAptPackages = String(process.env.MANIM_LATEX_APT_PACKAGES ?? defaultManimLatexAptPackages).trim() || defaultManimLatexAptPackages;

function cloneAcquireDiagnostics(diagnostics: any): any {
  if (!diagnostics || typeof diagnostics !== "object") return null;
  try {
    return JSON.parse(JSON.stringify(diagnostics));
  } catch {
    return null;
  }
}

function resolveAcquireDeadlineAtMs(turnDeadlineAtMs: number | null): number | null {
  const now = Date.now();
  const acquireBudgetDeadlineAtMs = now + runtimeAcquireBudgetMs;
  const turnDeadline = typeof turnDeadlineAtMs === 'number' && Number.isFinite(turnDeadlineAtMs) ? turnDeadlineAtMs : Number.POSITIVE_INFINITY;
  const resolved = Math.min(acquireBudgetDeadlineAtMs, turnDeadline);
  return Number.isFinite(resolved) ? resolved : null;
}

function remainingBudgetMs(deadlineAtMs: number | null): number {
  if (deadlineAtMs === null || !Number.isFinite(deadlineAtMs)) return Number.POSITIVE_INFINITY;
  return deadlineAtMs - Date.now();
}

function extractCodeContent(rawCode: any): string {
  const text = String(rawCode ?? "");
  const fencedBlock = text.match(/```(?:[a-z0-9_-]+)?\s*([\s\S]*?)```/i);
  return (fencedBlock ? fencedBlock[1] ?? text : text).trim();
}

function isMultiFileProject(code: any): code is { files: any[]; entryPoint: string } {
  return code && typeof code === "object" && Array.isArray(code.files) && code.entryPoint && code.files.length > 0;
}

async function writeProjectToFS(filesystem: any, project: any): Promise<{ success: boolean; filesWritten: number; error?: string }> {
  if (!project || !Array.isArray(project.files)) {
    return { success: false, filesWritten: 0, error: "Invalid project" };
  }
  try {
    const result = await filesystem.writeMultiple(project.files);
    return {
      success: result.success,
      filesWritten: result.written,
      error: result.failed > 0 ? `Failed to write ${result.failed} file(s)` : undefined
    };
  } catch (error: any) {
    return { success: false, filesWritten: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

function getEntryPointCode(project: any): string {
  if (!project || !project.entryPoint || !Array.isArray(project.files)) return "";
  const entry = project.files.find((f: any) => f.path === project.entryPoint);
  return entry ? entry.content : "";
}

function shouldBuildSkill(skillId: string): boolean {
  const buildableSkills = ["threejs", "babylon", "p5js", "p5.js", "d3", "d3js", "plotly", "chart.js", "chartjs", "gsap", "animation", "mermaid"];
  return buildableSkills.includes(skillId);
}

async function buildProject(buildManager: any, skillId: string, installDeps = true): Promise<{ success: boolean; buildOutput?: any; artifacts?: any; error?: string }> {
  try {
    const result = await buildManager.build(skillId, { installDeps, timeout: 60000 });
    if (!result.success) return { success: false, error: result.message || result.reason, buildOutput: result };
    return { success: true, buildOutput: result, artifacts: result.artifacts || result.buildResult?.artifacts };
  } catch (error: any) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new Error(timeoutMessage));
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs))
  ]);
}

function readCommandOutput(executionResult: any): string {
  if (!executionResult || typeof executionResult !== "object") return "";
  const candidates = [executionResult.result, executionResult.stdout, executionResult.output, executionResult.stderr];
  return candidates.filter((value) => typeof value === "string" && value.trim().length > 0).join("\\n");
}

function buildManimRunnerScript(): string {
  return [
    "import importlib.util",
    "import inspect",
    "import json",
    "import os",
    "import traceback",
    "import manim as manim_module",
    "import numpy as np",
    "from manim import Axes as BaseAxes, NumberPlane as BaseNumberPlane, Scene, config",
    "def find_scene_classes(module):",
    "    scene_classes = []",
    "    for _, value in inspect.getmembers(module, inspect.isclass):",
    "        try:",
    "            if value.__module__ != module.__name__: continue",
    "            if issubclass(value, Scene) and value is not Scene: scene_classes.append(value)",
    "        except Exception: continue",
    "    return scene_classes",
    "def emit(payload): print('__GVE_MANIM_RESULT__' + json.dumps(payload) + '__GVE_MANIM_RESULT_END__')",
    "def normalize_range(min_value, max_value, step_value, fallback):",
    "    if min_value is None and max_value is None and step_value is None: return fallback",
    "    start = fallback[0] if min_value is None else min_value",
    "    end = fallback[1] if max_value is None else max_value",
    "    step = fallback[2] if step_value is None else step_value",
    "    if step == 0: step = fallback[2]",
    "    return [start, end, step]",
    "class GVEAxesCompat(BaseAxes):",
    "    def __init__(self, *args, **kwargs):",
    "        x_min, x_max, x_step = kwargs.pop('x_min', None), kwargs.pop('x_max', None), kwargs.pop('x_step', None)",
    "        y_min, y_max, y_step = kwargs.pop('y_min', None), kwargs.pop('y_max', None), kwargs.pop('y_step', None)",
    "        if (x_min is not None or x_max is not None or x_step is not None) and 'x_range' not in kwargs:",
    "            kwargs['x_range'] = normalize_range(x_min, x_max, x_step, [-6, 6, 1])",
    "        if (y_min is not None or y_max is not None or y_step is not None) and 'y_range' not in kwargs:",
    "            kwargs['y_range'] = normalize_range(y_min, y_max, y_step, [-4, 4, 1])",
    "        super().__init__(*args, **kwargs)",
    "class GVENumberPlaneCompat(BaseNumberPlane):",
    "    def __init__(self, *args, **kwargs):",
    "        x_min, x_max, x_step = kwargs.pop('x_min', None), kwargs.pop('x_max', None), kwargs.pop('x_step', None)",
    "        y_min, y_max, y_step = kwargs.pop('y_min', None), kwargs.pop('y_max', None), kwargs.pop('y_step', None)",
    "        if (x_min is not None or x_max is not None or x_step is not None) and 'x_range' not in kwargs:",
    "            kwargs['x_range'] = normalize_range(x_min, x_max, x_step, [-6, 6, 1])",
    "        if (y_min is not None or y_max is not None or y_step is not None) and 'y_range' not in kwargs:",
    "            kwargs['y_range'] = normalize_range(y_min, y_max, y_step, [-4, 4, 1])",
    "        super().__init__(*args, **kwargs)",
    "def inject_runtime_symbols(module):",
    "    setattr(manim_module, 'Axes', GVEAxesCompat)",
    "    setattr(manim_module, 'NumberPlane', GVENumberPlaneCompat)",
    "    for name in dir(manim_module):",
    "        if name.startswith('_'): continue",
    "        module.__dict__.setdefault(name, getattr(manim_module, name))",
    "    module.__dict__.setdefault('np', np)",
    "def main():",
    "    script_path = os.environ.get('GVE_MANIM_SCRIPT')",
    "    output_dir = os.environ.get('GVE_MANIM_OUTPUT_DIR')",
    "    width = int(os.environ.get('GVE_MANIM_WIDTH', '1920'))",
    "    height = int(os.environ.get('GVE_MANIM_HEIGHT', '1080'))",
    "    fps = int(os.environ.get('GVE_MANIM_FPS', '60'))",
    "    if not script_path or not output_dir: raise RuntimeError('Missing config.')",
    "    os.makedirs(output_dir, exist_ok=True)",
    "    config.media_dir = config.video_dir = output_dir",
    "    config.pixel_width = width",
    "    config.pixel_height = height",
    "    config.frame_rate = fps",
    "    config.quality = 'high_quality'",
    "    config.progress_bar = 'none'",
    "    config.disable_caching = True",
    "    spec = importlib.util.spec_from_file_location('gve_manim_scene_module', script_path)",
    "    module = importlib.util.module_from_spec(spec)",
    "    inject_runtime_symbols(module)",
    "    spec.loader.exec_module(module)",
    "    scene_classes = find_scene_classes(module)",
    "    if not scene_classes: raise RuntimeError('No Scene subclass found.')",
    "    scene_class = scene_classes[0]",
    "    scene = scene_class()",
    "    scene.render()",
    "    movie_path = getattr(scene.renderer.file_writer, 'movie_file_path', None)",
    "    if not movie_path: raise RuntimeError('No video output path.')",
    "    emit({'success': True, 'videoPath': str(movie_path), 'sceneClass': scene_class.__name__, 'width': width, 'height': height, 'fps': fps})",
    "if __name__ == '__main__':",
    "    try: main()",
    "    except Exception as error: emit({'success': False, 'error': str(error), 'traceback': traceback.format_exc()})"
  ].join("\\n");
}

async function executeManimRuntime({ workspace, code, timeoutMs, sessionId }: { workspace: any; code: string; timeoutMs: number; sessionId: string | null }): Promise<any> {
  const normalizedCode = extractCodeContent(code);
  if (!normalizedCode) {
    return { success: false, status: "error", error: "Generated Manim code is empty.", errorCode: "RUNTIME_MANIM_EMPTY_CODE" };
  }

  const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  const remoteCodePath = `/tmp/gve_manim_scene_${runId}.py`;
  const remoteRunnerPath = `/tmp/gve_manim_runner_${runId}.py`;
  const remoteOutputDir = `/tmp/gve_manim_output_${runId}`;

  await workspace.fs.uploadFile(Buffer.from(normalizedCode, "utf-8"), remoteCodePath);
  await workspace.fs.uploadFile(Buffer.from(buildManimRunnerScript(), "utf-8"), remoteRunnerPath);

  const command = [
    "set -euo pipefail",
    "PYTHON_BIN=\"$(command -v python3 || command -v python || true)\"",
    "if [ -z \"${PYTHON_BIN}\" ]; then echo '__GVE_MANIM_RESULT__{\"success\": false, \"error\": \"Python runtime not found in sandbox.\"}__GVE_MANIM_RESULT_END__'; exit 0; fi",
    'mkdir -p "' + remoteOutputDir + '"',
    'export GVE_MANIM_SCRIPT="' + remoteCodePath + '"',
    'export GVE_MANIM_OUTPUT_DIR="' + remoteOutputDir + '"',
    'export GVE_MANIM_WIDTH="' + manimRenderWidth + '"',
    'export GVE_MANIM_HEIGHT="' + manimRenderHeight + '"',
    'export GVE_MANIM_FPS="' + manimRenderFps + '"',
    '"$PYTHON_BIN" "' + remoteRunnerPath + '"'
  ].join("\n");

  const executionResult = await withTimeout(workspace.process.executeCommand(command), timeoutMs + 5_000, `Manim execution timed out after ${timeoutMs + 5000}ms.`);
  const rawOutput = readCommandOutput(executionResult);
  const markerPayloads = Array.from(rawOutput.matchAll(/__GVE_MANIM_RESULT__((?:\\.|[\s\S])*?)__GVE_MANIM_RESULT_END__/g), (match) => String(match?.[1] ?? "").trim()).filter(Boolean);

  if (markerPayloads.length === 0) {
    return { success: false, status: "error", error: `Manim runtime did not return a structured result.`, errorCode: "RUNTIME_MANIM_INVALID_RESULT" };
  }

  let parsedResult: any = null;
  for (let index = markerPayloads.length - 1; index >= 0; index -= 1) {
    try { parsedResult = JSON.parse(markerPayloads[index]!); break; } catch { continue; }
  }

  if (!parsedResult?.success) {
    return { success: false, status: "error", error: parsedResult?.error ?? "Manim rendering failed.", errorCode: parsedResult?.errorCode ?? "RUNTIME_MANIM_RENDER_FAILED" };
  }

  const remoteVideoPath = String(parsedResult.videoPath ?? "").trim();
  if (!remoteVideoPath) {
    return { success: false, status: "error", error: "Manim completed without a downloadable video path.", errorCode: "RUNTIME_MANIM_MISSING_VIDEO" };
  }

  const downloaded = await workspace.fs.downloadFile(remoteVideoPath);
  const videoBuffer = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded);
  const persisted = persistMediaArtifact({ buffer: videoBuffer, extension: "mp4", mediaType: "video/mp4", sessionId: sessionId ?? undefined });

  return { success: true, status: "completed", previewUrl: persisted.previewUrl, outputKind: "media", mediaType: persisted.mediaType, mediaArtifactId: persisted.mediaKey, renderCount: 1 };
}

export function getSandboxRuntimeMetrics() {
  return poolManager.getMetricsSnapshot();
}

export function warmupSandboxForSkill(skillId: string) {
  if (skillId) poolManager.requestWarmup(skillId);
}

export async function shutdownSandboxRuntime(options = {}) {
  await poolManager.shutdown(options);
}

export async function executeSkillRuntime({ skillId, code, timeoutMs, maxFrames, turnDeadlineAtMs = null, sessionId = null, tools = [] }: any) {
  const skill = getSkillRuntimeProfile(skillId);
  const startedAt = Date.now();
  const acquireDeadlineAtMs = resolveAcquireDeadlineAtMs(turnDeadlineAtMs);
  let sandboxEnv: any = null;
  let acquireDiagnostics: any = null;
  const traceCtx = getTraceContext();
  const effectiveSessionId = sessionId ?? traceCtx.sessionId ?? null;
  const dedicatedKey = dedicatedSandboxManager.getKey({ userId: traceCtx.userId ?? null, sessionId: effectiveSessionId });

  try {
    const acquireBudgetMs = remainingBudgetMs(acquireDeadlineAtMs);
    if (acquireBudgetMs <= 0) throw new Error("Runtime budget exhausted before sandbox acquisition.");

    traceEvent("sandbox.acquire_start", { skillId, sessionId: effectiveSessionId, dedicated: dedicatedSandboxManager.isEnabled(), key: dedicatedKey });
    const acquireStartMs = Date.now();
    sandboxEnv = dedicatedKey
      ? await dedicatedSandboxManager.acquireForKey(dedicatedKey, { skillId, turnDeadlineAtMs: acquireDeadlineAtMs })
      : await poolManager.acquire({ skillId, turnDeadlineAtMs: acquireDeadlineAtMs });
    traceEvent("sandbox.acquire_ok", { skillId, workspaceId: sandboxEnv?.workspaceId ?? null, acquireMs: Date.now() - acquireStartMs, key: dedicatedKey });
    acquireDiagnostics = cloneAcquireDiagnostics(sandboxEnv?._acquireDiagnostics);

    if (Array.isArray(tools) && tools.length > 0) {
      const isCached = toolRegistry.isInstalled(sandboxEnv.workspaceId, tools);
      if (isCached) {
        toolRegistry.recordCacheHit();
      } else {
        const installResult = await poolManager.installTools(sandboxEnv.workspaceId, tools);
        if (installResult.success) toolRegistry.markInstalled(sandboxEnv.workspaceId, tools);
        else toolRegistry.markFailed(sandboxEnv.workspaceId, new Error(installResult.errors));
      }
    }

    let executionCode = code;
    let buildArtifacts = null;

    if (isMultiFileProject(code)) {
      const filesystem = poolManager.getFileSystem(sandboxEnv.workspaceId, sandboxEnv._workspace);
      const writeResult = await writeProjectToFS(filesystem, code);
      if (!writeResult.success) throw new Error(`Failed to write project files: ${writeResult.error}`);

      if (shouldBuildSkill(skillId)) {
        try {
          const buildManager = poolManager.getBuildManager(sandboxEnv.workspaceId, sandboxEnv._workspace, filesystem);
          const buildResult = await buildProject(buildManager, skillId, true);
          if (buildResult.success) buildArtifacts = buildResult.artifacts;
        } catch (buildError) { }
      }
      executionCode = getEntryPointCode(code);
      if (!executionCode) throw new Error(`Entry point code not found: ${code.entryPoint}`);
    }

    const executionBudgetMs = remainingBudgetMs(turnDeadlineAtMs);
    if (executionBudgetMs <= 0) throw new Error("Runtime budget exhausted before sandbox execution.");

    const effectiveTimeoutMs = timeoutMs ?? 2200;
    let resultObj: any;

    if (skill?.runtime?.adapter === "python-manim") {
      resultObj = await executeManimRuntime({ workspace: sandboxEnv._workspace, code: executionCode, timeoutMs: effectiveTimeoutMs, sessionId });
    } else {
      const payload = JSON.stringify({ skill, code: executionCode, timeoutMs: effectiveTimeoutMs, maxFrames });
      const execStartMs = Date.now();
      resultObj = await sandboxEnv.execute(payload);
      traceEvent("sandbox.execute_complete", { skillId, workspaceId: sandboxEnv?.workspaceId ?? null, execMs: Date.now() - execStartMs, success: Boolean(resultObj?.success) });
    }

    return {
      success: resultObj.success,
      status: resultObj.status,
      previewUrl: resultObj.success ? (resultObj.previewUrl ?? "about:blank") : null,
      outputKind: resultObj.outputKind ?? "code",
      mediaType: resultObj.mediaType ?? null,
      mediaUrl: resultObj.mediaUrl ?? null,
      skillId: skill?.id,
      durationMs: Date.now() - startedAt,
      renderCount: resultObj.renderCount || 0,
      error: resultObj.error || null,
      buildArtifacts,
      acquireDiagnostics
    };
  } catch (error: any) {
    return {
      success: false,
      status: "error",
      skillId: skill?.id,
      durationMs: Date.now() - startedAt,
      error: error?.message || String(error),
      acquireDiagnostics
    };
  } finally {
    if (sandboxEnv) {
      if (dedicatedKey) {
        await dedicatedSandboxManager.releaseForKey(dedicatedKey, sandboxEnv).catch(() => {});
      } else {
        await poolManager.release(sandboxEnv).catch(() => { });
      }
    }
  }
}
