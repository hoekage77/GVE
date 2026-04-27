import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { UserMessage, AIMessage, type ChatArtifactCard } from "./MessageComponents";
import { CinematicPlayer } from "./meta/CinematicPlayer";
import { Composer } from "./Composer";
import { useChatStore, type Session, type SessionMessage } from "../../stores";
import TaskStatusBar from "./TaskStatusBar";
import { WelcomeScreen } from "./WelcomeScreen";


// Types for message grouping
type ThoughtItem = {
  text: string;
  step: string;
  timestamp: number;
  meta?: string[];
};

type DisplayMessage = {
  message: SessionMessage;
  thoughts: ThoughtItem[];
  sceneId?: string;
  promptContext?: string;
  skill?: string;
  assistantSource?: string;
  assistantWarning?: boolean;
  errorCode?: string;
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

  if (/\b(generated scene code|live preview|media preview|re-run this scene|preview is running in degraded mode)\b/i.test(normalized)) {
    return false;
  }

  const matchCount = RUNTIME_DIAGNOSTIC_PATTERNS.reduce(
    (count, pattern) => (normalized.includes(pattern) ? count + 1 : count),
    0
  );

  if (matchCount >= 2) {
    return true;
  }

  if (/^failure details:/i.test(normalized) || /^runtime recovery skipped/i.test(normalized)) {
    return true;
  }

  return false;
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

function hasMetaFlag(meta: string[] | undefined, value: string): boolean {
  return Array.isArray(meta) && meta.includes(value);
}

function toThought(message: SessionMessage): ThoughtItem {
  return {
    text: message.content,
    step: message.meta?.[0] ?? message.kind ?? "thought",
    timestamp: Date.parse(message.createdAt),
    meta: message.meta
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
    const skill = getMetaValue(message.meta, "skill:") ?? undefined;
    const assistantSource = (
      getMetaValue(message.meta, "assistantSource:")
      ?? getMetaValue(message.meta, "source:")
      ?? undefined
    );
    const assistantWarning = hasMetaFlag(message.meta, "assistantWarning:true");
    const errorCode = getMetaValue(message.meta, "error:") ?? undefined;

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
      promptContext: message.role === "assistant" ? latestUserPrompt : undefined,
      skill,
      assistantSource,
      assistantWarning,
      errorCode
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

    versionsByMessageId.set(messageId, version);
  }

  return versionsByMessageId;
}

function buildMessageVersionListMap(sceneVersions: SceneVersionRecord[]): Map<string, SceneVersionRecord[]> {
  const versionsByMessageId = new Map<string, SceneVersionRecord[]>();

  for (const version of sceneVersions) {
    const messageId = typeof version.messageId === "string" ? version.messageId.trim() : "";
    if (!messageId) {
      continue;
    }

    const existing = versionsByMessageId.get(messageId);
    if (existing) {
      existing.push(version);
      continue;
    }

    versionsByMessageId.set(messageId, [version]);
  }

  for (const versions of versionsByMessageId.values()) {
    versions.sort((left, right) => {
      const leftVersion = Number(left.version ?? 0);
      const rightVersion = Number(right.version ?? 0);
      if (leftVersion !== rightVersion) {
        return rightVersion - leftVersion;
      }

      const leftUpdatedAt = Date.parse(left.updatedAt ?? left.createdAt ?? "") || 0;
      const rightUpdatedAt = Date.parse(right.updatedAt ?? right.createdAt ?? "") || 0;
      return rightUpdatedAt - leftUpdatedAt;
    });
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
  const isMetaVariant = true;
  const {
    sessions,
    activeSessionId,
    messages,
    taskProgressBySession,
    connectionState,
    sessionsError,
    isBootstrapping,
    isSending,
    activeRequestId,
    thinkingText,
    thinkingStep,
    composerValue,
    composerImage,
    panelOpen,
    panelView,
    setComposerValue,
    setComposerImage,
    clearComposerImage,
    createNewSession: startDraftSession,
    sendMessage,
    stopTurn,
    openPanel,
    closePanel,
    openTheaterMode,
    activeArtifactId,
    selectSceneVersion,
  } = useChatStore();

  const createNewSession = async (initialPrompt?: string) => {
    try {
      await startDraftSession();
      if (initialPrompt) {
        setComposerValue(initialPrompt);
      }
    } catch (err) {
      console.error("Failed to create new session:", err);
    }
  };

  const activeSession = (sessions || []).find(s => s?.sessionId === activeSessionId);
  const activeMessages = useMemo(
    () => (activeSessionId ? (messages[activeSessionId] ?? []) : []),
    [activeSessionId, messages]
  );
  const activeTaskProgress = activeSessionId ? taskProgressBySession[activeSessionId] ?? null : null;
  const isWorkspaceVisible = panelOpen && (panelView === "preview" || panelView === "code");
  const isTaskOperationActive = activeTaskProgress?.turnStatus === "running";
  const hasGlobalTaskStatus = Boolean(isTaskOperationActive && activeTaskProgress);
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
  const versionsListByMessageId = useMemo(
    () => buildMessageVersionListMap(sceneVersions),
    [sceneVersions]
  );
  const uniqueVersionsBySceneId = useMemo(
    () => buildUniqueSceneIdVersionMap(sceneVersions),
    [sceneVersions]
  );

  // Show inline thinking bubble when agent is active.
  // - If the last message is already from the assistant AND belongs to the current request: attach thought to it
  // - If last message is from user or chat is empty: render a standalone thinking bubble
  const lastDisplayMsg = displayMessages[displayMessages.length - 1];
  const lastMsgIsAssistant = lastDisplayMsg?.message.role === "assistant";
  const lastMsgRequestId = lastMsgIsAssistant ? getMetaValue(lastDisplayMsg?.message.meta, "requestId:") : null;
  const lastMsgBelongsToCurrentTurn = Boolean(lastMsgRequestId && activeRequestId && lastMsgRequestId === activeRequestId);
  const shouldShowInlineThinking =
    isSending &&
    Boolean(thinkingText) &&
    !lastMsgBelongsToCurrentTurn &&
    !hasGlobalTaskStatus;
  const lastAssistantIsThinking = isSending && lastMsgBelongsToCurrentTurn && !hasGlobalTaskStatus;

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

  // Workspace panel auto-close logic removed - split screen deprecated
  useEffect(() => {
    if (panelOpen) {
      closePanel();
    }
  }, [panelOpen, closePanel]);

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
    const isAlreadyActive = isWorkspaceVisible && panelView === action && currentVersionId === normalizedVersionId;

    if (isAlreadyActive) {
      closePanel();
      return;
    }

    if (action === 'preview') {
      openTheaterMode(normalizedVersionId);
    } else {
      openPanel(action);
    }
  };

  const handleOpenTasks = () => {
    setIsTasksExpanded((previous) => !previous);
  };

  useEffect(() => {
    if (!isTaskOperationActive && isTasksExpanded) {
      setIsTasksExpanded(false);
    }
  }, [isTaskOperationActive, isTasksExpanded]);

  // Split view functionality removed
  const debugLayout =
    typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("chatDebug") === "1";

  return (
    <>
      {/* LEFT AGENT */}
      <aside
        className={`relative z-20 flex h-full min-h-0 w-full min-w-0 flex-1 flex-col p-0 transition-all duration-300 ease-out ${debugLayout ? "outline outline-2 outline-fuchsia-500/70" : ""}`}
      >
        <div className={`relative flex h-full min-h-0 flex-1 overflow-hidden rounded-none bg-transparent shadow-none ${debugLayout ? "outline outline-2 outline-cyan-400/70" : ""}`}>
          <div className="relative z-10 flex h-full w-full flex-1 flex-col pt-0">
            {sessionsError && <div className="bg-red-950/30 px-3 py-1.5 text-[11px] text-red-300/80 lg:p-3 lg:text-xs">{sessionsError}</div>}

            {/* Messages */}
            <div
              className="flex min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto scroll-smooth scrollbar px-0 py-0"
              ref={chatRef}
            >
          <div className={`flex w-full flex-col gap-5 px-3 py-3 lg:gap-6 lg:py-8 ${activeSession ? 'max-w-3xl mx-auto' : 'items-center justify-center min-h-full'}`}>
            {!activeSession ? (
              <WelcomeScreen
                isBootstrapping={isBootstrapping}
                error={sessionsError}
                onCreate={createNewSession}
              />
            ) : (
              <>
                <div className="flex-1 min-h-[40px]" />
          {displayMessages.map(({ message, thoughts, sceneId, promptContext, skill, assistantSource, assistantWarning, errorCode }, index) => {
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
              isWorkspaceVisible
              && panelView === 'preview'
              && resolvedVersionId
              && activeSession?.currentScene?.versionId === resolvedVersionId
            );
            const isCodeActive = Boolean(
              isWorkspaceVisible
              && panelView === 'code'
              && resolvedVersionId
              && activeSession?.currentScene?.versionId === resolvedVersionId
            );

            const messageVersionCandidates = message.role === 'assistant'
              ? (versionsListByMessageId.get(message.id)
                ?? (resolvedSceneId
                  ? sceneVersions.filter((version) => version.sceneId === resolvedSceneId)
                  : []))
              : [];

            const dedupedVersionCandidates = messageVersionCandidates.filter((version, candidateIndex, allVersions) => {
              return allVersions.findIndex((candidate) => candidate.versionId === version.versionId) === candidateIndex;
            });

            const artifactCards: ChatArtifactCard[] = dedupedVersionCandidates.slice(0, 4).map((version) => {
              const rawPreviewUrl = String(version.mediaUrl ?? version.previewUrl ?? "").trim();
              const previewUrl = rawPreviewUrl && rawPreviewUrl !== "about:blank" ? rawPreviewUrl : null;

              return {
                versionId: version.versionId,
                sceneId: version.sceneId,
                versionLabel: `v${version.version ?? 0}`,
                skill: version.skill,
                outputKind: version.outputKind,
                mediaType: version.mediaType,
                previewUrl,
                isPreviewActive: Boolean(
                  activeArtifactId === version.versionId
                ),
                isCodeActive: Boolean(
                  isWorkspaceVisible
                  && panelView === 'code'
                  && activeSession?.currentScene?.versionId === version.versionId
                ),
                onPreview: () => {
                  void handleMessageSceneAction('preview', version.versionId);
                },
                onCode: () => {
                  void handleMessageSceneAction('code', version.versionId);
                }
              };
            });

            const displayContent = message.role === "assistant"
              ? getAssistantDisplayContent(message.content, promptContext, resolvedSceneId)
              : message.content;

            if (message.role === "user") {
              return (
                <UserMessage
                  key={message.id || `msg-user-${index}`}
                  content={message.content}
                  timestamp={Date.parse(message.createdAt)}
                  variant="meta"
                />
              );
            }

            return (
              <AIMessage
                key={message.id || `msg-ai-${index}`}
                content={displayContent}
                timestamp={Date.parse(message.createdAt)}
                isThinking={isLast && lastAssistantIsThinking && !message.content}
                thinkingText={isLast && lastAssistantIsThinking ? thinkingText : undefined}
                thinkingStep={isLast && lastAssistantIsThinking ? thinkingStep : undefined}
                thoughts={thoughts}
                thinkingDuration={thinkingDuration}
                taskProgress={isLast ? activeTaskProgress : null}
                sceneId={resolvedSceneId}
                skill={skill}
                assistantSource={assistantSource}
                assistantWarning={assistantWarning}
                errorCode={errorCode}
                meta={message.meta}
                isPreviewActive={isPreviewActive}
                isCodeActive={isCodeActive}
                variant="meta"
                onSceneCode={resolvedVersionId
                  ? () => {
                      void handleMessageSceneAction('code', resolvedVersionId);
                    }
                  : undefined}
                onScenePreview={resolvedVersionId
                  ? () => {
                      void handleMessageSceneAction('preview', resolvedVersionId);
                    }
                  : undefined}
                artifactCards={artifactCards}
                sceneCode={matchedVersion?.code}
                sceneSkill={matchedVersion?.skill}
                sceneVersionId={resolvedVersionId}
                onSceneExpand={resolvedVersionId
                  ? () => {
                      void handleMessageSceneAction('preview', resolvedVersionId);
                    }
                  : undefined}
              />
            );
          })}

          {shouldShowInlineThinking && (
            <AIMessage
              key="inline-thinking"
              content=""
              isThinking={true}
              thinkingText={thinkingText}
              thinkingStep={thinkingStep}
              thoughts={[{ text: thinkingText ?? "", step: thinkingStep, timestamp: Date.now(), meta: [thinkingStep, "status:streaming"] }]}
              taskProgress={activeTaskProgress}
              variant="meta"
            />
          )}
              </>
            )}

          </div>

        </div>
        
            {isTaskOperationActive && activeTaskProgress && (
              <div className="w-full p-0 px-4 pb-3 max-w-3xl mx-auto">
                <div className="w-full">
                  <TaskStatusBar
                    taskProgress={activeTaskProgress}
                    statusStep={activeStatusStep}
                    statusText={activeStatusText}
                    assetPlan={activeSession?.currentScene?.assetPlan ?? null}
                    isExpanded={isTasksExpanded}
                    onToggle={handleOpenTasks}
                    connectionState={connectionState}
                  />
                </div>
              </div>
            )}

            {/* Input */}
            <div className="shrink-0 bg-transparent pb-4 lg:pb-8 pt-2">
              <div className="w-full">
                <div className={`relative w-full px-3 max-w-3xl mx-auto ${debugLayout ? "outline outline-2 outline-amber-300/80" : ""}`}>
                <Composer
                  value={composerValue}
                  onChange={setComposerValue}
                  onSubmit={handleSend}
                  attachedImage={composerImage}
                  onImageSelected={setComposerImage}
                  onRemoveImage={clearComposerImage}
                  isSending={isSending}
                  onStop={handleStop}
                  variant="meta"
                  placeholder="Send a message..."
                />
                <div className="mt-2 text-center text-[11px] text-white/30 hidden lg:block">
                  Press Enter to send, Shift+Enter for new line
                </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Cinematic Theater Mode Overlay */}
      <CinematicPlayer />
    </>
  );
}

