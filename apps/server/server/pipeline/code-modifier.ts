import { getPool } from "../llm-pool.js";
import { parseIntentFromQuery } from "./intent-classifier.js";
import { resolveAssetPlan } from "../asset-resolver.js";
import { computeBoundedTimeoutMs, executeSkillRuntimeWithQualityDecision, resolveRuntimeExecutionTimeoutMs, shouldDegradeRuntimeFailure, buildDegradedRuntimeResult, runtimeExecutionMaxFrames } from "./runtime-executor.js";
import { buildModificationPromptBundle } from "../prompt-manager.js";
import { attemptRuntimeAgentRecovery } from "../agent-runner.js";
import { applyFallbackSceneEdit } from "../sandbox/fallback.js";
import {
  modifyRequestSchema,
  resolveRequestedQuality,
  emitPipelineProgress,
  getTurnDeadlineAtMs,
  runtimeDebugMaxIterations,
  extractCodeContent,
  describeGenerationSource
} from "./utils.js";
import { sleep } from "../lib/utils.js";

function normalizeCodeForSemanticCompare(code: any) {
  return String(code ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s+/g, "")
    .trim();
}

function splitCodeLines(code: any) {
  return String(code ?? "").split("\n");
}

export function buildLineDiffOperations(previousLines: string[], nextLines: string[]) {
  const rowCount = previousLines.length;
  const columnCount = nextLines.length;
  const matrix: number[][] = Array.from({ length: rowCount + 1 }, () => Array(columnCount + 1).fill(0));

  for (let row = rowCount - 1; row >= 0; row -= 1) {
    for (let column = columnCount - 1; column >= 0; column -= 1) {
      if (previousLines[row] === nextLines[column]) {
        matrix[row]![column] = (matrix[row + 1]![column + 1] ?? 0) + 1;
      } else {
        matrix[row]![column] = Math.max(matrix[row + 1]![column] ?? 0, matrix[row]![column + 1] ?? 0);
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

    if ((matrix[row + 1]![column] ?? 0) >= (matrix[row]![column + 1] ?? 0)) {
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

export function buildCodeDiffDetails(previousCode: any, nextCode: any) {
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

function patchAddsOnlyCommentLines(patch: any) {
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

export function detectNoopModification({ previousCode, nextCode, changeSummary, diffDetails }: any) {
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

// We will implement modifyVisual later or let the facade do it, as modifyVisual is huge and relies on `modifyCodeWithPool`.


export async function modifyVisual(input: any, options: any = {}): Promise<any> {
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
      const fallback = await applyFallbackSceneEdit(modificationState.currentCode, modificationState.instruction);
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
    onProgress: (progressEvent: any) => {
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

async function modifyCodeWithPool(state: any, options: any = {}) {
  const pool = getPool();
  const maxAttempts = pool.providers.filter((p) => p.hasApiKey).length;

  if (maxAttempts === 0) {
    const fallback = await applyFallbackSceneEdit(state.currentCode, state.instruction);
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
      const response = await fetchChatCompletionLocal(provider, {
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
    } catch (error: any) {
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
  const fallback = await applyFallbackSceneEdit(state.currentCode, state.instruction);
  pool.recordFallback();
  return {
    generatedCode: fallback.generatedCode,
    generationSource: "fallback",
    generationWarning: `All ${triedProviders.size} LLM providers exhausted; used fallback modifier.`,
    changeSummary: fallback.changeSummary,
  };
}

async function fetchChatCompletionLocal(provider: any, payload: any, options = {}) {
  const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  return response;
}