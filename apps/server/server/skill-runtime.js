import { getSkillRuntimeProfile } from "./skill-loader.js";
import { persistMediaArtifact } from "./media-artifacts.js";
import { SandboxPoolManager } from "@visual-runtime/sandbox-pool";

function parsePositiveIntEnv(rawValue, fallbackValue, minimum = 1) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }

  return Math.max(minimum, parsed);
}

function parseBooleanEnv(rawValue, fallbackValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return fallbackValue;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallbackValue;
}

function escapeDoubleQuotedShellValue(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
}

// We maintain a single instance of the on-demand pool manager
const poolManager = new SandboxPoolManager();
const runtimeAcquireBudgetMs = parsePositiveIntEnv(
  process.env.RUNTIME_ACQUIRE_BUDGET_MS,
  12_000,
  1_000
);
const manimRenderWidth = parsePositiveIntEnv(process.env.MANIM_RENDER_WIDTH, 1920, 320);
const manimRenderHeight = parsePositiveIntEnv(process.env.MANIM_RENDER_HEIGHT, 1080, 240);
const manimRenderFps = parsePositiveIntEnv(process.env.MANIM_RENDER_FPS, 60, 12);
const manimInstallOnDemand = parseBooleanEnv(process.env.MANIM_PIP_INSTALL_ON_DEMAND, true);
const manimPipPackage = String(process.env.MANIM_PIP_PACKAGE ?? "manim==0.20.1").trim() || "manim==0.20.1";
const manimLatexInstallOnDemand = parseBooleanEnv(process.env.MANIM_LATEX_INSTALL_ON_DEMAND, true);
const defaultManimLatexAptPackages = "texlive-latex-base texlive-latex-extra texlive-fonts-recommended dvisvgm";
const manimLatexAptPackages = String(process.env.MANIM_LATEX_APT_PACKAGES ?? defaultManimLatexAptPackages).trim() || defaultManimLatexAptPackages;

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

function extractCodeContent(rawCode) {
  const text = String(rawCode ?? "");
  const fencedBlock = text.match(/```(?:[a-z0-9_-]+)?\s*([\s\S]*?)```/i);
  return (fencedBlock ? fencedBlock[1] : text).trim();
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error(timeoutMessage));
  }

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    })
  ]);
}

function readCommandOutput(executionResult) {
  if (!executionResult || typeof executionResult !== "object") {
    return "";
  }

  const candidates = [
    executionResult.result,
    executionResult.stdout,
    executionResult.output,
    executionResult.stderr
  ];

  return candidates
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join("\n");
}

