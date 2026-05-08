import {
  appendOrchestrationTrace,
  appendSessionMessage,
  listSessionMessages,
  recordSceneVersion,
  buildSceneUpdatePayload,
  setSessionStatus,
  updateSessionMessage
} from "../../state/session.js";
import { broadcastEvent, broadcastThought } from "../../ws/streaming.js";
import { buildAgentActivity } from "./agent-activity.js";
import { buildAssistantMessageMeta } from "./turn-execution-helpers.js";
import { buildTurnLifecyclePayload, buildTurnResultSummary } from "./turn-summary.js";
import { executeToolTurn, createLlmProvider, type CoordinatorEvent } from "../../coordinator/tool-coordinator.js";

export type AgentTurnParams = {
  sessionId: string;
  content: string;
  imageUrl: string | null;
  imageData: string | null;
  sessionState: any;
  effectivePreferences: Record<string, unknown>;
  assistantMessageId: string;
  turnRequestId: string;
  userMessage: unknown;
};

/**
 * Agent turn path — routes to the tool-using coordinator with live streaming.
 *
 * Every coordinator event is mapped to existing broadcast primitives so the
 * frontend sees real-time progress without any new WebSocket handler code.
 *
 * Phase 2: Records scene versions and emits standard events (scene:update,
 * generation:complete, code:update) so the frontend preview panel works.
 */
