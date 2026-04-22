// @ts-nocheck
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";

import "./env.js";
import { buildConversationPromptBundle, buildGenerationPromptBundle, buildModificationPromptBundle, buildImageToCodePromptBundle } from "./prompt-manager.js";
import { executeSkillRuntime, warmupSandboxForSkill } from "./skill-runtime.js";
import { executeWithQualityLoop, getSandboxWorkspaceFiles } from "./sandbox-execution.js";
import { selectSkillForIntent } from "./skill-registry.js";
import { validateCode } from "./code-validator.js";
import { determineModeFromQuality, buildModeConfig } from "./mode-decision-engine.js";
import { getGenerationCacheKey, getCachedGeneration, setCachedGeneration } from "./cache-manager.js";
import { runSelfDebugSession, runRuntimeDebugSession } from "./agent-runner.js";
import { getDebugTools, getRuntimeDebugTools, setErrorContext, clearErrorContext } from "./agent-tools.js";
import { getPool } from "./llm-pool.js";
import { resolveAssetPlan } from "./asset-resolver.js";

const skillValues = ["threejs", "p5js", "d3js", "animejs", "manim", "auto"];
const qualityValues = ["draft", "standard", "high"];
const moonshotBaseUrl = process.env.MOONSHOT_BASE_URL ?? "https://api.moonshot.ai/v1";
const moonshotModel = process.env.MOONSHOT_MODEL ?? "kimi-k2.5";
const moonshotApiKey = process.env.MOONSHOT_API_KEY;
const moonshotOverloadedMessage = "Moonshot temporarily overloaded; used local fallback.";

// Quality loop iteration config mapping
const ITERATION_CONFIG_BY_QUALITY = {
  draft: { maxIterations: 1, qualityThreshold: 50, enableAutoPatch: false },
  standard: { maxIterations: 2, qualityThreshold: 75, enableAutoPatch: true },
  high: { maxIterations: 3, qualityThreshold: 85, enableAutoPatch: true }
};

/**
 * Resolve iteration configuration based on quality preference
 * @param {string} quality - 'draft', 'standard', or 'high'
 * @returns {object} Iteration config
 */
function resolveIterationConfig(quality) {
  return ITERATION_CONFIG_BY_QUALITY[quality] ?? ITERATION_CONFIG_BY_QUALITY.standard;
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

function parseRetryDelays(rawValue, fallbackValue) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") {
    return fallbackValue;
  }

  const parsed = String(rawValue)
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value >= 0);

  return parsed.length > 0 ? parsed : fallbackValue;
}

function parsePositiveIntEnv(rawValue, fallbackValue, minimum = 1) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }

  return Math.max(minimum, parsed);
}

const fastModeEnabled = parseBooleanEnv(process.env.FAST_MODE, true);
const moonshotRetryDelaysMs = parseRetryDelays(
  process.env.MOONSHOT_RETRY_DELAYS_MS,
  fastModeEnabled ? [150, 350] : [250, 750]
);
const narrationRetryDelaysMs = parseRetryDelays(
  process.env.MOONSHOT_NARRATION_RETRY_DELAYS_MS,
  fastModeEnabled ? [] : [1000, 2500, 5000]
);
const runtimeExecutionTimeoutMs = parsePositiveIntEnv(
  process.env.RUNTIME_EXEC_TIMEOUT_MS,
  2200,
  300
);
const manimRuntimeExecutionTimeoutMs = parsePositiveIntEnv(
  process.env.RUNTIME_EXEC_TIMEOUT_MANIM_MS,
  fastModeEnabled ? 90_000 : 150_000,
  2_000
);
const runtimeExecutionMaxFrames = parsePositiveIntEnv(
  process.env.RUNTIME_EXEC_MAX_FRAMES,
  48,
  1
);
const runtimeExecutionReserveMs = parsePositiveIntEnv(
  process.env.RUNTIME_EXEC_RESERVE_MS,
  10_000,
  1_000
);
const manimRuntimeExecutionReserveMs = parsePositiveIntEnv(
  process.env.RUNTIME_EXEC_RESERVE_MANIM_MS,
  fastModeEnabled ? 90_000 : 120_000,
  2_000
);
const turnBudgetMs = parsePositiveIntEnv(
  process.env.TURN_BUDGET_MS,
  300_000,
  1_000
);
const runtimeRecoveryBudgetMs = parsePositiveIntEnv(
  process.env.RUNTIME_RECOVERY_BUDGET_MS,
  fastModeEnabled ? 18_000 : 24_000,
  1_000
);
const runtimeDebugSessionTimeoutMs = parsePositiveIntEnv(
  process.env.RUNTIME_DEBUG_SESSION_TIMEOUT_MS,
  fastModeEnabled ? 10_000 : 15_000,
  1_000
);
const selfDebugSessionTimeoutMs = parsePositiveIntEnv(
  process.env.SELF_DEBUG_SESSION_TIMEOUT_MS,
  fastModeEnabled ? 9_000 : 14_000,
  1_000
);
const selfDebugMaxIterations = parsePositiveIntEnv(
  process.env.SELF_DEBUG_MAX_ITERATIONS,
  2,
  1
);
const runtimeDebugMaxIterations = parsePositiveIntEnv(
  process.env.RUNTIME_DEBUG_MAX_ITERATIONS,
  2,
  1
);

function resolveRuntimeExecutionTimeoutMs(skillId) {
  return skillId === "manim" ? manimRuntimeExecutionTimeoutMs : runtimeExecutionTimeoutMs;
}

function resolveRuntimeExecutionReserveMs(skillId) {
  return skillId === "manim" ? manimRuntimeExecutionReserveMs : runtimeExecutionReserveMs;
}

const disableGenerateAutoModify = parseBooleanEnv(
  process.env.DISABLE_GENERATE_AUTO_MODIFY,
  true
);

function getTurnDeadlineAtMs(turnStartedAtMs) {
  if (Number.isFinite(turnStartedAtMs)) {
    return turnStartedAtMs + turnBudgetMs;
  }

  return Date.now() + turnBudgetMs;
}

function getRemainingBudgetMs(deadlineAtMs) {
  if (!Number.isFinite(deadlineAtMs)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, deadlineAtMs - Date.now());
}

function computeBoundedTimeoutMs(deadlineAtMs, configuredTimeoutMs, minimumTimeoutMs = 300) {
  const remainingMs = getRemainingBudgetMs(deadlineAtMs);
  if (!Number.isFinite(remainingMs)) {
    return configuredTimeoutMs;
  }

  if (remainingMs <= 0) {
    return 0;
  }

  const minimum = Math.min(minimumTimeoutMs, remainingMs);
  return Math.max(minimum, Math.min(configuredTimeoutMs, remainingMs));
}

function shouldDegradeRuntimeFailure(runtimeResult) {
  if (!runtimeResult || runtimeResult.success) {
    return false;
  }

  const detail = [
    runtimeResult.errorCode,
    runtimeResult.error,
    runtimeResult.warning,
    runtimeResult.status
  ]
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();

  return /(acquire_budget_exhausted|runtime_budget_exhausted|budget exhausted|daytona|eai_again|getaddrinfo|enotfound|dns|enetunreach|operation timed out|timed out|failed to create and start sandbox|acquire timeout)/i.test(
    detail
  );
}

function buildDegradedRuntimeResult(runtimeResult, selectedSkill, fallbackPreviewUrl = "about:blank") {
  const originalDetail = runtimeResult?.error || runtimeResult?.warning || "Sandbox runtime unavailable.";
  const resolvedOutputKind = runtimeResult?.outputKind ?? (selectedSkill === "manim" ? "media" : "code");
  const resolvedMediaType = runtimeResult?.mediaType ?? (resolvedOutputKind === "media" ? "video/mp4" : null);
  const resolvedPreviewUrl = runtimeResult?.previewUrl ?? fallbackPreviewUrl;
  const resolvedMediaUrl = runtimeResult?.mediaUrl ?? (resolvedOutputKind === "media" ? resolvedPreviewUrl : null);

  return {
    success: true,
    status: "degraded",
    previewUrl: resolvedPreviewUrl,
    outputKind: resolvedOutputKind,
    mediaType: resolvedMediaType,
    mediaUrl: resolvedMediaUrl,
    mediaArtifactId: runtimeResult?.mediaArtifactId ?? null,
    mediaDurationMs: runtimeResult?.mediaDurationMs ?? null,
    mediaFps: runtimeResult?.mediaFps ?? null,
    mediaResolution: runtimeResult?.mediaResolution ?? null,
    mediaBytes: runtimeResult?.mediaBytes ?? null,
    skillId: runtimeResult?.skillId ?? selectedSkill,
    skillName: runtimeResult?.skillName ?? selectedSkill,
    dependencyCount: runtimeResult?.dependencyCount ?? 0,
    durationMs: runtimeResult?.durationMs ?? 0,
    renderCount: runtimeResult?.renderCount ?? 0,
    frameCount: runtimeResult?.frameCount ?? 0,
    logs: runtimeResult?.logs ?? [],
    summary: runtimeResult?.summary ?? { childCount: 0, types: [] },
    warning: `Runtime degraded due to sandbox provisioning constraints: ${originalDetail}`,
    warningCode: runtimeResult?.warningCode ?? "RUNTIME_DEGRADED_PROVISIONING",
    error: null,
    errorCode: null,
    acquireDiagnostics: runtimeResult?.acquireDiagnostics ?? null,
    degradedFrom: {
      status: runtimeResult?.status ?? "error",
      error: runtimeResult?.error ?? null,
      errorCode: runtimeResult?.errorCode ?? null
    }
  };
}

function shouldRequireOrbitControls(state) {
  if (state?.selectedSkill !== "threejs") {
    return false;
  }

  const normalizedQuery = normalizeQuery(state?.request?.query ?? "");
  if (!normalizedQuery) {
    return true;
  }

  if (/(chart|graph|diagram|mermaid|static|poster|logo|icon|infographic)/.test(normalizedQuery)) {
    return false;
  }

  return true;
}

