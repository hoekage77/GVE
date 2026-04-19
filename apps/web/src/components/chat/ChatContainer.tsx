import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { UserMessage, AIMessage, type ChatArtifactCard } from "./MessageComponents";
import { Composer } from "./Composer";
import { useChatStore, type Session, type SessionMessage } from "../../stores";
import { Send, Zap } from "lucide-react";
import WorkspacePanel from "../workspace/WorkspacePanel";
import TaskStatusBar from "./TaskStatusBar";
import IterationPanel from "../iteration/IterationPanel";

const WELCOME_STARTERS = [
  {
    title: "Cinematic Intro Scene",
    description: "Craft a moody camera fly-through with dramatic lighting and slow motion particles."
  },
  {
    title: "Data Storyboard",
    description: "Build a visual narrative that animates trends and annotations across a timeline."
  },
  {
    title: "Interactive Geometry",
    description: "Generate a responsive shape system with controls for scale, color, and movement."
  },
  {
    title: "Brand Motion Loop",
    description: "Design a short seamless loop with polished easing and layered depth."
  }
] as const;

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
  skill?: string;
  assistantSource?: string;
  assistantWarning?: boolean;
  errorCode?: string;
};

type SceneVersionRecord = NonNullable<Session["currentScene"]>;
type ChatContainerVariant = "legacy" | "meta";

interface ChatContainerProps {
  variant?: ChatContainerVariant;
}

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

  // Preserve concise user-facing summaries even if they mention preview/runtime context.
  if (/\b(generated scene code|live preview|media preview|re-run this scene|preview is running in degraded mode)\b/i.test(normalized)) {
    return false;
  }

  const matchCount = RUNTIME_DIAGNOSTIC_PATTERNS.reduce(
    (count, pattern) => (normalized.includes(pattern) ? count + 1 : count),
    0
  );

  // Only collapse content when it clearly looks like an internal diagnostic dump.
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

    // Keep the latest revision for each assistant message id.
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

