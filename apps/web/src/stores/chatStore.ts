import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import {
  createSession as apiCreateSession,
  listSessionMessages,
  listSessions,
  nextArtifact,
  previousArtifact,
  redoScene,
  resolveWebSocketUrl,
  sendSessionMessage,
  undoScene,
  type SessionMessage as ApiSessionMessage,
  type SessionSceneState
} from '@visual-runtime/shared';

const WS_RECONNECT_DELAY_MS = 750;
const WS_OPEN_WAIT_TIMEOUT_MS = 1200;

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let lastSequence = 0;

function sortSessionsByUpdatedAt(sessions: Session[]): Session[] {
  return [...sessions].sort((left, right) => {
    const leftTimestamp = new Date(left.updatedAt ?? 0).getTime();
    const rightTimestamp = new Date(right.updatedAt ?? 0).getTime();
    return rightTimestamp - leftTimestamp;
  });
}

function normalizeMessage(message: ApiSessionMessage): SessionMessage {
  const now = new Date().toISOString();
  return {
    id: message.id,
    role: message.role,
    content: message.content ?? '',
    kind: message.kind,
    meta: Array.isArray(message.meta) ? message.meta : [],
    error: message.error ?? null,
    createdAt: message.createdAt ?? now,
    updatedAt: message.updatedAt ?? message.createdAt ?? now
  };
}

function upsertMessage(messages: SessionMessage[], message: SessionMessage): SessionMessage[] {
  const existingIndex = messages.findIndex((item) => item.id === message.id);
  if (existingIndex === -1) {
    return [...messages, message];
  }

  const nextMessages = [...messages];
  nextMessages[existingIndex] = {
    ...nextMessages[existingIndex],
    ...message,
    meta: message.meta ?? nextMessages[existingIndex].meta
  };
  return nextMessages;
}

function mergeMessages(existing: SessionMessage[], incoming: SessionMessage[]): SessionMessage[] {
  return incoming.reduce((messages, message) => upsertMessage(messages, message), existing);
}

function upsertSession(sessions: Session[], session: Session): Session[] {
  const existingIndex = sessions.findIndex((item) => item.sessionId === session.sessionId);
  if (existingIndex === -1) {
    return sortSessionsByUpdatedAt([session, ...sessions]);
  }

  const nextSessions = [...sessions];
  nextSessions[existingIndex] = session;
  return sortSessionsByUpdatedAt(nextSessions);
}

function createClientMessageId(prefix: string): string {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  return `${prefix}-${randomId}`;
}

function isThoughtMessage(message: SessionMessage): boolean {
  return message.role === 'thought' || message.kind === 'thought';
}

// Types
export type Session = SessionSceneState;
export type LiveConnectionState = 'connecting' | 'open' | 'closed' | 'error';
export type SceneHistoryCommand = 'undo' | 'redo' | 'artifact.previous' | 'artifact.next';

export type SessionMessage = ApiSessionMessage;

interface ChatState {
  // Sessions
  sessions: Session[];
  activeSessionId: string | null;
  hasInitialized: boolean;
  isBootstrapping: boolean;
  sessionsError: string | null;
  
  // Messages by session
  messages: Record<string, SessionMessage[]>;
  
  // UI State
  connectionState: LiveConnectionState;
  isSending: boolean;
  activeRequestId: string | null;
  thinkingText: string | null;
  thinkingStep: string;
  showScrollToLatest: boolean;
  
  // Workspace Panel State (new simplified system)
  panelOpen: boolean;
  panelView: 'preview' | 'code' | null;
  panelWidth: number;
  
  // Composer
  composerValue: string;
  isSlashMenuOpen: boolean;
  
  // Actions
  initialize: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  createNewSession: () => Promise<Session | null>;
  selectSession: (sessionId: string) => Promise<void>;
  loadSessionMessages: (sessionId: string) => Promise<void>;
  sendMessage: (content?: string, options?: { mode?: 'modify' | 'generate' }) => Promise<void>;
  sendSceneCommand: (command: SceneHistoryCommand) => Promise<void>;
  stopTurn: () => void;
  connectWebSocket: () => void;
  setActiveSession: (sessionId: string | null) => void;
  addSession: (session: Session) => void;
  addMessage: (sessionId: string, message: SessionMessage) => void;
  setIsSending: (value: boolean) => void;
  setThinking: (text: string | null, step?: string) => void;
  setComposerValue: (value: string) => void;
  
  // Panel Actions (new)
  openPanel: (view: 'preview' | 'code') => void;
  closePanel: () => void;
  togglePanel: (view: 'preview' | 'code') => void;
  setPanelWidth: (width: number) => void;
  
  clearSession: (sessionId: string) => void;
}

