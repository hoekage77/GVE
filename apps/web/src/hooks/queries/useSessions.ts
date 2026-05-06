import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listSessions,
  createSession,
  deleteSession as apiDeleteSession,
  updateSession as apiUpdateSession,
  type SessionListResponse,
  type CreateSessionResponse,
  type SessionSceneState,
} from "../../api";

const SESSIONS_KEY = "sessions" as const;

export function useSessions(opts?: { limit?: number; offset?: number }) {
  return useQuery({
    queryKey: [SESSIONS_KEY, opts],
    queryFn: async (): Promise<SessionListResponse> => {
      const response = await listSessions();
      return response;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<CreateSessionResponse> => {
      const response = await createSession();
      return response;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [SESSIONS_KEY] });
    },
  });
}

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string): Promise<void> => {
      await apiDeleteSession(sessionId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [SESSIONS_KEY] });
    },
  });
}

export function usePatchSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sessionId, updates }: { sessionId: string; updates: Partial<SessionSceneState> }): Promise<void> => {
      await apiUpdateSession(sessionId, updates);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [SESSIONS_KEY] });
    },
  });
}

export function useRefreshSessions() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [SESSIONS_KEY] });
}