export async function executeAgentTurnPath(params: AgentTurnParams) {
  const {
    sessionId,
    content,
    imageUrl,
    imageData,
    sessionState,
    effectivePreferences,
    assistantMessageId,
    turnRequestId,
    userMessage
  } = params;

  const thoughtContextBase = { requestId: turnRequestId, messageId: assistantMessageId };
  const stepDurationsMs: Record<string, number> = {};

  // Build user message for coordinator (text or multimodal)
  let coordinatorUserMessage: string | Array<any> = content;
  if (imageUrl || imageData) {
    const resolvedImageUrl = imageUrl || (imageData ? `data:image/png;base64,${imageData}` : null);
    if (resolvedImageUrl) {
      coordinatorUserMessage = [
        { type: "text", text: content },
        { type: "image_url", image_url: { url: resolvedImageUrl, detail: "low" } }
      ];
    }
  }

  // Mode hint for modify — include current scene code so the LLM knows what to change
  const forcedMode = String(effectivePreferences?.mode ?? "").trim().toLowerCase();
  if (forcedMode === "modify" && typeof coordinatorUserMessage === "string") {
    const currentCode = sessionState?.currentScene?.code ?? "";
    coordinatorUserMessage = `[MODE: MODIFY] The user wants to modify the existing scene. Do NOT create a new scene unless explicitly asked. Preserve existing functionality and only change what is requested.\n\nCurrent scene code:\n\`\`\`javascript\n${currentCode}\n\`\`\`\n\nUser instruction: ${coordinatorUserMessage}`;
  }

  // ── Start ──
  broadcastEvent("turn:started", { sessionId, content, mode: "agent" });
  broadcastEvent("agent:activity", buildAgentActivity({
    sessionId,
    messageId: assistantMessageId,
    step: "agent_thinking",
    status: "running",
    payload: { content }
  }));

  await broadcastThought(sessionId, "turn_started", {
    ...thoughtContextBase,
    query: content,
    llmThoughts: null
  });

  setSessionStatus(sessionId, "planning" as any);
  const agentStart = Date.now();

  // ── Provision sandbox for tool calls ──
  // When SKILL_RUNTIME=daytona, use Daytona sandboxes for all file/shell
  // operations. Otherwise, fall back to local Docker containers.
  const skillRuntime = process.env.SKILL_RUNTIME ?? "docker";
  const useDaytona = skillRuntime === "daytona";
  let dedicatedKey: string | null = null;
  let daytonaEnv: any = null;

  if (useDaytona) {
    try {
      const { getDedicatedSandboxInstance } = await import(
        "../../sandbox/dedicated-manager.js"
      );
      const { createSandboxFileSystem } = await import(
        "@visual-runtime/sandbox-pool"
      );
      const { setWorkspace: setDaytonaWs } = await import(
        "../../sandbox/daytona-workspace-store.js"
      );
      const dedicatedMgr = getDedicatedSandboxInstance();
      if (dedicatedMgr) {
        dedicatedKey = `session:${sessionId}`;
        daytonaEnv = await dedicatedMgr.acquireForKey(dedicatedKey, {
          skillId: "manim",
        });
        const filesystem = createSandboxFileSystem(
          daytonaEnv.workspaceId,
          daytonaEnv._workspace
        );
        setDaytonaWs(sessionId, {
          workspaceId: daytonaEnv.workspaceId,
          workspace: daytonaEnv._workspace,
          filesystem,
          executeCommand: async (command: string, opts?: { timeoutMs?: number }) => {
            const raw = await daytonaEnv._workspace.process.executeCommand(
              command,
              undefined,
              undefined,
              Math.ceil((opts?.timeoutMs ?? 30000) / 1000)
            );
            // Daytona SDK returns { result, exitCode }, not a plain string
            return String(raw?.result ?? raw ?? "");
          },
        });
        console.log(
          `[AgentTurn] Provisioned Daytona sandbox for ${sessionId}: workspace=${daytonaEnv.workspaceId}`
        );
      }
    } catch (daytonaErr: any) {
      console.warn(
        `[AgentTurn] Daytona provisioning failed for ${sessionId}, falling back to Docker: ${daytonaErr?.message ?? daytonaErr}`
      );
    }
  }

  if (!useDaytona || !daytonaEnv) {
    const { createSandbox, activeContainers } = await import(
      "../../sandbox/manager.js"
    );
    if (!activeContainers.has(sessionId)) {
      try {
        const containerInfo = await createSandbox({
          sessionId,
          keepAlive: true,
        });
        try {
          const { exec: _exec } = await import("child_process");
          const { promisify: _prom } = await import("util");
          await _prom(_exec)(
            `chmod -R 777 "${containerInfo.workspacePath}"`
          );
        } catch (permErr: any) {
          console.warn(
            `[AgentTurn] chmod workspace failed (non-fatal): ${permErr?.message ?? permErr}`
          );
        }
        console.log(
          `[AgentTurn] Provisioned Docker sandbox for ${sessionId}: container=${containerInfo.containerId.slice(0, 8)}`
        );
      } catch (sandboxErr: any) {
        console.warn(
          `[AgentTurn] Failed to provision sandbox for ${sessionId}: ${sandboxErr?.message ?? sandboxErr}`
        );
      }
    }
  }

  let recordedScene: any = null;

  // ── Execute tool turn with live event streaming ──
  const result = await executeToolTurn({
    sessionId,
    userMessage: coordinatorUserMessage,
    llmProvider: createLlmProvider({
      preferredProviderId: effectivePreferences?.provider as string | undefined,
      onToken: (token: string) => {
        broadcastEvent("message.append", {
          sessionId,
          message: {
            id: assistantMessageId,
            role: "assistant",
            content: token,
            kind: "streaming"
          }
        });
      }
    }),
    maxToolCalls: 5,
    onEvent: async (event: CoordinatorEvent) => {
      switch (event.type) {
        case "coordinator:thinking": {
          await broadcastThought(sessionId, "agent_thinking", {
            ...thoughtContextBase,
            query: content,
            detail: `Iteration ${event.payload.iteration}`,
            llmThoughts: null
          });
          break;
        }

        case "coordinator:tool_call": {
          await broadcastThought(sessionId, "agent_tool_called", {
            ...thoughtContextBase,
            query: content,
            toolName: event.payload.name,
            llmThoughts: null
          });
          broadcastEvent("agent:activity", buildAgentActivity({
            sessionId,
            messageId: assistantMessageId,
            step: `tool_call_${event.payload.name}`,
            status: "running",
            payload: { tool: event.payload.name, callId: event.payload.callId }
          }));
          break;
        }

        case "coordinator:tool_result": {
          const status = event.payload.success ? "completed" : "failed";
          await broadcastThought(sessionId, event.payload.success ? "agent_tool_result" : "turn_error", {
            ...thoughtContextBase,
            query: content,
            toolName: event.payload.name,
            detail: event.payload.output.slice(0, 200),
            llmThoughts: null
          });
          broadcastEvent("agent:activity", buildAgentActivity({
            sessionId,
            messageId: assistantMessageId,
            step: `tool_result_${event.payload.name}`,
            status,
            payload: {
              tool: event.payload.name,
              callId: event.payload.callId,
              success: event.payload.success,
              durationMs: event.payload.durationMs
            }
          }));

          // Also emit raw tool:result for any direct consumers
          broadcastEvent("tool:result", {
            sessionId,
            callId: event.payload.callId,
            tool: event.payload.name,
            success: event.payload.success,
            output: event.payload.output,
            durationMs: event.payload.durationMs
          });

          // Extract scene code from animation tool results and record scene version.
          // Matches animation_3js, animation_p5js, animation_manim tool outputs.
          const animToolName = event.payload.name;
          const isAnimationTool =
            animToolName.startsWith("animation_") ||
            animToolName === "create_scene" ||
            animToolName === "edit_scene";
          if (event.payload.success && isAnimationTool) {
            try {
              const parsed = JSON.parse(event.payload.output);
              const hasCode = Boolean(parsed.code);
              const hasMedia = Boolean(parsed.media_url || parsed.preview_url);
              if (hasCode || hasMedia) {
                const sceneSnapshot = {
                  sceneId: parsed.file_path ?? `scene-${Date.now()}`,
                  code: parsed.code ?? "",
                  previewUrl: parsed.media_url ?? parsed.preview_url ?? null,
                  outputKind: parsed.outputKind ?? (hasCode ? "code" : hasMedia ? "media" : null),
                  skill: animToolName.includes("manim") ? "manim" : animToolName.includes("p5") ? "p5js" : "threejs",
                  explanation: parsed.description ?? content,
                  source: forcedMode === "modify" ? "modify" : "generate",
                  messageId: assistantMessageId
                };
                recordedScene = recordSceneVersion(sessionId, sceneSnapshot);
                broadcastEvent("scene:update", buildSceneUpdatePayload(sessionId));
              }
            } catch {
              // Not JSON — ignore
            }
          }
          break;
        }

        case "coordinator:file_complete": {
          broadcastEvent("agent:file_complete", {
            sessionId,
            path: event.payload.path,
            previewUrl: event.payload.previewUrl,
            lines: event.payload.lines ?? 0
          });
          broadcastEvent("agent:activity", buildAgentActivity({
            sessionId,
            messageId: assistantMessageId,
            step: "file_complete",
            status: "completed",
            payload: {
              path: event.payload.path,
              previewUrl: event.payload.previewUrl,
              lines: event.payload.lines
            }
          }));
          break;
        }

        case "coordinator:complete": {
          stepDurationsMs.agent = Date.now() - agentStart;
          await broadcastThought(sessionId, "turn_complete", {
            ...thoughtContextBase,
            query: content,
            detail: `${event.payload.totalToolCalls} tool calls across ${event.payload.iterations} iteration(s)`,
            llmThoughts: null
          });
          break;
        }

        case "coordinator:error": {
          stepDurationsMs.agent = Date.now() - agentStart;
          await broadcastThought(sessionId, "turn_error", {
            ...thoughtContextBase,
            query: content,
            error: event.payload.error,
            llmThoughts: null
          });
          break;
        }
      }
    }
  });

  // Ensure step duration is recorded even if no complete event fired
  if (!stepDurationsMs.agent) {
    stepDurationsMs.agent = Date.now() - agentStart;
  }

  let assistantText = result.response ?? "";

  // If a scene was recorded, always present a clean scene description.
  // The LLM may return raw tool_call XML/JSON which is not user-friendly.
  if (recordedScene?.currentScene?.code) {
    const sceneDesc = recordedScene.currentScene.explanation ?? recordedScene.currentScene.sceneId ?? "scene";
    assistantText = `${sceneDesc}\n\nPreview is available in the workspace.`;
  } else if (!assistantText || assistantText === "No response generated.") {
    const failedTools = (result.toolResults ?? []).filter((t: any) => !t.success);
    if (failedTools.length > 0) {
      const failures = failedTools
        .map((t: any) => {
          const toolName = String(t.callId ?? "")
            .replace(/^functions\./, "")
            .replace(/:\d+$/, "");
          return `- **${toolName || "tool"}**: ${t.output}`;
        })
        .join("\n");
      assistantText = [
        `I attempted to run ${result.toolCalls?.length ?? 0} tool call(s) but ${failedTools.length} failed:\n`,
        failures,
        "",
        "This may indicate a sandbox configuration or permissions issue.",
      ].join("\n");
    } else if (result.error) {
      assistantText = `Agent encountered an error: ${result.error}`;
    } else {
      assistantText = "No response generated.";
    }
  }

  // ── Finalize assistant message ──
  const turnResult = {
    sceneId: recordedScene?.currentScene?.sceneId ?? null,
    skill: recordedScene?.currentScene?.skill ?? null,
    sceneVersion: recordedScene?.currentScene?.version ?? null,
    previewUrl: recordedScene?.currentScene?.previewUrl ?? null,
    outputKind: recordedScene?.currentScene?.outputKind ?? null
  };

  const assistantMessage = await updateSessionMessage(sessionId, assistantMessageId, {
    content: assistantText,
    kind: forcedMode === "modify" ? "modify" : "agent",
    error: result.success ? null : { message: result.error },
    meta: buildAssistantMessageMeta(turnRequestId, {
      mode: forcedMode === "modify" ? "modify" : "agent",
      assistantSource: "agent-coordinator",
      result: result.success ? turnResult : null
    }, null)
  }) ?? await appendSessionMessage(sessionId, {
    id: assistantMessageId,
    role: "assistant",
    content: assistantText,
    kind: forcedMode === "modify" ? "modify" : "agent",
    error: result.success ? null : { message: result.error },
    meta: buildAssistantMessageMeta(turnRequestId, {
      mode: forcedMode === "modify" ? "modify" : "agent",
      assistantSource: "agent-coordinator",
      result: result.success ? turnResult : null
    }, null)
  });

  broadcastEvent("message.append", { sessionId, message: assistantMessage });

  // Emit generation / code events if a scene was recorded
  if (recordedScene && recordedScene.currentScene) {
    const isModify = forcedMode === "modify";
    broadcastEvent(isModify ? "code:update" : "generation:complete", {
      sessionId,
      sceneId: recordedScene.currentScene.sceneId,
      previewUrl: recordedScene.currentScene.previewUrl,
      skill: recordedScene.currentScene.skill,
      code: recordedScene.currentScene.code,
      sceneVersion: recordedScene.currentScene.version ?? 0,
      mode: isModify ? "modify" : "generate",
      explanation: recordedScene.currentScene.explanation ?? assistantText
    });
  }

  // ── Turn summary ──
  const turnSummary = buildTurnResultSummary(
    forcedMode === "modify" ? "modify" : "agent",
    result.success ? { ...turnResult, code: recordedScene?.currentScene?.code ?? null, outputKind: recordedScene?.currentScene?.outputKind ?? null } : null,
    sessionState,
    {
      assistantSource: "agent-coordinator",
      assistantWarning: null,
      assistantLlm: null
    }
  );

  await broadcastThought(sessionId, "turn_complete", {
    ...thoughtContextBase,
    query: content,
    llmThoughts: null
  });

  appendOrchestrationTrace(sessionId, {
    step: "turn_complete",
    payload: {
      sessionId,
      mode: forcedMode === "modify" ? "modify" : "agent",
      messageCount: listSessionMessages(sessionId).length,
      toolCalls: result.toolCalls.length,
      toolResults: result.toolResults.length,
      agentSuccess: result.success,
      agentError: result.error ?? null,
      durationMs: stepDurationsMs.agent
    }
  });

  setSessionStatus(sessionId, "idle");

  const turnEventType = result.success ? "turn:complete" : "turn:error";

  broadcastEvent(turnEventType, {
    sessionId,
    requestId: turnRequestId,
    mode: forcedMode === "modify" ? "modify" : "agent",
    messageCount: listSessionMessages(sessionId).length,
    ...buildTurnLifecyclePayload(turnSummary),
    timings: { stepDurationsMs },
    error: result.success ? null : { message: result.error },
    message: result.success ? null : (result.error ?? "Agent turn failed"),
    agentMeta: {
      toolCalls: result.toolCalls.length,
      toolResults: result.toolResults.length
    }
  });

  broadcastEvent("agent:activity", buildAgentActivity({
    sessionId,
    messageId: assistantMessageId,
    step: "turn_complete",
    status: result.success ? "completed" : "failed",
    payload: result.success ? {} : { error: result.error }
  }));

  // ── Release Daytona workspace ──
  if (dedicatedKey && daytonaEnv) {
    try {
      const { removeWorkspace: removeDaytonaWs } = await import(
        "../../sandbox/daytona-workspace-store.js"
      );
      const { getDedicatedSandboxInstance } = await import(
        "../../sandbox/dedicated-manager.js"
      );
      const dedicatedMgr = getDedicatedSandboxInstance();
      if (dedicatedMgr) {
        await dedicatedMgr.releaseForKey(dedicatedKey, daytonaEnv);
      }
      removeDaytonaWs(sessionId);
    } catch (releaseErr: any) {
      console.warn(
        `[AgentTurn] Daytona release failed (non-fatal): ${releaseErr?.message ?? releaseErr}`
      );
    }
  }

  return {
    sessionId,
    mode: forcedMode === "modify" ? "modify" : "agent",
    intent: null,
    assistantSource: "agent-coordinator" as string | null,
    assistantWarning: null as boolean | null,
    assistantLlm: null as string | null,
    userMessage,
    assistantMessage,
    sceneState: recordedScene ?? sessionState,
    messages: listSessionMessages(sessionId),
    result: {
      toolCalls: result.toolCalls,
      toolResults: result.toolResults,
      agentSuccess: result.success,
      agentError: result.error ?? null,
      sceneId: turnResult.sceneId,
      code: recordedScene?.currentScene?.code ?? null
    },
    turnSummary,
    stepDurationsMs
  };
}
