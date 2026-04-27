import { useState, useMemo, useCallback } from "react";
import { ChevronRight, Terminal, Brain, FilePlus, FileText, FilePen, Pencil, Loader2 } from "lucide-react";
import type { ThoughtItem } from "./MessageComponents";

interface AgentActionStreamProps {
  thoughts: ThoughtItem[];
  isThinking?: boolean;
  thinkingDuration?: number;
}

type ActionType = "think" | "file_created" | "read" | "write" | "edit" | "terminal" | "preview" | "generic";

interface ActionRow {
  id: string;
  type: ActionType;
  label: string;
  context: string;
  detail: string | null;
  status: "pending" | "running" | "completed" | "failed";
  durationMs: number | null;
  text: string;
}

const ACTION_CONFIG: Record<ActionType, { color: string; bg: string; icon: React.ElementType; label: string }> = {
  think: {
    color: "#a78bfa",
    bg: "rgba(167, 139, 250, 0.12)",
    icon: Brain,
    label: "Think",
  },
  file_created: {
    color: "#34d399",
    bg: "rgba(52, 211, 153, 0.12)",
    icon: FilePlus,
    label: "File created",
  },
  read: {
    color: "#60a5fa",
    bg: "rgba(96, 165, 250, 0.12)",
    icon: FileText,
    label: "Read",
  },
  write: {
    color: "#60a5fa",
    bg: "rgba(96, 165, 250, 0.12)",
    icon: FilePen,
    label: "Write",
  },
  edit: {
    color: "#fb923c",
    bg: "rgba(251, 146, 60, 0.12)",
    icon: Pencil,
    label: "Edit",
  },
  terminal: {
    color: "#9ca3af",
    bg: "rgba(156, 163, 175, 0.12)",
    icon: Terminal,
    label: "Execute Terminal",
  },
  preview: {
    color: "#22d3ee",
    bg: "rgba(34, 211, 238, 0.12)",
    icon: FileText,
    label: "Preview",
  },
  generic: {
    color: "#9ca3af",
    bg: "rgba(156, 163, 175, 0.12)",
    icon: Brain,
    label: "Action",
  },
};

function detectActionType(step: string, stepLabel: string, text: string): ActionType {
  const normalized = `${step} ${stepLabel} ${text}`.toLowerCase();

  if (normalized.includes("file_created") || normalized.includes("create file") || normalized.includes("file created") || normalized.includes("new file")) return "file_created";
  if (normalized.includes("write") || normalized.includes("save") || normalized.includes("output") || normalized.includes("generat") && normalized.includes("file")) return "write";
  if (normalized.includes("edit") || normalized.includes("modify") || normalized.includes("patch") || normalized.includes("update file")) return "edit";
  if (normalized.includes("read") || normalized.includes("fetch") || normalized.includes("load") || normalized.includes("skill") || normalized.includes("todo")) return "read";
  if (normalized.includes("terminal") || normalized.includes("execute") || normalized.includes("run ") || normalized.includes("shell") || normalized.includes("command") || normalized.includes("build") || normalized.includes("npm") || normalized.includes("npx")) return "terminal";
  if (normalized.includes("preview") || normalized.includes("render") || normalized.includes("scene") || normalized.includes("viewport")) return "preview";
  if (normalized.includes("think") || normalized.includes("reasoning") || normalized.includes("plan") || normalized.includes("draft") || normalized.includes("analyze")) return "think";

  return "generic";
}