function buildManimRunnerScript() {
  return [
    "import importlib.util",
    "import inspect",
    "import json",
    "import os",
    "import traceback",
    "",
    "import manim as manim_module",
    "import numpy as np",
    "",
    "from manim import Axes as BaseAxes, NumberPlane as BaseNumberPlane, Scene, config",
    "",
    "def find_scene_classes(module):",
    "    scene_classes = []",
    "    for _, value in inspect.getmembers(module, inspect.isclass):",
    "        try:",
    "            if value.__module__ != module.__name__:",
    "                continue",
    "            if issubclass(value, Scene) and value is not Scene:",
    "                scene_classes.append(value)",
    "        except Exception:",
    "            continue",
    "    return scene_classes",
    "",
    "def emit(payload):",
    "    print('__GVE_MANIM_RESULT__' + json.dumps(payload) + '__GVE_MANIM_RESULT_END__')",
    "",
    "def normalize_range(min_value, max_value, step_value, fallback):",
    "    if min_value is None and max_value is None and step_value is None:",
    "        return fallback",
    "",
    "    start = fallback[0] if min_value is None else min_value",
    "    end = fallback[1] if max_value is None else max_value",
    "    step = fallback[2] if step_value is None else step_value",
    "    if step == 0:",
    "        step = fallback[2]",
    "    return [start, end, step]",
    "",
    "class GVEAxesCompat(BaseAxes):",
    "    def __init__(self, *args, **kwargs):",
    "        x_min = kwargs.pop('x_min', None)",
    "        x_max = kwargs.pop('x_max', None)",
    "        x_step = kwargs.pop('x_step', None)",
    "        y_min = kwargs.pop('y_min', None)",
    "        y_max = kwargs.pop('y_max', None)",
    "        y_step = kwargs.pop('y_step', None)",
    "",
    "        if (x_min is not None or x_max is not None or x_step is not None) and 'x_range' not in kwargs:",
    "            kwargs['x_range'] = normalize_range(x_min, x_max, x_step, [-6, 6, 1])",
    "",
    "        if (y_min is not None or y_max is not None or y_step is not None) and 'y_range' not in kwargs:",
    "            kwargs['y_range'] = normalize_range(y_min, y_max, y_step, [-4, 4, 1])",
    "",
    "        super().__init__(*args, **kwargs)",
    "",
    "class GVENumberPlaneCompat(BaseNumberPlane):",
    "    def __init__(self, *args, **kwargs):",
    "        x_min = kwargs.pop('x_min', None)",
    "        x_max = kwargs.pop('x_max', None)",
    "        x_step = kwargs.pop('x_step', None)",
    "        y_min = kwargs.pop('y_min', None)",
    "        y_max = kwargs.pop('y_max', None)",
    "        y_step = kwargs.pop('y_step', None)",
    "",
    "        if (x_min is not None or x_max is not None or x_step is not None) and 'x_range' not in kwargs:",
    "            kwargs['x_range'] = normalize_range(x_min, x_max, x_step, [-6, 6, 1])",
    "",
    "        if (y_min is not None or y_max is not None or y_step is not None) and 'y_range' not in kwargs:",
    "            kwargs['y_range'] = normalize_range(y_min, y_max, y_step, [-4, 4, 1])",
    "",
    "        super().__init__(*args, **kwargs)",
    "",
    "def inject_runtime_symbols(module):",
    "    # Monkey-patch select classes so `from manim import *` uses compatibility-safe wrappers.",
    "    setattr(manim_module, 'Axes', GVEAxesCompat)",
    "    setattr(manim_module, 'NumberPlane', GVENumberPlaneCompat)",
    "",
    "    for name in dir(manim_module):",
    "        if name.startswith('_'):",
    "            continue",
    "        module.__dict__.setdefault(name, getattr(manim_module, name))",
    "",
    "    # Common alias used by generated math animations.",
    "    module.__dict__.setdefault('np', np)",
    "",
    "def main():",
    "    script_path = os.environ.get('GVE_MANIM_SCRIPT')",
    "    output_dir = os.environ.get('GVE_MANIM_OUTPUT_DIR')",
    "    width = int(os.environ.get('GVE_MANIM_WIDTH', '1920'))",
    "    height = int(os.environ.get('GVE_MANIM_HEIGHT', '1080'))",
    "    fps = int(os.environ.get('GVE_MANIM_FPS', '60'))",
    "",
    "    if not script_path or not output_dir:",
    "        raise RuntimeError('Missing manim script or output directory configuration.')",
    "",
    "    os.makedirs(output_dir, exist_ok=True)",
    "    config.media_dir = output_dir",
    "    config.video_dir = output_dir",
    "    config.pixel_width = width",
    "    config.pixel_height = height",
    "    config.frame_rate = fps",
    "    config.quality = 'high_quality'",
    "    config.progress_bar = 'none'",
    "    config.disable_caching = True",
    "",
    "    spec = importlib.util.spec_from_file_location('gve_manim_scene_module', script_path)",
    "    module = importlib.util.module_from_spec(spec)",
    "    inject_runtime_symbols(module)",
    "    spec.loader.exec_module(module)",
    "",
    "    scene_classes = find_scene_classes(module)",
    "    if not scene_classes:",
    "        raise RuntimeError('No Scene subclass found in generated Manim code.')",
    "",
    "    scene_class = scene_classes[0]",
    "    scene = scene_class()",
    "    scene.render()",
    "",
    "    movie_path = getattr(scene.renderer.file_writer, 'movie_file_path', None)",
    "    movie_path = str(movie_path) if movie_path is not None else None",
    "    if not movie_path:",
    "        raise RuntimeError('Manim render completed without a video output path.')",
    "",
    "    emit({",
    "        'success': True,",
    "        'videoPath': movie_path,",
    "        'sceneClass': scene_class.__name__,",
    "        'width': width,",
    "        'height': height,",
    "        'fps': fps",
    "    })",
    "",
    "if __name__ == '__main__':",
    "    try:",
    "        main()",
    "    except Exception as error:",
    "        emit({",
    "            'success': False,",
    "            'error': str(error),",
    "            'traceback': traceback.format_exc()",
    "        })"
  ].join("\n");
}

