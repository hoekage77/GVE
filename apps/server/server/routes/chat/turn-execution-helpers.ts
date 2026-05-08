import { broadcastEvent } from "../../ws/streaming.js";
import { appendOrchestrationTrace, setSessionStatus, updateSessionMessage } from "../../state/session.js";
import { buildAgentActivity } from "./agent-activity.js";
import { buildStructuredTurnError, extractErrorDiagnostics } from "./error-normalization.js";

export function buildAssistantMessageMeta(turnRequestId: string, turn: any, turnError: any) {
  if (!turn?.result) {
    return [
      turn?.assistantSource ? `assistantSource:${turn.assistantSource}` : null,
      turn?.assistantWarning ? "assistantWarning:true" : null
    ].filter((item): item is string => Boolean(item));
  }

  return [
    `requestId:${turnRequestId}`,
    `scene:${turn.result.sceneId}`,
    turn.result.skill ? `skill:${turn.result.skill}` : null,
    turn.result.sceneVersion ? `v${turn.result.sceneVersion}` : null,
    turnError ? `error:${turnError.code}` : null,
    turn.assistantSource ? `assistantSource:${turn.assistantSource}` : null,
    turn.assistantWarning ? "assistantWarning:true" : null
  ].filter((item): item is string => Boolean(item));
}

export function getRuntimeFailureStage(turn: any): "provisioning" | "execution" {
  const runtimeTechnicalDetail = String(
    turn?.result?.runtime?.error ?? turn?.result?.runtime?.warning ?? ""
  ).toLowerCase();
  return /(sandbox|daytona|acquire|eai_again|getaddrinfo|enotfound|dns|provision|budget exhausted)/i.test(runtimeTechnicalDetail)
    ? "provisioning"
    : "execution";
}

export function buildTurnRuntimeError(turn: any, turnRequestId: string, sessionId: string, assistantMessageId: string) {
  const turnFailed = Boolean(turn?.result?.runtime && turn.result.runtime.success === false);
  if (!turnFailed) return null;

  const runtimeFailureStage = getRuntimeFailureStage(turn);
  return buildStructuredTurnError({
    stage: runtimeFailureStage,
    errorMessage: turn.result?.runtime?.error ?? turn.result?.runtime?.warning ?? turn.assistantText,
    runtime: turn.result?.runtime ?? null,
    diagnostics: turn.result?.runtime
      ? {
          stage: runtimeFailureStage,
          requestId: turnRequestId,
          sessionId,
          messageId: assistantMessageId,
          message: turn.result?.runtime?.error ?? turn.result?.runtime?.warning ?? "Runtime execution failed",
          name: null,
          code: turn.result?.runtime?.errorCode ?? turn.result?.runtime?.status ?? null,
          status: null,
          cause: null,
          stack: null,
          timestamp: new Date().toISOString(),
          runtime: {
            status: turn.result?.runtime?.status ?? null,
            warningCode: turn.result?.runtime?.warningCode ?? null,
            acquireDiagnostics: turn.result?.runtime?.acquireDiagnostics ?? null
          }
        }
      : null
  });
}

export async function handleTurnExecutionError(params: {
  error: unknown;
  sessionId: string;
  turnRequestId: string;
  assistantMessageId: string;
  stepDurationsMs: Record<string, unknown>;
}) {
  const { error, sessionId, turnRequestId, assistantMessageId, stepDurationsMs } = params;
  const diagnostics = extractErrorDiagnostics(error, {
    stage: "turn",
    requestId: turnRequestId,
    sessionId,
    messageId: assistantMessageId
  });

  const structuredError = buildStructuredTurnError({
    stage: "turn",
    errorMessage: error instanceof Error ? error.message : "Unknown chat turn error",
    runtime: null,
    error,
    diagnostics
  });

  const assistantErrorMessage = await updateSessionMessage(sessionId, assistantMessageId, {
    content: structuredError.userMessage,
    kind: "error",
    error: structuredError,
    meta: [`error:${structuredError.code}`]
  });

  if (assistantErrorMessage) {
    broadcastEvent("message:update", {
      sessionId,
      message: assistantErrorMessage
    });
  }

  appendOrchestrationTrace(sessionId, {
    step: "turn_error",
    payload: {
      sessionId,
      error: structuredError,
      timings: {
        stepDurationsMs
      }
    }
  });
  setSessionStatus(sessionId, "idle");

  broadcastEvent("turn:error", {
    sessionId,
    requestId: turnRequestId,
    error: structuredError,
    message: structuredError.userMessage,
    timings: {
      stepDurationsMs
    }
  });

  broadcastEvent("agent:activity", buildAgentActivity({
    sessionId,
    messageId: assistantMessageId,
    step: "turn_error",
    status: "failed",
    payload: { error: structuredError.technicalDetail }
  }));
}