function hasOrbitControlsInCode(code) {
  const normalizedCode = String(code ?? "");
  if (!normalizedCode.trim()) {
    return false;
  }

  const hasCtor = /new\s+OrbitControls\s*\(/.test(normalizedCode) || /OrbitControls\s*\(/.test(normalizedCode);
  const hasControlUsage = /controls\s*\./.test(normalizedCode);
  return hasCtor && hasControlUsage;
}

/**
 * Detect required npm tools from generated code
 * @param {string} generatedCode
 * @returns {Array} Array of { name, version } objects
 */
function detectRequiredTools(generatedCode) {
  const toolMap = {
    // Three.js ecosystem
    'three': { name: 'three', version: 'latest' },
    'three-fiber': { name: 'three-fiber', version: 'latest' },
    '@react-three/drei': { name: '@react-three/drei', version: 'latest' },
    '@react-three/postprocessing': { name: '@react-three/postprocessing', version: 'latest' },
    
    // Animation
    'gsap': { name: 'gsap', version: 'latest' },
    'animejs': { name: 'animejs', version: 'latest' },
    'motion': { name: 'motion', version: 'latest' },
    
    // Data viz
    'd3': { name: 'd3', version: 'latest' },
    'plotly.js': { name: 'plotly.js', version: 'latest' },
    'chart.js': { name: 'chart.js', version: 'latest' },
    
    // Utilities
    'lodash': { name: 'lodash', version: 'latest' },
    'lodash-es': { name: 'lodash-es', version: 'latest' }
  };
  
  const detectedTools = new Map();
  const codeStr = String(generatedCode ?? '');
  
  if (!codeStr.trim()) {
    return [];
  }
  
  // Look for import/require statements
  const importRegex = /(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+.*\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  
  while ((match = importRegex.exec(codeStr)) !== null) {
    const moduleName = match[1] || match[2];
    if (!moduleName) continue;
    
    // Check if it's a known tool
    for (const [key, toolInfo] of Object.entries(toolMap)) {
      if (moduleName === key || moduleName.includes(key)) {
        // Avoid duplicates
        if (!detectedTools.has(toolInfo.name)) {
          detectedTools.set(toolInfo.name, toolInfo);
        }
        break;
      }
    }
  }
  
  return Array.from(detectedTools.values());
}

/**
 * Check if code is a multi-file project
 * @param {any} code - Code string or project object
 * @returns {boolean}
 */
function isMultiFileProject(code) {
  return code && typeof code === 'object' && 
         Array.isArray(code.files) && 
         code.entryPoint && 
         code.files.length > 0;
}

/**
 * Validate a GeneratedProject structure
 * @param {any} project
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateProject(project) {
  const errors = [];

  if (!project || typeof project !== 'object') {
    errors.push('Project must be an object');
    return { valid: false, errors };
  }

  if (!Array.isArray(project.files)) {
    errors.push('Project must have files array');
  } else if (project.files.length === 0) {
    errors.push('Project must have at least one file');
  }

  if (!project.entryPoint) {
    errors.push('Project must have entryPoint');
  } else if (project.files && !project.files.some(f => f.path === project.entryPoint)) {
    errors.push(`Entry point "${project.entryPoint}" not found in files`);
  }

  const invalidFiles = project.files?.filter(f => !f.path || typeof f.content !== 'string') || [];
  if (invalidFiles.length > 0) {
    errors.push(`Files must have path and string content. Found ${invalidFiles.length} invalid files.`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

async function withTimeout(promise, timeoutMs, timeoutMessage) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(timeoutMessage);
  }

  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function buildRuntimeFailureResult({ skillId, errorMessage, errorCode = "RUNTIME_EXEC_TIMEOUT" }) {
  const outputKind = skillId === "manim" ? "media" : "code";
  const mediaType = outputKind === "media" ? "video/mp4" : null;

  return {
    success: false,
    status: "error",
    previewUrl: null,
    outputKind,
    mediaType,
    mediaUrl: null,
    mediaArtifactId: null,
    mediaDurationMs: null,
    mediaFps: null,
    mediaResolution: null,
    mediaBytes: null,
    skillId,
    skillName: skillId,
    dependencyCount: 0,
    durationMs: 0,
    renderCount: 0,
    frameCount: 0,
    logs: [],
    summary: { childCount: 0, types: [] },
    warningCode: null,
    error: errorMessage,
    errorCode,
    acquireDiagnostics: null
  };
}

async function executeSkillRuntimeBounded({ skillId, code, timeoutMs, maxFrames, turnDeadlineAtMs, sessionId = null, tools = [] }) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return buildRuntimeFailureResult({
      skillId,
      errorMessage: "Turn budget exhausted before runtime execution.",
      errorCode: "RUNTIME_BUDGET_EXHAUSTED"
    });
  }

  const envelopeTimeoutMs = timeoutMs + 1500;
  try {
    return await withTimeout(
      executeSkillRuntime({
        skillId,
        code,
        timeoutMs,
        maxFrames,
        turnDeadlineAtMs,
        sessionId,
        tools
      }),
      envelopeTimeoutMs,
      `Runtime execution timed out after ${envelopeTimeoutMs}ms.`
    );
  } catch (error) {
    return buildRuntimeFailureResult({
      skillId,
      errorMessage: error instanceof Error ? error.message : "Unknown runtime execution timeout",
      errorCode: error?.code ? String(error.code) : "RUNTIME_EXEC_TIMEOUT"
    });
  }
}

/**
 * Execute skill with quality loop decision logic.
 * Routes to sandbox quality loop for "standard"/"high" quality, or one-shot for "draft".
 * @param {object} params
 * @param {string} params.skillId
 * @param {string} params.code
 * @param {number} params.timeoutMs
 * @param {number} params.maxFrames
 * @param {number} params.turnDeadlineAtMs
 * @param {string} [params.sessionId]
 * @param {string} [params.quality] - 'draft', 'standard', or 'high'
 * @param {string} [params.originalQuery] - For quality loop feedback
 * @param {Function} [params.onProgress] - Progress callback
 * @returns {Promise<object>} Runtime result with iterations array if quality loop was used
 */
async function executeSkillRuntimeWithQualityDecision({
  skillId,
  code,
  timeoutMs,
  maxFrames,
  turnDeadlineAtMs,
  sessionId = null,
  quality = "standard",
  originalQuery = null,
  onProgress = null,
  tools = []
}) {
  // Determine if quality loop should be enabled
  const shouldUseQualityLoop = quality !== "draft" && sessionId && originalQuery;

  if (!shouldUseQualityLoop) {
    // Use traditional one-shot execution
    return executeSkillRuntimeBounded({
      skillId,
      code,
      timeoutMs,
      maxFrames,
      turnDeadlineAtMs,
      sessionId,
      tools
    });
  }

  // Use quality loop
  try {
    const iterationConfig = resolveIterationConfig(quality);
    
    // PHASE 3: Determine execution mode from quality tier and add to config
    const executionMode = determineModeFromQuality(quality);
    
    const sandboxExecutionRequest = {
      sessionId,
      code,
      skill: skillId,
      prompt: originalQuery,
      tools,
      mode: executionMode,  // NEW: Add execution mode
      config: {
        ...iterationConfig,
        timeoutPerIterationMs: timeoutMs
      }
    };

    console.log(
      `[Orchestrator] Quality loop enabled for ${quality} (mode=${executionMode}, maxIterations=${iterationConfig.maxIterations}, threshold=${iterationConfig.qualityThreshold}).`
    );

    const qualityLoopResult = await executeWithQualityLoop(sandboxExecutionRequest, onProgress);

    if (!qualityLoopResult.success) {
      console.warn(
        `[Orchestrator] Quality loop failed: ${qualityLoopResult.error}`
      );
      return {
        success: false,
        status: "error",
        previewUrl: null,
        outputKind: skillId === "manim" ? "media" : "code",
        mediaType: null,
        mediaUrl: null,
        mediaArtifactId: null,
        mediaDurationMs: null,
        mediaFps: null,
        mediaResolution: null,
        mediaBytes: null,
        skillId,
        skillName: skillId,
        dependencyCount: 0,
        durationMs: qualityLoopResult.error ? 0 : (qualityLoopResult.iterations?.[0]?.durationMs ?? 0),
        renderCount: 0,
        frameCount: 0,
        logs: [],
        summary: { childCount: 0, types: [] },
        warning: `Quality loop encountered error: ${qualityLoopResult.error}`,
        warningCode: "QUALITY_LOOP_ERROR",
        error: qualityLoopResult.error,
        errorCode: "QUALITY_LOOP_FAILED",
        iterations: qualityLoopResult.iterations ?? [],
        qualityReport: qualityLoopResult.qualityReport ?? null
      };
    }

    // Success - convert quality loop result to orchestrator format
    const finalIteration = qualityLoopResult.iterations?.[qualityLoopResult.finalIteration - 1];
    console.log(
      `[Orchestrator] Quality loop completed: ${qualityLoopResult.finalIteration} iterations, final score ${qualityLoopResult.finalScore}/100 (${qualityLoopResult.stopReason}).`
    );

    return {
      success: true,
      status: "quality-loop",
      previewUrl: qualityLoopResult.previewUrl,
      outputKind: skillId === "manim" ? "media" : "code",
      mediaType: skillId === "manim" ? "video/mp4" : null,
      mediaUrl: qualityLoopResult.previewUrl,
      mediaArtifactId: null,
      mediaDurationMs: null,
      mediaFps: null,
      mediaResolution: null,
      mediaBytes: null,
      skillId,
      skillName: skillId,
      dependencyCount: 0,
      durationMs: finalIteration?.durationMs ?? 0,
      renderCount: 1,
      frameCount: 1,
      logs: [],
      summary: { childCount: 0, types: [] },
      warning: null,
      warningCode: null,
      error: null,
      errorCode: null,
      acquireDiagnostics: null,
      // Quality loop specific
      iterations: qualityLoopResult.iterations ?? [],
      qualityReport: qualityLoopResult.qualityReport ?? {
        finalScore: qualityLoopResult.finalScore,
        finalIteration: qualityLoopResult.finalIteration,
        stopReason: qualityLoopResult.stopReason
      }
    };
  } catch (error) {
    console.error(
      `[Orchestrator] Quality loop threw: ${error instanceof Error ? error.message : String(error)}`
    );

    // Fall back to one-shot if quality loop fails
    return executeSkillRuntimeBounded({
      skillId,
      code,
      timeoutMs,
      maxFrames,
      turnDeadlineAtMs,
      sessionId
    });
  }
}

function parseTemperature(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveMoonshotTemperature(model, requestedTemperature) {
  // Kimi models currently require temperature=1.
  if (/kimi/i.test(model)) {
    return 1;
  }

  return requestedTemperature;
}

function resolveRequestedQuality(request, selectedSkill) {
  const explicitQuality = request?.preferences?.quality;
  if (explicitQuality) {
    return explicitQuality;
  }

  return selectedSkill === "threejs" || selectedSkill === "animejs" || selectedSkill === "manim"
    ? "high"
    : "standard";
}

function buildValidationOptions({
  skillId,
  request = null,
  requestedQuality = null,
  userQuery = "",
  parsedIntent = null
}) {
  const resolvedSkill = skillId ?? "threejs";
  const queryFromRequest = request?.query;
  const resolvedQuery = typeof userQuery === "string" && userQuery.trim()
    ? userQuery
    : typeof queryFromRequest === "string"
      ? queryFromRequest
      : "";
  const quality = requestedQuality ?? resolveRequestedQuality(request ?? {}, resolvedSkill);

  return {
    requestedQuality: quality,
    userQuery: resolvedQuery,
    parsedIntent,
    enforceQuality: resolvedSkill === "threejs" && quality !== "draft"
  };
}

const moonshotModeProfiles = Object.freeze({
  instant: Object.freeze({
    temperature: parseTemperature(process.env.MOONSHOT_INSTANT_TEMPERATURE, 1.0),
    thinking: false
  }),
  thinking: Object.freeze({
    temperature: parseTemperature(process.env.MOONSHOT_THINKING_TEMPERATURE, 1.0)
  })
});

function emitPipelineProgress(progress, step, status = "running", payload = {}) {
  if (typeof progress !== "function") {
    return;
  }

  try {
    progress({ step, status, payload });
  } catch {
    // Progress callbacks are best-effort and must never break orchestration.
  }
}

const requestSchema = z.object({
  query: z.string().min(3),
  sessionId: z.string().optional(),
  preferences: z
    .object({
      skill: z.enum(skillValues).optional(),
      quality: z.enum(qualityValues).optional()
    })
    .optional()
});

const modifyRequestSchema = z.object({
  sessionId: z.string().min(3),
  instruction: z.string().min(3),
  runMode: z.enum(["modify", "rerun"]).optional(),
  codeOverride: z.string().optional(),
  preferences: z
    .object({
      skill: z.enum(skillValues).optional(),
      quality: z.enum(qualityValues).optional()
    })
    .optional(),
  sceneState: z.any().optional()
});

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  action: z.enum([
    "parse_intent",
    "select_skill",
    "build_prompt",
    "generate_code",
    "validate_code",
    "execute_code",
    "sync_state"
  ]),
  command: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  dependsOn: z.array(z.string())
});

const executeRequestSchema = z.object({
  planId: z.string().min(3),
  task: taskSchema
});

function normalizeQuery(query) {
  return query.trim().toLowerCase();
}

function isGreetingQuery(normalizedQuery) {
  return /^(hi|hey|hello|yo|sup|hiya|good\s+(morning|afternoon|evening))\b/.test(normalizedQuery);
}

function isCapabilityQuery(normalizedQuery) {
  return /(what can (you|u) do|what do you do|how can you help|help me|what can i do here|what should i ask)/.test(
    normalizedQuery
  );
}

function isSmallTalkQuery(normalizedQuery) {
  return /(thanks|thank you|cool|nice|okay|ok|got it|sounds good|hey there|hello there)/.test(normalizedQuery);
}

function hasActionIntent(normalizedQuery) {
  return /\b(create|make|build|generate|design|draw|sketch|render|animate|modify|change|update|edit|revise|refine|polish|enhance|improve|upgrade|tweak|adjust|add|explain|describe|walkthrough|show|preview)\b/.test(
    normalizedQuery
  );
}

function hasVisualTopicIntent(normalizedQuery) {
  return /\b(scene|visual|image|video|animation|3d|2d|canvas|diagram|chart|graph|data|cube|sphere|particle|color|rotation|spin|orbit|layout|lighting|material|shader|threejs|p5js|d3js|anime|animejs|manim|motion|timeline|tween|easing|equation|formula|latex|math|mermaid|wave|waves|scalar|interference|frequency|resonance|field|fields)\b/.test(
    normalizedQuery
  );
}

function hasRefinementIntent(normalizedQuery) {
  if (/(\bmodify\b|\bchange\b|\bupdate\b|\bedit\b|\brefine\b|\bpolish\b|\benhance\b|\bimprove\b|\bupgrade\b|\btweak\b|\badjust\b|more\s+detail|high\s*quality|premium|cinematic|look\s+better)/.test(normalizedQuery)) {
    return true;
  }

  return /\bmake\b/.test(normalizedQuery) && /(better|cleaner|sharper|richer|deeper|premium)/.test(normalizedQuery);
}

function hasExplicitEditInstruction(normalizedQuery) {
  if (/(\bmodify\b|\bchange\b|\bupdate\b|\bedit\b|\brefine\b|\bpolish\b|\benhance\b|\bimprove\b|\bupgrade\b|\btweak\b|\badjust\b|\brevise\b|\brework\b)/.test(normalizedQuery)) {
    return true;
  }

  if (!/\bmake\b/.test(normalizedQuery)) {
    return false;
  }

  const referencesCurrentScene = /\b(it|this|that|current|existing|same)\b/.test(normalizedQuery);
  const refinementQualifier = /(better|cleaner|sharper|richer|deeper|premium|cinematic|high\s*quality)/.test(normalizedQuery);
  return referencesCurrentScene && refinementQualifier;
}

function isQuestionQuery(normalizedQuery) {
  return /^(what|why|how|who|where|when|can|could|would|should|do|does|did|is|are|tell me|help|what's|whats)\b/.test(
    normalizedQuery
  );
}

function isConversationQuery(normalizedQuery) {
  if (isGreetingQuery(normalizedQuery) || isCapabilityQuery(normalizedQuery) || isSmallTalkQuery(normalizedQuery)) {
    return true;
  }

  if (isQuestionQuery(normalizedQuery) && !hasActionIntent(normalizedQuery)) {
    return true;
  }

  return !hasActionIntent(normalizedQuery) && !hasVisualTopicIntent(normalizedQuery);
}

function buildConversationHelpText(sessionState, query, parsedIntent) {
  const hasScene = Boolean(sessionState?.currentScene?.sceneId);
  const sceneLabel = hasScene ? `current scene ${sessionState.currentScene.sceneId}` : "no scene yet";
  const queryLabel = query.trim() ? `for “${query.trim()}”` : "for now";

  if (parsedIntent.isGreeting) {
    return [
      `Hi. I can generate a new visual, modify the current one, or explain ${sceneLabel}.`,
      `Try asking me to make something, change a detail, or explain what you already have ${queryLabel}.`,
      hasScene ? `If you want, I can continue from ${sceneLabel} right away.` : "If you do not have a scene yet, I can start one from scratch."
    ].join(" ");
  }

  if (parsedIntent.isCapabilityQuestion) {
    return [
      "I can create scenes, edit existing ones, explain the current result, and keep the session history organized.",
      hasScene
        ? `Right now I can work from ${sceneLabel}. Ask for a color change, rotation tweak, layout shift, or a full new scene.`
        : "Right now there is no active scene, so the fastest path is to ask me to create one.",
      "Examples: ‘make a spinning cube’, ‘make it greener’, or ‘explain this scene’."
    ].join(" ");
  }

  return [
    "I can help with visuals, edits, and explanations.",
    hasScene
      ? `This session already has ${sceneLabel}, so you can ask me to modify it or explain it.`
      : "There is no generated scene yet, so I can start by creating one.",
    "If you want a specific result, mention the object, style, motion, color, or layout."
  ].join(" ");
}

function extractAssistantText(rawContent) {
  if (!rawContent || typeof rawContent !== "string") {
    return "";
  }

  const cleaned = rawContent.replace(/^```(?:text|markdown)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return cleaned;
}

function extractChoiceContent(rawContent) {
  if (typeof rawContent === "string") {
    return rawContent;
  }

  if (Array.isArray(rawContent)) {
    return rawContent
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (!part || typeof part !== "object") {
          return "";
        }

        if (typeof part.text === "string") {
          return part.text;
        }

        if (typeof part.content === "string") {
          return part.content;
        }

        if (typeof part.value === "string") {
          return part.value;
        }

        return "";
      })
      .join("");
  }

  if (rawContent && typeof rawContent === "object") {
    if (typeof rawContent.text === "string") {
      return rawContent.text;
    }

    if (typeof rawContent.content === "string") {
      return rawContent.content;
    }
  }

  return "";
}

async function generateConversationReplyWithMoonshot({ sessionState, request, parsedIntent, mode, onChunk }) {
  const { systemPrompt, userPrompt } = buildConversationPromptBundle({
    sessionState,
    request,
    parsedIntent,
    mode
  });

  try {
    const completion = await executeWithProviderFailover({
      operationName: "ConversationReply",
      filter: { requireThinking: true },
      mode: "thinking",
      retryDelays: moonshotRetryDelaysMs,
      executeProvider: async ({ provider, mode: providerMode, retryDelays }) => {
        const response = await fetchChatCompletion(
          provider,
          {
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ]
          },
          { mode: providerMode, retryDelays }
        );

        const payload = await response.json();
        const replyText = extractAssistantText(extractChoiceContent(payload?.choices?.[0]?.message?.content));

        if (!replyText) {
          throw createRetryableProviderError(`${provider.id} returned empty conversational output.`, "PROVIDER_EMPTY_OUTPUT");
        }

        return { replyText };
      }
    });

    const replyText = completion?.value?.replyText ?? "";
    await emitTextChunks(replyText, onChunk);

    return {
      replyText,
      replySource: completion.provider.id,
      replyWarning: completion.llm.fallbackUsed
        ? `Primary conversation model unavailable; replied via ${completion.provider.id}.`
        : null,
      replyLlm: completion.llm
    };
  } catch (error) {
    const replyText = buildConversationHelpText(sessionState, request.query, parsedIntent);
    await emitTextChunks(replyText, onChunk);

    const fallbackReason = error?.code === "NO_ELIGIBLE_LLM_PROVIDER"
      ? "No eligible LLM providers configured; used fallback conversation reply."
      : isMoonshotOverloaded(error)
        ? moonshotOverloadedMessage
        : `Conversation fallback used after model error: ${error instanceof Error ? error.message : "Unknown error"}`;

    return {
      replyText,
      replySource: "fallback",
      replyWarning: fallbackReason,
      replyLlm: error?.llm ?? null
    };
  }
}

function extractCodeContent(rawContent) {
  if (!rawContent || typeof rawContent !== "string") {
    return "";
  }

  const fencedBlock = rawContent.match(/```(?:[a-z0-9_-]+)?\s*([\s\S]*?)```/i);
  const output = fencedBlock ? fencedBlock[1] : rawContent;
  return output.trim();
}

function splitCodeLines(code) {
  return String(code ?? "").replace(/\r\n/g, "\n").split("\n");
}

function buildLineDiffOperations(previousLines, nextLines) {
  const rowCount = previousLines.length;
  const columnCount = nextLines.length;
  const matrix = Array.from({ length: rowCount + 1 }, () => Array(columnCount + 1).fill(0));

  for (let row = rowCount - 1; row >= 0; row -= 1) {
    for (let column = columnCount - 1; column >= 0; column -= 1) {
      if (previousLines[row] === nextLines[column]) {
        matrix[row][column] = matrix[row + 1][column + 1] + 1;
      } else {
        matrix[row][column] = Math.max(matrix[row + 1][column], matrix[row][column + 1]);
      }
    }
  }

  const operations = [];
  let row = 0;
  let column = 0;

  while (row < rowCount && column < columnCount) {
    if (previousLines[row] === nextLines[column]) {
      operations.push({ type: "equal", line: previousLines[row] });
      row += 1;
      column += 1;
      continue;
    }

    if (matrix[row + 1][column] >= matrix[row][column + 1]) {
      operations.push({ type: "remove", line: previousLines[row] });
      row += 1;
    } else {
      operations.push({ type: "add", line: nextLines[column] });
      column += 1;
    }
  }

  while (row < rowCount) {
    operations.push({ type: "remove", line: previousLines[row] });
    row += 1;
  }

  while (column < columnCount) {
    operations.push({ type: "add", line: nextLines[column] });
    column += 1;
  }

  return operations;
}

function buildCodeDiffDetails(previousCode, nextCode) {
  if (previousCode === nextCode) {
    return {
      patch: "",
      addedLines: 0,
      removedLines: 0,
      changedLines: 0
    };
  }

  const previousLines = splitCodeLines(previousCode);
  const nextLines = splitCodeLines(nextCode);
  const operations = buildLineDiffOperations(previousLines, nextLines);
  const addedLines = operations.reduce((total, operation) => total + (operation.type === "add" ? 1 : 0), 0);
  const removedLines = operations.reduce((total, operation) => total + (operation.type === "remove" ? 1 : 0), 0);

  const patchLines = [
    "--- previous.js",
    "+++ updated.js",
    `@@ -1,${previousLines.length} +1,${nextLines.length} @@`,
    ...operations.map((operation) => {
      if (operation.type === "add") {
        return `+${operation.line}`;
      }

      if (operation.type === "remove") {
        return `-${operation.line}`;
      }

      return ` ${operation.line}`;
    })
  ];

  return {
    patch: patchLines.join("\n"),
    addedLines,
    removedLines,
    changedLines: addedLines + removedLines
  };
}

function normalizeCodeForSemanticCompare(code) {
  return String(code ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s+/g, "")
    .trim();
}

function patchAddsOnlyCommentLines(patch) {
  if (!patch) {
    return false;
  }

  const lines = String(patch).split("\n");
  let hasAddedLine = false;

  for (const line of lines) {
    if (!line.startsWith("+") || line.startsWith("+++")) {
      continue;
    }

    const addedLine = line.slice(1).trim();
    if (!addedLine) {
      continue;
    }

    hasAddedLine = true;
    if (!(addedLine.startsWith("//") || addedLine.startsWith("/*") || addedLine.startsWith("*"))) {
      return false;
    }
  }

  return hasAddedLine;
}

function detectNoopModification({ previousCode, nextCode, changeSummary, diffDetails }) {
  if (String(previousCode ?? "") === String(nextCode ?? "")) {
    return { isNoop: true, reason: "identical_output" };
  }

  const previousSemantic = normalizeCodeForSemanticCompare(previousCode);
  const nextSemantic = normalizeCodeForSemanticCompare(nextCode);
  if (previousSemantic === nextSemantic) {
    return { isNoop: true, reason: "non_semantic_diff" };
  }

  if (patchAddsOnlyCommentLines(diffDetails?.patch)) {
    return { isNoop: true, reason: "comment_only_patch" };
  }

  const summary = String(changeSummary ?? "");
  if ((diffDetails?.changedLines ?? 0) <= 1 && /instruction marker|no direct code match/i.test(summary)) {
    return { isNoop: true, reason: "instruction_marker_only" };
  }

  return { isNoop: false, reason: null };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateDiagnostic(value, maxLength = 320) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function serializeErrorForDiagnostics(error, context = {}) {
  const diagnostics = {
    stage: context.stage ?? null,
    context,
    message: "Unknown error",
    code: null,
    status: null,
    cause: null,
    stack: null,
    timestamp: new Date().toISOString()
  };

  if (error instanceof Error) {
    diagnostics.message = truncateDiagnostic(error.message) ?? diagnostics.message;
    diagnostics.code = truncateDiagnostic(error.code, 96);
    diagnostics.status = Number.isFinite(error.status) ? Number(error.status) : null;
    diagnostics.cause = truncateDiagnostic(
      error.cause instanceof Error ? error.cause.message : error.cause,
      240
    );
    diagnostics.stack = truncateDiagnostic(error.stack?.split("\n").slice(0, 3).join(" | "), 500);
    return diagnostics;
  }

  diagnostics.message = truncateDiagnostic(error, 320) ?? diagnostics.message;
  return diagnostics;
}

function isMoonshotOverloaded(error) {
  return Boolean(
    error &&
      typeof error === "object" &&
      ((error.code && error.code === "MOONSHOT_OVERLOADED") ||
        (error instanceof Error && /(temporarily overloaded|engine_overloaded_error|\b429\b)/i.test(error.message)))
  );
}

function createMoonshotOverloadedError() {
  const error = new Error(moonshotOverloadedMessage);
  error.code = "MOONSHOT_OVERLOADED";
  return error;
}

async function withNarrationRetries(operationName, fn, options = {}) {
  const retryDelays = Array.isArray(options.retryDelays) ? options.retryDelays : narrationRetryDelaysMs;
  let attempt = 0;
  let lastError = null;

  while (attempt <= retryDelays.length) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isMoonshotOverloaded(error) || attempt >= retryDelays.length) {
        throw error;
      }

      const delayMs = retryDelays[attempt] ?? 0;
      if (delayMs > 0) {
        console.warn(
          `[${operationName}] Moonshot overloaded. Retrying in ${delayMs}ms (attempt ${attempt + 1}/${retryDelays.length + 1}).`
        );
        await sleep(delayMs);
      }
      attempt += 1;
    }
  }

  throw lastError ?? new Error(`${operationName} failed.`);
}

function buildMoonshotRequestPayload(payload, options = {}) {
  const mode = options.mode ?? "thinking";
  const modeProfile = moonshotModeProfiles[mode] ?? moonshotModeProfiles.thinking;
  const enrichedPayload = { ...payload };
  const requestModel = enrichedPayload.model ?? moonshotModel;
  const requestedTemperature = payload.temperature ?? modeProfile.temperature;

  enrichedPayload.temperature = resolveMoonshotTemperature(requestModel, requestedTemperature);

  if (mode === "instant" && modeProfile.thinking === false) {
    const existingExtraBody = payload.extra_body ?? {};
    const existingTemplateArgs = existingExtraBody.chat_template_kwargs ?? {};

    enrichedPayload.extra_body = {
      ...existingExtraBody,
      chat_template_kwargs: {
        ...existingTemplateArgs,
        thinking: false
      }
    };
  } else if (payload.extra_body) {
    enrichedPayload.extra_body = payload.extra_body;
  }

  return enrichedPayload;
}

async function streamMoonshotAssistantText(response, onChunk) {
  if (!response.body) {
    throw new Error("Moonshot streaming response did not include a body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assistantText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (buffer.includes("\n\n")) {
      const separatorIndex = buffer.indexOf("\n\n");
      const rawEvent = buffer.slice(0, separatorIndex).trim();
      buffer = buffer.slice(separatorIndex + 2);

      if (!rawEvent) {
        continue;
      }

      const data = rawEvent
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.replace(/^data:\s?/, ""))
        .join("\n");

      if (!data || data === "[DONE]") {
        continue;
      }

      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      const delta = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content ?? "";
      if (!delta) {
        continue;
      }

      assistantText += delta;
      if (typeof onChunk === "function") {
        await onChunk(delta, assistantText);
      }
    }
  }

  const trailing = buffer.trim();
  if (trailing && trailing !== "[DONE]") {
    try {
      const parsed = JSON.parse(trailing.replace(/^data:\s?/, ""));
      const delta = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content ?? "";
      if (delta) {
        assistantText += delta;
        if (typeof onChunk === "function") {
          await onChunk(delta, assistantText);
        }
      }
    } catch {
      // Ignore trailing partial data.
    }
  }

  return assistantText;
}

async function emitTextChunks(text, onChunk) {
  if (typeof onChunk !== "function" || !text) {
    return;
  }

  const segments = text.match(/[^\n\.?!]+[\n\.?!]?|\s+/g) ?? [text];
  let runningText = "";

  for (const segment of segments) {
    runningText += segment;
    await onChunk(segment, runningText);
  }
}

/**
 * Fetch chat completion from Moonshot API with model mode routing.
 *
 * @param {object} payload - Standard OpenAI-compatible chat completion payload
 * @param {object} [options] - Additional options
 * @param {string} [options.mode='thinking'] - 'instant' | 'thinking' — controls Kimi K2.5 mode
 */
async function fetchMoonshotChatCompletion(payload, options = {}) {
  const mode = options.mode ?? "thinking";
  let lastError = null;
  let attempt = 0;

  console.log(`[Moonshot] [TRACE] fetchMoonshotChatCompletion called. mode=${mode}, model=${payload?.model ?? "default"}, attempt=${attempt}`);

  while (attempt <= moonshotRetryDelaysMs.length) {
    const enrichedPayload = buildMoonshotRequestPayload(payload, { mode });

    try {
      const fetchStartMs = Date.now();
      const response = await fetch(`${moonshotBaseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${moonshotApiKey}`
        },
        body: JSON.stringify(enrichedPayload)
      });
      const fetchDurationMs = Date.now() - fetchStartMs;

      if (response.ok) {
        console.log(`[Moonshot] [TRACE] Request succeeded in ${fetchDurationMs}ms. status=${response.status}, attempt=${attempt}`);
        return response;
      }

      const bodyText = await response.text();
      console.warn(`[Moonshot] [WARN] Request failed. status=${response.status}, attempt=${attempt}, duration=${fetchDurationMs}ms, body=${bodyText.slice(0, 200)}`);

      const error = new Error(`Moonshot request failed (${response.status}): ${bodyText.slice(0, 220)}`);

      if (response.status !== 429 || attempt >= moonshotRetryDelaysMs.length) {
        throw error;
      }

      lastError = error;
      await sleep(moonshotRetryDelaysMs[attempt]);
      attempt += 1;
    } catch (error) {
      lastError = error;
      console.warn(`[Moonshot] [WARN] Fetch threw. attempt=${attempt}, error=${error instanceof Error ? error.message : String(error)}`);

      if (!isMoonshotOverloaded(error) || attempt >= moonshotRetryDelaysMs.length) {
        throw error;
      }

      await sleep(moonshotRetryDelaysMs[attempt]);
      attempt += 1;
    }
  }

  if (isMoonshotOverloaded(lastError)) {
    throw createMoonshotOverloadedError();
  }

  throw lastError ?? new Error("Moonshot request failed.");
}

/**
 * Generalized chat completion fetch — works with any OpenAI-compatible provider.
 * Applies provider-specific payload transforms, handles retries within a single provider.
 *
 * @param {object} provider - Resolved provider object from the pool
 * @param {object} payload - Standard OpenAI-compatible chat completion payload
 * @param {object} [options] - Additional options
 * @param {string} [options.mode='instant'] - 'instant' | 'thinking'
 * @param {number[]} [options.retryDelays] - Retry delays for transient errors
 * @returns {Promise<Response>} The fetch response
 */
async function fetchChatCompletion(provider, payload, options = {}) {
  const mode = options.mode ?? "instant";
  const retryDelays = options.retryDelays ?? [150, 350];
  let lastError = null;
  let attempt = 0;

  const resolvedModel = payload.model ?? provider.model;
  const resolvedPayload = { max_tokens: 8192, ...payload, model: resolvedModel };

  console.log(`[LLMPool] [TRACE] fetchChatCompletion called. provider=${provider.id}, model=${resolvedModel}, mode=${mode}`);

  while (attempt <= retryDelays.length) {
    // Apply provider-specific payload transform if defined
    const enrichedPayload = typeof provider.payloadTransform === "function"
      ? provider.payloadTransform.call(provider, resolvedPayload, { mode })
      : resolvedPayload;

    const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;

    try {
      const fetchStartMs = Date.now();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(enrichedPayload),
      });
      const fetchDurationMs = Date.now() - fetchStartMs;

      if (response.ok) {
        console.log(`[LLMPool] [TRACE] ${provider.id} responded in ${fetchDurationMs}ms. status=${response.status}`);
        return response;
      }

      const bodyText = await response.text();
      console.warn(`[LLMPool] [WARN] ${provider.id} request failed. status=${response.status}, attempt=${attempt}, duration=${fetchDurationMs}ms, body=${bodyText.slice(0, 200)}`);

      const error = new Error(`${provider.id} request failed (${response.status}): ${bodyText.slice(0, 220)}`);
      error.status = response.status;

      // On 429, don't retry within this provider — let the pool handle rotation
      if (response.status === 429) {
        error.code = "PROVIDER_RATE_LIMITED";
        throw error;
      }

      // On other failures, retry within provider
      if (attempt >= retryDelays.length) {
        throw error;
      }

      lastError = error;
      await sleep(retryDelays[attempt]);
      attempt += 1;
    } catch (error) {
      // If it's a rate-limit error, propagate immediately for pool rotation
      if (error?.code === "PROVIDER_RATE_LIMITED" || error?.status === 429) {
        throw error;
      }

      lastError = error;
      console.warn(`[LLMPool] [WARN] ${provider.id} fetch threw. attempt=${attempt}, error=${error instanceof Error ? error.message : String(error)}`);

      if (attempt >= retryDelays.length) {
        throw error;
      }

      await sleep(retryDelays[attempt]);
      attempt += 1;
    }
  }

  throw lastError ?? new Error(`${provider.id} request failed.`);
}

function providerMatchesFilter(provider, filter = {}) {
  if (!provider?.hasApiKey) {
    return false;
  }

  if (filter.requireThinking && !provider.capabilities?.thinking) {
    return false;
  }

  if (filter.requireCodeGeneration && !provider.capabilities?.codeGeneration) {
    return false;
  }

  if (filter.requireVision && !provider.capabilities?.vision) {
    return false;
  }

  return true;
}

function countEligibleProviders(pool, filter = {}) {
  return pool.providers.filter((provider) => providerMatchesFilter(provider, filter)).length;
}

function createRetryableProviderError(message, code = "PROVIDER_RETRYABLE_FAILURE") {
  const error = new Error(message);
  error.code = code;
  error.retryable = true;
  return error;
}

function isRetryableProviderFailure(error) {
  if (error?.retryable === true) {
    return true;
  }

  if (error?.status === 429 || error?.code === "PROVIDER_RATE_LIMITED") {
    return true;
  }

  const text = String(error?.message ?? "").toLowerCase();
  return /(timed? ?out|overloaded|engine_overloaded|temporarily|connection reset|socket hang up)/i.test(text);
}

function getRetryableProviderFailureReason(error) {
  if (error?.status === 429 || error?.code === "PROVIDER_RATE_LIMITED") {
    return "429";
  }

  const text = String(error?.message ?? "").toLowerCase();
  if (/timed? ?out/i.test(text)) {
    return "timeout";
  }

  if (/(overloaded|engine_overloaded|temporarily)/i.test(text)) {
    return "overloaded";
  }

  return truncateDiagnostic(error?.code ?? error?.message ?? "provider_failure", 96) ?? "provider_failure";
}

function buildLlmSourceMetadata({ providerId, model, attempts }) {
  const normalizedAttempts = Array.isArray(attempts)
    ? attempts.map((attempt) => ({
      providerId: attempt.providerId,
      model: attempt.model,
      status: attempt.status,
      reason: attempt.reason ?? null,
      retryable: Boolean(attempt.retryable)
    }))
    : [];

  return {
    providerId: providerId ?? null,
    model: model ?? null,
    fallbackUsed: normalizedAttempts.length > 1,
    attemptCount: normalizedAttempts.length,
    attempts: normalizedAttempts
  };
}

async function executeWithProviderFailover(options = {}) {
  const operationName = options.operationName ?? "LLMOperation";
  const filter = options.filter ?? {};
  const mode = options.mode ?? "instant";
  const retryDelays = Array.isArray(options.retryDelays) ? options.retryDelays : [150, 350];
  const maxCooldownWaitMs = Number.isFinite(options.maxCooldownWaitMs)
    ? Math.max(0, options.maxCooldownWaitMs)
    : 15_000;
  const executeProvider = options.executeProvider;

  if (typeof executeProvider !== "function") {
    throw new Error(`${operationName} requires executeProvider callback.`);
  }

  const pool = getPool();
  const maxAttempts = countEligibleProviders(pool, filter);

  if (maxAttempts === 0) {
    const error = new Error(`${operationName} has no eligible LLM providers configured.`);
    error.code = "NO_ELIGIBLE_LLM_PROVIDER";
    throw error;
  }

  const triedProviders = new Set();
  const attempts = [];

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const acquired = pool.acquire(filter);
    if (!acquired) {
      break;
    }

    const { provider, waitMs } = acquired;
    const resolvedModel = provider.model;

    if (triedProviders.has(provider.id)) {
      if (waitMs > 0 && waitMs <= maxCooldownWaitMs) {
        await sleep(waitMs);
      } else {
        break;
      }
    }

    triedProviders.add(provider.id);
    const requestStartedAt = Date.now();

    try {
      const value = await executeProvider({
        provider,
        mode,
        retryDelays,
        attempt: attempt + 1,
        maxAttempts
      });

      pool.recordRequest(provider.id, Date.now() - requestStartedAt);
      pool.markHealthy(provider.id);

      attempts.push({
        providerId: provider.id,
        model: resolvedModel,
        status: "success",
        reason: null,
        retryable: false
      });

      return {
        value,
        provider,
        model: resolvedModel,
        llm: buildLlmSourceMetadata({
          providerId: provider.id,
          model: resolvedModel,
          attempts
        })
      };
    } catch (error) {
      const retryable = isRetryableProviderFailure(error);
      const reason = truncateDiagnostic(error?.code ?? error?.message ?? "provider_failure", 180);

      attempts.push({
        providerId: provider.id,
        model: resolvedModel,
        status: "failed",
        reason,
        retryable
      });

      if (retryable) {
        pool.markExhausted(provider.id, getRetryableProviderFailureReason(error));
        continue;
      }

      if (!error.llm) {
        error.llm = buildLlmSourceMetadata({
          providerId: provider.id,
          model: resolvedModel,
          attempts
        });
      }

      throw error;
    }
  }

  const exhaustedError = new Error(`${operationName}: all eligible LLM providers were exhausted.`);
  exhaustedError.code = "ALL_LLM_PROVIDERS_EXHAUSTED";
  exhaustedError.llm = buildLlmSourceMetadata({
    providerId: null,
    model: null,
    attempts
  });
  throw exhaustedError;
}

/**
 * Generate code using the LLM provider pool with round-robin failover.
 * Tries each provider in priority order; on 429 or timeout, marks the provider
 * as exhausted and moves to the next. Falls back to static code only after
 * all providers are exhausted.
 *
 * @param {object} state - The graph state with selectedSkill, request, etc.
 * @returns {Promise<object>} { generatedCode, generationSource, generationWarning }
 */
async function generateCodeWithPool(state) {
  const pool = getPool();
  const maxAttempts = pool.providers.filter((p) => p.hasApiKey).length;

  if (maxAttempts === 0) {
    console.warn(`[GenerateCode] [WARN] No LLM providers configured — returning fallback.`);
    pool.recordFallback();
    return {
      generatedCode: buildFallbackGeneratedCode(state?.selectedSkill),
      generationSource: "fallback",
      generationWarning: "No LLM API keys configured; used fallback generator.",
    };
  }

  const { systemPrompt, userPrompt } = buildGenerationPromptBundle(state);
  console.log(`[GenerateCode] [TRACE] generateCodeWithPool called. skill=${state?.selectedSkill}, enabledProviders=${maxAttempts}`);
  console.log(`[GenerateCode] [TRACE] Prompt built. systemPrompt length=${systemPrompt.length}, userPrompt length=${userPrompt.length}`);

  const triedProviders = new Set();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const acquired = pool.acquire({ requireCodeGeneration: true });
    if (!acquired) {
      break;
    }

    const { provider, waitMs } = acquired;

    // Skip if we already tried this provider (happens when all are in cooldown)
    if (triedProviders.has(provider.id)) {
      // If we need to wait, wait for the cooldown
      if (waitMs > 0 && waitMs < 15_000) {
        console.log(`[GenerateCode] [TRACE] Waiting ${waitMs}ms for ${provider.id} cooldown to expire...`);
        await sleep(waitMs);
      } else {
        break; // Don't wait too long; fall back
      }
    }
    triedProviders.add(provider.id);

    try {
      console.log(`[GenerateCode] [TRACE] Attempting provider: ${provider.id} (priority=${provider.priority}, attempt=${attempt + 1}/${maxAttempts})`);
      pool.logStatus();

      const genStartMs = Date.now();
      const response = await fetchChatCompletion(provider, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }, { mode: "instant" });

      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      const genDurationMs = Date.now() - genStartMs;

      pool.recordRequest(provider.id, genDurationMs);
      console.log(`[GenerateCode] [TRACE] ${provider.id} responded in ${genDurationMs}ms. content length=${content?.length ?? 0}, finishReason=${payload?.choices?.[0]?.finish_reason ?? "unknown"}`);

      const generatedCode = extractCodeContent(content);
      console.log(`[GenerateCode] [TRACE] Extracted code length=${generatedCode?.length ?? 0}. First 120 chars: ${(generatedCode ?? "").slice(0, 120).replace(/\n/g, "\\n")}`);

      if (!generatedCode) {
        console.error(`[GenerateCode] [ERROR] Empty code output from ${provider.id}. Raw content preview: ${(content ?? "").slice(0, 200)}`);
        pool.markExhausted(provider.id, "empty-output");
        continue;
      }

      // Success!
      pool.markHealthy(provider.id);

      // OrbitControls check (only for primary providers that produce high quality)
      if (shouldRequireOrbitControls(state) && !hasOrbitControlsInCode(generatedCode)) {
        console.log(`[GenerateCode] [TRACE] OrbitControls missing from ${provider.id} output — attempting strict retry.`);
        try {
          const strictControlsPrompt = [
            userPrompt,
            "",
            "Critical requirement: include interactive camera controls using OrbitControls.",
            "Instantiate controls as: const controls = new OrbitControls(camera, renderer.domElement);",
            "Enable damping and call controls.update() inside the animation loop.",
            "Return code only.",
          ].join("\n");

          const retryResponse = await fetchChatCompletion(provider, {
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: strictControlsPrompt },
            ],
          }, { mode: "instant" });

          const retryPayload = await retryResponse.json();
          const retryGeneratedCode = extractCodeContent(retryPayload?.choices?.[0]?.message?.content);

          if (retryGeneratedCode && hasOrbitControlsInCode(retryGeneratedCode)) {
            console.log(`[GenerateCode] [TRACE] OrbitControls strict retry succeeded via ${provider.id}. code length=${retryGeneratedCode.length}`);
            return {
              generatedCode: retryGeneratedCode,
              generationSource: provider.id,
              generationWarning: "Regenerated once to satisfy OrbitControls interaction invariant.",
            };
          }
        } catch (retryErr) {
          console.warn(`[GenerateCode] [WARN] OrbitControls strict retry failed via ${provider.id}: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`);
        }

        return {
          generatedCode,
          generationSource: provider.id,
          generationWarning: "Generated code may be missing OrbitControls setup after strict retry.",
        };
      }

      console.log(`[GenerateCode] [TRACE] Generation successful via ${provider.id}. code length=${generatedCode.length}`);
      return {
        generatedCode,
        generationSource: provider.id,
        generationWarning: null,
      };
    } catch (error) {
      const isRateLimited = error?.status === 429 || error?.code === "PROVIDER_RATE_LIMITED";
      const isTimeout = /timed? ?out/i.test(error?.message ?? "");
      const isOverloaded = /(overloaded|engine_overloaded|temporarily)/i.test(error?.message ?? "");

      console.warn(`[GenerateCode] [WARN] ${provider.id} failed. rateLimited=${isRateLimited}, timeout=${isTimeout}, overloaded=${isOverloaded}, error=${error instanceof Error ? error.message : String(error)}`);

      if (isRateLimited || isTimeout || isOverloaded) {
        pool.markExhausted(provider.id, isRateLimited ? "429" : isTimeout ? "timeout" : "overloaded");
        continue; // Try next provider
      }

      // Non-retryable error — throw immediately
      throw error;
    }
  }

  // All providers exhausted — fall back to static code
  console.warn(`[GenerateCode] [WARN] All providers exhausted after ${triedProviders.size} attempts — returning fallback code.`);
  pool.logStatus();
  pool.recordFallback();
  return {
    generatedCode: buildFallbackGeneratedCode(state?.selectedSkill),
    generationSource: "fallback",
    generationWarning: `All ${triedProviders.size} LLM providers exhausted (rate-limited or timed out); used fallback generator.`,
  };
}

/**
 * Generate code modifications using the LLM provider pool with failover.
 * Similar to generateCodeWithPool but uses the modification prompt bundle.
 *
 * @param {object} state - The state with currentCode, instruction, etc.
 * @param {object} [options]
 * @returns {Promise<object>} { generatedCode, generationSource, generationWarning, changeSummary }
 */
async function modifyCodeWithPool(state, options = {}) {
  const pool = getPool();
  const maxAttempts = pool.providers.filter((p) => p.hasApiKey).length;

  if (maxAttempts === 0) {
    const fallback = applyFallbackSceneEdit(state.currentCode, state.instruction);
    return {
      generatedCode: fallback.generatedCode,
      generationSource: "fallback",
      generationWarning: "No LLM API keys configured; used fallback modifier.",
      changeSummary: fallback.changeSummary,
    };
  }

  const { systemPrompt, userPrompt } = buildModificationPromptBundle(state);
  const triedProviders = new Set();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const acquired = pool.acquire({ requireCodeGeneration: true });
    if (!acquired) break;

    const { provider, waitMs } = acquired;
    if (triedProviders.has(provider.id)) {
      if (waitMs > 0 && waitMs < 15_000) {
        await sleep(waitMs);
      } else {
        break;
      }
    }
    triedProviders.add(provider.id);

    try {
      const response = await fetchChatCompletion(provider, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }, { mode: "instant" });

      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      const generatedCode = extractCodeContent(content);

      if (!generatedCode) {
        pool.markExhausted(provider.id, "empty-output");
        continue;
      }

      pool.markHealthy(provider.id);
      return {
        generatedCode,
        generationSource: provider.id,
        generationWarning: null,
        changeSummary: "Applied model-driven scene modification.",
      };
    } catch (error) {
      const isRateLimited = error?.status === 429 || error?.code === "PROVIDER_RATE_LIMITED";
      const isTimeout = /timed? ?out/i.test(error?.message ?? "");
      const isOverloaded = /(overloaded|engine_overloaded|temporarily)/i.test(error?.message ?? "");

      if (isRateLimited || isTimeout || isOverloaded) {
        pool.markExhausted(provider.id, isRateLimited ? "429" : isTimeout ? "timeout" : "overloaded");
        continue;
      }

      if (options.allowFallback === false) throw error;
      throw error;
    }
  }

  // All providers exhausted
  const fallback = applyFallbackSceneEdit(state.currentCode, state.instruction);
  pool.recordFallback();
  return {
    generatedCode: fallback.generatedCode,
    generationSource: "fallback",
    generationWarning: `All ${triedProviders.size} LLM providers exhausted; used fallback modifier.`,
    changeSummary: fallback.changeSummary,
  };
}

/**
 * Pre-turn LLM thinking analysis.
 * Makes a single thinking-mode call to generate context-aware narrations
 * for each pipeline step before the turn runs.
 *
 * @param {string} query - The user's raw query
 * @param {object} [sessionContext] - Optional session state for context
 * @returns {Promise<object|null>} Object with step narrations, or null on failure
 */
export async function generateThinkingAnalysis(query, sessionContext = {}, options = {}) {
  const hasScene = Boolean(sessionContext?.currentScene?.code);
  const sceneHint = hasScene
    ? `The user already has an active scene (skill: ${sessionContext.currentScene.skill ?? "unknown"}, version ${sessionContext.currentScene.version ?? 1}).`
    : "The user does not have an active scene yet.";

  const systemPrompt = [
    "You are the internal reasoning voice of a visual generation AI called GVE.",
    "Given the user's request, produce a JSON object with first-person thoughts for each pipeline stage.",
    "Write naturally as internal monologue. Be specific about the user's request — mention what they want, which technology fits, and what your approach is.",
    "Keep each thought to 1-2 sentences. Do NOT use markdown or code blocks. Output ONLY valid JSON.",
    "",
    "Required keys (all strings):",
    '  "intent" — your analysis of what the user wants',
    '  "skill" — which rendering engine (Three.js / p5.js / D3.js) you chose and why',
    '  "plan" — how many steps you\'ll take and what the approach is',
    '  "generating" — what code you\'re about to write (mention specific geometries, effects, etc.)',
    '  "validating" — a brief note about checking the code',
    '  "executing" — spinning up the sandbox',
    '  "complete" — a natural summary of the finished result for the user'
  ].join("\n");

  const userPrompt = [
    `The user asked: "${query}"`,
    sceneHint,
    "",
    "Produce the JSON object now."
  ].join("\n");

  try {
    const thinkingRetryDelays = narrationRetryDelaysMs.length > 0
      ? narrationRetryDelaysMs
      : moonshotRetryDelaysMs;

    const completion = await executeWithProviderFailover({
      operationName: "ThinkingAnalysis",
      filter: { requireThinking: true },
      mode: "thinking",
      retryDelays: thinkingRetryDelays,
      executeProvider: async ({ provider, mode: providerMode, retryDelays }) => {
        const response = await fetchChatCompletion(
          provider,
          {
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ]
          },
          { mode: providerMode, retryDelays }
        );

        const payload = await response.json();
        const content = extractChoiceContent(payload?.choices?.[0]?.message?.content ?? "");
        const jsonMatch = content.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
          throw createRetryableProviderError(`${provider.id} returned non-JSON thinking output.`, "PROVIDER_INVALID_OUTPUT");
        }

        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          throw createRetryableProviderError(`${provider.id} returned malformed thinking JSON.`, "PROVIDER_INVALID_OUTPUT");
        }
      }
    });

    console.log(`[ThinkingAnalysis] Generated context-aware thoughts via ${completion.provider.id} for:`, query.slice(0, 60));
    return completion.value;
  } catch (err) {
    const diagnostics = serializeErrorForDiagnostics(err, {
      stage: "thinking_analysis",
      queryPreview: truncateDiagnostic(query, 96),
      hasScene,
      llm: err?.llm ?? null
    });

    console.warn("[ThinkingAnalysis] Failed:", JSON.stringify(diagnostics));

    if (typeof options?.onError === "function") {
      try {
        options.onError(diagnostics);
      } catch {
        // Diagnostic hooks are best-effort and must never break turn flow.
      }
    }

    return null;
  }
}

/**
 * Post-turn LLM narration.
 * Makes a single thinking-mode call after execution to produce a natural
 * summary of the generated result.
 *
 * @param {object} turnResult - The completed turn result
 * @param {string} query - The original user query
 * @returns {Promise<string|null>} Natural language summary, or null on failure
 */
export async function generatePostTurnNarration(turnResult, query, options = {}) {
  const fastNarrationMode = options.fastMode ?? fastModeEnabled;

  const skill = turnResult?.result?.skill ?? "unknown";
  const runtimeStatus = turnResult?.result?.runtime?.status ?? "unknown";
  const renderCount = turnResult?.result?.runtime?.renderCount ?? 0;
  const frameCount = turnResult?.result?.runtime?.frameCount ?? 0;
  const durationMs = turnResult?.result?.runtime?.durationMs ?? 0;
  const success = turnResult?.result?.runtime?.success ?? false;

  const systemPrompt = [
    "You are explaining what you just built to the user. Be concise, specific, and natural.",
    "Mention what you created, the key visual elements, and any notable details.",
    "Keep it to 1-3 sentences. Do NOT use markdown. Do NOT start with \"I\"."
  ].join("\n");

  const userPrompt = [
    `I generated a ${skill} scene for "${query}"`,
    `Result: ${success ? "success" : "failed"}, ${renderCount} renders, ${frameCount} frames, ${durationMs}ms.`,
    runtimeStatus === "skipped" ? "Execution was skipped due to validation issues." : "",
    "",
    "Describe what was built in 1-3 sentences."
  ].filter(Boolean).join("\n");

  try {
    const narrationRetryDelays = fastNarrationMode ? [] : narrationRetryDelaysMs;
    const completion = await executeWithProviderFailover({
      operationName: "PostTurnNarration",
      filter: { requireThinking: true },
      mode: "thinking",
      retryDelays: narrationRetryDelays,
      executeProvider: async ({ provider, mode: providerMode, retryDelays }) => {
        const response = await fetchChatCompletion(
          provider,
          {
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ]
          },
          { mode: providerMode, retryDelays }
        );

        const payload = await response.json();
        const content = extractAssistantText(extractChoiceContent(payload?.choices?.[0]?.message?.content ?? ""));

        if (!content) {
          throw createRetryableProviderError(`${provider.id} returned empty narration output.`, "PROVIDER_EMPTY_OUTPUT");
        }

        return content;
      }
    });

    const content = completion.value;

    if (content) {
      console.log(`[PostTurnNarration] Generated summary via ${completion.provider.id} for:`, query.slice(0, 60));
    }

    return content || null;
  } catch (err) {
    console.warn("[PostTurnNarration] Failed:", err instanceof Error ? err.message : "Unknown error");
    return buildLocalPostTurnNarration(turnResult, query);
  }
}

function buildLocalPostTurnNarration(turnResult, query) {
  const skill = turnResult?.result?.skill ?? "unknown";
  const runtimeStatus = turnResult?.result?.runtime?.status ?? "unknown";
  const renderCount = turnResult?.result?.runtime?.renderCount ?? 0;
  const frameCount = turnResult?.result?.runtime?.frameCount ?? 0;
  const success = turnResult?.result?.runtime?.success ?? false;

  if (success) {
    return `Built a ${skill} scene for \"${query}\" with ${renderCount} renders across ${frameCount} frames.`;
  }

  return `Attempted a ${skill} scene for \"${query}\", but runtime finished with status ${runtimeStatus}.`;
}

function buildThreeJsFallbackCode() {
  return [
    "// Terranet Engine Cinematic Fallback",
    "scene.background = new THREE.Color('#020617');",
    "scene.fog = new THREE.FogExp2(0x020617, 0.04);",
    "scene.add(new THREE.AmbientLight(0x0f172a, 1.5));",
    "const mainLight = new THREE.PointLight(0x3b82f6, 120, 30);",
    "mainLight.position.set(5, 8, 5);",
    "scene.add(mainLight);",
    "const accentLight = new THREE.PointLight(0x8b5cf6, 100, 30);",
    "accentLight.position.set(-6, -4, -5);",
    "scene.add(accentLight);",
    "const engineGroup = new THREE.Group();",
    "scene.add(engineGroup);",
    "const coreGeo = new THREE.IcosahedronGeometry(1.5, 2);",
    "const coreMat = new THREE.MeshPhysicalMaterial({",
    "  color: 0x1e293b, emissive: 0x0f172a, roughness: 0.1, metalness: 0.9, clearcoat: 1.0, wireframe: true",
    "});",
    "const core = new THREE.Mesh(coreGeo, coreMat);",
    "engineGroup.add(core);",
    "const inner = new THREE.Mesh(new THREE.OctahedronGeometry(1.2, 0), new THREE.MeshStandardMaterial({",
    "  color: 0xffffff, emissive: 0x3b82f6, emissiveIntensity: 2, transparent: true, opacity: 0.9",
    "}));",
    "engineGroup.add(inner);",
    "const canvas = document.createElement('canvas');",
    "canvas.width = 1024; canvas.height = 256;",
    "const ctx = canvas.getContext('2d');",
    "ctx.fillStyle = '#000000';",
    "ctx.fillRect(0, 0, canvas.width, canvas.height);",
    "ctx.textAlign = 'center';",
    "ctx.textBaseline = 'middle';",
    "ctx.font = 'bold 72px \"Inter\", \"SF Pro Display\", sans-serif';",
    "ctx.fillStyle = '#60a5fa';",
    "ctx.shadowColor = '#3b82f6';",
    "ctx.shadowBlur = 25;",
    "ctx.fillText('TERRANET ENGINE', canvas.width / 2, canvas.height / 2);",
    "const textTexture = new THREE.CanvasTexture(canvas);",
    "const textMat = new THREE.MeshBasicMaterial({ map: textTexture, transparent: true, blending: THREE.AdditiveBlending });",
    "const textMesh = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 1, 64, 1, true, -Math.PI / 3, Math.PI / 1.5), textMat);",
    "engineGroup.add(textMesh);",
    "const rings = [];",
    "for (let i = 0; i < 3; i++) {",
    "  const ring = new THREE.Mesh(",
    "    new THREE.TorusGeometry(2.5 + i * 0.8, 0.02, 16, 100),",
    "    new THREE.MeshBasicMaterial({ color: i === 1 ? 0x8b5cf6 : 0x3b82f6, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending })",
    "  );",
    "  ring.rotation.x = Math.random() * Math.PI;",
    "  const pivot = new THREE.Group();",
    "  pivot.add(ring);",
    "  rings.push({ mesh: pivot, speed: 0.005 + Math.random() * 0.01 });",
    "  engineGroup.add(pivot);",
    "}",
    "camera.position.set(0, 2, 8);",
    "camera.lookAt(0, 0, 0);",
    "const clock = new THREE.Clock();",
    "function animate() {",
    "  requestAnimationFrame(animate);",
    "  const t = clock.getElapsedTime();",
    "  core.rotation.y += 0.005; core.rotation.x += 0.003;",
    "  inner.rotation.y -= 0.01; inner.rotation.z += 0.005;",
    "  inner.material.emissiveIntensity = 1.5 + Math.sin(t * 3) * 0.5;",
    "  textMesh.rotation.y = Math.sin(t * 0.5) * 0.2;",
    "  rings.forEach(r => { r.mesh.rotation.y += r.speed; r.mesh.rotation.x += r.speed * 0.3; });",
    "  engineGroup.position.y = Math.sin(t) * 0.3;",
    "  renderer.render(scene, camera);",
    "}",
    "animate();"
  ].join("\n");
}

function buildP5FallbackCode() {
  return [
    "// Local fallback output",
    "let theta = 0;",
    "function setup() {",
    "  createCanvas(800, 450);",
    "  noStroke();",
    "}",
    "function draw() {",
    "  background(10, 14, 24);",
    "  fill(29, 140, 248);",
    "  const x = width * 0.5 + Math.cos(theta) * 140;",
    "  const y = height * 0.5 + Math.sin(theta * 1.3) * 90;",
    "  ellipse(x, y, 120, 120);",
    "  theta += 0.02;",
    "}"
  ].join("\n");
}

function buildD3FallbackCode() {
  return [
    "// Local fallback output",
    "const width = 640;",
    "const height = 360;",
    "const root = d3.select(document.body);",
    "root.selectAll(\"*\").remove();",
    "const svg = root.append(\"svg\")",
    "  .attr(\"width\", width)",
    "  .attr(\"height\", height)",
    "  .attr(\"viewBox\", `0 0 ${width} ${height}`);",
    "svg.append(\"rect\")",
    "  .attr(\"x\", 0)",
    "  .attr(\"y\", 0)",
    "  .attr(\"width\", width)",
    "  .attr(\"height\", height)",
    "  .attr(\"fill\", \"#0b1220\");",
    "const pulse = svg.append(\"circle\")",
    "  .attr(\"cx\", width * 0.5)",
    "  .attr(\"cy\", height * 0.5)",
    "  .attr(\"r\", 56)",
    "  .attr(\"fill\", \"#1d8cf8\");",
    "let t = 0;",
    "function animate() {",
    "  t += 0.03;",
    "  pulse.attr(\"cx\", width * 0.5 + Math.cos(t) * 140);",
    "  requestAnimationFrame(animate);",
    "}",
    "animate();"
  ].join("\n");
}

function buildAnimeFallbackCode() {
  return [
    "// Local fallback output",
    "const node = document.createElement(\"div\");",
    "node.style.width = \"96px\";",
    "node.style.height = \"96px\";",
    "node.style.borderRadius = \"16px\";",
    "node.style.background = \"#1d8cf8\";",
    "node.style.margin = \"120px auto\";",
    "document.body.appendChild(node);",
    "anime({",
    "  targets: node,",
    "  translateX: [-120, 120],",
    "  translateY: [-24, 24],",
    "  rotate: \"1turn\",",
    "  duration: 2400,",
    "  direction: \"alternate\",",
    "  loop: true,",
    "  easing: \"easeInOutSine\"",
    "});"
  ].join("\n");
}

function buildManimFallbackCode() {
  return [
    "from manim import *",
    "",
    "class GVERichScene(Scene):",
    "    def construct(self):",
    "        title = Text('Terranet Rich Video', weight=BOLD).scale(0.86)",
    "        subtitle = Text('Manim fallback composition', font_size=30).next_to(title, DOWN, buff=0.25)",
    "        halo = Circle(radius=2.15, stroke_color=BLUE_D, stroke_width=10)",
    "        orbit = Dot(color=TEAL_A)",
    "",
    "        self.play(FadeIn(title, shift=UP * 0.2), FadeIn(subtitle, shift=DOWN * 0.2), run_time=1.0)",
    "        self.play(Create(halo), FadeIn(orbit), run_time=1.2)",
    "        self.play(MoveAlongPath(orbit, halo), run_time=2.2, rate_func=smooth)",
    "        self.play(Rotate(halo, angle=TAU, run_time=1.8, rate_func=linear), orbit.animate.scale(1.5), run_time=1.8)",
    "        self.wait(0.4)"
  ].join("\n");
}

function buildFallbackGeneratedCode(selectedSkill = "threejs") {
  const skillId = String(selectedSkill ?? "threejs").toLowerCase();
  if (skillId === "p5js") {
    return buildP5FallbackCode();
  }

  if (skillId === "d3js") {
    return buildD3FallbackCode();
  }

  if (skillId === "animejs") {
    return buildAnimeFallbackCode();
  }

  if (skillId === "manim") {
    return buildManimFallbackCode();
  }

  return buildThreeJsFallbackCode();
}

function describeGenerationSource(source) {
  const normalized = String(source ?? "").trim().toLowerCase();

  if (!normalized || normalized === "fallback" || normalized === "static-fallback") {
    return "Generated via local fallback output.";
  }

  if (normalized === "cache") {
    return "Generated from cache.";
  }

  if (normalized === "moonshot-kimi") {
    return `Generated via Moonshot Kimi (${moonshotModel}).`;
  }

  if (normalized === "agent-runtime-debug") {
    return "Recovered via runtime self-debug agent.";
  }

  if (normalized === "runtime-auto-fix") {
    return "Recovered via deterministic runtime auto-fix.";
  }

  if (normalized === "rerun") {
    return "Re-executed existing scene code.";
  }

  return `Generated via ${normalized} provider.`;
}

async function generateCodeWithMoonshot(state) {
  console.log(`[GenerateCode] [TRACE] generateCodeWithMoonshot called. skill=${state?.selectedSkill}, hasApiKey=${Boolean(moonshotApiKey)}, model=${moonshotModel}`);

  if (!moonshotApiKey) {
    console.warn(`[GenerateCode] [WARN] No MOONSHOT_API_KEY — returning fallback.`);
    return {
      generatedCode: buildFallbackGeneratedCode(state?.selectedSkill),
      generationSource: "fallback",
      generationWarning: "MOONSHOT_API_KEY not configured; used fallback generator."
    };
  }

  const { systemPrompt, userPrompt } = buildGenerationPromptBundle(state);
  console.log(`[GenerateCode] [TRACE] Prompt built. systemPrompt length=${systemPrompt.length}, userPrompt length=${userPrompt.length}`);

  try {
    const genStartMs = Date.now();
    const response = await fetchMoonshotChatCompletion({
      model: moonshotModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    }, { mode: "instant" });

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    const genDurationMs = Date.now() - genStartMs;
    console.log(`[GenerateCode] [TRACE] Moonshot responded in ${genDurationMs}ms. content length=${content?.length ?? 0}, finishReason=${payload?.choices?.[0]?.finish_reason ?? "unknown"}`);

    const generatedCode = extractCodeContent(content);
    console.log(`[GenerateCode] [TRACE] Extracted code length=${generatedCode?.length ?? 0}. First 120 chars: ${(generatedCode ?? "").slice(0, 120).replace(/\n/g, "\\n")}`);

    if (!generatedCode) {
      console.error(`[GenerateCode] [ERROR] Empty code output from Moonshot. Raw content preview: ${(content ?? "").slice(0, 200)}`);
      throw new Error("Moonshot returned empty code output.");
    }

    if (shouldRequireOrbitControls(state) && !hasOrbitControlsInCode(generatedCode)) {
      console.log(`[GenerateCode] [TRACE] OrbitControls missing — attempting strict retry.`);
      try {
        const strictControlsPrompt = [
          userPrompt,
          "",
          "Critical requirement: include interactive camera controls using OrbitControls.",
          "Instantiate controls as: const controls = new OrbitControls(camera, renderer.domElement);",
          "Enable damping and call controls.update() inside the animation loop.",
          "Return code only."
        ].join("\n");

        const retryResponse = await fetchMoonshotChatCompletion({
          model: moonshotModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: strictControlsPrompt }
          ]
        }, { mode: "instant" });

        const retryPayload = await retryResponse.json();
        const retryGeneratedCode = extractCodeContent(retryPayload?.choices?.[0]?.message?.content);

        if (retryGeneratedCode && hasOrbitControlsInCode(retryGeneratedCode)) {
          console.log(`[GenerateCode] [TRACE] OrbitControls strict retry succeeded. code length=${retryGeneratedCode.length}`);
          return {
            generatedCode: retryGeneratedCode,
            generationSource: "moonshot-kimi",
            generationWarning: "Regenerated once to satisfy OrbitControls interaction invariant."
          };
        }
      } catch (retryErr) {
        console.warn(`[GenerateCode] [WARN] OrbitControls strict retry failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`);
        // Fall through and keep first-pass output with a warning.
      }

      return {
        generatedCode,
        generationSource: "moonshot-kimi",
        generationWarning: "Generated code may be missing OrbitControls setup after strict retry."
      };
    }

    console.log(`[GenerateCode] [TRACE] Generation successful via moonshot-kimi. code length=${generatedCode.length}`);
    return {
      generatedCode,
      generationSource: "moonshot-kimi",
      generationWarning: null
    };
  } catch (error) {
    console.error(`[GenerateCode] [ERROR] generateCodeWithMoonshot threw. overloaded=${isMoonshotOverloaded(error)}, error=${error instanceof Error ? error.message : String(error)}`);

    if (!isMoonshotOverloaded(error)) {
      throw error;
    }

    console.warn(`[GenerateCode] [WARN] Moonshot overloaded — returning fallback code.`);
    return {
      generatedCode: buildFallbackGeneratedCode(state?.selectedSkill),
      generationSource: "fallback",
      generationWarning: moonshotOverloadedMessage
    };
  }
}

function applyFallbackSceneEdit(currentCode, instruction) {
  const normalizedInstruction = instruction.trim().toLowerCase();
  let nextCode = currentCode;
  const notes = [];

  if (/(faster|speed up|quicker)/.test(normalizedInstruction)) {
    nextCode = nextCode.replace(/0\.0?1/g, "0.02");
    notes.push("Increased animation speed.");
  }

  if (/(slower|reduce speed|gentler)/.test(normalizedInstruction)) {
    nextCode = nextCode.replace(/0\.0?1/g, "0.005");
    notes.push("Reduced animation speed.");
  }

  const colorMap = {
    blue: "0x1d8cf8",
    red: "0xef4444",
    green: "0x22c55e",
    yellow: "0xeab308",
    purple: "0x8b5cf6",
    pink: "0xec4899",
    orange: "0xf97316",
    white: "0xf8fafc"
  };

  const requestedColor = Object.entries(colorMap).find(([name]) => normalizedInstruction.includes(name));
  if (requestedColor) {
    const [colorName, colorHex] = requestedColor;
    nextCode = nextCode.replace(/color:\s*0x[0-9a-f]+/i, `color: ${colorHex}`);
    notes.push(`Adjusted color to ${colorName}.`);
  }

  const sphereMatch = normalizedInstruction.match(/sphere|orb|planet|ball/);
  const cubeMatch = normalizedInstruction.match(/cube|box/);
  const sphereIndex = sphereMatch ? normalizedInstruction.indexOf(sphereMatch[0]) : -1;
  const cubeIndex = cubeMatch ? normalizedInstruction.indexOf(cubeMatch[0]) : -1;

  if (sphereIndex !== -1 && (cubeIndex === -1 || sphereIndex > cubeIndex)) {
    nextCode = nextCode.replace(/BoxGeometry\(([^)]*)\)/g, "SphereGeometry(0.75, 32, 32)");
    notes.push("Swapped box geometry for sphere geometry.");
  } else if (cubeIndex !== -1) {
    nextCode = nextCode.replace(/SphereGeometry\(([^)]*)\)/g, "BoxGeometry(1, 1, 1)");
    notes.push("Swapped sphere geometry back to a cube.");
  }

  if (nextCode === currentCode) {
    nextCode = `// Modification requested: ${instruction}\n${currentCode}`;
    notes.push("Added instruction marker because no direct code match was available.");
  } else {
    nextCode = `// Modified scene: ${instruction}\n${nextCode}`;
  }

  return {
    generatedCode: nextCode,
    changeSummary: notes.length > 0 ? notes.join(" ") : "Applied fallback scene edit."
  };
}

