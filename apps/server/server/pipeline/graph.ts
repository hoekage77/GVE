import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import { emitPipelineProgress, requestSchema, describeGenerationSource, withTimeout } from "./utils.js";
import { parseIntentFromQuery } from "./intent-classifier.js";
import { generateCodeWithPool } from "./code-generator.js";
import { selectSkillForIntent } from "../skills/registry.js";
import { validateCode } from "../quality/validator.js";
import { resolveAssetPlan } from "./assets.js";
import { warmupSandboxForSkill, executeSkillRuntime } from "../sandbox/skill-runtime.js";
import { runSelfDebugSession, runRuntimeDebugSession } from "../agents/runner.js";
import { getDebugTools, getRuntimeDebugTools, setErrorContext, clearErrorContext } from "../agents/tools.js";
import { getGenerationCacheKey, getCachedGeneration, setCachedGeneration } from "../cache-manager.js";
import { getPool } from "../llm/pool.js";
import { executeWithQualityLoop } from "../sandbox/execution.js";
import { executeSkillRuntimeWithQualityDecision } from "./runtime-executor.js";

// Import constants from orchestrator (these will be re-exported from utils later if needed)
const disableGenerateAutoModify = process.env.DISABLE_GENERATE_AUTO_MODIFY === "true" || process.env.DISABLE_GENERATE_AUTO_MODIFY === "1";
const runtimeDebugMaxIterations = Number.parseInt(process.env.RUNTIME_DEBUG_MAX_ITERATIONS ?? "2", 10) || 2;
const runtimeRecoveryBudgetMs = Number.parseInt(process.env.RUNTIME_RECOVERY_BUDGET_MS ?? "300000", 10) || 300000;
const runtimeExecutionMaxFrames = Number.parseInt(process.env.RUNTIME_EXEC_MAX_FRAMES ?? "48", 10) || 48;
const selfDebugSessionTimeoutMs = Number.parseInt(process.env.SELF_DEBUG_SESSION_TIMEOUT_MS ?? "14000", 10) || 14000;
const runtimeExecutionTimeoutMs = Number.parseInt(process.env.RUNTIME_EXEC_TIMEOUT_MS ?? "2200", 10) || 2200;
const turnBudgetMs = Number.parseInt(process.env.TURN_BUDGET_MS ?? "300000", 10) || 300000;

const runtimeDebugSessionTimeoutMs = Number.parseInt(process.env.RUNTIME_DEBUG_SESSION_TIMEOUT_MS ?? "15000", 10) || 15000;

// Helper functions
function normalizeQuery(query: string): string {
  return String(query ?? "").trim().toLowerCase();
}

function resolveRequestedQuality(request: any, selectedSkill: string): string {
  return request?.preferences?.quality ?? "standard";
}

function resolveRuntimeExecutionReserveMs(skillId: string): number {
  const manimReserve = Number.parseInt(process.env.RUNTIME_EXEC_RESERVE_MANIM_MS ?? "120000", 10) || 120000;
  const standardReserve = Number.parseInt(process.env.RUNTIME_EXEC_RESERVE_MS ?? "10000", 10) || 10000;
  return skillId === "manim" ? manimReserve : standardReserve;
}

function getRemainingBudgetMs(deadlineAtMs: number): number {
  if (!Number.isFinite(deadlineAtMs)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, deadlineAtMs - Date.now());
}