async function executeManimRuntime({ workspace, code, timeoutMs, sessionId }) {
  const normalizedCode = extractCodeContent(code);
  if (!normalizedCode) {
    return {
      success: false,
      status: "error",
      previewUrl: null,
      outputKind: "media",
      mediaType: "video/mp4",
      mediaUrl: null,
      mediaArtifactId: null,
      mediaDurationMs: null,
      mediaFps: manimRenderFps,
      mediaResolution: `${manimRenderWidth}x${manimRenderHeight}`,
      mediaBytes: null,
      renderCount: 0,
      frameCount: 0,
      logs: [],
      summary: { childCount: 0, types: [] },
      warning: null,
      error: "Generated Manim code is empty.",
      errorCode: "RUNTIME_MANIM_EMPTY_CODE"
    };
  }

  const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  const remoteCodePath = `/tmp/gve_manim_scene_${runId}.py`;
  const remoteRunnerPath = `/tmp/gve_manim_runner_${runId}.py`;
  const remoteOutputDir = `/tmp/gve_manim_output_${runId}`;

  await workspace.fs.uploadFile(Buffer.from(normalizedCode, "utf-8"), remoteCodePath);
  await workspace.fs.uploadFile(Buffer.from(buildManimRunnerScript(), "utf-8"), remoteRunnerPath);

  const installBlock = [
    "if ! \"$PYTHON_BIN\" - <<'PY' >/dev/null 2>&1",
    "import manim",
    "PY",
    "then",
    "  if [ \"${GVE_MANIM_INSTALL_ON_DEMAND}\" = \"1\" ]; then",
    "    \"$PYTHON_BIN\" -m pip install --disable-pip-version-check --quiet \"${GVE_MANIM_PIP_PACKAGE}\" >/tmp/gve_manim_pip.log 2>&1 || true",
    "  fi",
    "fi",
    "",
    "if ! \"$PYTHON_BIN\" - <<'PY' >/dev/null 2>&1",
    "import manim",
    "PY",
    "then",
    "  echo '__GVE_MANIM_RESULT__{" +
      "\"success\": false, \"error\": \"Manim dependency is unavailable in sandbox.\", \"errorCode\": \"RUNTIME_MANIM_DEPENDENCY_UNAVAILABLE\"" +
      "}__GVE_MANIM_RESULT_END__'",
    "  exit 0",
    "fi"
  ].join("\n");

  const latexInstallBlock = [
    "if ! command -v latex >/dev/null 2>&1 || ! command -v dvisvgm >/dev/null 2>&1; then",
    "  if [ \"${GVE_MANIM_LATEX_INSTALL_ON_DEMAND}\" = \"1\" ]; then",
    "    if ! command -v apt-get >/dev/null 2>&1; then",
    "      echo '__GVE_MANIM_RESULT__{" +
      "\\\"success\\\": false, \\\"error\\\": \\\"LaTeX dependencies are unavailable and apt-get is not present. Provide a custom sandbox image with LaTeX preinstalled.\\\", \\\"errorCode\\\": \\\"RUNTIME_MANIM_LATEX_MANAGER_UNAVAILABLE\\\"" +
      "}__GVE_MANIM_RESULT_END__'",
    "      exit 0",
    "    fi",
    "",
    "    if [ \"$(id -u)\" -ne 0 ]; then",
    "      if ! command -v sudo >/dev/null 2>&1; then",
    "        echo '__GVE_MANIM_RESULT__{" +
      "\\\"success\\\": false, \\\"error\\\": \\\"LaTeX dependencies are unavailable and sandbox user lacks privilege to install apt packages.\\\", \\\"errorCode\\\": \\\"RUNTIME_MANIM_LATEX_PRIVILEGE_REQUIRED\\\"" +
      "}__GVE_MANIM_RESULT_END__'",
    "        exit 0",
    "      fi",
    "",
    "      if ! sudo -n true >/dev/null 2>&1; then",
    "        echo '__GVE_MANIM_RESULT__{" +
      "\\\"success\\\": false, \\\"error\\\": \\\"LaTeX dependencies are unavailable and sudo requires interactive authentication.\\\", \\\"errorCode\\\": \\\"RUNTIME_MANIM_LATEX_PRIVILEGE_REQUIRED\\\"" +
      "}__GVE_MANIM_RESULT_END__'",
    "        exit 0",
    "      fi",
    "    fi",
    "",
    "    apt_run() {",
    "      if [ \"$(id -u)\" -eq 0 ]; then",
    "        apt-get \"$@\"",
    "      else",
    "        sudo -n apt-get \"$@\"",
    "      fi",
    "    }",
    "",
    "    export DEBIAN_FRONTEND=noninteractive",
    "    if ! apt_run update -y >/tmp/gve_manim_apt_update.log 2>&1; then",
    "      echo '__GVE_MANIM_RESULT__{" +
      "\\\"success\\\": false, \\\"error\\\": \\\"Failed to update apt indexes for LaTeX installation.\\\", \\\"errorCode\\\": \\\"RUNTIME_MANIM_LATEX_APT_UPDATE_FAILED\\\"" +
      "}__GVE_MANIM_RESULT_END__'",
    "      exit 0",
    "    fi",
    "",
    "    if ! apt_run install -y --no-install-recommends ${GVE_MANIM_LATEX_APT_PACKAGES} >/tmp/gve_manim_apt_install.log 2>&1; then",
    "      echo '__GVE_MANIM_RESULT__{" +
      "\\\"success\\\": false, \\\"error\\\": \\\"Failed to install LaTeX dependencies in sandbox.\\\", \\\"errorCode\\\": \\\"RUNTIME_MANIM_LATEX_APT_INSTALL_FAILED\\\"" +
      "}__GVE_MANIM_RESULT_END__'",
    "      exit 0",
    "    fi",
    "  fi",
    "fi",
    "",
    "if ! command -v latex >/dev/null 2>&1; then",
    "  echo '__GVE_MANIM_RESULT__{" +
    "\\\"success\\\": false, \\\"error\\\": \\\"LaTeX binary is unavailable in sandbox.\\\", \\\"errorCode\\\": \\\"RUNTIME_MANIM_LATEX_UNAVAILABLE\\\"" +
    "}__GVE_MANIM_RESULT_END__'",
    "  exit 0",
    "fi",
    "",
    "if ! command -v dvisvgm >/dev/null 2>&1; then",
    "  echo '__GVE_MANIM_RESULT__{" +
    "\\\"success\\\": false, \\\"error\\\": \\\"dvisvgm binary is unavailable in sandbox.\\\", \\\"errorCode\\\": \\\"RUNTIME_MANIM_DVISVGM_UNAVAILABLE\\\"" +
    "}__GVE_MANIM_RESULT_END__'",
    "  exit 0",
    "fi"
  ].join("\n");

  const command = [
    "set -euo pipefail",
    "PYTHON_BIN=\"$(command -v python3 || command -v python || true)\"",
    "if [ -z \"${PYTHON_BIN}\" ]; then",
    "  echo '__GVE_MANIM_RESULT__{" +
      "\"success\": false, \"error\": \"Python runtime not found in sandbox.\"" +
      "}__GVE_MANIM_RESULT_END__'",
    "  exit 0",
    "fi",
    `mkdir -p \"${remoteOutputDir}\"`,
    `export GVE_MANIM_INSTALL_ON_DEMAND=\"${manimInstallOnDemand ? "1" : "0"}\"`,
    `export GVE_MANIM_PIP_PACKAGE=\"${escapeDoubleQuotedShellValue(manimPipPackage)}\"`,
    `export GVE_MANIM_LATEX_INSTALL_ON_DEMAND=\"${manimLatexInstallOnDemand ? "1" : "0"}\"`,
    `export GVE_MANIM_LATEX_APT_PACKAGES=\"${escapeDoubleQuotedShellValue(manimLatexAptPackages)}\"`,
    installBlock,
    latexInstallBlock,
    `export GVE_MANIM_SCRIPT=\"${remoteCodePath}\"`,
    `export GVE_MANIM_OUTPUT_DIR=\"${remoteOutputDir}\"`,
    `export GVE_MANIM_WIDTH=\"${manimRenderWidth}\"`,
    `export GVE_MANIM_HEIGHT=\"${manimRenderHeight}\"`,
    `export GVE_MANIM_FPS=\"${manimRenderFps}\"`,
    `\"$PYTHON_BIN\" \"${remoteRunnerPath}\"`
  ]
    .filter(Boolean)
    .join("\n");

  const executionResult = await withTimeout(
    workspace.process.executeCommand(command),
    timeoutMs + 5_000,
    `Manim execution timed out after ${timeoutMs + 5000}ms.`
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
      previewUrl: null,
      outputKind: "media",
      mediaType: "video/mp4",
      mediaUrl: null,
      mediaArtifactId: null,
      mediaDurationMs: null,
      mediaFps: manimRenderFps,
      mediaResolution: `${manimRenderWidth}x${manimRenderHeight}`,
      mediaBytes: null,
      renderCount: 0,
      frameCount: 0,
      logs: [],
      summary: { childCount: 0, types: [] },
      warning: null,
      error: `Manim runtime did not return a structured result. Output: ${rawOutput.slice(0, 320)}`,
      errorCode: "RUNTIME_MANIM_INVALID_RESULT"
    };
  }

  let parsedResult = null;
  let lastParseError = null;
  for (let index = markerPayloads.length - 1; index >= 0; index -= 1) {
    const markerPayload = markerPayloads[index];

    try {
      parsedResult = JSON.parse(markerPayload);
      break;
    } catch (rawParseError) {
      try {
        // Some shell-echoed fallback payloads escape quotes. Keep this as a fallback only.
        parsedResult = JSON.parse(markerPayload.replace(/\\"/g, '"'));
        break;
      } catch (fallbackParseError) {
        lastParseError = fallbackParseError ?? rawParseError;
      }
    }
  }

  if (!parsedResult) {
    const payloadPreview = String(markerPayloads[markerPayloads.length - 1] ?? "").slice(0, 320);
    const outputPreview = rawOutput.slice(0, 320);
    return {
      success: false,
      status: "error",
      previewUrl: null,
      outputKind: "media",
      mediaType: "video/mp4",
      mediaUrl: null,
      mediaArtifactId: null,
      mediaDurationMs: null,
      mediaFps: manimRenderFps,
      mediaResolution: `${manimRenderWidth}x${manimRenderHeight}`,
      mediaBytes: null,
      renderCount: 0,
      frameCount: 0,
      logs: [],
      summary: { childCount: 0, types: [] },
      warning: null,
      error: `Manim runtime returned malformed JSON payload. payload=${payloadPreview} output=${outputPreview}${lastParseError instanceof Error ? ` parseError=${lastParseError.message}` : ""}`,
      errorCode: "RUNTIME_MANIM_MALFORMED_RESULT"
    };
  }

  if (!parsedResult?.success) {
    return {
      success: false,
      status: "error",
      previewUrl: null,
      outputKind: "media",
      mediaType: "video/mp4",
      mediaUrl: null,
      mediaArtifactId: null,
      mediaDurationMs: null,
      mediaFps: Number.isFinite(parsedResult?.fps) ? parsedResult.fps : manimRenderFps,
      mediaResolution: `${Number.isFinite(parsedResult?.width) ? parsedResult.width : manimRenderWidth}x${Number.isFinite(parsedResult?.height) ? parsedResult.height : manimRenderHeight}`,
      mediaBytes: null,
      renderCount: 0,
      frameCount: 0,
      logs: [],
      summary: { childCount: 0, types: [] },
      warning: null,
      error: parsedResult?.error ?? "Manim rendering failed.",
      errorCode: parsedResult?.errorCode ?? "RUNTIME_MANIM_RENDER_FAILED"
    };
  }

  const remoteVideoPath = String(parsedResult.videoPath ?? "").trim();
  if (!remoteVideoPath) {
    return {
      success: false,
      status: "error",
      previewUrl: null,
      outputKind: "media",
      mediaType: "video/mp4",
      mediaUrl: null,
      mediaArtifactId: null,
      mediaDurationMs: null,
      mediaFps: Number.isFinite(parsedResult?.fps) ? parsedResult.fps : manimRenderFps,
      mediaResolution: `${Number.isFinite(parsedResult?.width) ? parsedResult.width : manimRenderWidth}x${Number.isFinite(parsedResult?.height) ? parsedResult.height : manimRenderHeight}`,
      mediaBytes: null,
      renderCount: 0,
      frameCount: 0,
      logs: [],
      summary: { childCount: 0, types: [] },
      warning: null,
      error: "Manim completed without a downloadable video path.",
      errorCode: "RUNTIME_MANIM_MISSING_VIDEO"
    };
  }

  const downloaded = await workspace.fs.downloadFile(remoteVideoPath);
  const videoBuffer = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded);
  const persisted = persistMediaArtifact({
    buffer: videoBuffer,
    extension: "mp4",
    mediaType: "video/mp4",
    sessionId
  });

  return {
    success: true,
    status: "completed",
    previewUrl: persisted.previewUrl,
    outputKind: "media",
    mediaType: persisted.mediaType,
    mediaUrl: persisted.previewUrl,
    mediaArtifactId: persisted.mediaKey,
    mediaDurationMs: null,
    mediaFps: Number.isFinite(parsedResult?.fps) ? parsedResult.fps : manimRenderFps,
    mediaResolution: `${Number.isFinite(parsedResult?.width) ? parsedResult.width : manimRenderWidth}x${Number.isFinite(parsedResult?.height) ? parsedResult.height : manimRenderHeight}`,
    mediaBytes: persisted.sizeBytes,
    renderCount: 1,
    frameCount: 0,
    logs: [],
    summary: { childCount: 1, types: ["video"] },
    warning: null,
    error: null,
    errorCode: null
  };
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

export async function executeSkillRuntime({ skillId, code, timeoutMs, maxFrames, turnDeadlineAtMs = null, sessionId = null }) {
  const skill = getSkillRuntimeProfile(skillId);
  const startedAt = Date.now();
  const acquireDeadlineAtMs = resolveAcquireDeadlineAtMs(turnDeadlineAtMs);
  let sandboxEnv = null;
  let acquireDiagnostics = null;

  try {
    const acquireBudgetMs = remainingBudgetMs(acquireDeadlineAtMs);
    if (acquireBudgetMs <= 0) {
      const budgetError = new Error("Runtime budget exhausted before sandbox acquisition.");
      budgetError.code = "RUNTIME_BUDGET_EXHAUSTED";
      throw budgetError;
    }

    // Acquire a daytona sandbox (on-demand)
    sandboxEnv = await poolManager.acquire({
      skillId,
      turnDeadlineAtMs: acquireDeadlineAtMs
    });
    acquireDiagnostics = cloneAcquireDiagnostics(sandboxEnv?._acquireDiagnostics);
    console.log(`[RT] [TRACE] Acquired sandbox ${sandboxEnv.workspaceId} for ${skillId}.`);

    const executionBudgetMs = remainingBudgetMs(turnDeadlineAtMs);
    if (executionBudgetMs <= 0) {
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

    let resultObj;
    if (skill.runtime?.adapter === "python-manim") {
      console.log(`[RT] [TRACE] Executing Manim payload on ${sandboxEnv.workspaceId}...`);
      resultObj = await executeManimRuntime({
        workspace: sandboxEnv._workspace,
        code,
        timeoutMs: effectiveTimeoutMs,
        sessionId
      });
    } else {
      // Prepare execution payload for the isolated container
      const payload = JSON.stringify({
        skill,
        code,
        timeoutMs: effectiveTimeoutMs,
        maxFrames
      });

      console.log(`[RT] [TRACE] Executing payload on ${sandboxEnv.workspaceId}...`);
      // Execute the payload inside Daytona Node environment safely
      resultObj = await sandboxEnv.execute(payload);
    }

    console.log(`[RT] [TRACE] Execution finished. Success: ${resultObj.success}, RenderCount: ${resultObj.renderCount}.`);

    const normalizedRenderCount = Number(resultObj.renderCount || 0);
    const noRenderWarning = resultObj.success && skill.runtime?.adapter !== "python-manim" && normalizedRenderCount === 0
      ? "Runtime executed successfully but produced zero renders."
      : null;

    // Reconstruct the response required by Orchestrator
    return {
      success: resultObj.success,
      status: resultObj.status,
      previewUrl: resultObj.success ? (resultObj.previewUrl ?? "about:blank") : null,
      outputKind: resultObj.outputKind ?? "code",
      mediaType: resultObj.mediaType ?? null,
      mediaUrl: resultObj.mediaUrl ?? null,
      mediaArtifactId: resultObj.mediaArtifactId ?? null,
      mediaDurationMs: resultObj.mediaDurationMs ?? null,
      mediaFps: resultObj.mediaFps ?? null,
      mediaResolution: resultObj.mediaResolution ?? null,
      mediaBytes: resultObj.mediaBytes ?? null,
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
      warningCode: noRenderWarning ? "RUNTIME_NO_RENDER_ACTIVITY" : (resultObj.warningCode ?? null),
      error: resultObj.error || null,
      errorCode: resultObj.errorCode ?? null,
      acquireDiagnostics
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const resolvedAcquireDiagnostics = acquireDiagnostics ?? cloneAcquireDiagnostics(error?.acquireDiagnostics);
    return {
      success: false,
      status: "error",
      previewUrl: null,
      outputKind: skill.runtime?.adapter === "python-manim" ? "media" : "code",
      mediaType: skill.runtime?.adapter === "python-manim" ? "video/mp4" : null,
      mediaUrl: null,
      mediaArtifactId: null,
      mediaDurationMs: null,
      mediaFps: skill.runtime?.adapter === "python-manim" ? manimRenderFps : null,
      mediaResolution: skill.runtime?.adapter === "python-manim" ? `${manimRenderWidth}x${manimRenderHeight}` : null,
      mediaBytes: null,
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
      acquireDiagnostics: resolvedAcquireDiagnostics
    };
  } finally {
    if (sandboxEnv) {
      try {
        await poolManager.release(sandboxEnv);
      } catch (releaseError) {
        console.warn(`[RT] [WARN] Failed to release sandbox ${sandboxEnv.workspaceId}: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`);
      }
    }
  }
}
