import { getPool } from "../llm/pool.js";
import { sleep, truncateDiagnostic } from "../lib/utils.js";
import { resolveAssetPlan } from "./assets.js";
import { validateCode } from "../quality/validator.js";
import { setErrorContext, clearErrorContext, getDebugTools } from "../agents/tools.js";
import { runSelfDebugSession, attemptRuntimeAgentRecovery } from "../agents/runner.js";
import { parseIntentFromQuery } from "./intent-classifier.js";
import { executeWithProviderFailover, createRetryableProviderError } from "./failover.js";
import { extractChoiceContent, shouldRequireOrbitControls, hasOrbitControlsInCode, buildFallbackGeneratedCode } from "./utils.js";
import { executeSkillRuntimeWithQualityDecision, runtimeExecutionMaxFrames, resolveRuntimeExecutionTimeoutMs, computeBoundedTimeoutMs, shouldDegradeRuntimeFailure, buildDegradedRuntimeResult, getTurnDeadlineAtMs } from "./runtime-executor.js";
import { buildGenerationPromptBundle, buildImageToCodePromptBundle } from "./prompts.js";
import { recordTokenUsage } from "../state/token-usage.js";
import { 
  moonshotModel,
  moonshotBaseUrl,
  moonshotApiKey,
  moonshotModeProfiles,
  moonshotRetryDelaysMs,
  selfDebugSessionTimeoutMs,
  selfDebugMaxIterations,
  runtimeDebugMaxIterations,
  resolveRequestedQuality,
  resolveMoonshotTemperature,
  buildValidationOptions,
  withTimeout,
  isMoonshotOverloaded,
  createMoonshotOverloadedError,
  requestSchema
} from "./utils.js";

function buildMoonshotRequestPayload(payload: any, options: any = {}) {
  const mode = options.mode ?? "thinking";
  const modeProfile = moonshotModeProfiles[mode as keyof typeof moonshotModeProfiles] ?? moonshotModeProfiles.thinking;
  const enrichedPayload = { ...payload };
  const requestModel = enrichedPayload.model ?? moonshotModel;
  const requestedTemperature = payload.temperature ?? modeProfile.temperature;

  enrichedPayload.temperature = resolveMoonshotTemperature(requestModel, requestedTemperature);

  const modeProfileWithThinking = modeProfile as { temperature: number; thinking?: boolean };

  if (mode === "instant" && modeProfileWithThinking.thinking === false) {
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

async function streamMoonshotAssistantText(response: any, onChunk: any) {
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

async function emitTextChunks(text: any, onChunk: any) {
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

async function fetchMoonshotChatCompletion(payload: any, options: any = {}) {
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
      await sleep(moonshotRetryDelaysMs[attempt] ?? 250);
      attempt += 1;
    } catch (error: any) {
      lastError = error;
      console.warn(`[Moonshot] [WARN] Fetch threw. attempt=${attempt}, error=${error instanceof Error ? error.message : String(error)}`);

      if (!isMoonshotOverloaded(error) || attempt >= moonshotRetryDelaysMs.length) {
        throw error;
      }

      await sleep(moonshotRetryDelaysMs[attempt] ?? 250);
      attempt += 1;
    }
  }

  if (isMoonshotOverloaded(lastError)) {
    throw createMoonshotOverloadedError();
  }

  throw lastError ?? new Error("Moonshot request failed.");
}

async function fetchChatCompletion(provider: any, payload: any, options: any = {}) {
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

      const error: any = new Error(`${provider.id} request failed (${response.status}): ${bodyText.slice(0, 220)}`);
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
    } catch (error: any) {
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

export async function generateCodeWithPool(state: any) {
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
    const acquired = pool.acquire({
      requireCodeGeneration: true,
      preferredProviderId: state?.request?.preferences?.provider
    });
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

      // Record token usage if the response includes it.
      if (payload?.usage) {
        recordTokenUsage(
          { providerId: provider.id, model: payload.model ?? provider.model ?? null },
          payload.usage
        );
      }
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
    } catch (error: any) {
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

export async function generateVisual(input: any, options: any = {}): Promise<any> {
  // Import generationGraph from the extracted graph module
  const { generationGraph } = await import("./graph.js");
  
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

export async function generateFromImage(input: any) {
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
      filter: { 
        requireCodeGeneration: true, 
        requireVision: true,
        preferredProviderId: input.preferences?.provider
      },
      mode: "thinking",
      retryDelays: moonshotRetryDelaysMs,
      executeProvider: async ({ provider, mode: providerMode, retryDelays }: any) => {
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
  } catch (error: any) {
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

function extractCodeContent(rawContent: unknown): string {
  if (!rawContent || typeof rawContent !== "string") {
    return "";
  }

  const fencedBlock = rawContent.match(/```(?:[a-z0-9_-]+)?\s*([\s\S]*?)```/i);
  const output = fencedBlock ? fencedBlock[1] : rawContent;
  return (output ?? "").trim();
}