function computeBoundedTimeoutMs(deadlineAtMs: number, configuredTimeoutMs: number, minimumTimeoutMs = 300): number {
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

function resolveRuntimeExecutionTimeoutMs(skillId: string): number {
  const manimTimeout = Number.parseInt(process.env.RUNTIME_EXEC_TIMEOUT_MANIM_MS ?? "150000", 10) || 150000;
  return skillId === "manim" ? manimTimeout : runtimeExecutionTimeoutMs;
}

function buildFallbackGeneratedCode(skill: string): string {
  return `// Fallback ${skill} scene\nconsole.log('Fallback scene');`;
}

function shouldDegradeRuntimeFailure(runtimeResult: any): boolean {
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
  
  return detail.includes("sandbox") || detail.includes("provision") || detail.includes("timeout");
}

function buildDegradedRuntimeResult(runtimeResult: any, skillId: string, previewUrl: string | null): any {
  const outputKind = skillId === "manim" ? "media" : "code";
  const mediaType = outputKind === "media" ? "video/mp4" : null;
  const warning = typeof runtimeResult?.warning === "string" ? runtimeResult.warning : "Sandbox runtime degraded due to provisioning constraints.";
  
  return {
    success: true,
    status: "degraded",
    previewUrl,
    outputKind,
    mediaType,
    mediaUrl: outputKind === "media" ? previewUrl : null,
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
    warning,
    warningCode: "RUNTIME_EXEC_SKIPPED_VALIDATION",
    error: null,
    errorCode: null,
    acquireDiagnostics: null
  };
}

function buildValidationOptions(options: any): any {
  return {
    skillId: options.skillId ?? "threejs",
    request: options.request,
    requestedQuality: options.requestedQuality ?? "standard",
    userQuery: options.userQuery ?? options.request?.query,
    parsedIntent: options.parsedIntent
  };
}

// Stub functions for multi-file project validation (not critical for single-file generation)
function isMultiFileProject(code: any): boolean {
  return code && typeof code === "object" && Array.isArray(code.files);
}

function validateProject(code: any): any {
  if (!code || !Array.isArray(code.files)) {
    return { valid: false, errors: ["Invalid project structure"] };
  }
  return { valid: true, errors: [] };
}

function detectRequiredTools(code: string): string[] {
  // Detect npm package names from import/require statements
  const tools: string[] = [];
  if (/\bthree\b/i.test(code)) tools.push("three");
  if (/\bpostprocessing\b/i.test(code)) tools.push("postprocessing");
  if (/\bp5\b/i.test(code)) tools.push("p5");
  if (/\bd3\b/i.test(code)) tools.push("d3");
  if (/\bgsap\b/i.test(code)) tools.push("gsap");
  if (/\banimejs?\b/i.test(code)) tools.push("animejs");
  return [...new Set(tools)];
}

// Graph State Definition
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

// Node Functions
const parseIntentNode = (state: any) => {
  emitPipelineProgress(state.progress, "parse_intent", "running");
  return { parsedIntent: parseIntentFromQuery(state.request.query) };
};

const selectSkillNode = (state: any) => {
  emitPipelineProgress(state.progress, "select_skill", "running");
  const requestedSkill = state.request.preferences?.skill;
  const selection = selectSkillForIntent(state.parsedIntent, requestedSkill);

  try {
    warmupSandboxForSkill(selection.selectedSkill);
  } catch {
    // Warmup is best-effort
  }

  if (selection.fallbackRequired && requestedSkill && requestedSkill !== "auto") {
    return {
      selectedSkill: selection.selectedSkill,
      skillFallback: {
        from: requestedSkill,
        to: selection.selectedSkill,
        reason: selection.reason ?? "Skill not available"
      }
    };
  }

  return { selectedSkill: selection.selectedSkill };
};

const buildPromptNode = (state: any) => {
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

const generateCodeNode = async (state: any) => {
  console.log(`[Graph] [TRACE] generateCodeNode started.`);
  emitPipelineProgress(state.progress, "generate_code", "running");
  const normalizedQuery = normalizeQuery(state.request.query);
  const runtimeReserveMs = resolveRuntimeExecutionReserveMs(state.selectedSkill);
  const generationBudgetMs = Number.isFinite(state.turnDeadlineAtMs)
    ? Math.max(0, getRemainingBudgetMs(state.turnDeadlineAtMs) - runtimeReserveMs)
    : Number.POSITIVE_INFINITY;

  console.log(`[Graph] [TRACE] generateCodeNode budget=${Number.isFinite(generationBudgetMs) ? generationBudgetMs + "ms" : "infinite"}, skill=${state.selectedSkill}, query=${state.request.query.slice(0, 80)}`);

  let generationResult: any;

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
    const quality = resolveRequestedQuality(state.request, state.selectedSkill);
    const cacheKey = getGenerationCacheKey(state.request.query, state.selectedSkill, quality);
    const cached = getCachedGeneration(cacheKey) as { code?: string } | undefined;
    if (cached?.code) {
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

const validateCodeNode = (state: any) => {
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

// Helper functions for runtime recovery
function escapeForRegex(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseRuntimeMismatch(runtimeError: string): any {
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
    const symbol = functionMatch[1] ?? "";
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

function resolveConstructorFallback(symbol: string): string | null {
  const explicitFallbacks: Record<string, string> = {
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

function applyDeterministicRuntimePatch({ code, runtimeError, skill }: { code: string; runtimeError: string; skill: string }): any {
  if (!code || skill !== "threejs") {
    return null;
  }

  const mismatch = parseRuntimeMismatch(runtimeError);
  if (!mismatch) {
    return null;
  }

  let patchedCode = code;
  const appliedFixes: string[] = [];

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

function buildRuntimeCompatibilityHints(runtimeError: string, deterministicFixes: string[] = []): string[] {
  const mismatch = parseRuntimeMismatch(runtimeError);
  const hints: string[] = [];

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
    hints.push(`Deterministic fix already attempted: ${deterministicFixes.join("; ")}`);
  }

  return hints;
}

// Execute skill runtime bounded helper
async function executeSkillRuntimeBounded(options: any): Promise<any> {
  const result = await executeSkillRuntimeWithQualityDecision({
    ...options,
    quality: options.quality ?? "standard",
    onProgress: null
  });
  return result;
}

export async function attemptRuntimeAgentRecovery({
  originalQuery,
  failedCode,
  runtimeResult,
  skill,
  maxIterations = runtimeDebugMaxIterations,
  turnDeadlineAtMs,
  sessionId = null,
  requestedQuality = "standard",
  parsedIntent = null
}: any): Promise<any> {
  let workingCode = failedCode;
  let workingRuntime = runtimeResult;
  let deterministicFixApplied = false;
  let deterministicFixes: string[] = [];
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
  const seenMismatchSignatures = new Set<string>();
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
      workingCode = deterministicPatch.patchedCode;
      break;
    }
  }

  const compatibilityHints = buildRuntimeCompatibilityHints(
    workingRuntime?.error ?? workingRuntime?.warning ?? "Unknown runtime error",
    deterministicFixes
  );

  if (compatibilityHints.length === 0 || compatibilityHints.length > 3) {
    return {
      recovered: false,
      recoveredCode: workingCode,
      recoveredRuntime: workingRuntime,
      warning: "Runtime recovery skipped; compatibility hints unavailable or excessive.",
      iterations: 0,
      debugUsed: false,
      deterministicFixApplied,
      deterministicFixes
    };
  }

  setErrorContext({
    originalQuery,
    failedCode: workingCode,
    runtimeError: workingRuntime?.error ?? workingRuntime?.warning,
    skill,
    runtimeHints: compatibilityHints,
    sessionId
  });

  try {
    const debugTimeoutMs = computeBoundedTimeoutMs(recoveryDeadlineAtMs, runtimeDebugSessionTimeoutMs, 500);
    if (debugTimeoutMs <= 0) {
      return {
        recovered: false,
        recoveredCode: workingCode,
        recoveredRuntime: workingRuntime,
        warning: "Runtime recovery budget exhausted before debug session.",
        iterations: 0,
        debugUsed: false,
        deterministicFixApplied,
        deterministicFixes
      };
    }

    const debugResult = await withTimeout(
      runRuntimeDebugSession({
        originalQuery,
        failedCode: workingCode,
        runtimeError: workingRuntime?.error ?? workingRuntime?.warning,
        skill,
        tools: getRuntimeDebugTools(),
        maxIterations,
        compatibilityHints,
        timeoutMs: debugTimeoutMs
      }),
      debugTimeoutMs,
      "Runtime debug session timed out."
    );

    if (debugResult?.recovered && debugResult?.recoveredCode) {
      const recoveryTimeoutMs = computeBoundedTimeoutMs(
        recoveryDeadlineAtMs,
        resolveRuntimeExecutionTimeoutMs(skill)
      );

      if (recoveryTimeoutMs <= 0) {
        return {
          recovered: false,
          recoveredCode: debugResult.recoveredCode,
          recoveredRuntime: workingRuntime,
          warning: "Runtime recovery budget exhausted before re-execution.",
          iterations: debugResult.iterations,
          debugUsed: true,
          deterministicFixApplied,
          deterministicFixes
        };
      }

      try {
        const recoveryRuntime = await executeSkillRuntimeBounded({
          skillId: skill,
          code: debugResult.recoveredCode,
          timeoutMs: recoveryTimeoutMs,
          maxFrames: runtimeExecutionMaxFrames,
          turnDeadlineAtMs: recoveryDeadlineAtMs,
          sessionId
        });

        if (recoveryRuntime.success) {
          return {
            recovered: true,
            recoveredCode: debugResult.recoveredCode,
            recoveredRuntime: recoveryRuntime,
            warning: debugResult.warning,
            iterations: debugResult.iterations,
            debugUsed: true,
            deterministicFixApplied,
            deterministicFixes
          };
        }

        return {
          recovered: false,
          recoveredCode: debugResult.recoveredCode,
          recoveredRuntime: recoveryRuntime,
          warning: debugResult.warning ?? "Runtime debug fix did not resolve execution error.",
          iterations: debugResult.iterations,
          debugUsed: true,
          deterministicFixApplied,
          deterministicFixes
        };
      } catch {
        return {
          recovered: false,
          recoveredCode: debugResult.recoveredCode,
          recoveredRuntime: workingRuntime,
          warning: debugResult.warning ?? "Runtime debug re-execution failed.",
          iterations: debugResult.iterations,
          debugUsed: true,
          deterministicFixApplied,
          deterministicFixes
        };
      }
    }

    return {
      recovered: false,
      recoveredCode: workingCode,
      recoveredRuntime: workingRuntime,
      warning: debugResult?.warning ?? "Runtime debug did not recover code.",
      iterations: debugResult?.iterations ?? 0,
      debugUsed: true,
      deterministicFixApplied,
      deterministicFixes
    };
  } finally {
    clearErrorContext();
  }
}

const executeCodeNode = async (state: any) => {
  console.log(`[Graph] [TRACE] executeCodeNode started.`);
  emitPipelineProgress(state.progress, "execute_code", "running");

  if (!state.generatedCode) {
    console.warn(`[Graph] [WARN] executeCodeNode: no generated code available.`);
    return {
      execution: {
        success: false,
        previewUrl: null,
        message: "No generated code available for execution."
      },
      runtime: buildDegradedRuntimeResult({
        success: false,
        error: "No generated code",
        errorCode: "NO_GENERATED_CODE",
        status: "failed"
      }, state.selectedSkill, null)
    };
  }

  const initialRuntimeTimeoutMs = computeBoundedTimeoutMs(
    state.turnDeadlineAtMs,
    resolveRuntimeExecutionTimeoutMs(state.selectedSkill)
  );
  const requestedQuality = resolveRequestedQuality(state.request, state.selectedSkill);
  
  const isMultiFileResult = isMultiFileProject(state.generatedCode);
  
  let detectedTools: any[] = [];
  if (isMultiFileResult) {
    const projectValidation = validateProject(state.generatedCode);
    if (!projectValidation.valid) {
      console.warn(`[Graph] Multi-file project validation failed:`, projectValidation.errors);
      return {
        execution: {
          success: false,
          previewUrl: null,
          message: "Multi-file project validation failed: " + projectValidation.errors.join('; ')
        },
        runtime: buildDegradedRuntimeResult({
          skillId: state.selectedSkill,
          errorMessage: "Multi-file project validation failed: " + projectValidation.errors.join('; '),
          errorCode: "PROJECT_VALIDATION_FAILED"
        }, state.selectedSkill, null)
      };
    }
    
    const allCode = state.generatedCode.files.map((f: any) => f.content).join('\n');
    detectedTools = detectRequiredTools(allCode);
    console.log(`[Graph] [TRACE] Multi-file project with ${state.generatedCode.files.length} files, detected tools: ${detectedTools.join(', ') || 'none'}`);
  } else {
    detectedTools = detectRequiredTools(state.generatedCode);
  }
  
  if (detectedTools.length > 0) {
    console.log(
      `[Graph] [TRACE] Detected required tools: ${detectedTools.join(', ')}`
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
    onProgress: (progressEvent: any) => {
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
  let deterministicRuntimeFixes: string[] = [];

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

const syncStateNode = (state: any) => {
  emitPipelineProgress(state.progress, "sync_state", "running");
  return {
    sceneState: {
      id: `scene-${Date.now()}`,
      version: 1
    }
  };
};

const agentSelfDebugNode = async (state: any) => {
  console.log(`[Graph] [TRACE] agentSelfDebugNode started — attempting agent self-debug.`);

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
        maxIterations: 2
      }),
      debugTimeoutMs,
      "Self-debug session timed out."
    );

    if (debugResult?.recovered && debugResult?.recoveredCode) {
      const recoveryValidation = validateCode(
        debugResult.recoveredCode,
        state.selectedSkill ?? "threejs",
        buildValidationOptions({
          skillId: state.selectedSkill ?? "threejs",
          request: state.request,
          requestedQuality: resolveRequestedQuality(state.request, state.selectedSkill),
          parsedIntent: state.parsedIntent
        })
      );

      if (recoveryValidation.passable) {
        console.log(`[Graph] [TRACE] Self-debug recovery succeeded and code is valid.`);
        return {
          generatedCode: debugResult.recoveredCode,
          validationRecoveryUsed: true,
          validation: {
            valid: true,
            passable: true,
            errors: [],
            warnings: []
          },
          agentDebugUsed: true,
          agentDebugIterations: debugResult.iterations,
          generationSource: "agent-self-debug",
          generationWarning: debugResult.warning ?? null
        };
      }

      console.warn(`[Graph] [WARN] Self-debug recovered code failed validation.`);
      return {
        generatedCode: debugResult.recoveredCode,
        validationRecoveryUsed: true,
        validation: {
          valid: false,
          passable: false,
          errors: recoveryValidation.errors,
          warnings: recoveryValidation.warnings ?? []
        },
        agentDebugUsed: true,
        agentDebugIterations: debugResult.iterations,
        generationSource: "agent-self-debug-failed",
        generationWarning: debugResult.warning ?? "Self-debug recovered code failed validation."
      };
    }

    console.warn(`[Graph] [WARN] Self-debug did not recover valid code.`);
    return {
      validationRecoveryUsed: true,
      validation: state.validation,
      agentDebugUsed: true,
      agentDebugIterations: debugResult?.iterations ?? 0,
      generationWarning: debugResult?.warning ?? "Self-debug could not recover valid code."
    };
  } finally {
    clearErrorContext();
  }
};

const abortExecutionNode = () => {
  return {
    execution: {
      success: false,
      previewUrl: null,
      message: "Execution aborted after agent debug and validation recovery failure."
    }
  };
};

const skipExecutionAfterValidationFailureNode = (state: any) => {
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

export function isValidationPassable(validation: any): boolean {
  return validation?.passable ?? validation?.valid ?? false;
}

function routeAfterValidation(state: any): string {
  const validationPassable = isValidationPassable(state.validation);
  if (validationPassable) {
    return "execute_code";
  }

  return disableGenerateAutoModify ? "skip_execution_after_validation_failure" : "agent_self_debug";
}

function routeAfterRecoveryValidation(state: any): string {
  const validationPassable = isValidationPassable(state.validation);
  return validationPassable ? "execute_code" : "abort_execution";
}

function routeAfterExecution(state: any): string {
  return state.execution?.success ? "sync_state" : "build_response";
}

function stripDegradedRuntimePrefix(warning: string): string {
  if (typeof warning !== "string") {
    return "";
  }

  return warning
    .replace(/^Runtime degraded due to sandbox provisioning constraints:\s*/i, "")
    .trim();
}

function buildResponseExplanation(state: any): string {
  const runtime = state.runtime ?? null;
  const outputKind = runtime?.outputKind ?? (state.selectedSkill === "manim" ? "media" : "code");
  const source = String(state.generationSource ?? "").trim().toLowerCase();
  const generationWarning = typeof state.generationWarning === "string"
    ? state.generationWarning.trim()
    : "";

  const summary: string[] = [
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

const buildResponseNode = (state: any) => {
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

// Compile the StateGraph
export const generationGraph = new StateGraph(generateState)
  .addNode("parse_intent", parseIntentNode)
  .addNode("select_skill", selectSkillNode)
  .addNode("build_prompt", buildPromptNode)
  .addNode("generate_code", generateCodeNode)
  .addNode("validate_code", validateCodeNode)
  .addNode("skip_execution_after_validation_failure", skipExecutionAfterValidationFailureNode)
  .addNode("agent_self_debug", agentSelfDebugNode)
  .addNode("validate_recovery_code", validateCodeNode)
  .addNode("execute_code", executeCodeNode)
  .addNode("abort_execution", abortExecutionNode)
  .addNode("sync_state", syncStateNode)
  .addNode("build_response", buildResponseNode)
  .addEdge(START, "parse_intent")
  .addEdge("parse_intent", "select_skill")
  .addEdge("select_skill", "build_prompt")
  .addEdge("build_prompt", "generate_code")
  .addEdge("generate_code", "validate_code")
  .addConditionalEdges("validate_code", routeAfterValidation, {
    execute_code: "execute_code",
    skip_execution_after_validation_failure: "skip_execution_after_validation_failure",
    agent_self_debug: "agent_self_debug"
  })
  .addEdge("skip_execution_after_validation_failure", "sync_state")
  .addEdge("agent_self_debug", "validate_recovery_code")
  .addConditionalEdges("validate_recovery_code", routeAfterRecoveryValidation, {
    execute_code: "execute_code",
    abort_execution: "abort_execution"
  })
  .addConditionalEdges("execute_code", routeAfterExecution, {
    sync_state: "sync_state",
    build_response: "build_response"
  })
  .addEdge("abort_execution", "build_response")
  .addEdge("sync_state", "build_response")
  .addEdge("build_response", END)
  .compile();
