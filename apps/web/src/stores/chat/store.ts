import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type { ChatState } from "./types";
import { createSessionSlice } from "./sessionSlice";
import { createComposerSlice } from "./composerSlice";
import { createPipelineSlice } from "./pipelineSlice";
import { createInfraSlice } from "./infraSlice";

export const useChatStore = create<ChatState>()(
  devtools(
    persist(
      (...a) => ({
        ...createSessionSlice(...a),
        ...createComposerSlice(...a),
        ...createPipelineSlice(...a),
        ...createInfraSlice(...a),

        initialize: async () => {
          const state = a[1]();
          if ((state as any).isBootstrapping) return;

          // Always connect WebSocket on every init — connection state should reflect reality
          state.connectWebSocket?.();

          if ((state as any).hasInitialized) {
            return;
          }
          a[0]({ isBootstrapping: true } as any);
          try {
            await (state as any).refreshSessions?.();
            await (state as any).fetchProviders?.();
            a[0]({ hasInitialized: true, isBootstrapping: false } as any);
          } catch {
            a[0]({ isBootstrapping: false } as any);
          }
        },

        sendSceneCommand: async (_command: any) => {},
      }),
      {
        name: "terranet-chat-storage",
        version: 1,
        migrate: (persistedState, _version) => persistedState as ChatState,
        partialize: (state) => ({
          sessions: state.sessions,
          messages: state.messages,
          activeSessionId: state.activeSessionId,
          isSidebarCollapsed: state.isSidebarCollapsed,
          panelWidth: state.panelWidth,
        }),
      }
    ),
    { name: "chat-store" }
  )
);