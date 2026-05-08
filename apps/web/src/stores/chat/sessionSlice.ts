import type { StateCreator } from "zustand";
import { type ChatState, type Session, type SessionMessage } from "./types";
import {
  nowIso,
  buildClientSession,
} from "./helpers";
import {
  createSession as apiCreateSession,
  undoScene,
  redoScene,
  previousArtifact,
  nextArtifact,
  selectVersion,
  modifyVisual,
} from "../../api";

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
  createNewSession: () => Promise<Session | null>;
  selectSession: (sessionId: string) => void;
  clearSession: (sessionId: string) => void;
  setMessages: (sessionId: string, messages: SessionMessage[]) => void;
  setSessionsError: (error: string | null) => void;
  selectSceneVersion: (versionId: string) => Promise<boolean>;
  rerunScene: (options?: { codeOverride?: string | null }) => Promise<boolean>;
  setCurrentSceneCode: (sessionId: string, code: string) => void;
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
    set((state) => {
      const existing = state.sessions.find((s) => s.sessionId === session.sessionId);
      const merged = existing
        ? {
            ...session,
            // Preserve scene data if the server payload is missing it
            // (e.g. listSessions only returns metadata without currentScene)
            currentScene: session.currentScene ?? existing.currentScene ?? null,
            versions: session.versions?.length ? session.versions : existing.versions ?? [],
            versionCount: session.versionCount ?? existing.versionCount ?? 0,
            versionPointer: session.versionPointer ?? existing.versionPointer ?? 0,
            sceneId: session.sceneId ?? existing.sceneId ?? null,
          }
        : session;
      return {
        sessions: [...state.sessions.filter((s) => s.sessionId !== session.sessionId), merged],
      };
    }),

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

  selectSession: (sessionId) => {
    set({ activeSessionId: sessionId });
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

  setMessages: (sessionId, messages) => {
    set((state) => ({
      messages: { ...state.messages, [sessionId]: messages },
    }));
  },

  setSessionsError: (error: string | null) => set({ sessionsError: error }),

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
      if (options?.codeOverride) {
        const result = await modifyVisual({
          sessionId: activeSessionId,
          instruction: "Rerun current scene.",
          runMode: "rerun",
          codeOverride: options.codeOverride,
        });
        if (result?.sceneState) {
          const updated = buildClientSession(result.sceneState);
          if (updated) {
            set((state) => ({
              sessions: state.sessions.map((s) => (s.sessionId === activeSessionId ? updated : s)),
            }));
          }
        }
        return result?.sceneState != null;
      }
      const result = await selectVersion(activeSessionId, activeSessionId);
      return result?.success ?? false;
    } catch {
      return false;
    }
  },

  setCurrentSceneCode: (sessionId, code) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === sessionId
          ? {
              ...s,
              currentScene: s.currentScene
                ? { ...s.currentScene, code, streaming: false, streamingComplete: true }
                : null,
            }
          : s
      ),
    }));
  },
});