export function ChatContainer({ variant = "legacy" }: ChatContainerProps) {
  const [isTasksExpanded, setIsTasksExpanded] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const isMetaVariant = variant === "meta";
  const {
    sessions,
    activeSessionId,
    messages,
    taskProgressBySession,
    connectionState,
    sessionsError,
    isBootstrapping,
    isSending,
    thinkingText,
    thinkingStep,
    composerValue,
    composerImage,
    panelOpen,
    panelView,
    setComposerValue,
    setComposerImage,
    clearComposerImage,
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
  const activeScene = activeSession?.currentScene ?? null;
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
  // - If the last message is already from the assistant: attach thought to it via isThinking prop
  // - If last message is from user or chat is empty: render a standalone thinking bubble
  const lastDisplayMsg = displayMessages[displayMessages.length - 1];
  const lastMsgIsAssistant = lastDisplayMsg?.message.role === "assistant";
  const shouldShowInlineThinking =
    isSending &&
    Boolean(thinkingText) &&
    !lastMsgIsAssistant &&
    !hasGlobalTaskStatus;
  const lastAssistantIsThinking = isSending && lastMsgIsAssistant && !hasGlobalTaskStatus;

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
        variant={variant}
      />
    );
  }

  return (
    <>
      {/* LEFT WORKSPACE SCENE/Code PANEL */}
      <WorkspacePanel />

      {/* RIGHT AGENT */}
      <aside
        className={`flex flex-col relative z-20 min-h-0 h-full w-full min-w-0 transition-all duration-300 ease-out ${
          panelOpen
            ? (isMetaVariant
              ? "flex-1 p-0 lg:w-[420px] lg:flex-none 2xl:w-[460px]"
              : "flex-1 p-0 lg:w-[420px] 2xl:w-[460px]")
            : "flex-1 p-0"
        }`}
      >
        <div className="relative flex-1 min-h-0 h-full overflow-hidden border border-white/10 bg-[#0b0b10]/90 shadow-[-20px_0_50px_-25px_rgba(0,0,0,0.7)] rounded-none">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_8%,rgba(56,189,248,0.14),transparent_45%),radial-gradient(circle_at_85%_18%,rgba(236,72,153,0.1),transparent_50%)]" />
            <div
              className="absolute inset-0 opacity-30"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.03) 1px, transparent 1px)",
                backgroundSize: "30px 30px",
              }}
            />
          </div>

          <div className="relative z-10 flex h-full flex-col pt-11 lg:pt-0">
            {sessionsError && <div className="border-b border-red-500/20 bg-red-950/30 px-3 py-1.5 text-[11px] text-red-300/80 lg:p-3 lg:text-xs">{sessionsError}</div>}

            {/* Messages */}
            <div
              className="flex min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto scroll-smooth scrollbar px-0 py-0"
              ref={chatRef}
            >
          <div className={`flex w-full flex-col gap-3 lg:gap-5 ${panelOpen ? 'px-3 py-2 lg:px-0 lg:py-0' : 'mx-auto max-w-[980px] px-4 py-4 lg:px-6 lg:py-6'}`}>
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
              panelOpen
              && panelView === 'preview'
              && resolvedVersionId
              && activeSession?.currentScene?.versionId === resolvedVersionId
            );
            const isCodeActive = Boolean(
              panelOpen
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
                  panelOpen
                  && panelView === 'preview'
                  && activeSession?.currentScene?.versionId === version.versionId
                ),
                isCodeActive: Boolean(
                  panelOpen
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
                  key={message.id}
                  content={message.content}
                  timestamp={Date.parse(message.createdAt)}
                  variant={variant}
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
                taskProgress={isLast ? activeTaskProgress : null}
                sceneId={resolvedSceneId}
                skill={skill}
                assistantSource={assistantSource}
                assistantWarning={assistantWarning}
                errorCode={errorCode}
                meta={message.meta}
                isPreviewActive={isPreviewActive}
                isCodeActive={isCodeActive}
                variant={variant}
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
              taskProgress={activeTaskProgress}
              variant={variant}
            />
          )}

          </div>

        </div>
        
            {isTaskOperationActive && activeTaskProgress && (
              <div className={`p-0 ${panelOpen ? '' : 'px-4 pb-3'}`}>
                <div className={panelOpen ? '' : 'mx-auto w-full max-w-[980px]'}>
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
            <div className="shrink-0 border-t border-white/[0.08] bg-black/40 p-0 backdrop-blur-xl">
              <div className={`relative ${panelOpen ? 'px-3 py-3 lg:px-0 lg:py-0' : 'mx-auto w-full max-w-[980px] px-4 py-3 lg:px-6 lg:py-4'}`}>
                <Composer
                  value={composerValue}
                  onChange={setComposerValue}
                  onSubmit={handleSend}
                  attachedImage={composerImage}
                  onImageSelected={setComposerImage}
                  onRemoveImage={clearComposerImage}
                  isSending={isSending}
                  onStop={handleStop}
                  variant={variant}
                  placeholder="Send a message"
                />
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function WelcomeScreen({
  onCreate,
  error,
  isBootstrapping,
  variant
}: {
  onCreate: () => Promise<unknown>;
  error: string | null;
  isBootstrapping: boolean;
  variant: ChatContainerVariant;
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
    <div className="flex h-full w-full items-center justify-center overflow-y-auto p-4 lg:p-8">
      <div className="w-full max-w-4xl rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-xl lg:p-10">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">GenVis Workspace</div>
        <h1 className="text-2xl font-semibold text-white lg:text-3xl">Build visual ideas that feel production-ready</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-white/70 lg:text-base">
          Move from prompt to polished output with live preview, editable code, and turn-by-turn progress in one focused canvas.
        </p>
        {error && <p className="mt-3 rounded-lg border border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-sky-400/45 bg-sky-400/15 px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-sky-400/25" onClick={() => void createNewChat()}>
            <Send className="h-4 w-4" />
            {isCreating || isBootstrapping ? "Preparing..." : "Start New Chat"}
          </button>
          <button
            type="button"
            className="inline-flex items-center rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/[0.08] disabled:opacity-50"
            onClick={() => void createNewChat()}
            disabled={isCreating || isBootstrapping}
          >
            Explore Templates
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3" aria-label="Core capabilities">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-sm font-semibold text-white">Live Preview</h3>
            <p className="mt-1 text-xs leading-6 text-white/65">See scene updates immediately while iterating.</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-sm font-semibold text-white">Code + Prompt</h3>
            <p className="mt-1 text-xs leading-6 text-white/65">Refine visuals from both natural language and code edits.</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-sm font-semibold text-white">Task Trace</h3>
            <p className="mt-1 text-xs leading-6 text-white/65">Track parse, build, generate, and sync steps in real time.</p>
          </div>
        </div>

        <div className="mt-6 grid gap-2 sm:grid-cols-2" aria-label="Starter ideas">
          {WELCOME_STARTERS.map((starter) => (
            <button
              key={starter.title}
              type="button"
              className="group rounded-xl border border-white/10 bg-white/[0.02] p-4 text-left transition hover:border-white/20 hover:bg-white/[0.06] disabled:opacity-60"
              onClick={() => void createNewChat()}
              disabled={isCreating || isBootstrapping}
            >
              <span className="block text-sm font-semibold text-white">{starter.title}</span>
              <span className="mt-1 block text-xs leading-6 text-white/65">{starter.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
