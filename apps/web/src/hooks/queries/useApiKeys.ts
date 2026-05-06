import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listApiKeys, createApiKey, deleteApiKey } from "../../api";

const API_KEYS_KEY = "apiKeys" as const;

export function useApiKeys() {
  return useQuery({
    queryKey: [API_KEYS_KEY],
    queryFn: async () => {
      const response = await listApiKeys();
      return response.data ?? [];
    },
    staleTime: 30_000,
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, scopes }: { name: string; scopes?: string[] }) => {
      const response = await createApiKey(name, scopes);
      return response.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [API_KEYS_KEY] });
    },
  });
}

export function useDeleteApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteApiKey(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [API_KEYS_KEY] });
    },
  });
}
