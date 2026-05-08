import { useEffect } from "react";
import { useSessions } from "../hooks/queries";
import { useChatStore } from "../stores";
import { buildClientSession } from "../stores/chat/helpers";

/**
 * Syncs TanStack Query session data into the Zustand store.
 * This bridges server state (React Query) with legacy UI state (Zustand).
 *
 * Merge strategy:
 * - New sessions from the server are always added.
 * - Existing sessions are only overwritten if the server copy carries scene
 *   data (currentScene code / previewUrl). This prevents a restarted server
 *   (which returns empty DB-reconstructed sessions) from wiping client-side
 *   scenes that were persisted in Zustand.
 */
export function useServerStateSync() {
  const { data, isSuccess } = useSessions();
  const addSession = useChatStore((s) => s.addSession);

  useEffect(() => {
    if (!isSuccess || !data?.sessions) return;

    for (const raw of data.sessions) {
      const serverSession = buildClientSession(raw);
      if (!serverSession) continue;

      const existing = useChatStore
        .getState()
        .sessions.find((s) => s.sessionId === serverSession.sessionId);

      const serverHasScene = Boolean(
        serverSession.currentScene?.code || serverSession.currentScene?.previewUrl
      );
      const clientHasScene = Boolean(
        existing?.currentScene?.code || existing?.currentScene?.previewUrl
      );

      if (!existing || serverHasScene || !clientHasScene) {
        addSession(serverSession);
      }
    }
  }, [data, isSuccess, addSession]);
}