async function modifyCodeWithMoonshot(state, options = {}) {
  if (!moonshotApiKey) {
    const fallback = applyFallbackSceneEdit(state.currentCode, state.instruction);
    return {
      generatedCode: fallback.generatedCode,
      generationSource: "fallback",
      generationWarning: "MOONSHOT_API_KEY not configured; used fallback modifier.",
      changeSummary: fallback.changeSummary
    };
  }

  const { systemPrompt, userPrompt } = buildModificationPromptBundle(state);

  try {
    const response = await fetchMoonshotChatCompletion({
      model: moonshotModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    }, { mode: "instant" });

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    const generatedCode = extractCodeContent(content);

    if (!generatedCode) {
      throw new Error("Moonshot returned empty code output for modification.");
    }

    return {
      generatedCode,
      generationSource: "moonshot-kimi",
      generationWarning: null,
      changeSummary: "Applied model-driven scene modification."
    };
  } catch (error) {
    if (!isMoonshotOverloaded(error)) {
      throw error;
    }

    if (options.allowFallback === false) {
      throw error;
    }

    const fallback = applyFallbackSceneEdit(state.currentCode, state.instruction);
    return {
      generatedCode: fallback.generatedCode,
      generationSource: "fallback",
      generationWarning: moonshotOverloadedMessage,
      changeSummary: fallback.changeSummary
    };
  }
}

