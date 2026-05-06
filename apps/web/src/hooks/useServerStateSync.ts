import { useEffect } from "react";
import { useSessions } from "../hooks/queries";
import { useChatStore } from "../stores";

/**
 * Syncs TanStack Query session data into the Zustand store.
 * This bridges server state (React Query) with legacy UI state (Zustand).
 * Over time, components should read directly from React Query hooks instead.
 */
export function useServerStateSync() {
  const { data, isSuccess } = useSessions();
  const addSession = useChatStore((s) => s.addSession);

  useEffect(() => {
    if (!isSuccess || !data?.sessions) return;

    // Merge fetched sessions into Zustand without duplicates
    const existingIds = new Set(
      useChatStore.getState().sessions.map((s) => s.sessionId)
    );

    for (const session of data.sessions) {
      if (!existingIds.has(session.sessionId)) {
        addSession(session);
      }
    }
  }, [data, isSuccess, addSession]);
}
