import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { LayoutPanelTop, Terminal } from "lucide-react";
import { UserMessage, AIMessage, type ChatArtifactCard } from "./MessageComponents";
import { CinematicPlayer } from "./meta/CinematicPlayer";
import { Composer } from "./Composer";
import { useChatStore, type Session, type SessionMessage } from "../../stores";
import type { AgentFileEntry, AgentToolLogEntry } from "../../stores/chat/types";
import { useMessageSync, useSendMessage } from "../../hooks/queries";
import { createClientMessageId, dedupeMessages } from "../../stores/chat/helpers";
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
  agentFiles?: AgentFileEntry[];
  agentToolLog?: AgentToolLogEntry[];
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

function isTrivialThought(thought: ThoughtItem): boolean {
  const step = thought.step;
  if (step !== "turn_started" && step !== "turn_complete") return false;
  const hasDetail = thought.meta?.some((m) => m.startsWith("detail:")) ?? false;
  const hasStepLabel = thought.meta?.some((m) => m.startsWith("stepLabel:")) ?? false;
  return !hasDetail && !hasStepLabel;
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
      const isDuplicate = existing.some(
        (t) => t.step === thought.step && t.text === thought.text
      );
      if (!isDuplicate) {
        existing.push(thought);
      }
      return;
    }
    bucket.set(key, [thought]);
  };

  const attachThought = (index: number | null, thought: ThoughtItem): boolean => {
    if (index === null || index < 0 || index >= displayMessages.length) {
      return false;
    }
    const existing = displayMessages[index].thoughts;
    const isDuplicate = existing.some(
      (t) => t.step === thought.step && t.text === thought.text
    );
    if (isDuplicate) {
      return true;
    }
    displayMessages[index].thoughts.push(thought);
    return true;
  };

  const attachDeferredToAssistant = (index: number, messageId: string, requestId: string | null) => {
    const deferredByMessage = deferredThoughtsByMessageId.get(messageId);
    if (deferredByMessage?.length) {
      for (const thought of deferredByMessage) {
        const isDuplicate = displayMessages[index].thoughts.some(
          (t) => t.step === thought.step && t.text === thought.text
        );
        if (!isDuplicate) {
          displayMessages[index].thoughts.push(thought);
        }
      }
      deferredThoughtsByMessageId.delete(messageId);
    }

    if (requestId) {
      const deferredByRequest = deferredThoughtsByRequestId.get(requestId);
      if (deferredByRequest?.length) {
        for (const thought of deferredByRequest) {
          const isDuplicate = displayMessages[index].thoughts.some(
            (t) => t.step === thought.step && t.text === thought.text
          );
          if (!isDuplicate) {
            displayMessages[index].thoughts.push(thought);
          }
        }
        deferredThoughtsByRequestId.delete(requestId);
      }
    }

    if (orphanThoughts.length > 0) {
      for (const thought of orphanThoughts) {
        const isDuplicate = displayMessages[index].thoughts.some(
          (t) => t.step === thought.step && t.text === thought.text
        );
        if (!isDuplicate) {
          displayMessages[index].thoughts.push(thought);
        }
      }
      orphanThoughts.length = 0;
    }
  };

  for (const message of messages) {
    if (message.role === "thought" || message.kind === "thought") {
      const thought = toThought(message);
      // Skip pure lifecycle thoughts (turn_started/turn_complete with no detail).
      // These add noise for simple chat responses where no agent work happened.
      if (isTrivialThought(thought)) continue;

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

    // Display deduplication safety net: skip exact duplicate messages within 30s
    // OR messages sharing the same requestId (catches cross-ID duplicates).
    const isDuplicate = displayMessages.some((dm) => {
      if (dm.message.role !== message.role) return false;
      if (dm.message.content !== message.content) return false;
      const timeDiff = Math.abs(Date.parse(dm.message.createdAt) - Date.parse(message.createdAt));
      if (timeDiff < 30_000) return true;
      // Also deduplicate if both messages share the same requestId meta tag
      const dmRequestId = getMetaValue(dm.message.meta, "requestId:");
      return Boolean(dmRequestId && dmRequestId === requestId);
    });
    if (isDuplicate) continue;

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

  const unmatchedGroups: ThoughtItem[][] = [
    ...Array.from(deferredThoughtsByMessageId.values()),
    ...Array.from(deferredThoughtsByRequestId.values()),
    orphanThoughts.length > 0 ? orphanThoughts : []
  ].filter(group => group.length > 0);

  for (const group of unmatchedGroups) {
    group.sort((a, b) => a.timestamp - b.timestamp);
    const lastTimestamp = group[group.length - 1].timestamp;

    displayMessages.push({
      message: {
        id: `synthetic-${Date.now()}-${Math.random()}`,
        role: "assistant",
        content: "",
        kind: "message",
        createdAt: new Date(lastTimestamp).toISOString(),
        updatedAt: new Date(lastTimestamp).toISOString(),
        meta: ["synthetic:true"]
      },
      thoughts: [...group],
      promptContext: undefined
    });
  }

  displayMessages.sort((a, b) => Date.parse(a.message.createdAt) - Date.parse(b.message.createdAt));

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
    agentFiles,
    agentToolLog,
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
    stopTurn,
    openPanel,
    closePanel,
    openTheaterMode,
    activeArtifactId,
    selectSceneVersion,
    openWorkspace,
    pendingApproval,
    sendApprovalResponse,
  } = useChatStore();

  // Server-state hooks
  const sendMutation = useSendMessage();
  useMessageSync(activeSessionId);

  // Safety: force isSending reset if a turn hangs so the UI never stays stuck.
  // Set to 120s to allow agent recovery + LLM debug sessions to complete.
  // Resets on each WebSocket activity so a long-running turn with events doesn't
  // get prematurely killed.
  const sendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isSending) {
      if (sendingTimeoutRef.current) clearTimeout(sendingTimeoutRef.current);
      sendingTimeoutRef.current = null;
      return;
    }
    const startTimer = () => {
      if (sendingTimeoutRef.current) clearTimeout(sendingTimeoutRef.current);
      sendingTimeoutRef.current = setTimeout(() => {
        useChatStore.getState().setIsSending(false);
        useChatStore.getState().setActiveRequestId(null);
        useChatStore.getState().setThinking(null, "turn_timeout");
      }, 120_000);
    };
    startTimer();
    return () => {
      if (sendingTimeoutRef.current) clearTimeout(sendingTimeoutRef.current);
    };
  }, [isSending, thinkingText, thinkingStep]);

  const createNewSession = async (initialPrompt?: string) => {
    try {
      const session = await startDraftSession();
      if (initialPrompt) {
        setComposerValue(initialPrompt);
        // Send the prompt immediately after creating the session so the user
        // doesn't have to press Enter again.
        if (!isPendingRef.current && !sendMutation.isPending) {
          isPendingRef.current = true;
          const requestId = `req-ws-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
          const clientMessageId = createClientMessageId("user");
          sendMutation.mutate({
            content: initialPrompt,
            mode: "generate",
            requestId,
            clientMessageId,
          }, {
            onSettled: () => {
              isPendingRef.current = false;
            }
          });
        }
      }
      return session;
    } catch (err) {
      console.error("Failed to create new session:", err);
      return null;
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

  const displayMessages = useMemo(() => {
    const built = buildDisplayMessages(dedupeMessages(activeMessages));
    // Attach live agent-mode files + tool log to the last assistant message when streaming
    if (isSending && (agentFiles.length > 0 || agentToolLog.length > 0)) {
      for (let i = built.length - 1; i >= 0; i--) {
        if (built[i]!.message.role === "assistant") {
          built[i] = { ...built[i]!, agentFiles, agentToolLog };
          break;
        }
      }
    }
    return built;
  }, [activeMessages, isSending, agentFiles, agentToolLog]);
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
  const lastMsgIsSynthetic = lastMsgIsAssistant && hasMetaFlag(lastDisplayMsg?.message.meta, "synthetic:true");
  const lastMsgBelongsToCurrentTurn = Boolean(lastMsgRequestId && activeRequestId && lastMsgRequestId === activeRequestId) || lastMsgIsSynthetic;
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

  // No panel auto-open; inline artifact cards within messages handle preview display

  // Mutation lock to prevent double-submit under React StrictMode or rapid clicks.
  const isPendingRef = useRef(false);

  const handleSend = async () => {
    if (!composerValue.trim() && !composerImage) return;
    if (isPendingRef.current || sendMutation.isPending) return;
    isPendingRef.current = true;

    // If no active session (e.g. welcome screen), create one first
    if (!activeSessionId) {
      await createNewSession();
      // activeSessionId is now set in Zustand; mutationFn will read it
    }
    const requestId = `req-ws-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const clientMessageId = createClientMessageId("user");
    sendMutation.mutate({
      content: composerValue,
      mode: "generate",
      imageUrl: composerImage?.previewUrl,
      imageData: composerImage?.dataBase64,
      requestId,
      clientMessageId,
    }, {
      onSettled: () => {
        isPendingRef.current = false;
      }
    });
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

  const providers = useChatStore((state) => state.providers);
  const activeProviderId = useChatStore((state) => state.activeProviderId);
  const setActiveProvider = useChatStore((state) => state.setActiveProvider);

  return (
    <>
      {/* LEFT AGENT */}
      <aside
        className={`relative z-20 flex h-full min-h-0 w-full min-w-0 flex-1 flex-col p-0 transition-all duration-300 ease-out ${debugLayout ? "outline outline-2 outline-fuchsia-500/70" : ""}`}
      >
        <div className={`relative flex h-full min-h-0 flex-1 overflow-hidden rounded-none bg-transparent shadow-none ${debugLayout ? "outline outline-2 outline-cyan-400/70" : ""}`}>
          <div className="relative z-10 flex h-full w-full flex-1 flex-col pt-0">
            {sessionsError && (
              <div className="mx-3 mt-2 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200 lg:mx-auto lg:max-w-3xl">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-red-400">
                  <circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" />
                </svg>
                <span className="flex-1">{sessionsError}</span>
                <button
                  type="button"
                  onClick={() => useChatStore.setState({ sessionsError: null })}
                  className="shrink-0 rounded p-1 text-red-400 transition hover:bg-red-500/20 hover:text-red-200"
                  aria-label="Dismiss error"
                  title="Dismiss"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            )}

            {/* Messages */}
            <div
              className="flex min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto scroll-smooth scrollbar px-0 py-0"
              ref={chatRef}
            >
          <div className={`flex w-full flex-col gap-4 px-3 py-3 lg:gap-5 lg:py-8 ${activeSession ? 'max-w-3xl mx-auto' : 'items-center justify-center min-h-full'}`}>
            {!activeSession ? (
              <WelcomeScreen
                isBootstrapping={isBootstrapping}
                error={sessionsError}
                onCreate={createNewSession}
              />
            ) : (
              <>
                <div className="flex-1 min-h-[40px]" />
          {displayMessages.map(({ message, thoughts, sceneId, promptContext, skill, assistantSource, assistantWarning, errorCode, agentFiles: msgAgentFiles, agentToolLog: msgAgentToolLog }, index) => {
            const isLast = index === displayMessages.length - 1;
            const isLatest = isLast;
            const thinkingDuration = getThinkingDuration(thoughts);
            const matchedVersion = message.role === 'assistant'
              ? (versionsByMessageId.get(message.id)
                ?? (sceneId ? uniqueVersionsBySceneId.get(sceneId) : undefined)
                ?? undefined)
              : undefined;
            const isLiveStreaming = isLast && lastAssistantIsThinking && !message.content;
            const liveScene = (isLiveStreaming || isLast) ? activeSession?.currentScene : null;
            const resolvedSceneId = matchedVersion?.sceneId ?? sceneId ?? liveScene?.sceneId;
            const resolvedVersionId = matchedVersion?.versionId ?? liveScene?.versionId ?? null;
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

            const isSynthetic = hasMetaFlag(message.meta, "synthetic:true");
            const turnFailed = isSynthetic && !isSending && Boolean(sessionsError);
            
            const displayContent = turnFailed 
              ? "The agent encountered a critical error before completing the response." 
              : (message.role === "assistant"
                ? getAssistantDisplayContent(message.content, promptContext, resolvedSceneId)
                : message.content);
            const displayErrorCode = turnFailed ? "Turn Incomplete" : errorCode;
            const displayAssistantWarning = turnFailed ? true : assistantWarning;

            if (message.role === "user") {
              return (
                <UserMessage
                  key={message.id || `msg-user-${index}`}
                  content={message.content}
                  timestamp={Date.parse(message.createdAt)}
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
                assistantWarning={displayAssistantWarning}
                errorCode={displayErrorCode}
                meta={message.meta}
                isPreviewActive={isPreviewActive}
                isCodeActive={isCodeActive}
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
                sceneCode={matchedVersion?.code ?? liveScene?.code ?? null}
                sceneSkill={matchedVersion?.skill ?? liveScene?.skill ?? null}
                sceneVersionId={resolvedVersionId}
                onSceneExpand={resolvedVersionId
                  ? () => {
                      void handleMessageSceneAction('preview', resolvedVersionId);
                    }
                  : undefined}
                mediaUrl={matchedVersion?.mediaUrl ?? null}
                mediaType={matchedVersion?.mediaType ?? null}
                outputKind={matchedVersion?.outputKind ?? null}
                mediaStatusStage={isLast ? (activeTaskProgress?.mediaStage ?? 'idle') : (matchedVersion?.mediaUrl ? 'ready' : 'idle')}
                mediaStatusText={isLast ? (activeTaskProgress?.mediaStatusText ?? null) : null}
                messageKind={message.kind ?? null}
                agentFiles={msgAgentFiles}
                agentToolLog={msgAgentToolLog}
                isLatest={isLatest}
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
              isLatest={true}
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

            {/* Floating Agent Terminal Button — always available when a session is active */}
            {activeSession && (
              <button
                type="button"
                onClick={openWorkspace}
                className="absolute right-4 bottom-24 z-30 flex items-center gap-2 rounded-full border border-white/[0.06] bg-[#18181B]/80 px-3.5 py-2 backdrop-blur-xl text-[11px] font-medium text-white/60 shadow-[0_4px_24px_rgba(0,0,0,0.4)] transition-all duration-200 hover:bg-[#18181B] hover:text-white/90 hover:shadow-[0_4px_32px_rgba(0,0,0,0.5)] active:scale-95 md:right-8 md:bottom-28"
              >
                <Terminal className="h-3.5 w-3.5 text-[#79c0ff]/60" />
                <span className="hidden sm:inline">Agent Terminal</span>
              </button>
            )}

            {/* Agent Approval Gate */}
            {pendingApproval && pendingApproval.sessionId === activeSessionId && (
              <div className="shrink-0 w-full px-3 max-w-3xl mx-auto pb-2">
                <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                  <div className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-amber-400/60 flex items-center justify-center">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-amber-200/90">Agent approval required</p>
                    <p className="mt-0.5 text-[12px] text-amber-200/60 leading-relaxed">
                      {pendingApproval.description || `Step: ${pendingApproval.step}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => sendApprovalResponse(false)}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => sendApprovalResponse(true)}
                      className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-[12px] font-medium text-emerald-300 transition hover:bg-emerald-500/30"
                    >
                      Approve
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Input */}
            <div className="shrink-0 pb-4 lg:pb-8 pt-2">
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
                  placeholder="Send a message..."
                  providers={providers}
                  activeProviderId={activeProviderId}
                  onProviderChange={setActiveProvider}
                  connectionState={connectionState}
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