export function parseIntentFromQuery(query) {
  const normalized = normalizeQuery(query);
  const greeting = isGreetingQuery(normalized);
  const capabilityQuestion = isCapabilityQuery(normalized);
  const smallTalk = isSmallTalkQuery(normalized);
  const conversationQuery = isConversationQuery(normalized);

  let intentType = "create";
  if (/(explain|describe|walkthrough)/.test(normalized)) intentType = "explain";
  if (/(modify|change|update|edit|refine|polish|enhance|improve|upgrade|tweak|adjust)/.test(normalized) || hasRefinementIntent(normalized)) {
    intentType = "modify";
  }
  if (/(create|make|build|generate|design|draw|sketch|render|animation|video)/.test(normalized)) intentType = "create";
  if (/(animate|animation|rotation|spin|orbit|timeline|video|manim)/.test(normalized)) intentType = "animate";
  if (conversationQuery) intentType = "chat";

  const hasStrong3dSignal = /\b(threejs|three\.js|3d|orbit(?:al)?\s+controls?|mesh|geometry|material|shader|volumetric|fog|lighting|emissive|camera|instanc(?:e|ed|ing)|terrain|pbr|catmullrom|vertex)\b/.test(
    normalized
  );
  const hasStrongDataSignal = /\b(data(?:set)?|chart|graph|scatter|histogram|plot|axis|axes|bar\s+chart|line\s+chart)\b/.test(
    normalized
  );
  const hasDiagramSignal = /\b(diagram|flow|sequence|class diagram|mermaid)\b/.test(normalized);
  const hasStrong2dSignal = /\b(2d|canvas|p5(?:js)?|sprite|pixel(?:\s+art)?|sketch|manim|equation|latex|formula|math\s+animation)\b/.test(normalized);
  const hasWeak2dSignal = /\bparticles?\b/.test(normalized);
  const hasAnimationVideoSignal = /\b(video|mp4|timeline|motion|cinematic|storyboard|manim)\b/.test(normalized);

  let targetDomain = "3d";
  if (hasStrongDataSignal) targetDomain = "data-viz";
  if (hasDiagramSignal) targetDomain = "diagram";
  if (hasStrong2dSignal || (hasWeak2dSignal && !hasStrong3dSignal)) targetDomain = "2d";
  if (hasAnimationVideoSignal && !hasStrongDataSignal && !hasDiagramSignal) targetDomain = "animation";
  if (hasStrong3dSignal && !hasStrongDataSignal && !hasDiagramSignal && !hasAnimationVideoSignal) targetDomain = "3d";

  const entities = [];
  if (/cube/.test(normalized)) entities.push({ kind: "object", name: "cube" });
  if (/sphere|planet|sun/.test(normalized)) entities.push({ kind: "object", name: "sphere" });
  if (/blue|red|green|yellow/.test(normalized)) {
    const color = ["blue", "red", "green", "yellow"].find((c) => normalized.includes(c));
    entities.push({ kind: "color", name: color });
  }
  if (/metallic|pbr/.test(normalized)) entities.push({ kind: "material", name: "metallic" });
  if (/rotate|rotation|spin|orbit/.test(normalized)) entities.push({ kind: "animation", name: "rotation" });
  if (/equation|latex|formula|proof|theorem/.test(normalized)) entities.push({ kind: "equation", name: "math" });
  if (/video|mp4|cinematic|manim/.test(normalized)) entities.push({ kind: "video", name: "render" });

  const constraints = [];
  if (/real-time|realtime|interactive/.test(normalized)) {
    constraints.push({ name: "rendering", value: "realtime" });
  }
  if (/video|mp4|cinematic|manim|60\s?fps|1080p/.test(normalized)) {
    constraints.push({ name: "output", value: "video" });
  }

  let confidence = query.length > 20 ? 0.9 : 0.72;
  if (hasActionIntent(normalized)) {
    confidence += 0.16;
  }
  if (hasVisualTopicIntent(normalized)) {
    confidence += 0.1;
  }
  if (hasRefinementIntent(normalized)) {
    confidence += 0.05;
  }
  if (isQuestionQuery(normalized) && !hasActionIntent(normalized)) {
    confidence -= 0.18;
  }
  confidence = Math.min(0.99, Math.max(0.05, confidence));
  const ambiguous = confidence < 0.7;
  const conversationalConfidence = conversationQuery ? 0.96 : confidence;
  const conversationalAmbiguous = conversationQuery ? false : ambiguous;

  return {
    rawQuery: query,
    intentType,
    targetDomain,
    entities,
    constraints,
    confidence: conversationalConfidence,
    ambiguous: conversationalAmbiguous,
    isGreeting: greeting,
    isCapabilityQuestion: capabilityQuestion,
    isSmallTalk: smallTalk,
    isConversation: conversationQuery,
    clarificationPrompt: conversationalAmbiguous
      ? "I can generate a new scene, modify the current one, or explain the existing result. Which should I do?"
      : null
  };
}

