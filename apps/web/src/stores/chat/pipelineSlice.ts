import type { StateCreator } from "zustand";
import type { ChatState, SessionTaskProgress, ActionBlock, TaskCheckpoint, SessionMessage } from "./types";
import {
  nowIso,
  cloneDefaultTasks,
  createDefaultTaskProgress,
  updateTaskProgressMap,
  applyStepStatusToTasks,
  mapStepToAction,
  upsertMessage,
  createClientMessageId,
} from "./helpers";
import { resolveMediaState, mediaUnavailable, computeMediaStage, computeMediaStatusText } from "./turn-helpers";
import { MEDIA_READY_TEXT, MEDIA_UNAVAILABLE_TEXT, MEDIA_SYNCING_TEXT } from "./media-strings";
import { sendSessionMessage } from "../../api";

export interface PipelineSlice {
  isSending: boolean;
  activeRequestId: string | null;
  thinkingText: string | null;
  thinkingStep: string;
  showScrollToLatest: boolean;
  taskProgressBySession: Record<string, SessionTaskProgress>;
  actionBlocksByMessage: Record<string, ActionBlock[]>;
  currentTurnCheckpoints: TaskCheckpoint[];
  currentMessageId: string | null;

  setIsSending: (value: boolean) => void;
  setThinking: (text: string | null, step?: string) => void;
  addMessage: (sessionId: string, message: SessionMessage) => void;
  sendMessage: (content?: string, options?: { mode?: "modify" | "generate" }) => Promise<void>;
  stopTurn: () => void;
  setActionBlocks: (messageId: string, blocks: ActionBlock[]) => void;
  updateActionBlock: (messageId: string, blockId: string, updates: Partial<ActionBlock>) => void;
  setCurrentTurnCheckpoints: (checkpoints: TaskCheckpoint[]) => void;
  setCurrentMessageId: (messageId: string | null) => void;
  clearActionBlocks: (messageId: string) => void;
}

export const createPipelineSlice: StateCreator<ChatState, [], [], PipelineSlice> = (set, get) => ({
  isSending: false,
  activeRequestId: null,
  thinkingText: null,
  thinkingStep: "idle",
  showScrollToLatest: true,
  taskProgressBySession: {},
  actionBlocksByMessage: {},
  currentTurnCheckpoints: [],
  currentMessageId: null,

  setIsSending: (value) => set({ isSending: value }),

  setThinking: (text, step) =>
    set({ thinkingText: text, thinkingStep: step ?? "thinking" }),

  addMessage: (sessionId, message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [sessionId]: upsertMessage(state.messages[sessionId] ?? [], message),
      },
    })),

  sendMessage: async (content, options) => {
    const { activeSessionId, composerValue, composerImage } = get() as any;
    const sessionId = activeSessionId;
    if (!sessionId) return;

    const messageContent = content ?? composerValue;
    if (!messageContent?.trim() && !composerImage) return;

    const requestId = `req-ws-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const userMessageId = createClientMessageId("user");
    const userMessage: SessionMessage = {
      id: userMessageId,
      role: "user",
      content: messageContent,
      kind: "message",
      meta: [`requestId:${requestId}`],
      error: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    set((state) => ({
      isSending: true,
      activeRequestId: requestId,
      thinkingText: "Analyzing your request...",
      thinkingStep: "turn_started",
      composerValue: "",
      composerImage: null,
      isSlashMenuOpen: false,
      messages: {
        ...state.messages,
        [sessionId]: upsertMessage(state.messages[sessionId] ?? [], userMessage),
      },
    }));

    try {
      const response: any = await sendSessionMessage(sessionId, {
        content: messageContent,
        mode: options?.mode ?? "generate",
        imageUrl: composerImage?.url ?? undefined,
        imageData: composerImage?.data ?? undefined,
        requestId,
      });

      if (response?.messages?.length > 0) {
        response.messages.forEach((m: any) => {
          get().addMessage(sessionId, {
            id: m.messageId || createClientMessageId("msg"),
            role: m.role,
            content: m.content,
            kind: m.kind,
            meta: m.meta,
            error: m.error || null,
            createdAt: m.createdAt || nowIso(),
            updatedAt: m.updatedAt || nowIso(),
          });
        });
      }

      set({
        isSending: false,
        activeRequestId: null,
        thinkingText: null,
        thinkingStep: "turn_complete",
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unable to send message.";
      const errorTimestamp = nowIso();
      const assistantError: SessionMessage = {
        id: createClientMessageId("error"),
        role: "assistant",
        content: errorMessage,
        kind: "error",
        meta: [`error:${errorMessage}`],
        error: null,
        createdAt: errorTimestamp,
        updatedAt: errorTimestamp,
      };

      set((state) => ({
        sessionsError: errorMessage,
        isSending: false,
        activeRequestId: null,
        thinkingText: null,
        thinkingStep: "turn_error",
        messages: {
          ...state.messages,
          [sessionId]: upsertMessage(state.messages[sessionId] ?? [], assistantError),
        },
      }));
    }
  },

  stopTurn: () => {
    const requestId = (get() as any).activeRequestId;
    const sessionId = (get() as any).activeSessionId;
    const ws = (get() as any)._ws as WebSocket | null;
    const abortedAt = nowIso();

    if (ws && ws.readyState === WebSocket.OPEN && requestId && sessionId) {
      try {
        ws.send(JSON.stringify({
          type: "turn.abort",
          payload: { sessionId, requestId }
        }));
      } catch {}
    }

    set((state) => ({
      isSending: false,
      activeRequestId: null,
      thinkingText: null,
      thinkingStep: "turn_aborted",
    }));
  },

  setActionBlocks: (messageId, blocks) =>
    set((state) => ({
      actionBlocksByMessage: { ...state.actionBlocksByMessage, [messageId]: blocks },
    })),

  updateActionBlock: (messageId, blockId, updates) =>
    set((state) => ({
      actionBlocksByMessage: {
        ...state.actionBlocksByMessage,
        [messageId]: (state.actionBlocksByMessage[messageId] || []).map((b) =>
          b.id === blockId ? { ...b, ...updates } : b
        ),
      },
    })),

  setCurrentTurnCheckpoints: (checkpoints) => set({ currentTurnCheckpoints: checkpoints }),

  setCurrentMessageId: (messageId) => set({ currentMessageId: messageId }),

  clearActionBlocks: (messageId) =>
    set((state) => {
      const { [messageId]: _omitted, ...remaining } = state.actionBlocksByMessage;
      void _omitted;
      return { actionBlocksByMessage: remaining };
    }),
});