export const useChatStore = create<ChatState>()(
  devtools(
    persist(
      (set, get) => ({
        initialize: async () => {
          if (get().isBootstrapping) {
            return;
          }

          if (get().hasInitialized) {
            get().connectWebSocket();
            return;
          }

          set({ isBootstrapping: true, sessionsError: null });

          try {
            await get().refreshSessions();
            set({ hasInitialized: true });
          } catch {
            // refreshSessions records the user-facing error.
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
            const nextActiveSessionId = currentActiveSessionId && sessions.some((session) => session.sessionId === currentActiveSessionId)
              ? currentActiveSessionId
              : sessions[0]?.sessionId ?? null;

            set({
              sessions,
              activeSessionId: nextActiveSessionId,
              sessionsError: null
            });

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

        createNewSession: async () => {
          try {
            const response = await apiCreateSession();
            const session = response.sceneState;

            set((state) => ({
              sessions: upsertSession(state.sessions, session),
              activeSessionId: response.sessionId,
              sessionsError: null,
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
          set({ activeSessionId: sessionId, sessionsError: null });

          const hasMessages = (get().messages[sessionId] ?? []).length > 0;
          if (!hasMessages) {
            await get().loadSessionMessages(sessionId);
          }

          const activeSocket = socket;
          if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
            activeSocket.send(
              JSON.stringify({
                type: 'session.resume',
                payload: {
                  sessionId,
                  lastSeq: lastSequence
                }
              })
            );
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
              }
            }));
          } catch (error) {
            set({
              sessionsError: error instanceof Error ? error.message : 'Unable to load session messages.'
            });
          }
        },

        sendMessage: async (content, options) => {
          const input = (content ?? get().composerValue).trim();
          if (!input || get().isSending) {
            return;
          }
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
            content: input,
            kind: 'input',
            meta: [`clientMessageId:${requestId}`, `requestId:${requestId}`],
            error: null,
            createdAt: now,
            updatedAt: now
          };

          set((state) => ({
            composerValue: '',
            isSending: true,
            activeRequestId: requestId,
            thinkingText: 'Analyzing your request...',
            thinkingStep: 'parse_intent',
            sessionsError: null,
            messages: {
              ...state.messages,
              [sessionId!]: upsertMessage(state.messages[sessionId!] ?? [], optimisticUserMessage)
            }
          }));

          const ensureSocketOpen = async (): Promise<WebSocket | null> => {
            if (typeof window === 'undefined') {
              return null;
            }

            const currentSocket = socket;
            if (currentSocket && currentSocket.readyState === WebSocket.OPEN) {
              return currentSocket;
            }

            get().connectWebSocket();

            const candidateSocket = socket;
            if (!candidateSocket) {
              return null;
            }

            if (candidateSocket.readyState === WebSocket.OPEN) {
              return candidateSocket;
            }

            if (candidateSocket.readyState !== WebSocket.CONNECTING) {
              return null;
            }

            return await new Promise<WebSocket | null>((resolve) => {
              let settled = false;

              const finish = (value: WebSocket | null) => {
                if (settled) {
                  return;
                }
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
            const payload: Record<string, unknown> = {
              sessionId,
              content: input,
              clientMessageId: requestId,
              requestId,
              idempotencyKey: requestId
            };

            if (requestedMode) {
              payload.mode = requestedMode;
            }

            activeSocket.send(
              JSON.stringify({
                type: 'message.send',
                payload
              })
            );
            return;
          }

          try {
            const response = await sendSessionMessage(sessionId, { content: input });
            const incomingMessages = (response.messages ?? []).map(normalizeMessage);

            set((state) => ({
              sessions: upsertSession(state.sessions, response.sceneState),
              messages: {
                ...state.messages,
                [sessionId!]: mergeMessages(state.messages[sessionId!] ?? [], incomingMessages)
              },
              isSending: false,
              activeRequestId: null,
              thinkingText: null,
              thinkingStep: 'turn_complete'
            }));
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unable to send message.';
            const errorTimestamp = new Date().toISOString();
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
              }
            }));
          }
        },

        sendSceneCommand: async (command) => {
          const sessionId = get().activeSessionId;
          if (!sessionId) {
            return;
          }

          try {
            let response: { sceneState: Session } | null = null;

            if (command === 'undo') {
              response = await undoScene(sessionId);
            } else if (command === 'redo') {
              response = await redoScene(sessionId);
            } else if (command === 'artifact.previous') {
              response = await previousArtifact(sessionId);
            } else if (command === 'artifact.next') {
              response = await nextArtifact(sessionId);
            }

            const nextSceneState = response?.sceneState;
            if (!nextSceneState) {
              return;
            }

            set((state) => ({
              sessions: upsertSession(state.sessions, nextSceneState),
              sessionsError: null
            }));
          } catch (error) {
            set({
              sessionsError: error instanceof Error ? error.message : 'Scene history command failed.'
            });
          }
        },

        stopTurn: () => {
          const requestId = get().activeRequestId;
          const sessionId = get().activeSessionId;
          const activeSocket = socket;

          if (requestId && sessionId && activeSocket && activeSocket.readyState === WebSocket.OPEN) {
            activeSocket.send(
              JSON.stringify({
                type: 'turn.abort',
                payload: {
                  sessionId,
                  requestId
                }
              })
            );
          }

          set({
            isSending: false,
            activeRequestId: null,
            thinkingText: null,
            thinkingStep: 'turn_aborted'
          });
        },

        connectWebSocket: () => {
          if (typeof window === 'undefined') {
            return;
          }

          if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
            return;
          }

          const websocketUrl = resolveWebSocketUrl();
          set({ connectionState: 'connecting' });

          const nextSocket = new WebSocket(websocketUrl);
          socket = nextSocket;

          nextSocket.addEventListener('open', () => {
            set({ connectionState: 'open' });

            nextSocket.send(
              JSON.stringify({
                type: 'session.resume',
                payload: {
                  sessionId: get().activeSessionId,
                  lastSeq: lastSequence
                }
              })
            );
          });

          nextSocket.addEventListener('message', (event) => {
            try {
              const parsed = JSON.parse(event.data) as {
                type?: string;
                seq?: number;
                payload?: Record<string, unknown>;
              };

              if (!parsed.type) {
                return;
              }

              if (typeof parsed.seq === 'number') {
                if (parsed.seq <= lastSequence) {
                  return;
                }
                lastSequence = parsed.seq;
              }

              const payload = parsed.payload ?? {};
              const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : null;

              if (parsed.type === 'connection:ready' || parsed.type === 'session:resumed') {
                set({ connectionState: 'open' });
                return;
              }

              if (parsed.type === 'message:created' || parsed.type === 'message:update' || parsed.type === 'message.append') {
                const incoming = payload.message;
                if (!sessionId || !incoming || typeof incoming !== 'object') {
                  return;
                }

                const normalizedMessage = normalizeMessage(incoming as ApiSessionMessage);

                set((state) => ({
                  messages: {
                    ...state.messages,
                    [sessionId]: upsertMessage(state.messages[sessionId] ?? [], normalizedMessage)
                  },
                  sessions: sortSessionsByUpdatedAt(
                    state.sessions.map((session) =>
                      session.sessionId === sessionId
                        ? {
                            ...session,
                            updatedAt: normalizedMessage.updatedAt ?? session.updatedAt
                          }
                        : session
                    )
                  )
                }));

                return;
              }

              if (parsed.type === 'thought:stream') {
                const thought = typeof payload.thought === 'string' ? payload.thought : null;
                const thoughtStep = typeof payload.step === 'string' ? payload.step : 'thought';
                const isFinal = payload.isFinal === true;
                const thoughtRequestId = typeof payload.requestId === 'string' && payload.requestId.trim()
                  ? payload.requestId.trim()
                  : null;
                const thoughtMessageId = typeof payload.messageId === 'string' && payload.messageId.trim()
                  ? payload.messageId.trim()
                  : null;

                if (thought) {
                  set({
                    thinkingText: thought,
                    thinkingStep: thoughtStep
                  });
                }

                if (sessionId && thought && isFinal) {
                  const now = new Date().toISOString();
                  const requestMeta = thoughtRequestId ? `requestId:${thoughtRequestId}` : null;
                  const messageMeta = thoughtMessageId ? `messageId:${thoughtMessageId}` : null;
                  const thoughtMessage: SessionMessage = {
                    id: createClientMessageId(`thought-${thoughtStep}`),
                    role: 'thought',
                    content: thought,
                    kind: 'thought',
                    meta: [thoughtStep, requestMeta, messageMeta].filter(Boolean) as string[],
                    error: null,
                    createdAt: now,
                    updatedAt: now
                  };

                  set((state) => {
                    const existingMessages = state.messages[sessionId] ?? [];
                    const duplicate = existingMessages.some(
                      (message) => {
                        if (!isThoughtMessage(message)) {
                          return false;
                        }

                        if (message.content.trim() !== thought.trim() || message.meta?.[0] !== thoughtStep) {
                          return false;
                        }

                        if (requestMeta && !message.meta?.includes(requestMeta)) {
                          return false;
                        }

                        if (messageMeta && !message.meta?.includes(messageMeta)) {
                          return false;
                        }

                        return true;
                      }
                    );

                    if (duplicate) {
                      return state;
                    }

                    return {
                      messages: {
                        ...state.messages,
                        [sessionId]: upsertMessage(existingMessages, thoughtMessage)
                      }
                    };
                  });
                }

                return;
              }

              if (parsed.type === 'scene:update') {
                const sceneState = payload.sceneState as Session | undefined;
                if (!sceneState?.sessionId) {
                  return;
                }

                set((state) => ({
                  sessions: upsertSession(state.sessions, sceneState)
                }));
                return;
              }

              if (parsed.type === 'turn:started') {
                set({ isSending: true });
                return;
              }

              if (parsed.type === 'turn:complete') {
                set({
                  isSending: false,
                  activeRequestId: null,
                  thinkingText: null,
                  thinkingStep: 'turn_complete'
                });
                return;
              }

              if (parsed.type === 'turn:error') {
                const errorMessage =
                  (typeof payload.message === 'string' && payload.message.trim()) ||
                  (payload.error && typeof payload.error === 'object' && typeof (payload.error as { userMessage?: string }).userMessage === 'string'
                    ? (payload.error as { userMessage: string }).userMessage
                    : 'Turn failed');

                if (sessionId) {
                  const timestamp = new Date().toISOString();
                  const assistantError: SessionMessage = {
                    id: createClientMessageId('turn-error'),
                    role: 'assistant',
                    content: errorMessage,
                    kind: 'error',
                    meta: [`error:${errorMessage}`],
                    error: (payload.error as SessionMessage['error']) ?? null,
                    createdAt: timestamp,
                    updatedAt: timestamp
                  };

                  set((state) => ({
                    messages: {
                      ...state.messages,
                      [sessionId]: upsertMessage(state.messages[sessionId] ?? [], assistantError)
                    }
                  }));
                }

                set({
                  isSending: false,
                  activeRequestId: null,
                  thinkingText: null,
                  thinkingStep: 'turn_error'
                });
                return;
              }

              if (parsed.type === 'message:error') {
                set({
                  isSending: false,
                  activeRequestId: null,
                  thinkingText: null,
                  thinkingStep: 'turn_error'
                });
              }
            } catch {
              // Ignore malformed websocket payloads.
            }
          });

          nextSocket.addEventListener('error', () => {
            set({ connectionState: 'error' });
          });

          nextSocket.addEventListener('close', () => {
            if (socket === nextSocket) {
              socket = null;
            }

            set({ connectionState: 'closed' });

            if (reconnectTimer !== null) {
              window.clearTimeout(reconnectTimer);
            }

            reconnectTimer = window.setTimeout(() => {
              reconnectTimer = null;
              get().connectWebSocket();
            }, WS_RECONNECT_DELAY_MS);
          });
        },

        // Initial state
        sessions: [],
        activeSessionId: null,
        hasInitialized: false,
        isBootstrapping: false,
        sessionsError: null,
        messages: {},
        connectionState: 'connecting',
        isSending: false,
        activeRequestId: null,
        thinkingText: null,
        thinkingStep: 'turn_started',
        showScrollToLatest: false,
        panelOpen: false,
        panelView: null,
        panelWidth: 600,
        composerValue: '',
        isSlashMenuOpen: false,
        
        // Actions
        setActiveSession: (sessionId) => {
          if (!sessionId) {
            set({ activeSessionId: null });
            return;
          }

          void get().selectSession(sessionId);
        },
        
        addSession: (session) => {
          set((state) => ({
            sessions: upsertSession(state.sessions, session),
            activeSessionId: session.sessionId,
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
          set({ 
            thinkingText: text,
            thinkingStep: step,
          });
        },
        
        setComposerValue: (value: string) => {
          set({ composerValue: value });
        },
        
        // Panel Actions (new)
        openPanel: (view: 'preview' | 'code') => {
          set({ panelOpen: true, panelView: view });
        },
        
        closePanel: () => {
          set({ panelOpen: false });
        },
        
        togglePanel: (view: 'preview' | 'code') => {
          const state = get();
          if (state.panelOpen && state.panelView === view) {
            set({ panelOpen: false });
          } else {
            set({ panelOpen: true, panelView: view });
          }
        },
        
        setPanelWidth: (width: number) => {
          set({ panelWidth: width });
        },
        
        clearSession: (sessionId: string) => {
          const { [sessionId]: _, ...remainingMessages } = get().messages;
          set((state) => ({
            sessions: state.sessions.filter(s => s.sessionId !== sessionId),
            messages: remainingMessages,
            activeSessionId: state.activeSessionId === sessionId 
              ? null 
              : state.activeSessionId,
          }));
        },
      }),
      {
        name: 'terranet-chat-storage',
        partialize: (state) => ({
          sessions: state.sessions,
          messages: state.messages,
          activeSessionId: state.activeSessionId,
        }),
      }
    ),
    { name: 'chatStore' }
  )
);