function applySessionAwareIntentOverrides(parsedIntent, query, sessionState) {
  if (!parsedIntent || !query || !sessionState?.currentScene?.code) {
    return parsedIntent;
  }

  const normalized = normalizeQuery(query);
  if (!hasExplicitEditInstruction(normalized)) {
    return parsedIntent;
  }

  return {
    ...parsedIntent,
    intentType: "modify",
    ambiguous: false,
    isConversation: false,
    clarificationPrompt: null
  };
}

function selectSkill(parsedIntent, requestedSkill) {
  return selectSkillForIntent(parsedIntent, requestedSkill);
}

export async function resolveChatTurn(request, sessionState, options = {}) {
  const forcedMode = String(request?.preferences?.mode ?? "").trim().toLowerCase();
  let parsedIntent = applySessionAwareIntentOverrides(parseIntentFromQuery(request.query), request.query, sessionState);

  if (forcedMode === "modify" && sessionState?.currentScene?.code) {
    parsedIntent = {
      ...parsedIntent,
      intentType: "modify",
      ambiguous: false,
      isConversation: false,
      clarificationPrompt: null
    };
  } else if (forcedMode === "generate") {
    parsedIntent = {
      ...parsedIntent,
      intentType: "generate",
      ambiguous: false,
      isConversation: false,
      clarificationPrompt: null
    };
  }

  if (parsedIntent.intentType === "chat") {
    const reply = await generateConversationReplyWithMoonshot({
      sessionState,
      request,
      parsedIntent,
      mode: "chat",
      onChunk: options.onAssistantChunk
    });

    return {
      mode: "chat",
      parsedIntent,
      assistantText: reply.replyText,
      assistantSource: reply.replySource,
      assistantWarning: reply.replyWarning,
      assistantLlm: reply.replyLlm ?? null,
      result: null,
      sceneState: sessionState ?? null
    };
  }

  if (parsedIntent.ambiguous) {
    const reply = await generateConversationReplyWithMoonshot({
      sessionState,
      request,
      parsedIntent,
      mode: "clarify",
      onChunk: options.onAssistantChunk
    });

    return {
      mode: "clarify",
      parsedIntent,
      assistantText: reply.replyText,
      assistantSource: reply.replySource,
      assistantWarning: reply.replyWarning,
      assistantLlm: reply.replyLlm ?? null,
      result: null,
      sceneState: sessionState ?? null
    };
  }

  if (parsedIntent.intentType === "explain") {
    const reply = await generateConversationReplyWithMoonshot({
      sessionState,
      request,
      parsedIntent,
      mode: "explain",
      onChunk: options.onAssistantChunk
    });

    return {
      mode: "explain",
      parsedIntent,
      assistantText: reply.replyText,
      assistantSource: reply.replySource,
      assistantWarning: reply.replyWarning,
      assistantLlm: reply.replyLlm ?? null,
      result: null,
      sceneState: sessionState ?? null
    };
  }

  if (parsedIntent.intentType === "modify" && sessionState?.currentScene?.code) {
    const result = await modifyVisual({
      sessionId: request.sessionId,
      instruction: request.query,
      preferences: request.preferences,
      sceneState: sessionState
    }, { onProgress: options.onStep });

    return {
      mode: "modify",
      parsedIntent,
      assistantText: result.explanation,
      result,
      sceneState: result.sceneState
    };
  }

  const result = await generateVisual(request, { onProgress: options.onStep });

  return {
    mode: "generate",
    parsedIntent,
    assistantText: result.explanation,
    result,
    sceneState: result.sceneState
  };
}

function createTasks(selectedSkill) {
  return [
    {
      id: "t1",
      title: "Parse Intent",
      description: "Extract intent, entities, constraints, and confidence from query.",
      action: "parse_intent",
      command: "router.intentParser.parse(query)",
      status: "pending",
      dependsOn: []
    },
    {
      id: "t2",
      title: "Select Skill",
      description: `Rank capabilities and choose primary skill (${selectedSkill}).`,
      action: "select_skill",
      command: "router.skillSelector.rank(parsedIntent, capabilityIndex)",
      status: "pending",
      dependsOn: ["t1"]
    },
    {
      id: "t3",
      title: "Build Prompt",
      description: "Assemble system prompt, user prompt, skill context, and constraints.",
      action: "build_prompt",
      command: "agent.promptBuilder.build(parsedIntent, selectedSkill, sceneContext)",
      status: "pending",
      dependsOn: ["t1", "t2"]
    },
    {
      id: "t4",
      title: "Generate Code",
      description: "Generate executable code via model invocation.",
      action: "generate_code",
      command: "agent.codeGenerator.generate(prompt, { temperature: 1 })",
      status: "pending",
      dependsOn: ["t3"]
    },
    {
      id: "t5",
      title: "Validate Code",
      description: "Validate syntax, security, API usage, and schema.",
      action: "validate_code",
      command: "agent.validator.runAll(generatedCode)",
      status: "pending",
      dependsOn: ["t4"]
    },
    {
      id: "t6",
      title: "Provision Sandbox",
      description: "Acquire dedicated Daytona sandbox environment for runtime execution.",
      action: "provision_sandbox",
      command: "sandbox.provision()",
      status: "pending",
      dependsOn: ["t5"]
    },
    {
      id: "t7",
      title: "Multi-Agent Review",
      description: "Trigger autonomous agent team for static and runtime quality analysis.",
      action: "analyze_quality",
      command: "agent.review(generatedCode)",
      status: "pending",
      dependsOn: ["t6"]
    },
    {
      id: "t8",
      title: "Autonomous Patching",
      description: "Self-correct codebase iteratively using gathered quality signals.",
      action: "autonomous_patching",
      command: "patchGenerator.apply()",
      status: "pending",
      dependsOn: ["t7"]
    },
    {
      id: "t9",
      title: "Execute Code",
      description: "Execute runtime workload in sandboxed environment.",
      action: "execute_code",
      command: "skill.runtime.execute(patchedCode)",
      status: "pending",
      dependsOn: ["t8"]
    },
    {
      id: "t10",
      title: "Synchronize State",
      description: "Commit scene state and broadcast updates to clients.",
      action: "sync_state",
      command: "stateSync.broadcast(sceneStateDiff, sessionId)",
      status: "pending",
      dependsOn: ["t9"]
    }
  ];
}

const planState = Annotation.Root({
  request: Annotation,
  parsedIntent: Annotation,
  selectedSkill: Annotation,
  skillFallback: Annotation,
  planId: Annotation,
  tasks: Annotation,
  summary: Annotation
});

const parseIntentNode = (state) => {
  emitPipelineProgress(state.progress, "parse_intent", "running");
  return { parsedIntent: parseIntentFromQuery(state.request.query) };
};

const selectSkillNode = (state) => {
  emitPipelineProgress(state.progress, "select_skill", "running");
  const requestedSkill = state.request.preferences?.skill;
  const selection = selectSkill(state.parsedIntent, requestedSkill);

  try {
    warmupSandboxForSkill(selection.selectedSkill);
  } catch {
    // Warmup is best-effort and should not block orchestration.
  }

  if (selection.fallbackRequired && requestedSkill && requestedSkill !== "auto") {
    return {
      selectedSkill: selection.selectedSkill,
      skillFallback: {
        from: requestedSkill,
        to: selection.selectedSkill,
        reason: selection.reason
      },
      skillRanking: selection.ranked,
      selectionReason: selection.reason
    };
  }

  return {
    selectedSkill: selection.selectedSkill,
    skillFallback: selection.fallbackRequired ? { from: "auto", to: selection.selectedSkill, reason: selection.reason } : null,
    skillRanking: selection.ranked,
    selectionReason: selection.reason
  };
};

const buildTaskPlanNode = (state) => {
  const planId = `plan-${Date.now()}`;
  const quality = resolveRequestedQuality(state.request, state.selectedSkill);
  const tasks = createTasks(state.selectedSkill);
  return {
    planId,
    tasks,
    summary: `Planned ${tasks.length} LangGraph-orchestrated tasks for ${state.selectedSkill} (${quality} quality).${
      state.skillFallback
        ? ` Fallback applied: ${state.skillFallback.from} -> ${state.skillFallback.to}.`
        : ""
    } ${state.selectionReason ? `Selection note: ${state.selectionReason}` : ""}`
  };
};

const planningGraph = new StateGraph(planState)
  .addNode("parse_intent", parseIntentNode)
  .addNode("select_skill", selectSkillNode)
  .addNode("build_task_plan", buildTaskPlanNode)
  .addEdge(START, "parse_intent")
  .addEdge("parse_intent", "select_skill")
  .addEdge("select_skill", "build_task_plan")
  .addEdge("build_task_plan", END)
  .compile();

const executionState = Annotation.Root({
  planId: Annotation,
  task: Annotation,
  output: Annotation,
  artifact: Annotation,
  status: Annotation
});

const runTaskNode = (state) => {
  const outputs = {
    parse_intent: "Intent parsed with confidence 0.94 and extracted entities.",
    select_skill: "Skill selected from weighted ranking with deterministic tie-break.",
    build_prompt: "Prompt built from templates, examples, and policy constraints.",
    generate_code: "Code generated from model using deterministic parameters.",
    validate_code: "Validation passed for syntax, security, API, and schema checks.",
    execute_code: "Code executed successfully in sandbox runtime.",
    sync_state: "Scene state committed and sync event published."
  };

  return {
    status: "completed",
    output: outputs[state.task.action],
    artifact: state.task.action === "execute_code" ? "preview://sandbox/mock-scene" : undefined
  };
};

const taskExecutionGraph = new StateGraph(executionState)
  .addNode("run_task", runTaskNode)
  .addEdge(START, "run_task")
  .addEdge("run_task", END)
  .compile();

const generateState = Annotation.Root({
  progress: Annotation,
  turnStartedAtMs: Annotation,
  turnDeadlineAtMs: Annotation,
  request: Annotation,
  parsedIntent: Annotation,
  selectedSkill: Annotation,
  assetPlan: Annotation,
  skillFallback: Annotation,
  prompt: Annotation,
  generatedCode: Annotation,
  generationSource: Annotation,
  generationWarning: Annotation,
  llmTrace: Annotation,
  validation: Annotation,
  validationRecoveryUsed: Annotation,
  runtimeRecoveryUsed: Annotation,
  agentDebugUsed: Annotation,
  agentDebugIterations: Annotation,
  execution: Annotation,
  runtime: Annotation,
  sceneState: Annotation,
  response: Annotation
});

const buildPromptNode = (state) => {
  emitPipelineProgress(state.progress, "build_prompt", "running");
  const selectedSkill = state.selectedSkill ?? "threejs";
  const requestedQuality = resolveRequestedQuality(state.request, selectedSkill);
  const assetPlan = resolveAssetPlan({
    selectedSkill,
    sourceText: [state.request?.query ?? "", JSON.stringify(state.parsedIntent ?? {})].join(" "),
    parsedIntent: state.parsedIntent,
    requestedQuality,
    allowInternetFallback: true
  });

  return {
    assetPlan,
    prompt: {
      system: "You are a visual generation assistant. Produce safe, valid JavaScript scene code.",
      user: state.request.query,
      context: {
        intent: state.parsedIntent,
        skill: state.selectedSkill,
        constraints: state.parsedIntent.constraints
      }
    }
  };
};

const generateCodeNode = async (state) => {
  console.log(`[Graph] [TRACE] generateCodeNode started.`);
  emitPipelineProgress(state.progress, "generate_code", "running");
  const normalizedQuery = normalizeQuery(state.request.query);
  const runtimeReserveMs = resolveRuntimeExecutionReserveMs(state.selectedSkill);
  const generationBudgetMs = Number.isFinite(state.turnDeadlineAtMs)
    ? Math.max(0, getRemainingBudgetMs(state.turnDeadlineAtMs) - runtimeReserveMs)
    : Number.POSITIVE_INFINITY;

  console.log(`[Graph] [TRACE] generateCodeNode budget=${Number.isFinite(generationBudgetMs) ? generationBudgetMs + "ms" : "infinite"}, skill=${state.selectedSkill}, query=${state.request.query.slice(0, 80)}`);

  let generationResult;

  if (/(unsafe|eval)/.test(normalizedQuery)) {
    console.log(`[Graph] [TRACE] generateCodeNode: unsafe/eval test query detected.`);
    generationResult = {
      generatedCode: [
        "// Intentionally unsafe draft used to trigger recovery path",
        "const output = eval('2 + 2');",
        "console.log(output);"
      ].join("\n"),
      generationSource: "recovery-test",
      generationWarning: null
    };
  } else {
    // Check generation cache
    const quality = resolveRequestedQuality(state.request, state.selectedSkill);
    const cacheKey = getGenerationCacheKey(state.request.query, state.selectedSkill, quality);
    const cached = getCachedGeneration(cacheKey);
    if (cached) {
      console.log(`[Graph] [TRACE] generateCodeNode: cache HIT for key=${cacheKey}. code length=${cached.code?.length ?? 0}`);
      generationResult = {
        generatedCode: cached.code,
        generationSource: "cache",
        generationWarning: null
      };
    } else {
      console.log(`[Graph] [TRACE] generateCodeNode: cache MISS. Calling generateCodeWithPool...`);
      try {
        if (Number.isFinite(generationBudgetMs) && generationBudgetMs <= 0) {
          console.warn(`[Graph] [WARN] generateCodeNode: budget exhausted (${generationBudgetMs}ms) — using fallback.`);
          generationResult = {
            generatedCode: buildFallbackGeneratedCode(state.selectedSkill),
            generationSource: "fallback",
            generationWarning: "Generation budget exhausted while preserving runtime reserve; used fallback generator."
          };
        } else {
          const timeoutMs = Number.isFinite(generationBudgetMs) ? generationBudgetMs : 120_000;
          console.log(`[Graph] [TRACE] generateCodeNode: starting pool call with timeout=${timeoutMs}ms`);
          const result = await withTimeout(
            generateCodeWithPool(state),
            timeoutMs,
            `Generation timed out after ${timeoutMs}ms while preserving runtime reserve.`
          );

          console.log(`[Graph] [TRACE] generateCodeNode: pool call returned. source=${result.generationSource}, code length=${result.generatedCode?.length ?? 0}, warning=${result.generationWarning ?? "none"}`);

          // Cache successful generations
          if (result.generatedCode && result.generationSource !== "fallback") {
            setCachedGeneration(cacheKey, { code: result.generatedCode, skill: state.selectedSkill });
          }

          generationResult = result;
        }
      } catch (error) {
        console.error(`[Graph] [ERROR] generateCodeNode: generation threw — using fallback. error=${error instanceof Error ? error.message : String(error)}`);
        generationResult = {
          generatedCode: buildFallbackGeneratedCode(state.selectedSkill),
          generationSource: "fallback",
          generationWarning: error instanceof Error ? error.message : "LLM generation failed; used fallback."
        };
      }
    }
  }

  console.log(`[Graph] [TRACE] generateCodeNode DONE. source=${generationResult.generationSource}, codeLen=${generationResult.generatedCode?.length ?? 0}, warning=${generationResult.generationWarning ?? "none"}`);

  emitPipelineProgress(state.progress, "generate_code", "completed", {
    selectedSkill: state.selectedSkill,
    source: generationResult.generationSource,
    code: generationResult.generatedCode
  });

  return generationResult;
};

