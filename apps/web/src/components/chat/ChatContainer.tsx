import { useMemo, useRef, useEffect, useState, useCallback, type CSSProperties } from "react";
import { UserMessage, AIMessage } from "./MessageComponents";
import { Composer } from "./Composer";
import { useChatStore, type Session, type SessionMessage } from "../../stores";
import { Send } from "lucide-react";
import WorkspacePanel from "../workspace/WorkspacePanel";
import TaskStatusBar from "./TaskStatusBar";

// Types for message grouping
type ThoughtItem = {
  text: string;
  step: string;
  timestamp: number;
};

type DisplayMessage = {
  message: SessionMessage;
  thoughts: ThoughtItem[];
  sceneId?: string;
  promptContext?: string;
};

type SceneVersionRecord = NonNullable<Session["currentScene"]>;

const RUNTIME_DIAGNOSTIC_PATTERNS = [
  "Generated through LangGraph",
  "orchestration pipeline",
  "local fallback pipeline",
  "Runtime: degraded",
  "Runtime recovery skipped",
  "sandbox provisioning constraints",
  "Runtime execution timed out",
  "Generated via",
  "Failure details:"
];

function looksLikeRuntimeDiagnostic(content: string): boolean {
  const normalized = String(content ?? "").trim();
  if (!normalized) {
    return false;
  }

  return RUNTIME_DIAGNOSTIC_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function buildAnimationDescription(promptContext: string | undefined, sceneId: string | undefined): string {
  const prompt = String(promptContext ?? "").trim().replace(/\s+/g, " ");
  if (prompt.length > 0) {
    const normalized = prompt.replace(/[.?!]+$/, "");
    return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}.`;
  }

  if (sceneId) {
    return `Generated animation scene ${sceneId}.`;
  }

  return "Generated animation scene.";
}

function getAssistantDisplayContent(
  content: string,
  promptContext: string | undefined,
  sceneId: string | undefined
): string {
  if (!looksLikeRuntimeDiagnostic(content)) {
    return content;
  }

  return buildAnimationDescription(promptContext, sceneId);
}

function getMetaValue(meta: string[] | undefined, prefix: string): string | null {
  if (!Array.isArray(meta)) {
    return null;
  }

  const matched = meta.find((entry) => entry.startsWith(prefix));
  if (!matched) {
    return null;
  }

  const parsed = matched.slice(prefix.length).trim();
  return parsed || null;
}

function compactSceneName(sceneId: string | null | undefined): string {
  const normalized = String(sceneId ?? "").trim();
  if (!normalized) {
    return "Live Chat";
  }

  if (normalized.length <= 16) {
    return normalized;
  }

  if (normalized.startsWith("scene-")) {
    return `scene-${normalized.slice(-6)}`;
  }

  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
}

function toThought(message: SessionMessage): ThoughtItem {
  return {
    text: message.content,
    step: message.meta?.[0] ?? message.kind ?? "thought",
    timestamp: Date.parse(message.createdAt)
  };
}

function buildDisplayMessages(messages: SessionMessage[]): DisplayMessage[] {
  const displayMessages: DisplayMessage[] = [];
  const assistantIndexByMessageId = new Map<string, number>();
  const assistantIndexByRequestId = new Map<string, number>();
  const deferredThoughtsByMessageId = new Map<string, ThoughtItem[]>();
  const deferredThoughtsByRequestId = new Map<string, ThoughtItem[]>();
  const orphanThoughts: ThoughtItem[] = [];
  let fallbackAssistantIndex: number | null = null;
  let latestUserPrompt: string | undefined;

  const pushDeferredThought = (bucket: Map<string, ThoughtItem[]>, key: string, thought: ThoughtItem) => {
    const existing = bucket.get(key);
    if (existing) {
      existing.push(thought);
      return;
    }
    bucket.set(key, [thought]);
  };

  const attachThought = (index: number | null, thought: ThoughtItem): boolean => {
    if (index === null || index < 0 || index >= displayMessages.length) {
      return false;
    }
    displayMessages[index].thoughts.push(thought);
    return true;
  };

  const attachDeferredToAssistant = (index: number, messageId: string, requestId: string | null) => {
    const deferredByMessage = deferredThoughtsByMessageId.get(messageId);
    if (deferredByMessage?.length) {
      displayMessages[index].thoughts.push(...deferredByMessage);
      deferredThoughtsByMessageId.delete(messageId);
    }

    if (requestId) {
      const deferredByRequest = deferredThoughtsByRequestId.get(requestId);
      if (deferredByRequest?.length) {
        displayMessages[index].thoughts.push(...deferredByRequest);
        deferredThoughtsByRequestId.delete(requestId);
      }
    }

    if (orphanThoughts.length > 0) {
      displayMessages[index].thoughts.push(...orphanThoughts);
      orphanThoughts.length = 0;
    }
  };

  for (const message of messages) {
    if (message.role === "thought" || message.kind === "thought") {
      const thought = toThought(message);
      const thoughtMessageId = getMetaValue(message.meta, "messageId:");
      const thoughtRequestId = getMetaValue(message.meta, "requestId:");

      if (thoughtMessageId && assistantIndexByMessageId.has(thoughtMessageId)) {
        attachThought(assistantIndexByMessageId.get(thoughtMessageId) ?? null, thought);
        continue;
      }

      if (thoughtRequestId && assistantIndexByRequestId.has(thoughtRequestId)) {
        attachThought(assistantIndexByRequestId.get(thoughtRequestId) ?? null, thought);
        continue;
      }

      if (thoughtMessageId) {
        pushDeferredThought(deferredThoughtsByMessageId, thoughtMessageId, thought);
        continue;
      }

      if (thoughtRequestId) {
        pushDeferredThought(deferredThoughtsByRequestId, thoughtRequestId, thought);
        continue;
      }

      if (attachThought(fallbackAssistantIndex, thought)) {
        continue;
      }

      orphanThoughts.push(thought);
      continue;
    }

    const sceneId = getMetaValue(message.meta, "scene:") ?? undefined;
    const requestId = getMetaValue(message.meta, "requestId:");

    if (message.role === "user") {
      const prompt = String(message.content ?? "").trim();
      if (prompt) {
        latestUserPrompt = prompt;
      }
    }

    displayMessages.push({
      message,
      thoughts: [],
      sceneId,
      promptContext: message.role === "assistant" ? latestUserPrompt : undefined
    });

    const currentIndex = displayMessages.length - 1;

    if (message.role === "assistant") {
      assistantIndexByMessageId.set(message.id, currentIndex);
      if (requestId) {
        assistantIndexByRequestId.set(requestId, currentIndex);
      }

      attachDeferredToAssistant(currentIndex, message.id, requestId);
      fallbackAssistantIndex = currentIndex;
      continue;
    }

    if (message.role === "user") {
      fallbackAssistantIndex = null;
    }
  }

  if (displayMessages.length === 0) {
    return displayMessages;
  }

  let lastAssistantIndex = -1;
  for (let index = displayMessages.length - 1; index >= 0; index -= 1) {
    if (displayMessages[index].message.role === "assistant") {
      lastAssistantIndex = index;
      break;
    }
  }

  if (lastAssistantIndex >= 0) {
    for (const deferredThoughts of deferredThoughtsByMessageId.values()) {
      displayMessages[lastAssistantIndex].thoughts.push(...deferredThoughts);
    }

    for (const deferredThoughts of deferredThoughtsByRequestId.values()) {
      displayMessages[lastAssistantIndex].thoughts.push(...deferredThoughts);
    }

    if (orphanThoughts.length > 0) {
      displayMessages[lastAssistantIndex].thoughts.push(...orphanThoughts);
    }
  }

  return displayMessages;
}

function buildMessageVersionMap(sceneVersions: SceneVersionRecord[]): Map<string, SceneVersionRecord> {
  const versionsByMessageId = new Map<string, SceneVersionRecord>();

  for (const version of sceneVersions) {
    const messageId = typeof version.messageId === "string" ? version.messageId.trim() : "";
    if (!messageId) {
      continue;
    }

    // Keep the latest revision for each assistant message id.
    versionsByMessageId.set(messageId, version);
  }

  return versionsByMessageId;
}

function buildUniqueSceneIdVersionMap(sceneVersions: SceneVersionRecord[]): Map<string, SceneVersionRecord> {
  const versionsBySceneId = new Map<string, SceneVersionRecord[]>();

  for (const version of sceneVersions) {
    const sceneId = typeof version.sceneId === "string" ? version.sceneId.trim() : "";
    if (!sceneId) {
      continue;
    }

    const existing = versionsBySceneId.get(sceneId);
    if (existing) {
      existing.push(version);
      continue;
    }

    versionsBySceneId.set(sceneId, [version]);
  }

  const uniqueBySceneId = new Map<string, SceneVersionRecord>();

  for (const [sceneId, versions] of versionsBySceneId.entries()) {
    if (versions.length === 1) {
      uniqueBySceneId.set(sceneId, versions[0]);
    }
  }

  return uniqueBySceneId;
}

export function ChatContainer() {
  const [isTasksExpanded, setIsTasksExpanded] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const {
    sessions,
    activeSessionId,
    messages,
    taskProgressBySession,
    sessionsError,
    isBootstrapping,
    isSending,
    thinkingText,
    thinkingStep,
    composerValue,
    panelOpen,
    panelView,
    panelWidth,
    setComposerValue,
    createNewSession,
    sendMessage,
    stopTurn,
    openPanel,
    closePanel,
    selectSceneVersion,
  } = useChatStore();

  const activeSession = sessions.find(s => s.sessionId === activeSessionId);
  const activeMessages = activeSessionId ? messages[activeSessionId] || [] : [];
  const activeTaskProgress = activeSessionId ? taskProgressBySession[activeSessionId] ?? null : null;
  const isTaskOperationActive = activeTaskProgress?.turnStatus === "running";
  const activeStatusStep = activeTaskProgress?.liveThought?.step ?? activeTaskProgress?.currentStep ?? thinkingStep;
  const activeStatusText = activeTaskProgress?.liveThought?.text ?? thinkingText ?? null;

  const displayMessages = useMemo(() => buildDisplayMessages(activeMessages), [activeMessages]);
  const sceneVersions = useMemo(
    () => (activeSession?.sceneVersions ?? []).filter((version): version is SceneVersionRecord => {
      return Boolean(version && typeof version.versionId === "string");
    }),
    [activeSession?.sceneVersions]
  );
  const versionsByMessageId = useMemo(
    () => buildMessageVersionMap(sceneVersions),
    [sceneVersions]
  );
  const uniqueVersionsBySceneId = useMemo(
    () => buildUniqueSceneIdVersionMap(sceneVersions),
    [sceneVersions]
  );

  // Show inline thinking bubble when agent is active.
  // - If the last message is already from the assistant: attach thought to it via isThinking prop
  // - If last message is from user or chat is empty: render a standalone thinking bubble
  const lastDisplayMsg = displayMessages[displayMessages.length - 1];
  const lastMsgIsAssistant = lastDisplayMsg?.message.role === "assistant";
  const shouldShowInlineThinking =
    isSending &&
    Boolean(thinkingText) &&
    !lastMsgIsAssistant;
  const lastAssistantIsThinking = isSending && lastMsgIsAssistant;

  // Calculate thinking duration from thoughts
  const getThinkingDuration = useCallback((thoughts: ThoughtItem[]) => {
    if (thoughts.length < 2) return 0;
    const first = thoughts[0]?.timestamp ?? 0;
    const last = thoughts[thoughts.length - 1]?.timestamp ?? 0;
    return last - first;
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    const container = chatRef.current;
    if (!container) {
      return;
    }

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const shouldStickToBottom = distanceFromBottom < 120;

    if (shouldStickToBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }, [displayMessages, thinkingText]);

  const handleSend = async () => {
    await sendMessage(composerValue);
  };

  const handleStop = () => {
    stopTurn();
  };

  const handleMessageSceneAction = async (action: 'code' | 'preview', versionId: string) => {
    const normalizedVersionId = String(versionId ?? '').trim();
    if (!normalizedVersionId) {
      return;
    }

    const currentVersionId = activeSession?.currentScene?.versionId ?? null;
    const isAlreadyActive = panelOpen && panelView === action && currentVersionId === normalizedVersionId;

    if (isAlreadyActive) {
      closePanel();
      return;
    }

    const selected = await selectSceneVersion(normalizedVersionId);
    if (!selected) {
      return;
    }

    openPanel(action);
  };

  const handleOpenTasks = () => {
    setIsTasksExpanded((previous) => !previous);
  };

  useEffect(() => {
    if (!isTaskOperationActive && isTasksExpanded) {
      setIsTasksExpanded(false);
    }
  }, [isTaskOperationActive, isTasksExpanded]);

  if (!activeSession) {
    return (
      <WelcomeScreen
        isBootstrapping={isBootstrapping}
        error={sessionsError}
        onCreate={createNewSession}
      />
    );
  }

  const shellStyle = {
    ["--workspace-width" as string]: `${Math.max(360, panelWidth)}px`
  } as CSSProperties;

  return (
    <div
      className={`chat-page-container terranet-chat-shell ${panelOpen ? "terranet-chat-shell--panel-open" : "terranet-chat-shell--panel-closed"}`}
      style={shellStyle}
    >
      {/* Chat Area */}
      <div className="terranet-chat-main">
        {/* Messages */}
        <div className="terranet-chat-scroll" ref={chatRef}>
          <div className="chat-messages">
            <div className="chat-container">
              {displayMessages.map(({ message, thoughts, sceneId, promptContext }, index) => {
                const isLast = index === displayMessages.length - 1;
                const thinkingDuration = getThinkingDuration(thoughts);
                const matchedVersion = message.role === 'assistant'
                  ? (versionsByMessageId.get(message.id)
                    ?? (sceneId ? uniqueVersionsBySceneId.get(sceneId) : undefined)
                    ?? undefined)
                  : undefined;
                const resolvedSceneId = matchedVersion?.sceneId ?? sceneId;
                const resolvedVersionId = matchedVersion?.versionId ?? null;
                const isPreviewActive = Boolean(
                  panelOpen
                  && panelView === 'preview'
                  && resolvedVersionId
                  && activeSession?.currentScene?.versionId === resolvedVersionId
                );
                const displayContent = message.role === "assistant"
                  ? getAssistantDisplayContent(message.content, promptContext, resolvedSceneId)
                  : message.content;

                if (message.role === "user") {
                  return (
                    <UserMessage
                      key={message.id}
                      content={message.content}
                      timestamp={Date.parse(message.createdAt)}
                    />
                  );
                }

                return (
                  <AIMessage
                    key={message.id}
                    content={displayContent}
                    timestamp={Date.parse(message.createdAt)}
                    isThinking={isLast && lastAssistantIsThinking && !message.content}
                    thinkingText={isLast && lastAssistantIsThinking ? thinkingText : undefined}
                    thinkingStep={isLast && lastAssistantIsThinking ? thinkingStep : undefined}
                    thoughts={thoughts}
                    thinkingDuration={thinkingDuration}
                    sceneId={resolvedSceneId}
                    isPreviewActive={isPreviewActive}
                    onScenePreview={resolvedVersionId
                      ? () => {
                          void handleMessageSceneAction('preview', resolvedVersionId);
                        }
                      : undefined}
                  />
                );
              })}

              {shouldShowInlineThinking && (
                <AIMessage
                  content=""
                  isThinking={true}
                  thinkingText={thinkingText}
                  thinkingStep={thinkingStep}
                  thoughts={[{ text: thinkingText ?? "", step: thinkingStep, timestamp: Date.now() }]}
                />
              )}
            </div>
          </div>
        </div>

        {sessionsError && <div className="chat-error-banner">{sessionsError}</div>}

        {isTaskOperationActive && activeTaskProgress && (
          <div className="chat-task-status-container">
            <TaskStatusBar
              taskProgress={activeTaskProgress}
              statusStep={activeStatusStep}
              statusText={activeStatusText}
              isExpanded={isTasksExpanded}
              onToggle={handleOpenTasks}
            />
          </div>
        )}

        {/* Composer */}
        <Composer
          value={composerValue}
          onChange={setComposerValue}
          onSubmit={handleSend}
          isSending={isSending}
          onStop={handleStop}
          placeholder="Message GenVis..."
        />
      </div>

      {/* Workspace Panel - slides in from right */}
      <WorkspacePanel />
    </div>
  );
}

function WelcomeScreen({
  onCreate,
  error,
  isBootstrapping
}: {
  onCreate: () => Promise<unknown>;
  error: string | null;
  isBootstrapping: boolean;
}) {
  const [isCreating, setIsCreating] = useState(false);

  const createNewChat = async () => {
    if (isCreating || isBootstrapping) {
      return;
    }

    setIsCreating(true);
    try {
      await onCreate();
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="chat-welcome">
      <div className="chat-welcome-content">
        <h1>GenVis</h1>
        <p>Generative Visual Engine</p>
        {error && <p className="chat-welcome-error">{error}</p>}
        <div className="chat-welcome-actions">
          <button type="button" className="chat-welcome-button" onClick={() => void createNewChat()}>
            <Send className="h-4 w-4" />
            {isCreating || isBootstrapping ? "Preparing..." : "Start New Chat"}
          </button>
        </div>
      </div>
    </div>
  );
}
