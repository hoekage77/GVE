/**
 * PythonManimAdapter — Executes Manim Python scenes inside a sandbox.
 *
 * Uploads the user's scene code + a compatibility runner script,
 * runs the runner via shell, parses the structured result marker,
 * downloads the rendered video, and persists it as a media artifact.
 */

import { persistMediaArtifact } from "../../routes/media.js";
import type { SkillAdapter, ExecutionContext, AdapterExecuteOptions, AdapterExecutionResult } from "./types.js";

function parsePositiveIntEnv(rawValue: string | undefined | null, fallbackValue: number, minimum = 1): number {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallbackValue;
  return Math.max(minimum, parsed);
}

function extractCodeContent(rawCode: any): string {
  const text = String(rawCode ?? "");
  const fencedBlock = text.match(/```(?:[a-z0-9_-]+)?\s*([\s\S]*?)```/i);
  return (fencedBlock ? fencedBlock[1] ?? text : text).trim();
}

function readCommandOutput(executionResult: any): string {
  if (!executionResult || typeof executionResult !== "object") return "";
  const candidates = [executionResult.result, executionResult.stdout, executionResult.output, executionResult.stderr];
  return candidates.filter((value) => typeof value === "string" && value.trim().length > 0).join("\n");
}

/**
 * Execute a shell command in a Daytona sandbox with an explicit timeout.
 *
 * The Daytona SDK `process.executeCommand` signature is positional:
 *   executeCommand(command, cwd?, env?, timeoutSec?)
 *
 * `timeoutSec` is passed to the server; when omitted the server defaults
 * to ~10 s, which is far too short for Manim renders.  We always pass
 * a generous timeout in seconds.
 */
async function executeCommandInSandbox(
  process: any,
  command: string,
  timeoutMs = 120_000
): Promise<{ stdout: string; stderr: string; result: string; exitCode: number }> {
  const raw = await process.executeCommand(
    command,
    undefined,
    undefined,
    Math.ceil(timeoutMs / 1000)
  );

  // The Process wrapper returns { exitCode, result, artifacts }.
  // `result` contains stdout.  We normalise across possible shapes.
  const stdout =
    typeof raw === "string"
      ? raw
      : String(
          raw?.result ?? raw?.stdout ?? raw?.artifacts?.stdout ?? raw?.output ?? ""
        );
  const stderr =
    typeof raw === "string"
      ? ""
      : String(raw?.stderr ?? raw?.artifacts?.stderr ?? "");
  const exitCode =
    typeof raw === "object" && raw !== null
      ? (raw.exitCode ?? raw.code ?? 0)
      : 0;

  return { stdout, stderr, result: stdout, exitCode };
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
    "    width = int(os.environ.get('GVE_MANIM_WIDTH', '1280'))",
    "    height = int(os.environ.get('GVE_MANIM_HEIGHT', '720'))",
    "    fps = int(os.environ.get('GVE_MANIM_FPS', '30'))",
    "    quality = os.environ.get('GVE_MANIM_QUALITY', 'low_quality')",
    "    if not script_path or not output_dir: raise RuntimeError('Missing config.')",
    "    os.makedirs(output_dir, exist_ok=True)",
    "    config.media_dir = config.video_dir = output_dir",
    "    config.pixel_width = width",
    "    config.pixel_height = height",
    "    config.frame_rate = fps",
    "    config.quality = quality",
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
  ].join("\n");
}

const manimRenderWidth = parsePositiveIntEnv(process.env.MANIM_RENDER_WIDTH, 1280, 320);
const manimRenderHeight = parsePositiveIntEnv(process.env.MANIM_RENDER_HEIGHT, 720, 240);
const manimRenderFps = parsePositiveIntEnv(process.env.MANIM_RENDER_FPS, 30, 12);
const manimRenderQuality = process.env.MANIM_RENDER_QUALITY ?? "low_quality";

export class PythonManimAdapter implements SkillAdapter {
  readonly kind = "python-manim";