const validateCodeNode = (state) => {
  console.log(`[Graph] [TRACE] validateCodeNode started for skill ${state.selectedSkill}.`);
  emitPipelineProgress(state.progress, "validate_code", "running");
  const selectedSkill = state.selectedSkill ?? "threejs";
  const requestedQuality = resolveRequestedQuality(state.request, selectedSkill);
  const validationOptions = buildValidationOptions({
    skillId: selectedSkill,
    request: state.request,
    requestedQuality,
    parsedIntent: state.parsedIntent
  });
  const result = validateCode(state.generatedCode, selectedSkill, validationOptions);

  if (!result.passable) {
    emitPipelineProgress(state.progress, "validate_code", "failed", {
      errors: result.errors,
      warnings: result.warnings ?? []
    });
    return {
      validation: {
        valid: false,
        passable: false,
        errors: result.errors,
        warnings: result.warnings ?? []
      }
    };
  }

  emitPipelineProgress(state.progress, "validate_code", "completed", {
    valid: result.valid,
    passable: result.passable,
    warnings: result.warnings ?? []
  });

  return {
    validation: {
      valid: result.valid,
      passable: result.passable,
      errors: result.errors,
      warnings: result.warnings ?? []
    }
  };
};

function escapeForRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseRuntimeMismatch(runtimeError) {
  const detail = String(runtimeError ?? "").trim();
  if (!detail) {
    return null;
  }

  const constructorMatch = detail.match(/([A-Za-z0-9_$.]+)\s+is not a constructor/i);
  if (constructorMatch) {
    return {
      kind: "constructor",
      symbol: constructorMatch[1],
      detail
    };
  }

  const functionMatch = detail.match(/([A-Za-z0-9_$.]+)\s+is not a function/i);
  if (functionMatch) {
    const symbol = functionMatch[1];
    const lastDot = symbol.lastIndexOf(".");
    return {
      kind: "function",
      symbol,
      receiver: lastDot > -1 ? symbol.slice(0, lastDot) : null,
      member: lastDot > -1 ? symbol.slice(lastDot + 1) : symbol,
      detail
    };
  }

  return null;
}

function resolveConstructorFallback(symbol) {
  const explicitFallbacks = {
    "THREE.ShadowMaterial": "THREE.MeshStandardMaterial",
    "THREE.MeshPhysicalNodeMaterial": "THREE.MeshPhysicalMaterial"
  };

  if (explicitFallbacks[symbol]) {
    return explicitFallbacks[symbol];
  }

  if (/Material$/i.test(symbol)) {
    return "THREE.MeshStandardMaterial";
  }

  if (/Curve3?$/i.test(symbol)) {
    return "THREE.CatmullRomCurve3";
  }

  if (/Geometry$/i.test(symbol)) {
    return "THREE.BoxGeometry";
  }

  return null;
}

function applyDeterministicRuntimePatch({ code, runtimeError, skill }) {
  if (!code || skill !== "threejs") {
    return null;
  }

  const mismatch = parseRuntimeMismatch(runtimeError);
  if (!mismatch) {
    return null;
  }

  let patchedCode = code;
  const appliedFixes = [];

  if (mismatch.kind === "function" && mismatch.member === "setScalar") {
    const scalarRegex = /\.setScalar\(\s*([^()]+?)\s*\)/g;
    const replaced = patchedCode.replace(scalarRegex, ".set($1, $1, $1)");
    if (replaced !== patchedCode) {
      patchedCode = replaced;
      appliedFixes.push("Replaced .setScalar(value) with .set(value, value, value)");
    }
  }

  if (mismatch.kind === "constructor" && mismatch.symbol) {
    const fallbackCtor = resolveConstructorFallback(mismatch.symbol);
    if (fallbackCtor && fallbackCtor !== mismatch.symbol) {
      const ctorRegex = new RegExp(`new\\s+${escapeForRegex(mismatch.symbol)}\\s*\\(`, "g");
      const replaced = patchedCode.replace(ctorRegex, `new ${fallbackCtor}(`);
      const directCtorRegex = new RegExp(`${escapeForRegex(mismatch.symbol)}\\s*\\(`, "g");
      const replacedDirect = replaced.replace(directCtorRegex, `${fallbackCtor}(`);
      if (replacedDirect !== patchedCode) {
        patchedCode = replacedDirect;
        appliedFixes.push(`Replaced unsupported constructor ${mismatch.symbol} with ${fallbackCtor}`);
      }
    }
  }

  if (patchedCode === code || appliedFixes.length === 0) {
    return null;
  }

  return {
    patchedCode,
    mismatch,
    appliedFixes
  };
}

function buildRuntimeCompatibilityHints(runtimeError, deterministicFixes = []) {
  const mismatch = parseRuntimeMismatch(runtimeError);
  const hints = [];

  if (mismatch?.kind === "constructor") {
    const fallbackCtor = resolveConstructorFallback(mismatch.symbol);
    hints.push(`Avoid constructor ${mismatch.symbol}; it is not available in this runtime.`);
    if (fallbackCtor) {
      hints.push(`Prefer ${fallbackCtor} as a compatibility-safe fallback.`);
    }
  }

  if (mismatch?.kind === "function" && mismatch.member) {
    hints.push(`Method ${mismatch.symbol} is unavailable in this runtime.`);
    if (mismatch.member === "setScalar") {
      hints.push("Use .set(v, v, v) instead of .setScalar(v) for vector-like scale updates.");
    }
  }

  if (Array.isArray(deterministicFixes) && deterministicFixes.length > 0) {
    hints.push(`Deterministic fixes already attempted: ${deterministicFixes.join("; ")}`);
  }

  return hints;
}

