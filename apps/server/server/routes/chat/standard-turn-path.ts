import {
  appendOrchestrationTrace,
  appendSessionMessage,
  buildSceneUpdatePayload,
  listSessionMessages,
  recordSceneVersion,
  setSessionStatus,
  updateSessionMessage
} from "../../state/session.js";
import { broadcastCodeStream, broadcastEvent, broadcastThought } from "../../ws/streaming.js";
import { buildAgentActivity } from "./agent-activity.js";
import { buildTurnRuntimeError, buildAssistantMessageMeta } from "./turn-execution-helpers.js";
import { buildTurnLifecyclePayload, buildTurnResultSummary } from "./turn-summary.js";

type StepStatus = "running" | "completed" | "failed";
type OnStepInput = { step: string; status?: StepStatus; payload?: Record<string, unknown> };
type ResolveHandlers = {
  onAssistantChunk?: (chunk: unknown, runningText: string) => Promise<void> | void;
  onStep?: (input: OnStepInput) => void;
};

type TurnPlan = { planId?: string; summary?: string; tasks: unknown[] };
type ResolvedTurn = {
  mode: string;
  assistantText: string;
  parsedIntent?: unknown;
  assistantSource?: string | null;
  assistantWarning?: boolean | null;
  assistantLlm?: string | null;
  result?: any;
};

export type StandardTurnResult = {
  sessionId: string;
  mode: string;
  intent?: unknown;
  assistantSource: string | null;
  assistantWarning: boolean | null;
  assistantLlm: string | null;
  userMessage: unknown;
  assistantMessage: unknown;
  sceneState: unknown;
  messages: unknown;
  result: unknown;
  turnSummary: unknown;
  stepDurationsMs: Record<string, number>;
};

