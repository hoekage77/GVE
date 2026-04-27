import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import {
  createSession as apiCreateSession,
  modifyVisual as apiModifyVisual,
  listVersions,
  listSessionMessages,
  listSessions,
  nextArtifact,
  previousArtifact,
  redoScene,
  resolveWebSocketUrl,
  selectVersion,
  sendSessionMessage,
  undoScene,
  type AgentActivityEvent,
  type GveTaskAction,
  type SessionMessage as ApiSessionMessage,
  type IterationState as SharedIterationState,
  listProviders,
} from '@visual-runtime/shared';
import {
  type ChatState,
  type Session,
  type SessionMessage,
  type UIIterationState,
  type WorkspacePanelView,
} from './types';
import {
  WS_RECONNECT_DELAY_MS,
  WS_OPEN_WAIT_TIMEOUT_MS,
  MAX_ACTIVITY_ENTRIES,
  ORCHESTRATION_STEP_TO_ACTION,
} from './constants';
import {
  nowIso,
  cloneDefaultTasks,
  createEmptyStageEventMap,
  normalizeTaskStatus,
  normalizeTaskList,
  appendStageEvent,
  formatOrchestrationEventText,
  formatOrchestrationEventDetail,
  findRunningStageAction,
  resolveActiveStageAction,
  mapStepToAction,
  applyStepStatusToTasks,
  isMediaScene,
  hasMediaUrl,
  createDefaultTaskProgress,
  updateTaskProgressMap,
  patchTaskProgressFromScene,
  reconcileTaskProgressMap,
  sortSessionsByUpdatedAt,
  normalizeMessage,
  upsertMessage,
  mergeMessages,
  upsertSession,
  createClientMessageId,
  isThoughtMessage,
  getPanelWidthPreset,
} from './helpers';
import { isConversationalMessage } from './is-conversational';
import { type ActionBlock } from '../../types/actionBlocks';


let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let lastSequence = 0;
let shouldReplayOnReconnect = false;