  async execute(
    context: ExecutionContext,
    code: string | { files: any[]; entryPoint: string },
    options: AdapterExecuteOptions
  ): Promise<AdapterExecutionResult> {
    const normalizedCode = extractCodeContent(code);
    if (!normalizedCode) {
      return {
        success: false,
        status: "error",
        error: "Generated Manim code is empty.",
        errorCode: "RUNTIME_MANIM_EMPTY_CODE"
      };
    }

    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const remoteCodePath = `/tmp/gve_manim_scene_${runId}.py`;
    const remoteRunnerPath = `/tmp/gve_manim_runner_${runId}.py`;
    const remoteOutputDir = `/tmp/gve_manim_output_${runId}`;

    await context.workspace.fs.uploadFile(Buffer.from(normalizedCode, "utf-8"), remoteCodePath);
    await context.workspace.fs.uploadFile(Buffer.from(buildManimRunnerScript(), "utf-8"), remoteRunnerPath);

    const command = [
      "set -euo pipefail",
      'PYTHON_BIN="$(command -v python3 || command -v python || true)"',
      'if [ -z "${PYTHON_BIN}" ]; then echo \'__GVE_MANIM_RESULT__{"success": false, "error": "Python runtime not found in sandbox."}__GVE_MANIM_RESULT_END__\'; exit 0; fi',
      `mkdir -p "${remoteOutputDir}"`,
      `export GVE_MANIM_SCRIPT="${remoteCodePath}"`,
      `export GVE_MANIM_OUTPUT_DIR="${remoteOutputDir}"`,
      `export GVE_MANIM_WIDTH="${manimRenderWidth}"`,
      `export GVE_MANIM_HEIGHT="${manimRenderHeight}"`,
      `export GVE_MANIM_FPS="${manimRenderFps}"`,
      `export GVE_MANIM_QUALITY="${manimRenderQuality}"`,
      `"$PYTHON_BIN" "${remoteRunnerPath}"`
    ].join("\n");

    const executionResult = await executeCommandInSandbox(
      context.workspace.process,
      command,
      Math.min(600_000, Math.max(30_000, options.timeoutMs ?? 180_000))
    );
    const rawOutput = readCommandOutput(executionResult);

    const markerPayloads = Array.from(
      rawOutput.matchAll(/__GVE_MANIM_RESULT__((?:\\.|[\s\S])*?)__GVE_MANIM_RESULT_END__/g),
      (match) => String(match?.[1] ?? "").trim()
    ).filter(Boolean);

    if (markerPayloads.length === 0) {
      return {
        success: false,
        status: "error",
        error: "Manim runtime did not return a structured result.",
        errorCode: "RUNTIME_MANIM_INVALID_RESULT"
      };
    }

    let parsedResult: any = null;
    for (let index = markerPayloads.length - 1; index >= 0; index -= 1) {
      try { parsedResult = JSON.parse(markerPayloads[index]!); break; } catch { continue; }
    }

    if (!parsedResult?.success) {
      return {
        success: false,
        status: "error",
        error: parsedResult?.error ?? "Manim rendering failed.",
        errorCode: parsedResult?.errorCode ?? "RUNTIME_MANIM_RENDER_FAILED"
      };
    }

    const remoteVideoPath = String(parsedResult.videoPath ?? "").trim();
    if (!remoteVideoPath) {
      return {
        success: false,
        status: "error",
        error: "Manim completed without a downloadable video path.",
        errorCode: "RUNTIME_MANIM_MISSING_VIDEO"
      };
    }

    const downloaded = await context.workspace.fs.downloadFile(remoteVideoPath);
    const videoBuffer = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded);
    const persisted = persistMediaArtifact({
      buffer: videoBuffer,
      extension: "mp4",
      mediaType: "video/mp4",
      sessionId: options.sessionId ?? undefined
    });

    return {
      success: true,
      status: "completed",
      previewUrl: persisted.previewUrl,
      outputKind: "media",
      mediaType: persisted.mediaType,
      mediaArtifactId: persisted.mediaKey,
      renderCount: 1
    };
  }
}