async function attemptRuntimeAgentRecovery({
  originalQuery,
  failedCode,
  runtimeResult,
  skill,
  maxIterations = runtimeDebugMaxIterations,
  turnDeadlineAtMs,
  sessionId = null,
  requestedQuality = "standard",
  parsedIntent = null
}) {
  let workingCode = failedCode;
  let workingRuntime = runtimeResult;
  let deterministicFixApplied = false;
  let deterministicFixes = [];
  const validationOptions = buildValidationOptions({
    skillId: skill ?? "threejs",
    request: {
      query: originalQuery,
      preferences: {
        quality: requestedQuality
      }
    },
    requestedQuality,
    userQuery: originalQuery,
    parsedIntent
  });

  const MAX_DETERMINISTIC_RUNTIME_PASSES = 3;
  const seenMismatchSignatures = new Set();
  const recoveryDeadlineAtMs = Number.isFinite(turnDeadlineAtMs)
    ? Math.min(turnDeadlineAtMs, Date.now() + runtimeRecoveryBudgetMs)
    : Date.now() + runtimeRecoveryBudgetMs;

  for (let pass = 0; pass < MAX_DETERMINISTIC_RUNTIME_PASSES; pass += 1) {
    const runtimeErrorText = workingRuntime?.error ?? workingRuntime?.warning ?? "";
    const deterministicPatch = applyDeterministicRuntimePatch({
      code: workingCode,
      runtimeError: runtimeErrorText,
      skill
    });

    if (!deterministicPatch?.patchedCode) {
      break;
    }

    const mismatchSignature = deterministicPatch.mismatch
      ? `${deterministicPatch.mismatch.kind}:${deterministicPatch.mismatch.symbol ?? deterministicPatch.mismatch.detail}`
      : `unknown:${runtimeErrorText}`;

    if (seenMismatchSignatures.has(mismatchSignature) || deterministicPatch.patchedCode === workingCode) {
      break;
    }

    seenMismatchSignatures.add(mismatchSignature);

    const patchValidation = validateCode(deterministicPatch.patchedCode, skill ?? "threejs", validationOptions);
    if (!patchValidation.passable) {
      break;
    }

    deterministicFixApplied = true;
    deterministicFixes = [...new Set([...deterministicFixes, ...deterministicPatch.appliedFixes])];
    const deterministicTimeoutMs = computeBoundedTimeoutMs(
      recoveryDeadlineAtMs,
      resolveRuntimeExecutionTimeoutMs(skill)
    );
    if (deterministicTimeoutMs <= 0) {
      return {
        recovered: false,
        recoveredCode: workingCode,
        recoveredRuntime: workingRuntime,
        warning: "Runtime recovery budget exhausted before deterministic retry.",
        iterations: 0,
        debugUsed: false,
        deterministicFixApplied,
        deterministicFixes
      };
    }

    try {
      const deterministicRuntime = await executeSkillRuntimeBounded({
        skillId: skill,
        code: deterministicPatch.patchedCode,
        timeoutMs: deterministicTimeoutMs,
        maxFrames: runtimeExecutionMaxFrames,
        turnDeadlineAtMs: recoveryDeadlineAtMs,
        sessionId
      });

      if (deterministicRuntime.success) {
        return {
          recovered: true,
          recoveredCode: deterministicPatch.patchedCode,
          recoveredRuntime: deterministicRuntime,
          warning: null,
          iterations: 0,
          debugUsed: false,
          deterministicFixApplied: true,
          deterministicFixes
        };
      }

      workingCode = deterministicPatch.patchedCode;
      workingRuntime = deterministicRuntime;
    } catch {
      // If deterministic execution crashes, continue into runtime agent debug.
      workingCode = deterministicPatch.patchedCode;
      break;
    }
  }

  const compatibilityHints = buildRuntimeCompatibilityHints(
    workingRuntime?.error ?? workingRuntime?.warning ?? "Unknown runtime error",
    deterministicFixes
  );

  setErrorContext({
    originalQuery,
    failedCode: workingCode,
    validationErrors: [],
    skill,
    runtimeError: workingRuntime?.error ?? workingRuntime?.warning ?? "Unknown runtime error",
    runtimeStatus: workingRuntime?.status ?? "error",
    runtimeDetails: {
      status: workingRuntime?.status ?? "error",
      renderCount: workingRuntime?.renderCount ?? 0,
      frameCount: workingRuntime?.frameCount ?? 0
    },
    runtimeHints: compatibilityHints,
    compatibilityMode: "strict",
    runtimeDebugDeadlineAtMs: recoveryDeadlineAtMs
  });

  let debugResult;
  const runtimeDebugTimeoutMs = computeBoundedTimeoutMs(recoveryDeadlineAtMs, runtimeDebugSessionTimeoutMs, 500);
  if (runtimeDebugTimeoutMs <= 0) {
    clearErrorContext();
    return {
      recovered: false,
      recoveredCode: workingCode,
      recoveredRuntime: workingRuntime,
      warning: "Runtime recovery budget exhausted before agent debug.",
      iterations: 0,
      debugUsed: false,
      deterministicFixApplied,
      deterministicFixes
    };
  }

  try {
    debugResult = await withTimeout(
      runRuntimeDebugSession({
        originalQuery,
        failedCode: workingCode,
        runtimeError: workingRuntime?.error ?? workingRuntime?.warning ?? "Unknown runtime error",
        runtimeStatus: workingRuntime?.status ?? "error",
        skill,
        tools: getRuntimeDebugTools(),
        maxIterations,
        compatibilityHints
      }),
      runtimeDebugTimeoutMs,
      `Runtime debug session timed out after ${runtimeDebugTimeoutMs}ms.`
    );
  } catch (error) {
    return {
      recovered: false,
      recoveredCode: workingCode,
      recoveredRuntime: workingRuntime,
      warning: `Runtime agent debug failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      iterations: 0,
      debugUsed: false,
      deterministicFixApplied,
      deterministicFixes
    };
  } finally {
    clearErrorContext();
  }

  if (!debugResult?.fixedCode) {
    return {
      recovered: false,
      recoveredCode: workingCode,
      recoveredRuntime: workingRuntime,
      warning: "Runtime agent debug did not produce a fix.",
      iterations: debugResult?.iterations ?? 0,
      debugUsed: true,
      deterministicFixApplied,
      deterministicFixes
    };
  }

  const revalidated = validateCode(debugResult.fixedCode, skill ?? "threejs", validationOptions);
  if (!revalidated.passable) {
    return {
      recovered: false,
      recoveredCode: workingCode,
      recoveredRuntime: workingRuntime,
      warning: "Runtime debug produced code that failed validation.",
      iterations: debugResult.iterations,
      debugUsed: true,
      deterministicFixApplied,
      deterministicFixes
    };
  }

  let retriedRuntime;
  const retryTimeoutMs = computeBoundedTimeoutMs(
    recoveryDeadlineAtMs,
    resolveRuntimeExecutionTimeoutMs(skill)
  );
  if (retryTimeoutMs <= 0) {
    return {
      recovered: false,
      recoveredCode: debugResult.fixedCode,
      recoveredRuntime: {
        ...runtimeResult,
        success: false,
        status: "error",
        error: "Runtime recovery budget exhausted before retry execution."
      },
      warning: "Runtime recovery budget exhausted before retry execution.",
      iterations: debugResult.iterations,
      debugUsed: true,
      deterministicFixApplied,
      deterministicFixes
    };
  }

  try {
    retriedRuntime = await executeSkillRuntimeBounded({
      skillId: skill,
      code: debugResult.fixedCode,
      timeoutMs: retryTimeoutMs,
      maxFrames: runtimeExecutionMaxFrames,
      turnDeadlineAtMs: recoveryDeadlineAtMs,
      sessionId
    });
  } catch (error) {
    return {
      recovered: false,
      recoveredCode: debugResult.fixedCode,
      recoveredRuntime: {
        ...runtimeResult,
        success: false,
        status: "error",
        error: error instanceof Error ? error.message : "Unknown runtime retry error"
      },
      warning: `Runtime retry execution crashed: ${error instanceof Error ? error.message : "Unknown error"}`,
      iterations: debugResult.iterations,
      debugUsed: true
    };
  }

  if (retriedRuntime.success) {
    return {
      recovered: true,
      recoveredCode: debugResult.fixedCode,
      recoveredRuntime: retriedRuntime,
      warning: null,
      iterations: debugResult.iterations,
      debugUsed: true,
      deterministicFixApplied,
      deterministicFixes
    };
  }

  return {
    recovered: false,
    recoveredCode: debugResult.fixedCode,
    recoveredRuntime: retriedRuntime,
    warning: `Runtime agent debug attempted ${debugResult.iterations} iteration(s) but execution still failed: ${retriedRuntime.error ?? retriedRuntime.warning ?? "Unknown error"}`,
    iterations: debugResult.iterations,
    debugUsed: true,
    deterministicFixApplied,
    deterministicFixes
  };
}

const executeCodeNode = async (state) => {
  console.log(`[Graph] [TRACE] executeCodeNode started.`);
  emitPipelineProgress(state.progress, "execute_code", "running");
  if (!isValidationPassable(state.validation)) {
    const skippedOutputKind = state.selectedSkill === "manim" ? "media" : "code";
    emitPipelineProgress(state.progress, "execute_code", "failed", {
      error: "Validation failed; execution skipped."
    });
    return {
      execution: {
        success: false,
        previewUrl: null,
        message: "Validation failed; execution skipped."
      },
      runtime: {
        success: false,
        status: "skipped",
        previewUrl: null,
        outputKind: skippedOutputKind,
        mediaType: skippedOutputKind === "media" ? "video/mp4" : null,
        mediaUrl: null,
        mediaArtifactId: null,
        mediaDurationMs: null,
        mediaFps: null,
        mediaResolution: null,
        mediaBytes: null,
        skillId: state.selectedSkill,
        skillName: state.selectedSkill,
        dependencyCount: 0,
        durationMs: 0,
        renderCount: 0,
        frameCount: 0,
        logs: [],
        summary: { childCount: 0, types: [] },
        warningCode: null,
        error: "Validation failed before runtime execution.",
        acquireDiagnostics: null
      }
    };
  }

  const initialRuntimeTimeoutMs = computeBoundedTimeoutMs(
    state.turnDeadlineAtMs,
    resolveRuntimeExecutionTimeoutMs(state.selectedSkill)
  );
  const requestedQuality = resolveRequestedQuality(state.request, state.selectedSkill);
  
  // Check if generated code is a multi-file project
  const isMultiFile = isMultiFileProject(state.generatedCode);
  
  // For multi-file projects, validate structure
  let detectedTools = [];
  if (isMultiFile) {
    const projectValidation = validateProject(state.generatedCode);
    if (!projectValidation.valid) {
      console.warn(`[Graph] Multi-file project validation failed:`, projectValidation.errors);
      return {
        execution: {
          success: false,
          previewUrl: null,
          message: "Multi-file project validation failed: " + projectValidation.errors.join('; ')
        },
        runtime: buildRuntimeFailureResult({
          skillId: state.selectedSkill,
          errorMessage: "Multi-file project validation failed: " + projectValidation.errors.join('; '),
          errorCode: "PROJECT_VALIDATION_FAILED"
        })
      };
    }
    
    // For multi-file projects, detect tools from all files
    const allCode = state.generatedCode.files.map(f => f.content).join('\n');
    detectedTools = detectRequiredTools(allCode);
    console.log(`[Graph] [TRACE] Multi-file project with ${state.generatedCode.files.length} files, detected tools: ${detectedTools.map(t => t.name).join(', ') || 'none'}`);
  } else {
    // Detect required tools from single-file generated code
    detectedTools = detectRequiredTools(state.generatedCode);
  }
  
  if (detectedTools.length > 0) {
    console.log(
      `[Graph] [TRACE] Detected required tools: ${detectedTools.map(t => t.name).join(', ')}`
    );
  }
  
  const initialRuntimeResult = await executeSkillRuntimeWithQualityDecision({
    skillId: state.selectedSkill,
    code: state.generatedCode,
    timeoutMs: initialRuntimeTimeoutMs,
    maxFrames: runtimeExecutionMaxFrames,
    turnDeadlineAtMs: state.turnDeadlineAtMs,
    tools: detectedTools,
    sessionId: state.request?.sessionId ?? null,
    quality: requestedQuality,
    originalQuery: state.request?.query ?? null,
    onProgress: (progressEvent) => {
      // Emit iteration progress via WebSocket if available
      if (typeof state.progress === "function") {
        try {
          state.progress({
            step: "execute_code",
            status: progressEvent.type,
            payload: progressEvent
          });
        } catch (err) {
          // Progress callbacks are best-effort
        }
      }
    }
  });

  let finalRuntimeResult = initialRuntimeResult;
  let finalCode = state.generatedCode;
  let runtimeRecoveryUsed = false;
  let generationSource = state.generationSource;
  let generationWarning = state.generationWarning;
  let agentDebugUsed = state.agentDebugUsed ?? false;
  let agentDebugIterations = state.agentDebugIterations ?? 0;
  let deterministicRuntimeFixApplied = false;
  let deterministicRuntimeFixes = [];

  if (!initialRuntimeResult.success && !disableGenerateAutoModify) {
    console.log(`[Graph] [TRACE] Runtime failed. Attempting agent runtime recovery...`);

    const recovery = await attemptRuntimeAgentRecovery({
      originalQuery: state.request.query,
      failedCode: state.generatedCode,
      runtimeResult: initialRuntimeResult,
      skill: state.selectedSkill,
      maxIterations: runtimeDebugMaxIterations,
      turnDeadlineAtMs: state.turnDeadlineAtMs,
      sessionId: state.request?.sessionId ?? null,
      requestedQuality: resolveRequestedQuality(state.request, state.selectedSkill),
      parsedIntent: state.parsedIntent
    });

    if (recovery.recovered) {
      console.log(`[Graph] [TRACE] Runtime recovery succeeded after ${recovery.iterations} iteration(s).`);
      finalRuntimeResult = recovery.recoveredRuntime;
      finalCode = recovery.recoveredCode;
      runtimeRecoveryUsed = true;
      deterministicRuntimeFixApplied = Boolean(recovery.deterministicFixApplied);
      deterministicRuntimeFixes = recovery.deterministicFixes ?? [];
      generationSource = recovery.debugUsed ? "agent-runtime-debug" : "runtime-auto-fix";
      generationWarning = recovery.warning ?? generationWarning;
      agentDebugUsed = Boolean(recovery.debugUsed);
      agentDebugIterations = recovery.debugUsed ? recovery.iterations : 0;
    } else if (recovery.debugUsed) {
      console.warn(`[Graph] [TRACE] Runtime recovery attempted but did not succeed.`);
      finalRuntimeResult = recovery.recoveredRuntime ?? initialRuntimeResult;
      finalCode = recovery.recoveredCode ?? state.generatedCode;
      generationWarning = recovery.warning ?? generationWarning;
      agentDebugUsed = true;
      agentDebugIterations = recovery.iterations;
      deterministicRuntimeFixApplied = Boolean(recovery.deterministicFixApplied);
      deterministicRuntimeFixes = recovery.deterministicFixes ?? [];
    }
  } else if (!initialRuntimeResult.success && disableGenerateAutoModify) {
    generationWarning = generationWarning
      ? `${generationWarning} Runtime recovery skipped because immutable-generate mode is enabled.`
      : "Runtime recovery skipped because immutable-generate mode is enabled.";
  }

  if (!finalRuntimeResult.success && shouldDegradeRuntimeFailure(finalRuntimeResult)) {
    finalRuntimeResult = buildDegradedRuntimeResult(finalRuntimeResult, state.selectedSkill, "about:blank");
    generationWarning =
      generationWarning ??
      "Sandbox runtime degraded due to provisioning constraints; returning generated code without full live execution.";
  }

  emitPipelineProgress(state.progress, "execute_code", finalRuntimeResult.success ? "completed" : "failed", {
    error: finalRuntimeResult.success ? null : finalRuntimeResult.error,
    status: finalRuntimeResult.status,
    runtimeRecoveryUsed
  });

  return {
    generatedCode: finalCode,
    generationSource,
    generationWarning,
    runtimeRecoveryUsed,
    agentDebugUsed,
    agentDebugIterations,
    deterministicRuntimeFixApplied,
    deterministicRuntimeFixes,
    execution: {
      success: finalRuntimeResult.success,
      previewUrl: finalRuntimeResult.previewUrl,
      message: finalRuntimeResult.success
        ? (finalRuntimeResult.status === "degraded"
          ? `Execution completed in degraded mode: ${finalRuntimeResult.warning}`
          : `Executed in isolated ${finalRuntimeResult.skillName} sandbox (${finalRuntimeResult.status}, ${finalRuntimeResult.renderCount} renders).`)
        : `Sandbox execution ${finalRuntimeResult.status}: ${finalRuntimeResult.error}`
    },
    runtime: finalRuntimeResult
  };
};

const syncStateNode = (state) => {
  emitPipelineProgress(state.progress, "sync_state", "running");
  return {
    sceneState: {
      id: `scene-${Date.now()}`,
      version: 1
    }
  };
};

/**
 * Agent-powered self-debugging node.
 * When code fails validation, this node uses the agent loop to autonomously fix it.
 * Falls back to a static green box only if the agent also fails.
 */
const agentSelfDebugNode = async (state) => {
  console.log(`[Graph] [TRACE] agentSelfDebugNode started — attempting agent self-debug.`);

  // Set error context for the get_error_context tool
  setErrorContext({
    originalQuery: state.request.query,
    failedCode: state.generatedCode,
    validationErrors: state.validation.errors,
    skill: state.selectedSkill
  });

  try {
    const debugTimeoutMs = computeBoundedTimeoutMs(state.turnDeadlineAtMs, selfDebugSessionTimeoutMs, 500);
    if (debugTimeoutMs <= 0) {
      throw new Error("Turn budget exhausted before self-debug session.");
    }

    const debugResult = await withTimeout(
      runSelfDebugSession({
        originalQuery: state.request.query,
        failedCode: state.generatedCode,
        validationErrors: state.validation.errors,
        skill: state.selectedSkill,
        tools: getDebugTools(),
        maxIterations: selfDebugMaxIterations
      }),
      debugTimeoutMs,
      `Self-debug session timed out after ${debugTimeoutMs}ms.`
    );

    clearErrorContext();

    if (debugResult.success && debugResult.fixedCode) {
      console.log(`[Graph] [TRACE] Agent self-debug SUCCEEDED after ${debugResult.iterations} iteration(s).`);
      return {
        generatedCode: debugResult.fixedCode,
        agentDebugUsed: true,
        agentDebugIterations: debugResult.iterations,
        generationSource: "agent-debug",
        generationWarning: null
      };
    }

    // Agent produced code but we need to verify it
    if (debugResult.fixedCode) {
      console.log(`[Graph] [TRACE] Agent produced code (unverified). Returning for re-validation.`);
      return {
        generatedCode: debugResult.fixedCode,
        agentDebugUsed: true,
        agentDebugIterations: debugResult.iterations,
        generationSource: "agent-debug-unverified",
        generationWarning: debugResult.aborted
          ? `Agent debug loop hit max iterations (${debugResult.iterations}). Code may still have issues.`
          : null
      };
    }

    // Agent failed entirely — fall back to safe code
    console.warn(`[Graph] [TRACE] Agent self-debug FAILED. Using static fallback.`);
    return buildStaticFallback();
  } catch (err) {
    clearErrorContext();
    console.warn(`[Graph] [TRACE] Agent self-debug ERROR: ${err instanceof Error ? err.message : "Unknown error"}. Using static fallback.`);
    return buildStaticFallback();
  }
};

/** Static green-box fallback — last resort when agent debug also fails. */
function buildStaticFallback() {
  const safeCode = [
    "// Terranet Engine Static Validation Recovery",
    "scene.background = new THREE.Color('#020617');",
    "scene.fog = new THREE.FogExp2(0x020617, 0.04);",
    "scene.add(new THREE.AmbientLight(0x0f172a, 1.5));",
    "const mainLight = new THREE.PointLight(0x3b82f6, 120, 30);",
    "mainLight.position.set(5, 8, 5);",
    "scene.add(mainLight);",
    "const accentLight = new THREE.PointLight(0x8b5cf6, 100, 30);",
    "accentLight.position.set(-6, -4, -5);",
    "scene.add(accentLight);",
    "const engineGroup = new THREE.Group();",
    "scene.add(engineGroup);",
    "const coreGeo = new THREE.IcosahedronGeometry(1.5, 2);",
    "const coreMat = new THREE.MeshPhysicalMaterial({",
    "  color: 0x1e293b, emissive: 0x0f172a, roughness: 0.1, metalness: 0.9, clearcoat: 1.0, wireframe: true",
    "});",
    "const core = new THREE.Mesh(coreGeo, coreMat);",
    "engineGroup.add(core);",
    "const inner = new THREE.Mesh(new THREE.OctahedronGeometry(1.2, 0), new THREE.MeshStandardMaterial({",
    "  color: 0xffffff, emissive: 0x3b82f6, emissiveIntensity: 2, transparent: true, opacity: 0.9",
    "}));",
    "engineGroup.add(inner);",
    "const canvas = document.createElement('canvas');",
    "canvas.width = 1024; canvas.height = 256;",
    "const ctx = canvas.getContext('2d');",
    "ctx.fillStyle = '#000000';",
    "ctx.fillRect(0, 0, canvas.width, canvas.height);",
    "ctx.textAlign = 'center';",
    "ctx.textBaseline = 'middle';",
    "ctx.font = 'bold 72px \"Inter\", \"SF Pro Display\", sans-serif';",
    "ctx.fillStyle = '#60a5fa';",
    "ctx.shadowColor = '#3b82f6';",
    "ctx.shadowBlur = 25;",
    "ctx.fillText('TERRANET ENGINE', canvas.width / 2, canvas.height / 2);",
    "const textTexture = new THREE.CanvasTexture(canvas);",
    "const textMat = new THREE.MeshBasicMaterial({ map: textTexture, transparent: true, blending: THREE.AdditiveBlending });",
    "const textMesh = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 1, 64, 1, true, -Math.PI / 3, Math.PI / 1.5), textMat);",
    "engineGroup.add(textMesh);",
    "const rings = [];",
    "for (let i = 0; i < 3; i++) {",
    "  const ring = new THREE.Mesh(",
    "    new THREE.TorusGeometry(2.5 + i * 0.8, 0.02, 16, 100),",
    "    new THREE.MeshBasicMaterial({ color: i === 1 ? 0x8b5cf6 : 0x3b82f6, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending })",
    "  );",
    "  ring.rotation.x = Math.random() * Math.PI;",
    "  const pivot = new THREE.Group();",
    "  pivot.add(ring);",
    "  rings.push({ mesh: pivot, speed: 0.005 + Math.random() * 0.01 });",
    "  engineGroup.add(pivot);",
    "}",
    "camera.position.set(0, 2, 8);",
    "camera.lookAt(0, 0, 0);",
    "const clock = new THREE.Clock();",
    "function animate() {",
    "  requestAnimationFrame(animate);",
    "  const t = clock.getElapsedTime();",
    "  core.rotation.y += 0.005; core.rotation.x += 0.003;",
    "  inner.rotation.y -= 0.01; inner.rotation.z += 0.005;",
    "  inner.material.emissiveIntensity = 1.5 + Math.sin(t * 3) * 0.5;",
    "  textMesh.rotation.y = Math.sin(t * 0.5) * 0.2;",
    "  rings.forEach(r => { r.mesh.rotation.y += r.speed; r.mesh.rotation.x += r.speed * 0.3; });",
    "  engineGroup.position.y = Math.sin(t) * 0.3;",
    "  renderer.render(scene, camera);",
    "}",
    "animate();"
  ].join("\n");

  return {
    generatedCode: safeCode,
    agentDebugUsed: false,
    agentDebugIterations: 0,
    generationSource: "static-fallback",
    validationRecoveryUsed: true
  };
}

const abortExecutionNode = () => {
  return {
    execution: {
      success: false,
      previewUrl: null,
      message: "Execution aborted after agent debug and validation recovery failure."
    }
  };
};

const skipExecutionAfterValidationFailureNode = (state) => {
  const warning = "Validation failed and immutable-generate mode is enabled; skipped runtime execution to preserve generated code.";
  const outputKind = state.selectedSkill === "manim" ? "media" : "code";
  const mediaType = outputKind === "media" ? "video/mp4" : null;

  emitPipelineProgress(state.progress, "execute_code", "completed", {
    status: "degraded",
    skipped: true,
    warning
  });

  return {
    generationWarning: state.generationWarning ? `${state.generationWarning} ${warning}` : warning,
    validationRecoveryUsed: false,
    execution: {
      success: true,
      previewUrl: "about:blank",
      message: `Execution completed in degraded mode: ${warning}`
    },
    runtime: {
      success: true,
      status: "degraded",
      previewUrl: "about:blank",
      outputKind,
      mediaType,
      mediaUrl: outputKind === "media" ? "about:blank" : null,
      mediaArtifactId: null,
      mediaDurationMs: null,
      mediaFps: null,
      mediaResolution: null,
      mediaBytes: null,
      skillId: state.selectedSkill,
      skillName: state.selectedSkill,
      dependencyCount: 0,
      durationMs: 0,
      renderCount: 0,
      frameCount: 0,
      logs: [],
      summary: { childCount: 0, types: [] },
      warning,
      warningCode: "RUNTIME_EXEC_SKIPPED_VALIDATION",
      error: null,
      errorCode: null,
      acquireDiagnostics: null
    }
  };
};

// isValidationPassable has been moved to pipeline/graph.ts
// Re-exported below for backward compatibility

function routeAfterValidation(state) {
  const validationPassable = isValidationPassable(state.validation);
  if (validationPassable) {
    return "execute_code";
  }

  return disableGenerateAutoModify ? "skip_execution_after_validation_failure" : "agent_self_debug";
}

function routeAfterRecoveryValidation(state) {
  const validationPassable = isValidationPassable(state.validation);
  return validationPassable ? "execute_code" : "abort_execution";
}

function routeAfterExecution(state) {
  return state.execution?.success ? "sync_state" : "build_response";
}

function stripDegradedRuntimePrefix(warning) {
  if (typeof warning !== "string") {
    return "";
  }

  return warning
    .replace(/^Runtime degraded due to sandbox provisioning constraints:\s*/i, "")
    .trim();
}

function buildResponseExplanation(state) {
  const runtime = state.runtime ?? null;
  const outputKind = runtime?.outputKind ?? (state.selectedSkill === "manim" ? "media" : "code");
  const source = String(state.generationSource ?? "").trim().toLowerCase();
  const generationWarning = typeof state.generationWarning === "string"
    ? state.generationWarning.trim()
    : "";

  const summary = [
    outputKind === "media"
      ? "Generated scene code and media output."
      : "Generated scene code for live preview."
  ];

  if (state.execution?.success) {
    if (runtime?.status === "degraded") {
      const degradedReason = stripDegradedRuntimePrefix(runtime?.warning);
      summary.push(
        `Preview is running in degraded mode${degradedReason ? ` (${degradedReason})` : " due to sandbox constraints"}.`
      );
      summary.push("Re-run this scene to attempt a full live preview.");
    } else if (runtime?.status === "skipped") {
      summary.push("Preview execution was skipped for this turn.");
    } else if (outputKind === "media" && runtime?.mediaUrl) {
      summary.push("Media preview is ready.");
    } else {
      summary.push("Live preview executed successfully.");
    }
  } else {
    const runtimeError = typeof runtime?.error === "string" && runtime.error.trim()
      ? runtime.error.trim()
      : "";
    summary.push(`Live preview is currently unavailable${runtimeError ? ` (${runtimeError})` : ""}.`);
    summary.push("The generated code is saved and can be re-run.");
  }

  if (state.runtimeRecoveryUsed) {
    summary.push("Runtime recovery was applied.");
  }

  if ((source === "fallback" || source === "static-fallback" || source === "cache") && !generationWarning) {
    summary.push(describeGenerationSource(state.generationSource));
  }

  if (generationWarning) {
    summary.push(generationWarning);
  }

  return summary.filter(Boolean).join(" ");
}

const buildResponseNode = (state) => {
  const outputKind = state.runtime?.outputKind ?? (state.selectedSkill === "manim" ? "media" : "code");
  const mediaType = state.runtime?.mediaType ?? (outputKind === "media" ? "video/mp4" : null);
  const mediaUrl = state.runtime?.mediaUrl ?? (outputKind === "media" ? state.execution.previewUrl ?? null : null);

  const response = {
    sceneId: state.sceneState?.id ?? `scene-failed-${Date.now()}`,
    previewUrl: state.execution.previewUrl,
    skill: state.selectedSkill,
    outputKind,
    mediaType,
    mediaUrl,
    mediaArtifactId: state.runtime?.mediaArtifactId ?? null,
    mediaDurationMs: state.runtime?.mediaDurationMs ?? null,
    mediaFps: state.runtime?.mediaFps ?? null,
    mediaResolution: state.runtime?.mediaResolution ?? null,
    mediaBytes: state.runtime?.mediaBytes ?? null,
    assetPlan: state.assetPlan ?? null,
    explanation: buildResponseExplanation(state),
    code: state.generatedCode,
    generationSource: state.generationSource ?? null,
    generationWarning: state.generationWarning ?? null,
    llmTrace: state.llmTrace ?? null,
    runtime: state.runtime,
    runtimeRecoveryUsed: Boolean(state.runtimeRecoveryUsed),
    deterministicRuntimeFixApplied: Boolean(state.deterministicRuntimeFixApplied),
    deterministicRuntimeFixes: state.deterministicRuntimeFixes ?? [],
    agentDebug: state.agentDebugUsed ? {
      used: true,
      iterations: state.agentDebugIterations,
      source: state.generationSource
    } : null
  };

  return { response };
};

// generationGraph has been extracted to pipeline/graph.ts
// See that file for the full StateGraph implementation including:
// - generateState definition
// - All 12 graph nodes (parseIntentNode, selectSkillNode, buildPromptNode, etc.)
// - Helper functions (attemptRuntimeAgentRecovery, buildResponseExplanation, etc.)
// - Routing functions (routeAfterValidation, routeAfterRecoveryValidation, routeAfterExecution)
// - StateGraph compilation
//
// The re-export above maintains backward compatibility.

// Re-export generationGraph from pipeline/graph.ts to maintain backward compatibility
// The full graph implementation has been extracted to reduce this file's size
export { generationGraph, isValidationPassable } from './pipeline/graph.js';

export async function planTasks(input) {
  const request = requestSchema.parse(input);
  const result = await planningGraph.invoke({ request });

  return {
    planId: result.planId,
    summary: result.summary,
    tasks: result.tasks
  };
}

export async function executeTask(input) {
  const request = executeRequestSchema.parse(input);
  const result = await taskExecutionGraph.invoke({
    planId: request.planId,
    task: request.task
  });

  return {
    planId: request.planId,
    taskId: request.task.id,
    status: result.status,
    output: result.output,
    artifact: result.artifact
  };
}

export async function generateVisual(input, options = {}) {
  const request = requestSchema.parse(input);
  const turnStartedAtMs = Date.now();
  const turnDeadlineAtMs = getTurnDeadlineAtMs(turnStartedAtMs);
  const result = await generationGraph.invoke({
    request,
    progress: options.onProgress ?? null,
    turnStartedAtMs,
    turnDeadlineAtMs
  });
  return result.response;
}

export async function modifyVisual(input, options = {}) {
  const onProgress = options.onProgress ?? null;
  const request = modifyRequestSchema.parse(input);
  const runMode = request.runMode ?? "modify";
  const normalizedInstruction = String(request.instruction ?? "").trim() || (runMode === "rerun" ? "Rerun current scene." : "");
  const requestedCodeOverride = typeof request.codeOverride === "string" ? request.codeOverride : "";
  const sessionState = request.sceneState;
  const turnStartedAtMs = Date.now();
  const turnDeadlineAtMs = getTurnDeadlineAtMs(turnStartedAtMs);
  const baseSceneCode = requestedCodeOverride.trim() || sessionState?.currentScene?.code || "";

  if (!sessionState?.currentScene || !baseSceneCode) {
    throw new Error("No scene available to modify.");
  }

  const currentSkill = sessionState.currentScene.skill ?? request.preferences?.skill ?? "threejs";
  const requestedSkill = request.preferences?.skill ?? currentSkill;
  const selectedSkill = requestedSkill === "auto" ? currentSkill : requestedSkill;
  emitPipelineProgress(onProgress, "parse_intent", "completed");
  emitPipelineProgress(onProgress, "select_skill", "completed", { selectedSkill });
  emitPipelineProgress(onProgress, "build_prompt", "completed", { selectedSkill });
  emitPipelineProgress(onProgress, "generate_code", "running", { selectedSkill, mode: runMode });

  const requestedQuality = resolveRequestedQuality(request, selectedSkill);
  const modificationParsedIntent = parseIntentFromQuery(normalizedInstruction);
  const assetPlan = resolveAssetPlan({
    selectedSkill,
    sourceText: normalizedInstruction,
    parsedIntent: modificationParsedIntent,
    requestedQuality,
    allowInternetFallback: true
  });
  const modificationState = {
    sessionId: request.sessionId,
    instruction: normalizedInstruction,
    currentCode: baseSceneCode,
    selectedSkill,
    quality: requestedQuality,
    parsedIntent: modificationParsedIntent,
    assetPlan
  };

  let modificationResult;
  if (runMode === "rerun") {
    modificationResult = {
      generatedCode: modificationState.currentCode,
      generationSource: "rerun",
      generationWarning: null,
      changeSummary: "Reran current scene without modifying code."
    };
  } else {
    try {
      modificationResult = await modifyCodeWithPool(modificationState);
    } catch (error) {
      const fallback = applyFallbackSceneEdit(modificationState.currentCode, modificationState.instruction);
      modificationResult = {
        generatedCode: fallback.generatedCode,
        generationSource: "fallback",
        generationWarning: error instanceof Error
          ? error.message
          : "LLM modification failed; used fallback modifier.",
        changeSummary: fallback.changeSummary
      };
    }
  }

  let retriedAfterNoop = false;
  let modifyOutcome = "applied";
  let noopReason = null;
  let codeDiff = buildCodeDiffDetails(sessionState.currentScene.code ?? "", modificationResult.generatedCode);
  const shouldCheckNoop = runMode !== "rerun";
  let noopCheck = shouldCheckNoop
    ? detectNoopModification({
      previousCode: sessionState.currentScene.code,
      nextCode: modificationResult.generatedCode,
      changeSummary: modificationResult.changeSummary,
      diffDetails: codeDiff
    })
    : { isNoop: false, reason: null };

  if (shouldCheckNoop && noopCheck.isNoop && getPool().providers.some((p) => p.hasApiKey)) {
    retriedAfterNoop = true;

    emitPipelineProgress(onProgress, "generate_code", "running", {
      selectedSkill,
      mode: "modify",
      retryAfterNoop: true,
      noopReason: noopCheck.reason
    });

    const rewriteInstruction = [
      normalizedInstruction,
      "",
      "Apply concrete functional scene code changes.",
      "Do not return comment-only or metadata-only edits.",
      "Change geometry, materials, lighting, camera, animation, or composition as needed."
    ].join("\n");

    try {
      const retryResult = await modifyCodeWithPool(
        {
          ...modificationState,
          instruction: rewriteInstruction
        },
        { allowFallback: false }
      );

      modificationResult = {
        ...retryResult,
        changeSummary: `${retryResult.changeSummary} Retried after no-op candidate.`
      };
    } catch (retryError) {
      const retryErrorMessage = retryError instanceof Error ? retryError.message : "Unknown retry failure";
      modificationResult = {
        ...modificationResult,
        generationWarning: modificationResult.generationWarning
          ? `${modificationResult.generationWarning}; retry after no-op failed: ${retryErrorMessage}`
          : `Retry after no-op failed: ${retryErrorMessage}`
      };
    }

    codeDiff = buildCodeDiffDetails(sessionState.currentScene.code ?? "", modificationResult.generatedCode);
    noopCheck = detectNoopModification({
      previousCode: sessionState.currentScene.code,
      nextCode: modificationResult.generatedCode,
      changeSummary: modificationResult.changeSummary,
      diffDetails: codeDiff
    });
  }

  emitPipelineProgress(onProgress, "generate_code", "completed", {
    selectedSkill,
    mode: runMode,
    source: modificationResult.generationSource,
    code: modificationResult.generatedCode,
    retriedAfterNoop,
    noopReason: shouldCheckNoop && noopCheck.isNoop ? noopCheck.reason : null
  });

  if (shouldCheckNoop && noopCheck.isNoop) {
    modifyOutcome = "rejected_noop";
    noopReason = noopCheck.reason ?? "non_semantic_diff";
    const skippedOutputKind = sessionState.currentScene.outputKind ?? (selectedSkill === "manim" ? "media" : "code");
    const skippedMediaType = sessionState.currentScene.mediaType ?? (skippedOutputKind === "media" ? "video/mp4" : null);
    const skippedMediaUrl = sessionState.currentScene.mediaUrl
      ?? (skippedOutputKind === "media" ? sessionState.currentScene.previewUrl ?? "about:blank" : null);

    emitPipelineProgress(onProgress, "validate_code", "completed", {
      selectedSkill,
      skipped: true,
      noopReason
    });
    emitPipelineProgress(onProgress, "execute_code", "completed", {
      selectedSkill,
      skipped: true,
      noopReason
    });
    emitPipelineProgress(onProgress, "sync_state", "completed", {
      selectedSkill,
      skipped: true,
      noopReason
    });

    const skippedRuntime = {
      success: true,
      status: "skipped",
      previewUrl: sessionState.currentScene.previewUrl ?? "about:blank",
      outputKind: skippedOutputKind,
      mediaType: skippedMediaType,
      mediaUrl: skippedMediaUrl,
      mediaArtifactId: sessionState.currentScene.mediaArtifactId ?? null,
      mediaDurationMs: sessionState.currentScene.mediaDurationMs ?? null,
      mediaFps: sessionState.currentScene.mediaFps ?? null,
      mediaResolution: sessionState.currentScene.mediaResolution ?? null,
      mediaBytes: sessionState.currentScene.mediaBytes ?? null,
      skillId: selectedSkill,
      skillName: selectedSkill,
      dependencyCount: 0,
      durationMs: 0,
      renderCount: 0,
      frameCount: 0,
      logs: [],
      summary: {
        childCount: 0,
        types: []
      },
      warning: "Skipped runtime execution because the modification produced no semantic code changes.",
      warningCode: "RUNTIME_EXEC_SKIPPED_NOOP_MODIFY",
      error: null,
      acquireDiagnostics: null
    };

    const explanation = [
      `Applied modification: ${normalizedInstruction}`,
      modificationResult.changeSummary,
      retriedAfterNoop ? "Retried once with model rewrite after no-op detection." : null,
      "No meaningful code changes were produced, so runtime execution was skipped.",
      `Outcome: ${modifyOutcome} (${noopReason}).`
    ]
      .filter(Boolean)
      .join(" ");

    return {
      sceneId: sessionState.currentScene.sceneId,
      skill: selectedSkill,
      previewUrl: skippedRuntime.previewUrl,
      outputKind: skippedRuntime.outputKind,
      mediaType: skippedRuntime.mediaType,
      mediaUrl: skippedRuntime.mediaUrl,
      mediaArtifactId: skippedRuntime.mediaArtifactId,
      mediaDurationMs: skippedRuntime.mediaDurationMs,
      mediaFps: skippedRuntime.mediaFps,
      mediaResolution: skippedRuntime.mediaResolution,
      mediaBytes: skippedRuntime.mediaBytes,
      assetPlan,
      code: sessionState.currentScene.code,
      explanation,
      diff: {
        instruction: normalizedInstruction,
        currentVersion: sessionState.currentScene.version,
        changed: false,
        changeSummary: modificationResult.changeSummary,
        source: modificationResult.generationSource,
        patch: codeDiff.patch,
        addedLines: codeDiff.addedLines,
        removedLines: codeDiff.removedLines,
        changedLines: codeDiff.changedLines
      },
      runtime: skippedRuntime,
      generationSource: modificationResult.generationSource,
      generationWarning: modificationResult.generationWarning,
      runtimeRecoveryUsed: false,
      modifyOutcome,
      noopReason,
      retriedAfterNoop
    };
  }

  if (retriedAfterNoop) {
    modifyOutcome = "applied_after_retry";
  }

  emitPipelineProgress(onProgress, "validate_code", "completed", { selectedSkill });
  emitPipelineProgress(onProgress, "execute_code", "running", { selectedSkill });

  const modifyRuntimeTimeoutMs = computeBoundedTimeoutMs(
    turnDeadlineAtMs,
    resolveRuntimeExecutionTimeoutMs(selectedSkill)
  );
  const runtimeResult = await executeSkillRuntimeWithQualityDecision({
    skillId: selectedSkill,
    code: modificationResult.generatedCode,
    timeoutMs: modifyRuntimeTimeoutMs,
    maxFrames: runtimeExecutionMaxFrames,
    turnDeadlineAtMs,
    sessionId: request.sessionId,
    quality: requestedQuality,
    originalQuery: normalizedInstruction,
    onProgress: (progressEvent) => {
      if (typeof onProgress === "function") {
        try {
          onProgress({
            step: "execute_code",
            status: progressEvent.type,
            payload: progressEvent
          });
        } catch (err) {
          // Progress callbacks are best-effort
        }
      }
    }
  });

  let finalRuntimeResult = runtimeResult;
  let finalCode = modificationResult.generatedCode;
  let finalGenerationSource = modificationResult.generationSource;
  let finalGenerationWarning = modificationResult.generationWarning;
  let runtimeRecoveryUsed = false;
  let deterministicRuntimeFixApplied = false;
  let deterministicRuntimeFixes = [];

  if (!runtimeResult.success) {
    const recovery = await attemptRuntimeAgentRecovery({
      originalQuery: normalizedInstruction,
      failedCode: modificationResult.generatedCode,
      runtimeResult,
      skill: selectedSkill,
      maxIterations: runtimeDebugMaxIterations,
      turnDeadlineAtMs,
      sessionId: request.sessionId,
      requestedQuality,
      parsedIntent: modificationParsedIntent
    });

    if (recovery.recovered) {
      finalRuntimeResult = recovery.recoveredRuntime;
      finalCode = recovery.recoveredCode;
      finalGenerationSource = recovery.debugUsed ? "agent-runtime-debug" : "runtime-auto-fix";
      finalGenerationWarning = recovery.warning ?? finalGenerationWarning;
      runtimeRecoveryUsed = true;
      deterministicRuntimeFixApplied = Boolean(recovery.deterministicFixApplied);
      deterministicRuntimeFixes = recovery.deterministicFixes ?? [];
    } else if (recovery.debugUsed) {
      finalRuntimeResult = recovery.recoveredRuntime ?? runtimeResult;
      finalCode = recovery.recoveredCode ?? modificationResult.generatedCode;
      finalGenerationWarning = recovery.warning ?? finalGenerationWarning;
      deterministicRuntimeFixApplied = Boolean(recovery.deterministicFixApplied);
      deterministicRuntimeFixes = recovery.deterministicFixes ?? [];
    }
  }

  if (!finalRuntimeResult.success && shouldDegradeRuntimeFailure(finalRuntimeResult)) {
    finalRuntimeResult = buildDegradedRuntimeResult(
      finalRuntimeResult,
      selectedSkill,
      sessionState.currentScene.previewUrl ?? "about:blank"
    );
    finalGenerationWarning =
      finalGenerationWarning ??
      "Sandbox runtime degraded due to provisioning constraints; modification completed without full live execution.";
  }

  emitPipelineProgress(onProgress, "execute_code", finalRuntimeResult.success ? "completed" : "failed", {
    selectedSkill,
    error: finalRuntimeResult.success ? null : finalRuntimeResult.error,
    runtimeRecoveryUsed
  });
  emitPipelineProgress(onProgress, "sync_state", finalRuntimeResult.success ? "completed" : "failed", {
    selectedSkill,
    error: finalRuntimeResult.success ? null : finalRuntimeResult.error,
    runtimeRecoveryUsed
  });

  const explanation = [
    runMode === "rerun" ? "Reran current scene." : `Applied modification: ${normalizedInstruction}`,
    modificationResult.changeSummary,
    retriedAfterNoop ? "Applied after no-op retry." : null,
    runtimeRecoveryUsed ? "Runtime self-debug recovery was applied." : null,
    finalRuntimeResult.warning ? finalRuntimeResult.warning : null,
    finalRuntimeResult.success
      ? (finalRuntimeResult.status === "degraded"
        ? `Runtime degraded: ${finalRuntimeResult.warning}`
        : `Runtime completed in ${finalRuntimeResult.durationMs}ms.`)
      : `Runtime failed: ${finalRuntimeResult.error}`,
    describeGenerationSource(finalGenerationSource)
  ]
    .filter(Boolean)
    .join(" ");

  codeDiff = buildCodeDiffDetails(sessionState.currentScene.code ?? "", finalCode);

  return {
    sceneId: sessionState.currentScene.sceneId,
    skill: selectedSkill,
    previewUrl: finalRuntimeResult.previewUrl ?? sessionState.currentScene.previewUrl ?? "about:blank",
    outputKind: finalRuntimeResult.outputKind ?? (selectedSkill === "manim" ? "media" : "code"),
    mediaType: finalRuntimeResult.mediaType ?? null,
    mediaUrl: finalRuntimeResult.mediaUrl
      ?? (finalRuntimeResult.outputKind === "media" ? finalRuntimeResult.previewUrl ?? null : null),
    mediaArtifactId: finalRuntimeResult.mediaArtifactId ?? null,
    mediaDurationMs: finalRuntimeResult.mediaDurationMs ?? null,
    mediaFps: finalRuntimeResult.mediaFps ?? null,
    mediaResolution: finalRuntimeResult.mediaResolution ?? null,
    mediaBytes: finalRuntimeResult.mediaBytes ?? null,
    assetPlan,
    code: finalCode,
    explanation,
    diff: {
      instruction: normalizedInstruction,
      currentVersion: sessionState.currentScene.version,
      changed: finalCode !== sessionState.currentScene.code,
      changeSummary: modificationResult.changeSummary,
      source: finalGenerationSource,
      patch: codeDiff.patch,
      addedLines: codeDiff.addedLines,
      removedLines: codeDiff.removedLines,
      changedLines: codeDiff.changedLines
    },
    runtime: finalRuntimeResult,
    generationSource: finalGenerationSource,
    generationWarning: finalGenerationWarning,
    runtimeRecoveryUsed,
    deterministicRuntimeFixApplied,
    deterministicRuntimeFixes,
    modifyOutcome,
    noopReason,
    retriedAfterNoop
  };
}

/**
 * Generate a visual scene from a reference image.
 *
 * Uses eligible vision-capable LLM providers to analyze the image
 * and produce matching scene code. Validates and optionally self-debugs.
 *
 * @param {object} input
 * @param {string} input.imageUrl - URL or base64 data URI of the reference image
 * @param {string} [input.query] - Optional text instruction alongside the image
 * @param {string} [input.sessionId] - Session ID
 * @param {object} [input.preferences] - { skill, quality }
 * @returns {Promise<object>} Generation result with code, skill, explanation, runtime
 */
export async function generateFromImage(input) {
  const imageUrl = input.imageUrl;
  const query = input.query ?? "";
  const sessionId = input.sessionId ?? null;
  const turnStartedAtMs = Date.now();
  const turnDeadlineAtMs = getTurnDeadlineAtMs(turnStartedAtMs);

  if (!imageUrl) {
    throw new Error("imageUrl is required for image-to-code generation.");
  }

  // Determine skill — default to threejs for image-to-code
  const requestedSkill = input.preferences?.skill ?? "auto";
  let selectedSkill = requestedSkill;

  if (requestedSkill === "auto") {
    // For images, default to threejs unless there's a text hint
    const normalizedQuery = (query || "").toLowerCase();
    if (/(manim|equation|latex|formula|proof|theorem|educational\s+video|storyboard|cinematic\s+video|mp4|narrated\s+animation)/.test(normalizedQuery)) {
      selectedSkill = "manim";
    } else if (/(chart|graph|data|bar|pie|line chart)/.test(normalizedQuery)) {
      selectedSkill = "d3js";
    } else if (/(2d|canvas|sketch|drawing|pixel|flat)/.test(normalizedQuery)) {
      selectedSkill = "p5js";
    } else {
      selectedSkill = "threejs";
    }
  }

  const parsedIntent = query ? parseIntentFromQuery(query) : null;
  const requestedQuality = resolveRequestedQuality({ preferences: input.preferences }, selectedSkill);
  const assetPlan = resolveAssetPlan({
    selectedSkill,
    sourceText: query,
    parsedIntent,
    requestedQuality,
    allowInternetFallback: true
  });

  console.log(`[ImageToCode] Generating from image for skill=${selectedSkill}, query="${query.slice(0, 60)}"`);

  // Build the multimodal prompt
  const { systemPrompt, userContent } = buildImageToCodePromptBundle({
    imageUrl,
    query,
    selectedSkill,
    parsedIntent,
    assetPlan
  });

  let generatedCode = "";
  let generationSource = "image-to-code";
  let generationWarning = null;
  let agentDebugInfo = null;
  let llmTrace = null;

  try {
    const completion = await executeWithProviderFailover({
      operationName: "ImageToCode",
      filter: { requireCodeGeneration: true, requireVision: true },
      mode: "thinking",
      retryDelays: moonshotRetryDelaysMs,
      executeProvider: async ({ provider, mode: providerMode, retryDelays }) => {
        const response = await fetchChatCompletion(
          provider,
          {
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userContent }
            ]
          },
          { mode: providerMode, retryDelays }
        );

        const payload = await response.json();
        const content = extractChoiceContent(payload?.choices?.[0]?.message?.content ?? "");
        const code = extractCodeContent(content);

        if (!code) {
          throw createRetryableProviderError(`${provider.id} returned empty code output for image-to-code generation.`, "PROVIDER_EMPTY_OUTPUT");
        }

        return code;
      }
    });

    generatedCode = completion.value;
    generationSource = completion.provider.id;
    llmTrace = completion.llm;
    if (completion.llm.fallbackUsed) {
      generationWarning = `Primary vision model unavailable; generated via ${completion.provider.id}.`;
    }
  } catch (error) {
    if (error?.code === "NO_ELIGIBLE_LLM_PROVIDER") {
      throw new Error("No vision-capable LLM provider is configured for image-to-code generation.");
    }

    throw error;
  }

  // Validate the generated code
  const imageValidationOptions = buildValidationOptions({
    skillId: selectedSkill,
    request: {
      query,
      preferences: {
        quality: requestedQuality
      }
    },
    requestedQuality,
    userQuery: query || "Generate scene from reference image",
    parsedIntent
  });
  const validation = validateCode(generatedCode, selectedSkill, imageValidationOptions);

  if (!validation.passable) {
    console.log(`[ImageToCode] Code failed validation. Attempting agent self-debug...`);

    // Try agent self-debug
    setErrorContext({
      originalQuery: query || "Generate scene from reference image",
      failedCode: generatedCode,
      validationErrors: validation.errors,
      skill: selectedSkill
    });

    try {
      const imageSelfDebugTimeoutMs = computeBoundedTimeoutMs(turnDeadlineAtMs, selfDebugSessionTimeoutMs, 500);
      const debugResult = await withTimeout(
        runSelfDebugSession({
          originalQuery: query || "Generate scene from reference image",
          failedCode: generatedCode,
          validationErrors: validation.errors,
          skill: selectedSkill,
          tools: getDebugTools(),
          maxIterations: selfDebugMaxIterations
        }),
        imageSelfDebugTimeoutMs,
        `Self-debug session timed out after ${imageSelfDebugTimeoutMs}ms.`
      );

      clearErrorContext();

      if (debugResult.fixedCode) {
        const debugValidation = validateCode(debugResult.fixedCode, selectedSkill, imageValidationOptions);

        if (debugValidation.passable) {
          generatedCode = debugResult.fixedCode;
          generationSource = "image-to-code-debugged";
          agentDebugInfo = {
            used: true,
            iterations: debugResult.iterations,
            success: debugResult.success
          };
          console.log(`[ImageToCode] Agent debug resolved code in ${debugResult.iterations} iteration(s).`);
        } else {
          generationWarning = "Code failed validation and agent debug output remained non-passable.";
        }
      } else {
        generationWarning = "Code failed validation and agent debug could not fix it.";
      }
    } catch (debugErr) {
      clearErrorContext();
      generationWarning = `Agent debug failed: ${debugErr instanceof Error ? debugErr.message : "Unknown error"}`;
    }
  }

  // Execute in sandbox
  const imageRuntimeTimeoutMs = computeBoundedTimeoutMs(
    turnDeadlineAtMs,
    resolveRuntimeExecutionTimeoutMs(selectedSkill)
  );
  const runtimeResult = await executeSkillRuntimeWithQualityDecision({
    skillId: selectedSkill,
    code: generatedCode,
    timeoutMs: imageRuntimeTimeoutMs,
    maxFrames: runtimeExecutionMaxFrames,
    turnDeadlineAtMs,
    sessionId,
    quality: requestedQuality,
    originalQuery: query || imageUrl
  });

  let finalRuntimeResult = runtimeResult;
  let runtimeRecoveryUsed = false;

  if (!runtimeResult.success) {
    const recovery = await attemptRuntimeAgentRecovery({
      originalQuery: query || "Generate scene from reference image",
      failedCode: generatedCode,
      runtimeResult,
      skill: selectedSkill,
      maxIterations: runtimeDebugMaxIterations,
      turnDeadlineAtMs,
      sessionId,
      requestedQuality,
      parsedIntent
    });

    if (recovery.recovered) {
      generatedCode = recovery.recoveredCode;
      finalRuntimeResult = recovery.recoveredRuntime;
      generationSource = "image-to-code-runtime-debugged";
      generationWarning = recovery.warning ?? generationWarning;
      runtimeRecoveryUsed = true;
      agentDebugInfo = {
        used: true,
        iterations: recovery.iterations,
        success: true,
        mode: "runtime"
      };
    } else if (recovery.debugUsed) {
      finalRuntimeResult = recovery.recoveredRuntime ?? runtimeResult;
      generationWarning = recovery.warning ?? generationWarning;
      agentDebugInfo = {
        used: true,
        iterations: recovery.iterations,
        success: false,
        mode: "runtime"
      };
    }
  }

  if (!finalRuntimeResult.success && shouldDegradeRuntimeFailure(finalRuntimeResult)) {
    finalRuntimeResult = buildDegradedRuntimeResult(finalRuntimeResult, selectedSkill, "about:blank");
    generationWarning =
      generationWarning ??
      "Sandbox runtime degraded due to provisioning constraints; generated image-derived code was returned without full live execution.";
  }

  const explanation = [
    query ? `Generated from reference image with instruction: "${query}"` : "Generated from reference image.",
    runtimeRecoveryUsed ? "Runtime self-debug recovery was applied." : null,
    finalRuntimeResult.success
      ? (finalRuntimeResult.status === "degraded"
        ? `Runtime degraded: ${finalRuntimeResult.warning}`
        : `Runtime completed in ${finalRuntimeResult.durationMs}ms with ${finalRuntimeResult.renderCount} renders.`)
      : `Runtime failed: ${finalRuntimeResult.error}`,
    generationWarning,
    agentDebugInfo?.used
      ? `Agent self-debug was used (${agentDebugInfo.iterations} iteration(s)).`
      : null
  ].filter(Boolean).join(" ");

  return {
    sceneId: `scene-img-${Date.now()}`,
    skill: selectedSkill,
    previewUrl: finalRuntimeResult.previewUrl ?? "about:blank",
    outputKind: finalRuntimeResult.outputKind ?? (selectedSkill === "manim" ? "media" : "code"),
    mediaType: finalRuntimeResult.mediaType ?? null,
    mediaUrl: finalRuntimeResult.mediaUrl
      ?? (finalRuntimeResult.outputKind === "media" ? finalRuntimeResult.previewUrl ?? null : null),
    mediaArtifactId: finalRuntimeResult.mediaArtifactId ?? null,
    mediaDurationMs: finalRuntimeResult.mediaDurationMs ?? null,
    mediaFps: finalRuntimeResult.mediaFps ?? null,
    mediaResolution: finalRuntimeResult.mediaResolution ?? null,
    mediaBytes: finalRuntimeResult.mediaBytes ?? null,
    assetPlan,
    code: generatedCode,
    explanation,
    runtime: finalRuntimeResult,
    generationSource,
    generationWarning,
    llmTrace,
    agentDebug: agentDebugInfo,
    runtimeRecoveryUsed,
    imageUrl
  };
}