export const useChatStore = create<ChatState>()(
  devtools(
    persist(
      (set, get) => ({
        // === Initial State ===
        sessions: [],
        activeSessionId: null,
        hasInitialized: false,
        isBootstrapping: false,
        sessionsError: null,
        messages: {},
        taskProgressBySession: {},
        actionBlocksByMessage: {},
        currentTurnCheckpoints: [],
        currentMessageId: null,
        connectionState: 'connecting',
        isSending: false,
        activeRequestId: null,
        thinkingText: null,
        thinkingStep: 'turn_started',
        showScrollToLatest: false,
        iterationState: null,
        agentState: null,
        panelOpen: false,
        panelView: null,
        panelWidth: 600,
        activeArtifactId: null,
        composerValue: '',
        composerImage: null,
        isSlashMenuOpen: false,
        isSidebarCollapsed: typeof window !== "undefined" ? window.sessionStorage.getItem("terranet.sidebar.collapsed.v2") === "1" : false,
        
        providers: [],
        activeProviderId: "auto",
        
        // === Basic Actions ===
        setSidebarCollapsed: (collapsed: boolean) => {
          set({ isSidebarCollapsed: collapsed });
          if (typeof window !== "undefined") {
            window.sessionStorage.setItem("terranet.sidebar.collapsed.v2", collapsed ? "1" : "0");
          }
        },

        cycleTheaterArtifact: (direction: "next" | "prev") => {
          const { activeArtifactId, activeSessionId, sessions } = get();
          if (!activeArtifactId || !activeSessionId) return;
          
          const session = (sessions || []).find(s => s?.sessionId === activeSessionId);
          if (!session || !session.versions || session.versions.length <= 1) return;
          
          const currentIndex = session.versions.findIndex(v => v.versionId === activeArtifactId);
          if (currentIndex === -1) return;
          
          let nextIndex;
          if (direction === "next") {
            nextIndex = (currentIndex + 1) % session.versions.length;
          } else {
            nextIndex = (currentIndex - 1 + session.versions.length) % session.versions.length;
          }
          
          const nextVersion = session.versions[nextIndex];
          if (nextVersion) {
            set({ activeArtifactId: nextVersion.versionId });
          }
        },

        initialize: async () => {
          if (get().isBootstrapping) return;
          if (get().hasInitialized) {
            get().connectWebSocket();
            return;
          }

          set({ isBootstrapping: true, sessionsError: null });

          try {
            await Promise.all([
              get().refreshSessions(),
              get().fetchProviders()
            ]);
            set({ hasInitialized: true });
          } catch {
            // refreshSessions handles error state
          } finally {
            set({ isBootstrapping: false });
            get().connectWebSocket();
          }
        },

        refreshSessions: async () => {
          try {
            const response = await listSessions();
            const sessions = sortSessionsByUpdatedAt(response.sessions ?? []);
            const currentActiveSessionId = get().activeSessionId;
            const nextActiveSessionId = currentActiveSessionId && (sessions || []).some((session) => session?.sessionId === currentActiveSessionId)
              ? currentActiveSessionId
              : sessions[0]?.sessionId ?? null;

            set((state) => ({
              sessions,
              activeSessionId: nextActiveSessionId,
              sessionsError: null,
              panelOpen: false,
              panelView: null,
              activeArtifactId: null,
              taskProgressBySession: reconcileTaskProgressMap(state.taskProgressBySession, sessions)
            }));

            if (nextActiveSessionId) {
              const hasMessages = (get().messages[nextActiveSessionId] ?? []).length > 0;
              if (!hasMessages) {
                await get().loadSessionMessages(nextActiveSessionId);
              }
            }
          } catch (error) {
            set({
              sessionsError: error instanceof Error ? error.message : 'Unable to load sessions.'
            });
            throw error;
          }
        },

        fetchProviders: async () => {
          try {
            const response = await listProviders();
            set({ providers: response.providers });
          } catch (error) {
            console.error("Failed to fetch LLM providers:", error);
          }
        },

        setActiveProvider: (providerId: string) => {
          set({ activeProviderId: providerId });
        },

        createNewSession: async () => {
          try {
            const response = await apiCreateSession();
            const session = response.sceneState;

            set((state) => ({
              sessions: upsertSession(state.sessions, session),
              activeSessionId: response.sessionId,
              sessionsError: null,
              taskProgressBySession: {
                ...state.taskProgressBySession,
                [response.sessionId]: createDefaultTaskProgress(response.sessionId)
              },
              messages: {
                ...state.messages,
                [response.sessionId]: state.messages[response.sessionId] ?? []
              }
            }));

            get().connectWebSocket();
            return session;
          } catch (error) {
            set({
              sessionsError: error instanceof Error ? error.message : 'Unable to create a new session.'
            });
            return null;
          }
        },

        selectSession: async (sessionId) => {
          const nextProgress = get().taskProgressBySession[sessionId] ?? null;

          set({
            activeSessionId: sessionId,
            sessionsError: null,
            isSending: nextProgress?.turnStatus === 'running',
            activeRequestId: nextProgress?.activeRequestId ?? null,
            thinkingText: nextProgress?.liveThought?.text ?? null,
            thinkingStep: nextProgress?.liveThought?.step ?? nextProgress?.currentStep ?? 'turn_started',
            composerImage: null,
            panelOpen: false,
            panelView: null,
            activeArtifactId: null
          });

          const hasMessages = (get().messages[sessionId] ?? []).length > 0;
          if (!hasMessages) {
            await get().loadSessionMessages(sessionId);
          }
        },

        loadSessionMessages: async (sessionId) => {
          try {
            const response = await listSessionMessages(sessionId);
            const normalizedMessages = (response.messages ?? []).map(normalizeMessage);
            set((state) => ({
              messages: {
                ...state.messages,
                [sessionId]: normalizedMessages
              },
              taskProgressBySession: state.taskProgressBySession[sessionId]
                ? state.taskProgressBySession
                : {
                    ...state.taskProgressBySession,
                    [sessionId]: createDefaultTaskProgress(sessionId)
                  }
            }));
          } catch (error) {
            set({
              sessionsError: error instanceof Error ? error.message : 'Unable to load session messages.'
            });
          }
        },

        sendMessage: async (content, options) => {
          const currentState = get();
          const input = (content ?? currentState.composerValue).trim();
          const attachedImage = currentState.composerImage;
          const imageData = attachedImage?.dataBase64 ?? null;
          const hasImage = Boolean(imageData);

          if ((!input && !hasImage) || currentState.isSending) return;

          const requestedMode = options?.mode;
          let sessionId = get().activeSessionId;
          if (!sessionId) {
            const createdSession = await get().createNewSession();
            sessionId = createdSession?.sessionId ?? null;
          }

          if (!sessionId) {
            set({ sessionsError: 'Unable to create a chat session.' });
            return;
          }

          const requestId = createClientMessageId('client');
          const now = new Date().toISOString();
          const optimisticUserMessage: SessionMessage = {
            id: requestId,
            role: 'user',
            content: input || 'Attached an image.',
            kind: 'input',
            meta: [
              `clientMessageId:${requestId}`,
              `requestId:${requestId}`,
              ...(hasImage ? ['attachment:image'] : [])
            ],
            error: null,
            createdAt: now,
            updatedAt: now
          };

          const initialMediaStatusText = hasImage
            ? 'Preparing image analysis pipeline...'
            : 'Preparing runtime pipeline...';

          const looksLikeChat = !hasImage && isConversationalMessage(input);

          set((state) => ({
            composerValue: '',
            composerImage: null,
            isSending: true,
            activeRequestId: requestId,
            thinkingText: looksLikeChat ? 'Thinking...' : 'Analyzing your request...',
            thinkingStep: looksLikeChat ? 'turn_started' : 'parse_intent',
            sessionsError: null,
            panelOpen: false,
            panelView: null,
            activeArtifactId: null,
            messages: {
              ...state.messages,
              [sessionId!]: upsertMessage(state.messages[sessionId!] ?? [], optimisticUserMessage)
            },
            taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId!, (current) => ({
              ...current,
              planId: null,
              tasks: looksLikeChat ? [] : applyStepStatusToTasks(cloneDefaultTasks(), 'parse_intent', 'running'),
              activities: [],
              stageEventsByAction: looksLikeChat
                ? createEmptyStageEventMap()
                : appendStageEvent(
                    createEmptyStageEventMap(),
                    'parse_intent',
                    {
                      id: createClientMessageId('stage-parse'),
                      source: 'activity',
                      step: 'parse_intent',
                      status: 'running',
                      text: 'Analyzing your request...',
                      detail: hasImage ? 'mode:image-input' : 'mode:text-input',
                      createdAt: now
                    }
                  ),
              activeStageAction: looksLikeChat ? null : 'parse_intent',
              currentStep: looksLikeChat ? null : 'parse_intent',
              currentStepStatus: looksLikeChat ? null : 'running',
              liveThought: looksLikeChat
                ? null
                : {
                    text: 'Analyzing your request...',
                    step: 'parse_intent',
                    updatedAt: now,
                    requestId
                  },
              turnStatus: 'running',
              activeRequestId: requestId,
              mediaStage: looksLikeChat ? 'idle' : 'queued',
              mediaStatusText: looksLikeChat ? null : initialMediaStatusText,
              mediaType: null,
              mediaUrl: null,
              lastTerminalAt: null
            }))
          }));

          const ensureSocketOpen = async (): Promise<WebSocket | null> => {
            if (typeof window === 'undefined') return null;
            const currentSocket = socket;
            if (currentSocket && currentSocket.readyState === WebSocket.OPEN) return currentSocket;

            get().connectWebSocket();
            const candidateSocket = socket;
            if (!candidateSocket) return null;
            if (candidateSocket.readyState === WebSocket.OPEN) return candidateSocket;
            if (candidateSocket.readyState !== WebSocket.CONNECTING) return null;

            return await new Promise<WebSocket | null>((resolve) => {
              let settled = false;
              const finish = (value: WebSocket | null) => {
                if (settled) return;
                settled = true;
                candidateSocket.removeEventListener('open', handleOpen);
                candidateSocket.removeEventListener('error', handleCloseOrError);
                candidateSocket.removeEventListener('close', handleCloseOrError);
                resolve(value);
              };
              const handleOpen = () => finish(candidateSocket);
              const handleCloseOrError = () => finish(null);
              candidateSocket.addEventListener('open', handleOpen);
              candidateSocket.addEventListener('error', handleCloseOrError);
              candidateSocket.addEventListener('close', handleCloseOrError);
              window.setTimeout(() => {
                finish(candidateSocket.readyState === WebSocket.OPEN ? candidateSocket : null);
              }, WS_OPEN_WAIT_TIMEOUT_MS);
            });
          };

          const activeSocket = await ensureSocketOpen();
          if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
            const provider = get().activeProviderId !== "auto" ? get().activeProviderId : undefined;
            const payload: Record<string, unknown> = {
              sessionId,
              content: input,
              clientMessageId: requestId,
              requestId,
              idempotencyKey: requestId,
              preferences: provider ? { provider } : undefined
            };
            if (requestedMode) payload.mode = requestedMode;
            if (imageData) payload.imageData = imageData;

            activeSocket.send(JSON.stringify({ type: 'message.send', payload }));
            return;
          }

          try {
            const provider = get().activeProviderId !== "auto" ? get().activeProviderId : undefined;
            const response = await sendSessionMessage(sessionId, {
              content: input,
              imageData: imageData ?? undefined,
              preferences: provider ? { provider } : undefined
            });
            const incomingMessages = (response.messages ?? []).map(normalizeMessage);
            const mediaReady = isMediaScene(response.sceneState.currentScene) && hasMediaUrl(response.sceneState.currentScene);
            const mediaPending = isMediaScene(response.sceneState.currentScene) && !mediaReady;
            const completionTimestamp = nowIso();

            set((state) => ({
              sessions: upsertSession(state.sessions, response.sceneState),
              messages: {
                ...state.messages,
                [sessionId!]: mergeMessages(state.messages[sessionId!] ?? [], incomingMessages)
              },
              isSending: false,
              activeRequestId: null,
              thinkingText: null,
              thinkingStep: 'turn_complete',
              taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId!, (current) => ({
                ...patchTaskProgressFromScene(current, response.sceneState),
                tasks: applyStepStatusToTasks(current.tasks, 'turn_complete', 'completed'),
                activeStageAction: null,
                currentStep: 'turn_complete',
                currentStepStatus: 'completed',
                turnStatus: 'completed',
                activeRequestId: null,
                liveThought: null,
                mediaStage: mediaReady ? 'ready' : mediaPending ? 'syncing' : 'idle',
                mediaStatusText: mediaReady
                  ? 'Video artifact is ready to preview.'
                  : mediaPending
                    ? 'Runtime output is syncing.'
                    : null,
                lastTerminalAt: completionTimestamp
              }))
            }));
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unable to send message.';
            const errorTimestamp = nowIso();
            const assistantError: SessionMessage = {
              id: createClientMessageId('error'),
              role: 'assistant',
              content: errorMessage,
              kind: 'error',
              meta: [`error:${errorMessage}`],
              error: null,
              createdAt: errorTimestamp,
              updatedAt: errorTimestamp
            };

            set((state) => ({
              sessionsError: errorMessage,
              isSending: false,
              activeRequestId: null,
              thinkingText: null,
              thinkingStep: 'turn_error',
              messages: {
                ...state.messages,
                [sessionId!]: upsertMessage(state.messages[sessionId!] ?? [], assistantError)
              },
              taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId!, (current) => ({
                ...current,
                tasks: applyStepStatusToTasks(current.tasks, 'turn_error', 'failed'),
                activeStageAction: mapStepToAction(current.currentStep) ?? mapStepToAction('turn_error'),
                currentStep: 'turn_error',
                currentStepStatus: 'failed',
                turnStatus: 'failed',
                activeRequestId: null,
                liveThought: {
                  text: errorMessage,
                  step: 'turn_error',
                  updatedAt: errorTimestamp
                },
                mediaStage: current.mediaStage === 'ready' ? 'ready' : 'error',
                mediaStatusText: errorMessage,
                lastTerminalAt: errorTimestamp
              }))
            }));
          }
        },

        sendSceneCommand: async (command) => {
          const sessionId = get().activeSessionId;
          if (!sessionId) return;

          try {
            let response: { sceneState: Session } | null = null;
            if (command === 'undo') response = await undoScene(sessionId);
            else if (command === 'redo') response = await redoScene(sessionId);
            else if (command === 'artifact.previous') response = await previousArtifact(sessionId);
            else if (command === 'artifact.next') response = await nextArtifact(sessionId);
            else if (command === 'version.previous' || command === 'version.next') {
              const selectedSession = get().sessions.find((session) => session.sessionId === sessionId) ?? null;
              if (!selectedSession) return;

              let versions = Array.isArray(selectedSession.versions) ? selectedSession.versions : [];
              let versionPointer = typeof selectedSession.versionPointer === 'number' ? selectedSession.versionPointer : -1;

              if (versions.length === 0) {
                const versionList = await listVersions(sessionId);
                const currentVersionId = selectedSession.currentScene?.versionId ?? null;
                const listedCurrentIndex = versionList.versions.findIndex((v) => v.isCurrent || (currentVersionId ? v.versionId === currentVersionId : false));

                const mergedSession: Session = {
                  ...selectedSession,
                  ...versionList,
                  versions: versionList.versions,
                  sceneVersions: versionList.versions,
                  artifacts: versionList.artifacts ?? selectedSession.artifacts,
                  currentScene: listedCurrentIndex >= 0 ? versionList.versions[listedCurrentIndex] : selectedSession.currentScene
                };

                set((state) => ({
                  sessions: upsertSession(state.sessions, mergedSession),
                  sessionsError: null,
                  taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, mergedSession.sessionId, (current) => patchTaskProgressFromScene(current, mergedSession))
                }));
                versions = versionList.versions;
                versionPointer = versionList.versionPointer;
              }

              if (versions.length <= 1) return;
              if (versionPointer < 0 || versionPointer >= versions.length) {
                const selectedSessionLatest = get().sessions.find((s) => s.sessionId === sessionId) ?? selectedSession;
                const currentVersionId = selectedSessionLatest.currentScene?.versionId ?? null;
                versionPointer = versions.findIndex((v) => currentVersionId ? v.versionId === currentVersionId : (v as any).isCurrent === true);
              }
              if (versionPointer < 0) return;

              const nextPointer = command === 'version.previous' ? versionPointer - 1 : versionPointer + 1;
              if (nextPointer < 0 || nextPointer >= versions.length) return;
              response = await selectVersion(sessionId, versions[nextPointer].versionId);
            }

            const nextSceneState = response?.sceneState;
            if (!nextSceneState) return;

            set((state) => ({
              sessions: upsertSession(state.sessions, nextSceneState),
              sessionsError: null,
              taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, nextSceneState.sessionId, (current) => patchTaskProgressFromScene(current, nextSceneState))
            }));
          } catch (error) {
            set({ sessionsError: error instanceof Error ? error.message : 'Scene history command failed.' });
          }
        },

        selectSceneVersion: async (versionId) => {
          const sessionId = get().activeSessionId;
          const normalizedVersionId = String(versionId ?? '').trim();
          if (!sessionId || !normalizedVersionId) return false;

          try {
            const response = await selectVersion(sessionId, normalizedVersionId);
            const nextSceneState = response?.sceneState;
            if (!nextSceneState) return false;

            set((state) => ({
              sessions: upsertSession(state.sessions, nextSceneState),
              sessionsError: null,
              taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, nextSceneState.sessionId, (current) => patchTaskProgressFromScene(current, nextSceneState))
            }));
            return true;
          } catch (error) {
            set({ sessionsError: error instanceof Error ? error.message : 'Version selection failed.' });
            return false;
          }
        },

        rerunScene: async (options) => {
          const sessionId = get().activeSessionId;
          if (!sessionId) return false;

          const selectedSession = get().sessions.find((s) => s.sessionId === sessionId) ?? null;
          const selectedScene = selectedSession?.currentScene ?? null;
          const rerunCode = (typeof options?.codeOverride === 'string' ? options.codeOverride : null) ?? selectedScene?.code ?? null;

          if (!rerunCode || !rerunCode.trim()) {
            set({ sessionsError: 'No scene code is available to rerun.' });
            return false;
          }

          try {
            const response = await apiModifyVisual({
              sessionId,
              instruction: 'Rerun current scene.',
              runMode: 'rerun',
              codeOverride: rerunCode
            });
            const nextSceneState = response?.sceneState;
            if (!nextSceneState) return false;

            set((state) => ({
              sessions: upsertSession(state.sessions, nextSceneState),
              sessionsError: null,
              taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, nextSceneState.sessionId, (current) => patchTaskProgressFromScene(current, nextSceneState))
            }));
            return true;
          } catch (error) {
            set({ sessionsError: error instanceof Error ? error.message : 'Scene rerun failed.' });
            return false;
          }
        },

        stopTurn: () => {
          const requestId = get().activeRequestId;
          const sessionId = get().activeSessionId;
          const abortedAt = nowIso();
          if (requestId && sessionId && socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'turn.abort', payload: { sessionId, requestId } }));
          }

          set((state) => ({
            isSending: false,
            activeRequestId: null,
            thinkingText: null,
            thinkingStep: 'turn_aborted',
            taskProgressBySession: sessionId
              ? updateTaskProgressMap(state.taskProgressBySession, sessionId, (current) => ({
                  ...current,
                  tasks: applyStepStatusToTasks(current.tasks, current.currentStep ?? 'sync_state', 'failed'),
                  activeStageAction: mapStepToAction(current.currentStep) ?? mapStepToAction('turn_error'),
                  currentStep: 'turn_error',
                  currentStepStatus: 'failed',
                  turnStatus: 'failed',
                  activeRequestId: null,
                  liveThought: { text: 'Turn was stopped by user.', step: 'turn_error', updatedAt: abortedAt },
                  mediaStage: current.mediaStage === 'ready' ? 'ready' : 'error',
                  mediaStatusText: 'Turn was stopped by user.',
                  lastTerminalAt: abortedAt
                }))
              : state.taskProgressBySession
          }));
        },

        connectWebSocket: () => {
          if (typeof window === 'undefined') return;
          if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

          const websocketUrl = resolveWebSocketUrl();
          set({ connectionState: 'connecting' });

          const nextSocket = new WebSocket(websocketUrl);
          socket = nextSocket;
          let resumeRequestedOnOpen = false;

          nextSocket.addEventListener('open', () => {
            set({ connectionState: 'open' });
            const activeSessionId = get().activeSessionId;
            resumeRequestedOnOpen = shouldReplayOnReconnect && Boolean(activeSessionId) && lastSequence > 0;
            if (resumeRequestedOnOpen) {
              nextSocket.send(JSON.stringify({ type: 'session.resume', payload: { sessionId: activeSessionId, lastSeq: lastSequence } }));
            }
            shouldReplayOnReconnect = false;
          });

          nextSocket.addEventListener('message', (event) => {
            try {
              const parsed = JSON.parse(event.data);
              if (!parsed.type) return;

              if (typeof parsed.seq === 'number') {
                if (parsed.seq <= lastSequence) return;
                lastSequence = parsed.seq;
              }

              const payload = parsed.payload ?? {};
              const nestedPayload = payload.payload && typeof payload.payload === 'object' ? payload.payload : null;
              const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : (typeof nestedPayload?.sessionId === 'string' ? nestedPayload.sessionId : null);
              const activeSessionId = get().activeSessionId;
              const eventTargetsActiveSession = !sessionId || !activeSessionId || activeSessionId === sessionId;
              const payloadRequestId = typeof payload.requestId === 'string' && payload.requestId.trim() ? payload.requestId.trim() : null;
              const activeRequestId = get().activeRequestId;
              const eventTargetsActiveRequest = Boolean(payloadRequestId && activeRequestId && payloadRequestId === activeRequestId);

              if (parsed.type === 'connection:ready') {
                const latestSeq = typeof payload.latestSeq === 'number' ? payload.latestSeq : null;
                if (!resumeRequestedOnOpen && latestSeq !== null) lastSequence = Math.max(lastSequence, latestSeq);
                set({ connectionState: 'open' });
                return;
              }

              if (parsed.type === 'session:resumed') {
                set({ connectionState: 'open' });
                return;
              }

              if (parsed.type === 'message:created' || parsed.type === 'message:update' || parsed.type === 'message.append') {
                if (!sessionId || !payload.message) return;
                const normalized = normalizeMessage(payload.message);
                set((state) => ({
                  messages: { ...state.messages, [sessionId]: upsertMessage(state.messages[sessionId] ?? [], normalized) },
                  sessions: sortSessionsByUpdatedAt(state.sessions.map(s => s.sessionId === sessionId ? { ...s, updatedAt: normalized.updatedAt ?? s.updatedAt } : s))
                }));
                return;
              }

              if (parsed.type === 'message:ack') {
                if ((payload.status === 'accepted' || payload.status === 'duplicate') && (eventTargetsActiveSession || eventTargetsActiveRequest)) {
                  const ackSessionId = sessionId ?? activeSessionId;
                  const completedAt = nowIso();
                  set((state) => {
                    const ackProgress = ackSessionId ? state.taskProgressBySession[ackSessionId] : null;
                    const shouldFinalize = Boolean(ackProgress && ackProgress.turnStatus === 'running');
                    return {
                      isSending: shouldFinalize ? false : state.isSending,
                      activeRequestId: shouldFinalize ? null : state.activeRequestId,
                      thinkingText: shouldFinalize ? null : state.thinkingText,
                      thinkingStep: shouldFinalize ? 'turn_complete' : state.thinkingStep,
                      taskProgressBySession: shouldFinalize && ackSessionId ? updateTaskProgressMap(state.taskProgressBySession, ackSessionId, c => ({
                        ...c,
                        tasks: applyStepStatusToTasks(c.tasks, 'turn_complete', 'completed'),
                        activeStageAction: null,
                        currentStep: 'turn_complete',
                        currentStepStatus: 'completed',
                        turnStatus: 'completed',
                        activeRequestId: null,
                        liveThought: null,
                        mediaStage: ['ready', 'error', 'idle'].includes(c.mediaStage) ? c.mediaStage : 'syncing',
                        mediaStatusText: ['ready', 'error'].includes(c.mediaStage) ? c.mediaStatusText : (c.mediaStage === 'idle' ? null : 'Runtime output is syncing.'),
                        lastTerminalAt: completedAt
                      })) : state.taskProgressBySession
                    };
                  });
                }
                return;
              }

              if (parsed.type === 'orchestration:plan') {
                if (!sessionId) return;
                const planId = typeof payload.planId === 'string' ? payload.planId : null;
                const tasks = normalizeTaskList(payload.tasks);
                set((state) => ({
                  taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId, c => ({ ...c, planId, tasks, turnStatus: c.turnStatus === 'idle' ? 'running' : c.turnStatus, activeStageAction: c.activeStageAction ?? findRunningStageAction(tasks) }))
                }));
                return;
              }

              if (parsed.type === 'orchestration:step') {
                if (!sessionId) return;
                const step = typeof payload.step === 'string' ? payload.step : null;
                const stepStatus = normalizeTaskStatus(payload.status, 'running');
                const stepText = typeof nestedPayload?.message === 'string' ? nestedPayload.message : null;
                const stepAction = mapStepToAction(step);
                const stepDetail = formatOrchestrationEventDetail(nestedPayload);
                const stepCreatedAt = nowIso();

                set((state) => {
                  let nextThinkingStep = state.thinkingStep;
                  let nextIsSending = state.isSending;
                  const nextTP = updateTaskProgressMap(state.taskProgressBySession, sessionId, c => {
                    const nextTasks = applyStepStatusToTasks(c.tasks, step, stepStatus);
                    const next = { ...c, tasks: nextTasks, currentStep: step, currentStepStatus: stepStatus };
                    if (stepAction && step) {
                      next.stageEventsByAction = appendStageEvent(next.stageEventsByAction, stepAction, { id: createClientMessageId(`stage-${stepAction}`), source: 'orchestration', step, status: stepStatus, text: stepText ?? formatOrchestrationEventText(step, stepStatus), detail: stepDetail, createdAt: stepCreatedAt });
                    }
                    if (step === 'turn_error' || stepStatus === 'failed') {
                      next.turnStatus = 'failed';
                      if (next.mediaStage !== 'ready') {
                        next.mediaStage = 'error';
                        next.mediaStatusText = stepText ?? 'Turn failed while processing runtime output.';
                      }
                    } else if (step === 'turn_complete') {
                      next.turnStatus = 'completed';
                    } else if (next.turnStatus !== 'completed' && next.turnStatus !== 'failed') {
                      next.turnStatus = 'running';
                    }
                    if (next.turnStatus === 'running') {
                      if (['generate_code', 'code_generated', 'code_modified'].includes(step!)) {
                        next.mediaStage = 'generating';
                        next.mediaStatusText = 'Generating runtime output...';
                      } else if (['execute_code', 'executing'].includes(step!)) {
                        next.mediaStage = 'executing';
                        next.mediaStatusText = 'Executing runtime workload...';
                      } else if (step === 'sync_state') {
                        next.mediaStage = 'syncing';
                        next.mediaStatusText = 'Syncing runtime output...';
                      }
                    }
                    next.activeStageAction = resolveActiveStageAction(c.activeStageAction, nextTasks, stepAction, stepStatus);
                    return next;
                  });
                  if (eventTargetsActiveSession && step) {
                    nextThinkingStep = step;
                    nextIsSending = step !== 'turn_complete' && step !== 'turn_error';
                  }
                  return { taskProgressBySession: nextTP, thinkingStep: nextThinkingStep, isSending: nextIsSending };
                });
                return;
              }

              if (parsed.type === 'agent:activity') {
                if (!sessionId) return;
                const step = typeof payload.step === 'string' ? payload.step : 'turn_started';
                const incomingStatus = normalizeTaskStatus(payload.status, 'running');
                const activity: AgentActivityEvent = {
                  id: typeof payload.id === 'string' ? payload.id : createClientMessageId('activity'),
                  sessionId,
                  messageId: typeof payload.messageId === 'string' ? payload.messageId : null,
                  step,
                  status: incomingStatus,
                  tone: ['progress', 'success', 'error'].includes(payload.tone) ? payload.tone : undefined,
                  text: typeof payload.text === 'string' && payload.text.trim() ? payload.text : 'Processing step...',
                  technicalDetail: typeof payload.technicalDetail === 'string' ? payload.technicalDetail : null,
                  createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : nowIso()
                };
                const activityAction = mapStepToAction(step);

                set((state) => {
                  let nextThinkingText = state.thinkingText;
                  let nextThinkingStep = state.thinkingStep;
                  let nextIsSending = state.isSending;
                  const nextTP = updateTaskProgressMap(state.taskProgressBySession, sessionId, c => {
                    const activities = c.activities.some(e => e.id === activity.id) ? c.activities : [...c.activities, activity].slice(-MAX_ACTIVITY_ENTRIES);
                    const nextTasks = applyStepStatusToTasks(c.tasks, step, incomingStatus);
                    const next = { ...c, activities, tasks: nextTasks, currentStep: step, currentStepStatus: incomingStatus };
                    if (activityAction) {
                      next.stageEventsByAction = appendStageEvent(next.stageEventsByAction, activityAction, { id: activity.id, source: 'activity', step, status: incomingStatus, text: activity.text, detail: activity.technicalDetail ?? null, createdAt: activity.createdAt! });
                    }
                    if (incomingStatus === 'failed' || step === 'turn_error' || activity.tone === 'error') {
                      next.turnStatus = 'failed';
                      if (next.mediaStage !== 'ready') {
                        next.mediaStage = 'error';
                        next.mediaStatusText = activity.text;
                      }
                    } else if (step === 'turn_complete') {
                      next.turnStatus = 'completed';
                    } else if (next.turnStatus !== 'completed' && next.turnStatus !== 'failed') {
                      next.turnStatus = 'running';
                    }
                    if (next.turnStatus === 'running') {
                      if (['generate_code', 'code_generated', 'code_modified'].includes(step)) {
                        next.mediaStage = 'generating';
                        next.mediaStatusText = activity.text;
                      } else if (['execute_code', 'executing'].includes(step)) {
                        next.mediaStage = 'executing';
                        next.mediaStatusText = activity.text;
                      } else if (step === 'sync_state') {
                        next.mediaStage = 'syncing';
                        next.mediaStatusText = activity.text;
                      }
                    }
                    next.activeStageAction = resolveActiveStageAction(c.activeStageAction, nextTasks, activityAction, incomingStatus);
                    return next;
                  });
                  if (eventTargetsActiveSession) {
                    nextThinkingText = activity.text;
                    nextThinkingStep = step;
                    nextIsSending = incomingStatus === 'running' || step === 'turn_started';
                  }
                  return { taskProgressBySession: nextTP, thinkingText: nextThinkingText, thinkingStep: nextThinkingStep, isSending: nextIsSending };
                });
                return;
              }

              if (parsed.type === 'generation:started' || parsed.type === 'code:started') {
                if (!sessionId) return;
                set((state) => ({ taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId, c => ({ ...c, mediaStage: c.turnStatus === 'running' ? 'generating' : c.mediaStage, mediaStatusText: c.turnStatus === 'running' ? 'Generating runtime output...' : c.mediaStatusText })) }));
                return;
              }

              if (parsed.type === 'generation:progress' || parsed.type === 'code:stream') {
                if (!sessionId) return;
                const progress = typeof payload.progress === 'number' ? payload.progress : null;
                const tokens = typeof payload.tokens === 'number' ? payload.tokens : null;
                const total = typeof payload.estimatedTotal === 'number' ? payload.estimatedTotal : null;
                const statusMessage = typeof payload.message === 'string' ? payload.message : null;
                set((state) => ({
                  taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId, c => ({
                    ...c,
                    mediaStage: c.turnStatus === 'running' ? 'generating' : c.mediaStage,
                    mediaStatusText: statusMessage ?? (progress !== null ? `Generating... ${progress}%` : (tokens !== null && total !== null ? `Generating... ${tokens} / ${total} tokens` : 'Generating runtime output...'))
                  }))
                }));
                return;
              }

              if (parsed.type === 'generation:complete' || parsed.type === 'code:update') {
                if (!sessionId) return;
                const outputKind = typeof payload.outputKind === 'string' ? payload.outputKind : null;
                const mediaType = typeof payload.mediaType === 'string' ? payload.mediaType : null;
                const mediaUrl = typeof payload.mediaUrl === 'string' ? payload.mediaUrl : null;
                const runtimeStatus = typeof payload.runtimeStatus === 'string' ? payload.runtimeStatus : null;
                const runtimeWarning = typeof payload.runtimeWarning === 'string' ? payload.runtimeWarning.trim() : '';
                const generationWarning = typeof payload.generationWarning === 'string' ? payload.generationWarning.trim() : '';
                const mediaExpected = outputKind === 'media' || (typeof mediaType === 'string' && mediaType.startsWith('video/'));
                const mediaReady = Boolean(mediaUrl && mediaUrl !== 'about:blank');
                const mediaUnavailable = mediaExpected && !mediaReady && (['degraded', 'skipped', 'error'].includes(runtimeStatus!) || runtimeWarning.length > 0 || generationWarning.length > 0);

                set((state) => ({
                  isSending: false,
                  activeRequestId: null,
                  thinkingText: null,
                  thinkingStep: 'turn_complete',
                  taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId, c => ({
                    ...c,
                    turnStatus: 'completed',
                    mediaStage: mediaExpected ? (mediaReady ? 'ready' : (mediaUnavailable ? 'error' : (c.turnStatus === 'running' ? 'syncing' : 'error'))) : c.mediaStage,
                    mediaStatusText: mediaExpected ? (mediaReady ? 'Video artifact is ready to preview.' : (mediaUnavailable ? (runtimeWarning || generationWarning || 'Video artifact is unavailable for this run.') : (c.turnStatus === 'running' ? 'Video artifact is still syncing.' : 'Video artifact is unavailable for this run.'))) : c.mediaStatusText,
                    mediaType: mediaType ?? c.mediaType,
                    mediaUrl: mediaReady ? mediaUrl : c.mediaUrl
                  }))
                }));
                return;
              }

              if (parsed.type === 'thought:stream') {
                if (!sessionId) return;
                const thought = typeof payload.thought === 'string' ? payload.thought : null;
                const thoughtStep = typeof payload.step === 'string' ? payload.step : 'thought';
                const isFinal = payload.isFinal === true;
                const thoughtRequestId = typeof payload.requestId === 'string' ? payload.requestId.trim() : null;
                const thoughtMessageId = typeof payload.messageId === 'string' ? payload.messageId.trim() : null;
                const thoughtDurationMs = typeof payload.durationMs === 'number' ? payload.durationMs : null;
                const thoughtStepLabel = typeof payload.stepLabel === 'string' ? payload.stepLabel : null;
                const thoughtDetail = typeof payload.detail === 'string' ? payload.detail : null;
                const thoughtStatus = typeof payload.status === 'string' ? payload.status : null;

                if (thought) {
                  const updatedAt = nowIso();
                  set((state) => ({
                    thinkingText: eventTargetsActiveSession ? thought : state.thinkingText,
                    thinkingStep: eventTargetsActiveSession ? thoughtStep : state.thinkingStep,
                    taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId, c => ({
                      ...c,
                      currentStep: thoughtStep,
                      currentStepStatus: c.currentStepStatus ?? 'running',
                      liveThought: { text: thought, step: thoughtStep, updatedAt, requestId: thoughtRequestId, messageId: thoughtMessageId, durationMs: thoughtDurationMs, stepLabel: thoughtStepLabel, detail: thoughtDetail, status: thoughtStatus },
                      turnStatus: c.turnStatus === 'idle' ? 'running' : c.turnStatus,
                      tasks: applyStepStatusToTasks(c.tasks, thoughtStep, 'running')
                    }))
                  }));
                }

                if (sessionId && thought && isFinal) {
                  const now = nowIso();
                  const requestMeta = thoughtRequestId ? `requestId:${thoughtRequestId}` : null;
                  const messageMeta = thoughtMessageId ? `messageId:${thoughtMessageId}` : null;
                  const thoughtMessage: SessionMessage = {
                    id: createClientMessageId(`thought-${thoughtStep}`),
                    role: 'thought',
                    content: thought,
                    kind: 'thought',
                    meta: [thoughtStep, requestMeta, messageMeta, thoughtDurationMs != null ? `durationMs:${thoughtDurationMs}` : null, thoughtStepLabel ? `stepLabel:${thoughtStepLabel}` : null, thoughtDetail ? `detail:${thoughtDetail}` : null, thoughtStatus ? `status:${thoughtStatus}` : null].filter(Boolean) as string[],
                    error: null,
                    createdAt: now,
                    updatedAt: now
                  };
                  set((state) => {
                    const existing = state.messages[sessionId] ?? [];
                    const duplicate = existing.some(m => isThoughtMessage(m) && m.content.trim() === thought.trim() && m.meta?.[0] === thoughtStep && (!requestMeta || m.meta?.includes(requestMeta)) && (!messageMeta || m.meta?.includes(messageMeta)));
                    if (duplicate) return state;
                    return { messages: { ...state.messages, [sessionId]: upsertMessage(existing, thoughtMessage) } };
                  });
                }
                return;
              }

              if (parsed.type === 'scene:update') {
                const sceneState = payload.sceneState as Session | undefined;
                if (!sceneState?.sessionId) return;
                set((state) => ({ sessions: upsertSession(state.sessions, sceneState), taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sceneState.sessionId, c => patchTaskProgressFromScene(c, sceneState)) }));
                return;
              }

              if (parsed.type === 'turn:started') {
                if (!eventTargetsActiveSession) return;
                const startedAt = nowIso();
                set((state) => ({
                  isSending: true,
                  taskProgressBySession: sessionId ? updateTaskProgressMap(state.taskProgressBySession, sessionId, c => ({
                    ...c,
                    tasks: applyStepStatusToTasks(c.tasks, 'turn_started', 'running'),
                    activeStageAction: 'parse_intent',
                    currentStep: 'turn_started',
                    currentStepStatus: 'running',
                    turnStatus: 'running',
                    activeRequestId: payloadRequestId ?? c.activeRequestId,
                    lastTerminalAt: null,
                    mediaStage: c.mediaStage === 'ready' ? 'ready' : 'queued',
                    mediaStatusText: c.mediaStage === 'ready' ? c.mediaStatusText : 'Preparing runtime pipeline...',
                    liveThought: c.liveThought ?? { text: 'Analyzing your request...', step: 'turn_started', updatedAt: startedAt, requestId: payloadRequestId }
                  })) : state.taskProgressBySession
                }));
                return;
              }

              if (parsed.type === 'turn:complete') {
                if (!eventTargetsActiveSession && !eventTargetsActiveRequest) return;
                const completedAt = nowIso();
                const compSessionId = sessionId ?? activeSessionId;
                const outputKind = typeof payload.outputKind === 'string' ? payload.outputKind : null;
                const mediaType = typeof payload.mediaType === 'string' ? payload.mediaType : null;
                const mediaUrl = typeof payload.mediaUrl === 'string' ? payload.mediaUrl : null;
                const mediaExpected = outputKind === 'media' || (typeof mediaType === 'string' && mediaType.startsWith('video/'));
                const mediaReady = Boolean(mediaUrl && mediaUrl !== 'about:blank');
                const runtimeStatus = typeof payload.runtimeStatus === 'string' ? payload.runtimeStatus : null;
                const runtimeWarning = typeof payload.runtimeWarning === 'string' ? payload.runtimeWarning.trim() : '';
                const generationWarning = typeof payload.generationWarning === 'string' ? payload.generationWarning.trim() : '';
                const mediaUnavailable = mediaExpected && !mediaReady && (['degraded', 'skipped', 'error'].includes(runtimeStatus!) || runtimeWarning.length > 0 || generationWarning.length > 0);

                set((state) => ({
                  isSending: false, activeRequestId: null, thinkingText: null, thinkingStep: 'turn_complete',
                  taskProgressBySession: compSessionId ? updateTaskProgressMap(state.taskProgressBySession, compSessionId, c => ({
                    ...c,
                    tasks: applyStepStatusToTasks(c.tasks, 'turn_complete', 'completed'),
                    activeStageAction: null, currentStep: 'turn_complete', currentStepStatus: 'completed', turnStatus: 'completed', activeRequestId: null, liveThought: null,
                    mediaStage: mediaExpected ? (mediaReady ? 'ready' : 'error') : (c.mediaStage === 'ready' ? 'ready' : (c.mediaStage === 'error' ? 'error' : 'idle')),
                    mediaStatusText: mediaExpected ? (mediaReady ? 'Video artifact is ready to preview.' : (mediaUnavailable ? (runtimeWarning || generationWarning || 'Video artifact is unavailable for this run.') : 'Video artifact is unavailable for this run.')) : null,
                    mediaType: mediaType ?? c.mediaType, mediaUrl: mediaReady ? mediaUrl : null, lastTerminalAt: completedAt
                  })) : state.taskProgressBySession
                }));
                return;
              }

              if (parsed.type === 'generation:error' || parsed.type === 'code:error') {
                if (!sessionId) return;
                const msg = typeof payload.message === 'string' ? payload.message : 'Generation failed';
                const code = typeof payload.code === 'string' ? payload.code : 'GENERATION_ERROR';
                const failedAt = nowIso();
                set((state) => ({
                  taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId, c => ({
                    ...c, mediaStage: 'error', mediaStatusText: msg,
                    stageEventsByAction: appendStageEvent(c.stageEventsByAction, c.activeStageAction ?? 'generate_code', { id: createClientMessageId(`gen-err-${code}`), source: 'error', step: c.currentStep ?? 'generate_code', status: 'failed', text: msg, detail: code, createdAt: failedAt })
                  }))
                }));
                return;
              }

              if (parsed.type === 'thinking:analysis_failed') {
                if (!sessionId) return;
                const msg = typeof payload.message === 'string' ? payload.message : 'Analysis failed';
                const failedAt = nowIso();
                set((state) => ({
                  thinkingText: eventTargetsActiveSession ? msg : state.thinkingText,
                  thinkingStep: eventTargetsActiveSession ? 'turn_error' : state.thinkingStep,
                  taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId, c => ({
                    ...c, liveThought: { text: msg, step: 'turn_error', updatedAt: failedAt },
                    stageEventsByAction: appendStageEvent(c.stageEventsByAction, 'parse_intent', { id: createClientMessageId('analysis-failed'), source: 'error', step: 'parse_intent', status: 'failed', text: 'Analysis failed', detail: msg, createdAt: failedAt })
                  }))
                }));
                return;
              }

              if (parsed.type === 'turn:error') {
                if (!eventTargetsActiveSession && !eventTargetsActiveRequest) return;
                const msg = (typeof payload.message === 'string' && payload.message.trim()) || (payload.error?.userMessage) || 'Turn failed';
                const code = payload.error?.code || null;
                if (sessionId) {
                  const now = nowIso();
                  set((state) => ({
                    messages: (() => {
                      const existing = state.messages[sessionId] ?? [];
                      const reqMeta = payloadRequestId ? `requestId:${payloadRequestId}` : null;
                      if (reqMeta && existing.some(m => m.role === 'assistant' && m.meta?.includes(reqMeta))) return state.messages;
                      if (existing.some(m => m.role === 'assistant' && String(m.content).trim() === msg && (m.kind === 'error' || m.error || m.meta?.some(e => e.startsWith('error:'))))) return state.messages;
                      return { ...state.messages, [sessionId]: upsertMessage(existing, { id: createClientMessageId('turn-error'), role: 'assistant', content: msg, kind: 'error', meta: [`error:${code ?? msg}`, reqMeta].filter(Boolean) as string[], error: payload.error || null, createdAt: now, updatedAt: now }) };
                    })()
                  }));
                }
                const failedAt = nowIso();
                const fSessionId = sessionId ?? activeSessionId;
                set((state) => ({
                  isSending: false, activeRequestId: null, thinkingText: null, thinkingStep: 'turn_error',
                  taskProgressBySession: fSessionId ? updateTaskProgressMap(state.taskProgressBySession, fSessionId, c => ({
                    ...c, tasks: applyStepStatusToTasks(c.tasks, 'turn_error', 'failed'), activeStageAction: mapStepToAction(c.currentStep) ?? mapStepToAction('turn_error'), currentStep: 'turn_error', currentStepStatus: 'failed', turnStatus: 'failed', activeRequestId: null, liveThought: { text: msg, step: 'turn_error', updatedAt: failedAt }, mediaStage: c.mediaStage === 'ready' ? 'ready' : 'error', mediaStatusText: msg, lastTerminalAt: failedAt
                  })) : state.taskProgressBySession
                }));
                return;
              }

              if (parsed.type === 'iteration:update') {
                if (!sessionId) return;
                const iter = payload.iteration as SharedIterationState;
                const prog = payload.progress as any;
                if (!iter || !prog) return;
                set((state) => {
                  const cur = state.iterationState?.iterations ?? [];
                  const updated = iter.iterationNumber === 1 ? [iter] : [...cur.filter(i => i.iterationNumber < iter.iterationNumber), iter];
                  return { iterationState: { isIterating: prog.phase !== 'finalizing' && !iter.isFinal, currentIteration: prog.current, maxIterations: prog.total, currentScore: iter.qualitySignals?.composite ?? state.iterationState?.currentScore ?? 0, threshold: state.iterationState?.threshold ?? 75, phase: prog.phase, iterations: updated, qualityReport: state.iterationState?.qualityReport ?? null, stopReason: state.iterationState?.stopReason ?? null, sessionId } };
                });
                return;
              }

              if (parsed.type === 'agent:analysis_complete') {
                const results = payload.results as Record<string, any> ?? {};
                const consensus = typeof payload.consensus === 'number' ? payload.consensus : 0;
                const recommendations = (payload.recommendations ?? []) as Array<any>;
                const formatted: Record<string, any> = {};
                Object.entries(results).forEach(([id, r]) => { formatted[id] = { id, name: r.name || id, score: r.score || 0, findings: r.findings || [], recommendations: r.recommendations || [] }; });
                set((state) => ({ agentState: { isAnalyzing: false, results: formatted, consensus, shouldAutoApply: consensus >= 80, recommendations: recommendations.map((r, i) => ({ ...r, priority: i + 1 })), memory: state.agentState?.memory ?? [], lastAnalyzedAt: nowIso() } }));
                return;
              }

              if (parsed.type === 'tasks:planned' || parsed.type === 'task:started' || parsed.type === 'task:completed' || parsed.type === 'task:failed') {
                if (!sessionId) return;
                const createdAt = nowIso();
                set((state) => ({
                  taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId, c => {
                    if (parsed.type === 'tasks:planned') return { ...c, planId: payload.planId, turnStatus: c.turnStatus === 'idle' ? 'running' : c.turnStatus };
                    const taskId = payload.taskId;
                    const action = payload.action ?? (parsed.type === 'task:completed' || parsed.type === 'task:failed' ? c.tasks.find(t => t.id === taskId)?.action : null) ?? c.currentStep;
                    const status = parsed.type === 'task:started' ? 'running' : normalizeTaskStatus(payload.status, parsed.type === 'task:failed' ? 'failed' : 'completed');
                    const nextTasks = applyStepStatusToTasks(c.tasks, action, status);
                    const nextStageEvents = action && (action as any in ORCHESTRATION_STEP_TO_ACTION) ? appendStageEvent(c.stageEventsByAction, action as any, { id: createClientMessageId(`task-ev-${taskId}`), source: 'task', step: action, status, text: `Task ${action} ${status}`, detail: parsed.type === 'task:completed' ? `Duration: ${(payload.durationMs / 1000).toFixed(2)}s` : (parsed.type === 'task:failed' ? payload.message : `Task started`), createdAt }) : c.stageEventsByAction;
                    return { ...c, tasks: nextTasks, stageEventsByAction: nextStageEvents, currentStep: action, currentStepStatus: status, turnStatus: (status === 'failed' ? 'failed' : (c.turnStatus === 'idle' ? 'running' : c.turnStatus)), activeStageAction: (status === 'running' ? (action as any) : c.activeStageAction), mediaStage: status === 'failed' && c.mediaStage !== 'ready' ? 'error' : c.mediaStage, mediaStatusText: status === 'failed' ? payload.message : c.mediaStatusText };
                  })
                }));
                return;
              }

              if (parsed.type === 'message:error') {
                const msg = typeof payload.message === 'string' && payload.message.trim() ? payload.message : 'Turn failed';
                const failedAt = nowIso();
                const errSessionId = sessionId ?? activeSessionId;
                set((state) => ({
                  isSending: false, activeRequestId: null, thinkingText: null, thinkingStep: 'turn_error',
                  taskProgressBySession: errSessionId ? updateTaskProgressMap(state.taskProgressBySession, errSessionId, c => ({
                    ...c, tasks: applyStepStatusToTasks(c.tasks, 'turn_error', 'failed'), activeStageAction: mapStepToAction(c.currentStep) ?? mapStepToAction('turn_error'), currentStep: 'turn_error', currentStepStatus: 'failed', turnStatus: 'failed', activeRequestId: null, liveThought: { text: msg, step: 'turn_error', updatedAt: failedAt }, mediaStage: c.mediaStage === 'ready' ? 'ready' : 'error', mediaStatusText: msg, lastTerminalAt: failedAt
                  })) : state.taskProgressBySession
                }));
              }

              if (parsed.type === 'action:block_update') {
                const mId = payload.messageId;
                const bId = payload.blockId;
                const up = payload.updates;
                if (mId && bId && up) get().updateActionBlock(mId, bId, up);
              }
            } catch (err) {
              console.error('WebSocket message parsing error:', err);
            }
          });

          nextSocket.addEventListener('error', () => {
            set({ connectionState: 'error' });
          });

          nextSocket.addEventListener('close', () => {
            if (socket === nextSocket) socket = null;
            if (lastSequence > 0) shouldReplayOnReconnect = true;
            set({ connectionState: 'closed' });
            if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
            reconnectTimer = window.setTimeout(() => {
              reconnectTimer = null;
              get().connectWebSocket();
            }, WS_RECONNECT_DELAY_MS);
          });
        },

        startDraftSession: () => {
          set({
            activeSessionId: null,
            sessionsError: null,
            isSending: false,
            activeRequestId: null,
            thinkingText: null,
            thinkingStep: 'turn_started',
            composerValue: '',
            composerImage: null,
            panelOpen: false,
            panelView: null
          });
        },

        setActiveSession: (sessionId) => {
          if (!sessionId) {
            get().startDraftSession();
            return;
          }
          void get().selectSession(sessionId);
        },

        addSession: (session) => {
          set((state) => ({
            sessions: upsertSession(state.sessions, session),
            activeSessionId: session.sessionId,
            taskProgressBySession: {
              ...state.taskProgressBySession,
              [session.sessionId]: state.taskProgressBySession[session.sessionId] ?? createDefaultTaskProgress(session.sessionId)
            }
          }));
        },

        addMessage: (sessionId, message) => {
          set((state) => ({
            messages: {
              ...state.messages,
              [sessionId]: upsertMessage(state.messages[sessionId] || [], message),
            },
          }));
        },

        setIsSending: (value) => {
          set({ isSending: value });
        },

        setThinking: (text, step = 'turn_started') => {
          const activeSessionId = get().activeSessionId;
          set((state) => ({
            thinkingText: text,
            thinkingStep: step,
            taskProgressBySession: activeSessionId
              ? updateTaskProgressMap(state.taskProgressBySession, activeSessionId, (c) => ({
                  ...c,
                  currentStep: step,
                  currentStepStatus: c.currentStepStatus ?? 'running',
                  liveThought: text ? { text, step, updatedAt: nowIso() } : c.liveThought
                }))
              : state.taskProgressBySession
          }));
        },

        setComposerValue: (value) => set({ composerValue: value }),
        setComposerImage: (image) => set({ composerImage: image }),
        clearComposerImage: () => set({ composerImage: null }),

        openPanel: (view) => {
          set({
            panelOpen: true,
            panelView: view,
            panelWidth: getPanelWidthPreset(view)
          });
        },

        closePanel: () => set({ panelOpen: false, panelView: null }),

        togglePanel: (view) => {
          const state = get();
          if (state.panelOpen && state.panelView === view) {
            set({ panelOpen: false, panelView: null });
          } else {
            get().openPanel(view);
          }
        },

        setPanelWidth: (width) => set({ panelWidth: width }),

        updateIterationState: (state) => set({ iterationState: state }),

        abortIteration: () => {
          const sessionId = get().iterationState?.sessionId;
          if (sessionId && socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'iteration:abort', sessionId }));
          }
          set({ iterationState: null });
        },

        updateAgentState: (state) => set({ agentState: state }),

        setAgentAnalyzing: (isAnalyzing) => {
          const cur = get().agentState;
          if (cur) set({ agentState: { ...cur, isAnalyzing } });
        },

        clearAgentState: () => set({ agentState: null }),

        setActionBlocks: (messageId, blocks) => {
          set((state) => ({
            actionBlocksByMessage: { ...state.actionBlocksByMessage, [messageId]: blocks }
          }));
        },

        updateActionBlock: (messageId, blockId, updates) => {
          set((state) => {
            const blocks = state.actionBlocksByMessage[messageId] ?? [];
            const updated = blocks.map(b => b.id === blockId ? { ...b, ...updates } : b);
            return { actionBlocksByMessage: { ...state.actionBlocksByMessage, [messageId]: updated } };
          });
        },

        setCurrentTurnCheckpoints: (checkpoints) => set({ currentTurnCheckpoints: checkpoints }),
        setCurrentMessageId: (messageId) => set({ currentMessageId: messageId }),
        clearActionBlocks: (messageId) => {
          set((state) => {
            const { [messageId]: omitted, ...remaining } = state.actionBlocksByMessage;
            void omitted;
            return { actionBlocksByMessage: remaining };
          });
        },

        clearSession: (sessionId) => {
          set((state) => {
            const { [sessionId]: omittedM, ...remainingM } = state.messages;
            const { [sessionId]: omittedTP, ...remainingTP } = state.taskProgressBySession;
            void omittedM; void omittedTP;
            return {
              sessions: state.sessions.filter(s => s.sessionId !== sessionId),
              messages: remainingM,
              taskProgressBySession: remainingTP,
              activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
            };
          });
        },

        openTheaterMode: (artifactId) => set({ activeArtifactId: artifactId }),
        closeTheaterMode: () => set({ activeArtifactId: null })
      }),
      {
        name: 'terranet-chat-storage',
        partialize: (state) => ({
          sessions: state.sessions,
          messages: state.messages,
          activeSessionId: state.activeSessionId,
          taskProgressBySession: state.taskProgressBySession,
          actionBlocksByMessage: state.actionBlocksByMessage,
          isSidebarCollapsed: state.isSidebarCollapsed,
          panelWidth: state.panelWidth,
        }),
      }
    ),
    { name: 'chatStore' }
  )
);