function buildContextFromText(text: string, type: ActionType): string {
  const normalized = text.trim();
  if (!normalized) return "";

  // Extract file names, paths, or key subjects
  const fileMatch = normalized.match(/[`\"']([^`\"']+\.(?:md|tsx|ts|js|jsx|json|css|html|py|rs|go|java|txt))[`\"']/i);
  if (fileMatch) return fileMatch[1];

  const pathMatch = normalized.match(/(?:file|path|dir|directory|folder)\s*:?\s*[`\"']?([^`\"'\n]+)[`\"']?/i);
  if (pathMatch) return pathMatch[1].trim().slice(0, 60);

  const commandMatch = normalized.match(/(?:running|execute|run):?\s*[`\"']?([^`\"'\n]+)[`\"']?/i);
  if (commandMatch && type === "terminal") return commandMatch[1].trim().slice(0, 60);

  // For short texts, use as-is
  if (normalized.length <= 50) return normalized;

  // Use first sentence or truncated text
  const firstSentence = normalized.split(/[.!?]/)[0];
  if (firstSentence && firstSentence.length > 10 && firstSentence.length < 80) {
    return firstSentence.trim();
  }

  return normalized.slice(0, 60) + (normalized.length > 60 ? "..." : "");
}

export function AgentActionStream({ thoughts, isThinking = false }: AgentActionStreamProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = useCallback((id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const rows = useMemo<ActionRow[]>(() => {
    return thoughts.map((t, idx) => {
      let stepLabel = t.step.replace(/_/g, " ");
      let status: ActionRow["status"] = "completed";
      let durationMs: number | null = null;
      let detail: string | null = null;

      if (t.meta) {
        for (const meta of t.meta) {
          if (meta.startsWith("stepLabel:")) stepLabel = meta.substring("stepLabel:".length);
          if (meta.startsWith("status:")) {
            const s = meta.substring("status:".length);
            if (s === "streaming" || s === "running") status = "running";
            else if (s === "failed") status = "failed";
            else if (s === "pending") status = "pending";
          }
          if (meta.startsWith("durationMs:")) durationMs = parseInt(meta.substring("durationMs:".length), 10);
          if (meta.startsWith("detail:")) detail = meta.substring("detail:".length);
        }
      }

      const type = detectActionType(t.step, stepLabel, t.text);
      const context = buildContextFromText(t.text, type);
      const config = ACTION_CONFIG[type];
      const label = config.label;

      return {
        id: `${t.step}-${idx}`,
        type,
        label,
        context,
        detail: detail || null,
        status,
        durationMs,
        text: t.text,
      };
    });
  }, [thoughts]);

  if (thoughts.length === 0 && !isThinking) return null;

  return (
    <div className="my-3 select-none">
      {/* Vertical timeline connector */}
      <div className="relative">
        <div className="absolute left-[15px] top-[10px] bottom-[10px] w-[1.5px] rounded-full bg-white/[0.06]" />

        <div className="relative flex flex-col">
          {rows.map((row, idx) => {
            const config = ACTION_CONFIG[row.type];
            const isExpanded = expandedRows.has(row.id);
            const Icon = config.icon;

            return (
              <div key={row.id} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => toggleRow(row.id)}
                  className="group relative flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors duration-200 hover:bg-white/[0.03] animate-[row-fade_0.25s_ease-out_both]"
                  style={{ animationDelay: `${Math.min(idx * 40, 300)}ms` }}
                  aria-expanded={isExpanded}
                >
                  {/* Action dot / icon */}
                  <div className="relative z-10 flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                    <div
                      className="h-[10px] w-[10px] rounded-full transition-transform duration-200 group-hover:scale-110"
                      style={{ backgroundColor: config.color, boxShadow: `0 0 6px ${config.color}40` }}
                    />
                  </div>

                  {/* Label + Context */}
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="shrink-0 text-[13px] font-medium text-white/[0.82]">
                      {row.label}
                    </span>
                    {row.context && (
                      <>
                        <span className="shrink-0 text-[13px] text-white/30">·</span>
                        <span className="truncate text-[13px] text-white/45">
                          {row.context}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Right side: status + chevron */}
                  <div className="flex shrink-0 items-center gap-2">
                    {row.status === "running" && (
                      <Loader2 className="h-3 w-3 animate-spin text-white/40" />
                    )}
                    <ChevronRight
                      className={`h-3.5 w-3.5 text-white/25 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                    />
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="ml-[26px] mr-2 overflow-hidden">
                    <div
                      className="rounded-lg px-3 py-2.5 text-[12px] leading-relaxed text-white/60"
                      style={{ backgroundColor: config.bg }}
                    >
                      <div className="mb-1.5 flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5" style={{ color: config.color }} />
                        <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: config.color }}>
                          {row.label}
                        </span>
                        {row.durationMs != null && row.durationMs > 0 && (
                          <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-mono text-white/30">
                            {row.durationMs}ms
                          </span>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap">{row.text}</p>
                      {row.detail && (
                        <p className="mt-1.5 overflow-x-auto rounded bg-black/20 px-2 py-1.5 font-mono text-[11px] text-white/40">
                          {row.detail}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {isThinking && (
            <div className="flex items-center gap-3 rounded-lg px-2 py-2.5 animate-[row-fade_0.25s_ease-out]">
              <div className="relative z-10 flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                <div className="h-[10px] w-[10px] animate-pulse rounded-full bg-white/40" />
              </div>
              <span className="text-[13px] text-white/40">Thinking...</span>
              <Loader2 className="h-3 w-3 animate-spin text-white/30" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
