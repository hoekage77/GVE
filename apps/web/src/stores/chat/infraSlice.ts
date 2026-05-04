import type { StateCreator } from "zustand";
import type { ChatState, UIAgentState, UIIterationState } from "./types";
import type { WorkspaceRecord, WorkspaceFileEntry } from "@visual-runtime/shared";
import { listProviders, resolveWebSocketUrl } from "@visual-runtime/shared";
import { nowIso } from "./helpers";

export interface InfraSlice {
  connectionState: "connecting" | "open" | "closed" | "error";
  providers: any[];
  activeProviderId: string;
  agentState: UIAgentState | null;
  iterationState: UIIterationState | null;

  setActiveProvider: (providerId: string) => void;
  fetchProviders: () => Promise<void>;
  updateAgentState: (state: UIAgentState | null) => void;
  setAgentAnalyzing: (isAnalyzing: boolean) => void;
  clearAgentState: () => void;
  updateIterationState: (state: UIIterationState | null) => void;
  abortIteration: () => void;

  _ws: WebSocket | null;
  _wsSeq: number;
  connectWebSocket: () => void;
  handleWorkspaceUpdate: (payload: any) => void;
  handleFilePatched: (payload: any) => void;
}

export const createInfraSlice: StateCreator<ChatState, [], [], InfraSlice> = (set, get) => ({
  connectionState: "closed",
  providers: [],
  activeProviderId: "auto",
  agentState: null,
  iterationState: null,
  _ws: null,
  _wsSeq: 0,

  setActiveProvider: (providerId) => set({ activeProviderId: providerId }),

  fetchProviders: async () => {
    try {
      const providers = await listProviders();
      set({ providers: (providers as any).providers ?? [] });
    } catch { /* provider list is non-critical */ }
  },

  updateAgentState: (state) => set({ agentState: state }),

  setAgentAnalyzing: (isAnalyzing) =>
    set((s) => ({
      agentState: s.agentState ? { ...s.agentState, isAnalyzing } : null,
    })),

  clearAgentState: () => set({ agentState: null }),

  updateIterationState: (state) => set({ iterationState: state }),

  abortIteration: () => set({ iterationState: null }),

  connectWebSocket: () => {
    const state = get();
    if (state._ws && state._ws.readyState === WebSocket.OPEN) return;

    const wsUrl = resolveWebSocketUrl("/ws");
    set({ connectionState: "connecting" });

    const ws = new WebSocket(wsUrl);
    state._ws = ws;

    ws.onopen = () => set({ connectionState: "open" });

    ws.onclose = () => set({ connectionState: "closed" });

    ws.onerror = () => set({ connectionState: "error" });

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const seq = Number(msg.seq ?? 0);
        if (seq > get()._wsSeq) set({ _wsSeq: seq } as any);

        switch (msg.type) {
          case "thought:stream": {
            const thoughtText = msg.payload?.thought ?? msg.payload?.text ?? "";
            const step = msg.payload?.step ?? "thinking";
            const isFinal = Boolean(msg.payload?.isFinal);
            const sessionId = msg.payload?.sessionId || (get() as any).activeSessionId;

            set({
              thinkingText: thoughtText || null,
              thinkingStep: step,
            });

            if (isFinal && thoughtText && sessionId) {
              const requestId = msg.payload?.requestId ?? null;
              const messageId = msg.payload?.messageId ?? null;
              const stepLabel = msg.payload?.stepLabel ?? null;
              const durationMs = msg.payload?.durationMs ?? null;
              const detail = msg.payload?.detail ?? null;
              const thoughtMessageId = `thought-${step}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

              const meta = [
                step,
                requestId ? `requestId:${requestId}` : null,
                messageId ? `messageId:${messageId}` : null,
                stepLabel ? `stepLabel:${stepLabel}` : null,
                durationMs ? `durationMs:${durationMs}` : null,
                detail ? `detail:${detail}` : null,
                "status:completed"
              ].filter((m): m is string => Boolean(m));

              (get() as any).addMessage(sessionId, {
                id: thoughtMessageId,
                role: "thought",
                content: thoughtText,
                kind: "thought",
                meta,
                error: null,
                createdAt: nowIso(),
                updatedAt: nowIso(),
              });
            }
            break;
          }

          case "message:append": {
            const p = msg.payload;
            if (p?.messageId && p?.content != null) {
              const sessionId = p.sessionId || (get() as any).activeSessionId;
              const state = get() as any;
              const existing = state.messages[sessionId] || [];
              const target = existing.find((m: any) => m.id === p.messageId);
              if (target) {
                const updated = existing.map((m: any) =>
                  m.id === p.messageId
                    ? { ...m, content: m.content + p.content, updatedAt: nowIso() }
                    : m
                );
                set({ messages: { ...state.messages, [sessionId]: updated } });
              } else {
                state.addMessage(sessionId, {
                  id: p.messageId,
                  role: p.role || "assistant",
                  content: p.content,
                  kind: p.kind || "message",
                  meta: p.meta || [],
                  error: null,
                  createdAt: p.createdAt || nowIso(),
                  updatedAt: nowIso(),
                });
              }
            }
            break;
          }

          case "message:update": {
            const p = msg.payload;
            if (p?.messageId) {
              const sessionId = p.sessionId || (get() as any).activeSessionId;
              const state = get() as any;
              const existing = state.messages[sessionId] || [];
              const updated = existing.map((m: any) =>
                m.id === p.messageId
                  ? { ...m, ...p.updates, updatedAt: nowIso() }
                  : m
              );
              set({ messages: { ...state.messages, [sessionId]: updated } });
            }
            break;
          }

          case "turn:complete":
            set({
              isSending: false,
              activeRequestId: null,
              thinkingText: null,
              thinkingStep: "turn_complete",
            });
            break;

          case "turn:error":
            set({
              isSending: false,
              activeRequestId: null,
              thinkingText: null,
              thinkingStep: "turn_error",
              sessionsError: msg.payload?.error || "An error occurred during processing.",
            });
            break;

          case "turn:aborted":
            set({
              isSending: false,
              activeRequestId: null,
              thinkingText: null,
              thinkingStep: "turn_aborted",
            });
            break;

          case "code:stream":
            if (msg.payload?.code != null) {
              set({
                thinkingText: msg.payload.code.slice(0, 200) + "...",
                thinkingStep: "generating_code",
              });
            }
            break;

          case "orchestration:step":
            if (msg.payload?.step) {
              set({
                thinkingStep: msg.payload.step,
                thinkingText: msg.payload.description || msg.payload.step,
              });
            }
            break;

          case "workspace:update":
            (get() as any).handleWorkspaceUpdate(msg.payload);
            break;

          case "file:patched":
            (get() as any).handleFilePatched(msg.payload);
            break;

          case "workspace:analysis":
            if (msg.payload) {
              const p = msg.payload;
              set((s) => ({
                iterationState: s.iterationState
                  ? {
                      ...s.iterationState,
                      currentIteration: p.iteration ?? s.iterationState.currentIteration,
                      currentScore: p.compositeScore ?? s.iterationState.currentScore,
                      phase: p.compositeScore !== undefined
                        ? (p.compositeScore >= (s.iterationState.threshold ?? 80) ? "finalizing" : "scoring")
                        : s.iterationState.phase,
                    }
                  : null,
              }));
            }
            break;

          case "iteration:update":
            if (msg.payload) {
              set((s) => ({
                iterationState: s.iterationState
                  ? {
                      ...s.iterationState,
                      currentIteration: (msg.payload.progress?.current ?? s.iterationState.currentIteration),
                      phase: msg.payload.progress?.phase ?? s.iterationState.phase,
                      currentScore: msg.payload.iteration?.qualitySignals?.composite ?? s.iterationState.currentScore,
                    }
                  : null,
              }));
            }
            break;

          case "agentState": {
            const p = msg.payload;
            if (p?.isAnalyzing === true) {
              (get() as any).setAgentAnalyzing(true);
            } else if (p?.isAnalyzing === false) {
              (get() as any).setAgentAnalyzing(false);
            }
            break;
          }

          case "agent:analysis_complete": {
            const p = msg.payload;
            if (!p) break;
            const results: Record<string, import("./types").AgentResult> = {};
            if (p.results && typeof p.results === "object") {
              for (const [key, val] of Object.entries(p.results as Record<string, any>)) {
                results[key] = {
                  id: val.id || key,
                  name: val.name || key,
                  score: typeof val.score === "number" ? val.score : 0,
                  findings: Array.isArray(val.findings) ? val.findings : [],
                  recommendations: Array.isArray(val.recommendations)
                    ? val.recommendations.map((r: any) => ({
                        action: typeof r === "string" ? r : (r.action ?? r.description ?? ""),
                        impact: typeof r.impact === "number" ? r.impact : (typeof r.severity === "number" ? r.severity : 5),
                        confidence: typeof r.confidence === "number" ? r.confidence : 50,
                        category: r.category ?? "structure",
                      }))
                    : [],
                };
              }
            }
            const consensus = typeof p.consensus === "number" ? p.consensus : 0;
            const recs = Array.isArray(p.recommendations)
              ? p.recommendations.map((r: any, i: number) => ({
                  agentId: r.agent ?? r.agentId ?? "unknown",
                  action: typeof r === "string" ? r : (r.action ?? r.description ?? ""),
                  impact: typeof r.impact === "number" ? r.impact : (typeof r.priority === "number" ? (5 - r.priority) * 4 : 5),
                  confidence: typeof r.confidence === "number" ? r.confidence : 50,
                  category: r.category ?? "structure",
                  priority: r.priority ?? i,
                }))
              : [];
            (get() as any).updateAgentState({
              isAnalyzing: false,
              results,
              consensus,
              shouldAutoApply: consensus >= 80,
              recommendations: recs,
              memory: [],
              lastAnalyzedAt: new Date().toISOString(),
            });
            break;
          }

          case "agent:activity": {
            const p = msg.payload;
            if (p?.step && p?.text) {
              set({
                thinkingStep: p.step,
                thinkingText: p.text,
              });
            }
            break;
          }
        }
      } catch { /* ws message parse failures are non-critical */ }
    };
  },

  handleWorkspaceUpdate: (payload: any) => {
    if (!payload) return;
    set({
      workspaceRecord: payload.workspace ?? payload,
    });
  },

  handleFilePatched: (payload: any) => {
    if (!payload?.path) return;
    set((state) => {
      const record = state.workspaceRecord;
      if (!record || !record.files) return {};

      const updatedFiles = { ...record.files };

      if (payload.kind === "remove") {
        delete updatedFiles[payload.path];
      } else if (payload.patchedContent || payload.content) {
        updatedFiles[payload.path] = {
          ...updatedFiles[payload.path],
          path: payload.path,
          content: payload.patchedContent ?? payload.content ?? "",
          purpose: payload.explanation ?? updatedFiles[payload.path]?.purpose ?? "",
          skill: updatedFiles[payload.path]?.skill ?? "unknown",
        } as WorkspaceFileEntry;
      }

      return {
        workspaceRecord: {
          ...record,
          files: updatedFiles,
          updatedAt: new Date().toISOString(),
        } as WorkspaceRecord,
      };
    });
  },
});