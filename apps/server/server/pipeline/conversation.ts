// @ts-nocheck
import { getPool } from "../llm-pool.js";

import { executeWithProviderFailover, buildLlmSourceMetadata } from "./failover.js";

import { parseIntentFromQuery, applySessionAwareIntentOverrides } from "./intent-classifier.js";

export async function generateThinkingAnalysis(query: any, sessionContext = {}, options = {}) {
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

export async function generatePostTurnNarration(turnResult: any, query: any, options = {}) {
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

export async function resolveChatTurn(request: any, sessionState: any, options = {}) {
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

function extractChoiceContent(rawContent: any) {
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