export async function executeStandardTurnPath(params: {
  sessionId: string;
  content: string;
  plan: TurnPlan;
  effectivePreferences: Record<string, unknown>;
  sessionState: any;
  assistantMessageId: string;
  turnRequestId: string;
  thoughtContextBase: Record<string, unknown>;
  llmThoughts: unknown;
  userMessage: unknown;
  resolveChatTurn: (input: unknown, sessionState: unknown, handlers: ResolveHandlers) => Promise<ResolvedTurn>;
  generatePostTurnNarration: (input: unknown, content: string, options: { fastMode: boolean; provider?: string }) => Promise<string | null>;
  postTurnNarrationEnabled: boolean;
  fastModeEnabled: boolean;
}): Promise<StandardTurnResult> {
  const {
    sessionId,
    content,
    plan,
    effectivePreferences,
    sessionState,
    assistantMessageId,
    turnRequestId,
    thoughtContextBase,
    llmThoughts,
    userMessage,
    resolveChatTurn,
    generatePostTurnNarration,
    postTurnNarrationEnabled,
    fastModeEnabled
  } = params;

  const stepStartedAtMs = new Map();
  const stepDurationsMs: Record<string, number> = {};
  let assistantContent = "";
  let streamedCodePromise = Promise.resolve();
  let hasStreamedCode = false;

  const parsedIntentPreview = plan.summary?.includes("threejs")
    ? "threejs"
    : plan.summary?.includes("p5js")
      ? "p5js"
      : plan.summary?.includes("d3js")
        ? "d3js"
        : plan.summary?.includes("animejs")
          ? "animejs"
          : "threejs";
  await broadcastThought(sessionId, "intent_parsed", {
    ...thoughtContextBase,
    query: content,
    domain: plan.summary?.includes("3d") || plan.summary?.includes("3D") ? "3D" : "visual",
    intentType: "create",
    skill: parsedIntentPreview,
    llmThoughts
  });

  await broadcastThought(sessionId, "plan_created", {
    ...thoughtContextBase,
    taskCount: plan.tasks.length,
    query: content,
    llmThoughts
  });

  broadcastEvent("orchestration:plan", {
    sessionId,
    planId: plan.planId,
    tasks: plan.tasks
  });

  const turn = await resolveChatTurn(
    { query: content, sessionId, preferences: effectivePreferences },
    sessionState,
    {
      onAssistantChunk: async (_, runningText) => {
        assistantContent = runningText;
        const streamedMessage = updateSessionMessage(sessionId, assistantMessageId, {
          content: assistantContent,
          kind: "streaming"
        });
        if (streamedMessage) broadcastEvent("message:update", { sessionId, message: streamedMessage });
      },
      onStep: ({ step, status = "running", payload = {} }: OnStepInput) => {
        const now = Date.now();
        if (status === "running") stepStartedAtMs.set(step, now);
        const startedAt = stepStartedAtMs.get(step);
        const stageDurationMs = startedAt && status !== "running" ? Math.max(0, now - startedAt) : null;
        if (stageDurationMs !== null) stepDurationsMs[step] = stageDurationMs;

        const payloadWithTiming = stageDurationMs !== null ? { ...payload, stageDurationMs } : payload;
        if (step === "generate_code" && status === "completed" && typeof (payload as any)?.code === "string") {
          hasStreamedCode = true;
          streamedCodePromise = broadcastCodeStream(sessionId, (payload as any).code, {
            messageId: assistantMessageId,
            mode: (payload as any)?.mode === "modify" ? "modify" : "generate"
          }).catch(() => {});
        }

        appendOrchestrationTrace(sessionId, {
          step,
          payload: { sessionId, status, ...payloadWithTiming }
        });
        broadcastEvent("orchestration:step", {
          requestId: turnRequestId,
          step,
          status,
          payload: { sessionId, ...payloadWithTiming }
        });
        broadcastEvent("agent:activity", buildAgentActivity({
          sessionId,
          messageId: assistantMessageId,
          step,
          status,
          payload: payloadWithTiming
        }));
      }
    }
  );

  let nextSessionState = sessionState;
  if (turn.result && (turn.mode === "generate" || turn.mode === "modify")) {
    if (!hasStreamedCode && typeof turn.result.code === "string") {
      hasStreamedCode = true;
      streamedCodePromise = broadcastCodeStream(sessionId, turn.result.code, {
        messageId: assistantMessageId,
        mode: turn.mode,
        diff: turn.result.diff ?? null
      }).catch(() => {});
    }

    await streamedCodePromise;

    await broadcastThought(sessionId, turn.mode === "generate" ? "code_generated" : "code_modified", {
      ...thoughtContextBase,
      query: content,
      skill: turn.result.skill,
      llmThoughts,
      stageDurationMs: stepDurationsMs["generate_code"] ?? null
    });
    setSessionStatus(sessionId, "generating");

    broadcastEvent(turn.mode === "generate" ? "generation:started" : "code:started", {
      sessionId,
      query: content,
      mode: turn.mode
    });

    const isRejectedNoopModify = turn.mode === "modify" && turn.result?.modifyOutcome === "rejected_noop";
    if (!isRejectedNoopModify) {
      nextSessionState = recordSceneVersion(sessionId, {
        sceneId: turn.result.sceneId,
        code: turn.result.code,
        previewUrl: turn.result.previewUrl,
        skill: turn.result.skill,
        outputKind: turn.result.outputKind ?? turn.result.runtime?.outputKind ?? null,
        mediaType: turn.result.mediaType ?? turn.result.runtime?.mediaType ?? null,
        mediaUrl: turn.result.mediaUrl ?? turn.result.runtime?.mediaUrl ?? null,
        mediaArtifactId: turn.result.mediaArtifactId ?? turn.result.runtime?.mediaArtifactId ?? null,
        mediaDurationMs: turn.result.mediaDurationMs ?? turn.result.runtime?.mediaDurationMs ?? null,
        mediaFps: turn.result.mediaFps ?? turn.result.runtime?.mediaFps ?? null,
        mediaResolution: turn.result.mediaResolution ?? turn.result.runtime?.mediaResolution ?? null,
        mediaBytes: turn.result.mediaBytes ?? turn.result.runtime?.mediaBytes ?? null,
        assetPlan: turn.result.assetPlan ?? null,
        explanation: turn.result.explanation,
        source: turn.mode,
        messageId: assistantMessageId
      });

      broadcastEvent("scene:update", buildSceneUpdatePayload(nextSessionState));
    }

    if (!isRejectedNoopModify) {
      await broadcastThought(sessionId, "executing", {
        ...thoughtContextBase,
        query: content,
        skill: turn.result.skill,
        llmThoughts,
        stageDurationMs: stepDurationsMs["execute_code"] ?? null
      });
      setSessionStatus(sessionId, "executing");
    }

    await broadcastThought(sessionId, "sync_state", {
      ...thoughtContextBase,
      query: content,
      skill: turn.result.skill,
      llmThoughts,
      stageDurationMs: stepDurationsMs["sync_state"] ?? null
    });

    // Update the assistant message early with scene metadata so the artifact appears in chat immediately
    const earlyAssistantMessage = updateSessionMessage(sessionId, assistantMessageId, {
      kind: turn.mode,
      meta: buildAssistantMessageMeta(turnRequestId, turn, null)
    });
    if (earlyAssistantMessage) {
      broadcastEvent("message:update", { sessionId, message: earlyAssistantMessage });
    }

    broadcastEvent(turn.mode === "generate" ? "generation:complete" : "code:update", {
      sessionId,
      sceneId: turn.result.sceneId,
      previewUrl: turn.result.previewUrl,
      outputKind: turn.result.outputKind ?? turn.result.runtime?.outputKind ?? null,
      mediaType: turn.result.mediaType ?? turn.result.runtime?.mediaType ?? null,
      mediaUrl: turn.result.mediaUrl ?? turn.result.runtime?.mediaUrl ?? null,
      mediaArtifactId: turn.result.mediaArtifactId ?? turn.result.runtime?.mediaArtifactId ?? null,
      mediaDurationMs: turn.result.mediaDurationMs ?? turn.result.runtime?.mediaDurationMs ?? null,
      mediaFps: turn.result.mediaFps ?? turn.result.runtime?.mediaFps ?? null,
      mediaResolution: turn.result.mediaResolution ?? turn.result.runtime?.mediaResolution ?? null,
      mediaBytes: turn.result.mediaBytes ?? turn.result.runtime?.mediaBytes ?? null,
      skill: turn.result.skill,
      code: turn.result.code,
      diff: turn.result.diff ?? null,
      sceneVersion: nextSessionState.currentScene?.version ?? 0,
      mode: turn.mode,
      explanation: turn.result.explanation,
      modifyOutcome: turn.result.modifyOutcome ?? null,
    });
  }

  const turnFailed = Boolean(turn.result?.runtime && turn.result.runtime.success === false);
  const turnSummary = buildTurnResultSummary(turn.mode, turn.result, nextSessionState, {
    assistantSource: turn.assistantSource ?? null,
    assistantWarning: turn.assistantWarning ?? null,
    assistantLlm: turn.assistantLlm ?? null
  });
  const turnError = turnFailed ? buildTurnRuntimeError(turn, turnRequestId, sessionId, assistantMessageId) : null;

  const assistantMessage = updateSessionMessage(sessionId, assistantMessageId, {
    content: turn.assistantText,
    kind: turn.mode,
    error: turnError,
    meta: buildAssistantMessageMeta(turnRequestId, turn, turnError)
  }) ?? appendSessionMessage(sessionId, {
    id: assistantMessageId,
    role: "assistant",
    content: turn.assistantText,
    kind: turn.mode,
    error: turnError,
    meta: buildAssistantMessageMeta(turnRequestId, turn, turnError)
  });

  broadcastEvent("message.append", { sessionId, message: assistantMessage });
  const turnEventType = turnFailed ? "turn:error" : "turn:complete";
  await broadcastThought(sessionId, turnFailed ? "turn_error" : "turn_complete", {
    ...thoughtContextBase,
    query: content,
    error: turnFailed ? turn.result?.runtime?.error ?? "" : "",
    llmThoughts
  });

  if (postTurnNarrationEnabled && !turnFailed && (turn.mode === "generate" || turn.mode === "modify")) {
    void (async () => {
      try {
        const postNarration = await generatePostTurnNarration({ result: turn.result }, content, { 
          fastMode: fastModeEnabled,
          provider: effectivePreferences?.provider as string | undefined 
        });
        if (postNarration) {
          await broadcastThought(sessionId, "post_narration", {
            ...thoughtContextBase,
            query: content,
            llmThoughts: { complete: postNarration }
          });
        }
      } catch (error) {
        console.warn(`[Turn] [TRACE] Post-turn narration skipped: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    })();
  }

  broadcastEvent(turnEventType, {
    sessionId,
    requestId: turnRequestId,
    mode: turn.mode,
    messageCount: listSessionMessages(sessionId).length,
    ...buildTurnLifecyclePayload(turnSummary),
    timings: { stepDurationsMs },
    error: turnFailed ? turnError : null,
    message: turnFailed ? turnError?.userMessage ?? turn.result?.runtime?.error ?? "Turn failed" : null
  });
  broadcastEvent("agent:activity", buildAgentActivity({
    sessionId,
    messageId: assistantMessageId,
    step: turnFailed ? "turn_error" : "turn_complete",
    status: turnFailed ? "failed" : "completed",
    payload: turnFailed ? { error: turnError?.technicalDetail ?? "Turn failed" } : {}
  }));

  appendOrchestrationTrace(sessionId, {
    step: turnFailed ? "turn_error" : "turn_complete",
    payload: {
      sessionId,
      mode: turn.mode,
      messageCount: listSessionMessages(sessionId).length,
      error: turnFailed ? turnError : null
    }
  });
  setSessionStatus(sessionId, "idle");

  return {
    sessionId,
    mode: turn.mode,
    intent: turn.parsedIntent,
    assistantSource: turn.assistantSource ?? null,
    assistantWarning: turn.assistantWarning ?? null,
    assistantLlm: turn.assistantLlm ?? null,
    userMessage,
    assistantMessage,
    sceneState: nextSessionState,
    messages: listSessionMessages(sessionId),
    result: turn.result,
    turnSummary,
    stepDurationsMs
  };
}
