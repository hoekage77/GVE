import type { StateCreator } from "zustand";
import { type ChatState, type Session, type SessionMessage } from "./types";
import {
  nowIso,
  upsertMessage,
  createClientMessageId,
  buildClientSession,
} from "./helpers";
import {
  createSession as apiCreateSession,
  listSessions,
  listSessionMessages,
  undoScene,
  redoScene,
  previousArtifact,
  nextArtifact,
  selectVersion,
} from "@visual-runtime/shared";

export interface SessionSlice {
  sessions: Session[];
  activeSessionId: string | null;
  hasInitialized: boolean;
  isBootstrapping: boolean;
  sessionsError: string | null;
  messages: Record<string, SessionMessage[]>;

  setActiveSession: (sessionId: string | null) => void;
  addSession: (session: Session) => void;
  startDraftSession: () => void;
  refreshSessions: () => Promise<void>;
  createNewSession: () => Promise<Session | null>;
  selectSession: (sessionId: string) => Promise<void>;
  loadSessionMessages: (sessionId: string) => Promise<void>;
  clearSession: (sessionId: string) => void;
  selectSceneVersion: (versionId: string) => Promise<boolean>;
  rerunScene: (options?: { codeOverride?: string | null }) => Promise<boolean>;
}

export const createSessionSlice: StateCreator<ChatState, [], [], SessionSlice> = (set, get) => ({
  sessions: [],
  activeSessionId: null,
  hasInitialized: false,
  isBootstrapping: false,
  sessionsError: null,
  messages: {},

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  addSession: (session) =>
    set((state) => ({
      sessions: [...state.sessions.filter((s) => s.sessionId !== session.sessionId), session],
    })),

  startDraftSession: () => {
    const draftId = `draft-${crypto.randomUUID?.() ?? Date.now().toString(36)}`;
    const now = nowIso();
    const draftSession: Session = {
      sessionId: draftId,
      sceneId: null,
      versionCount: 0,
      currentScene: null,
      versions: [],
      createdAt: now,
      updatedAt: now,
    } as Session;
    set((state) => ({
      sessions: [draftSession, ...state.sessions],
      activeSessionId: draftId,
    }));
  },

  refreshSessions: async () => {
    try {
      const response = await listSessions();
      const normalized = response.sessions.map(buildClientSession).filter((s): s is Session => s !== null);
      set({ sessions: normalized, sessionsError: null });
    } catch (error) {
      set({ sessionsError: error instanceof Error ? error.message : "Failed to load sessions" });
    }
  },

  createNewSession: async () => {
    try {
      const session = await apiCreateSession();
      const clientSession = buildClientSession(session);
      if (clientSession) {
        set((state) => ({
          sessions: [clientSession, ...state.sessions],
          activeSessionId: clientSession.sessionId,
        }));
        return clientSession;
      }
      return null;
    } catch (error) {
      set({ sessionsError: error instanceof Error ? error.message : "Failed to create session" });
      return null;
    }
  },

  selectSession: async (sessionId) => {
    set({ activeSessionId: sessionId });
    const { messages, loadSessionMessages } = get();
    if (!messages[sessionId]) {
      await loadSessionMessages(sessionId);
    }
  },

  loadSessionMessages: async (sessionId) => {
    try {
      const apiResponse = await listSessionMessages(sessionId);
      const apiMessages = apiResponse.messages ?? [];
      const clientMessages: SessionMessage[] = (apiMessages || []).map((m: any) => ({
        id: m.messageId || m.id || createClientMessageId("msg"),
        role: m.role,
        content: m.content,
        kind: m.kind || undefined,
        meta: m.meta || undefined,
        error: m.error || null,
        createdAt: m.createdAt || nowIso(),
        updatedAt: m.updatedAt || m.createdAt || nowIso(),
      }));
      set((state) => ({
        messages: { ...state.messages, [sessionId]: clientMessages },
      }));
    } catch {
      set((state) => ({
        messages: { ...state.messages, [sessionId]: [] },
      }));
    }
  },

  clearSession: (sessionId) => {
    set((state) => {
      const { [sessionId]: _m, ...remainingM } = state.messages;
      void _m;
      return {
        sessions: state.sessions.filter((s) => s.sessionId !== sessionId),
        messages: remainingM,
        activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
      };
    });
  },

  selectSceneVersion: async (versionId) => {
    const { activeSessionId } = get();
    if (!activeSessionId) return false;
    try {
      const result = await selectVersion(activeSessionId, versionId);
      if (result.success && result.sceneState) {
        const updated = buildClientSession(result.sceneState);
        if (updated) {
          set((state) => ({
            sessions: state.sessions.map((s) => (s.sessionId === activeSessionId ? updated : s)),
          }));
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  rerunScene: async (options) => {
    const { activeSessionId } = get();
    if (!activeSessionId) return false;
    try {
      const result = await selectVersion(activeSessionId, activeSessionId);
      return result?.success ?? false;
    } catch {
      return false;
    }
  },
});