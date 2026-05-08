import { useState, useMemo, useCallback } from "react";
import {
  ChevronRight,
  Terminal,
  Brain,
  FilePlus,
  FileText,
  FilePen,
  Pencil,
  Loader2,
  Search,
  Clock,
  AlertCircle,
  CheckCircle2,
  Globe,
  Wrench,
  Eye,
  Sparkles,
  X,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import type { ThoughtItem } from "./MessageComponents";
import { AiOrb } from "./AiOrb";

interface AgentActionStreamProps {
  thoughts: ThoughtItem[];
  isThinking?: boolean;
  thinkingDuration?: number;
  onActionClick?: (action: AgentActionItem) => void;
}

export type ActionCategory =
  | "think"
  | "search"
  | "file_create"
  | "file_read"
  | "file_write"
  | "file_edit"
  | "command"
  | "preview"
  | "media"
  | "browser"
  | "monologue"
  | "generic";

export type ActionStatus = "pending" | "running" | "completed" | "failed";

export interface AgentActionItem {
  id: string;
  type: ActionCategory;
  label: string;
  context: string;
  detail: string | null;
  status: ActionStatus;
  durationMs: number | null;
  text: string;
  timestamp?: number;
  command?: string;
  filePath?: string;
  searchQuery?: string;
}

/* ── Category Configuration ─────────────────────────────── */

interface CategoryConfig {
  color: string;
  bg: string;
  icon: LucideIcon;
  label: string;
  prefix?: string;
  ansiColor?: string;
}

export const CATEGORY_CONFIG: Record<ActionCategory, CategoryConfig> = {
  think: {
    color: "#a78bfa",
    bg: "rgba(167, 139, 250, 0.06)",
    icon: Brain,
    label: "Thinking",
    ansiColor: "#c084fc",
  },
  search: {
    color: "#fbbf24",
    bg: "rgba(251, 191, 36, 0.06)",
    icon: Search,
    label: "Searching",
    prefix: "🔍",
    ansiColor: "#f59e0b",
  },
  file_create: {
    color: "#34d399",
    bg: "rgba(52, 211, 153, 0.06)",
    icon: FilePlus,
    label: "Creating",
    prefix: "+",
    ansiColor: "#4ade80",
  },
  file_read: {
    color: "#60a5fa",
    bg: "rgba(96, 165, 250, 0.06)",
    icon: FileText,
    label: "Reading",
    prefix: "◆",
    ansiColor: "#60a5fa",
  },
  file_write: {
    color: "#38bdf8",
    bg: "rgba(56, 189, 248, 0.06)",
    icon: FilePen,
    label: "Writing",
    prefix: "◆",
    ansiColor: "#38bdf8",
  },
  file_edit: {
    color: "#fb923c",
    bg: "rgba(251, 146, 60, 0.06)",
    icon: Pencil,
    label: "Editing",
    prefix: "~",
    ansiColor: "#fb923c",
  },
  command: {
    color: "#9ca3af",
    bg: "rgba(156, 163, 175, 0.06)",
    icon: Terminal,
    label: "Executing",
    prefix: "$",
    ansiColor: "#9ca3af",
  },
  preview: {
    color: "#22d3ee",
    bg: "rgba(34, 211, 238, 0.06)",
    icon: Eye,
    label: "Previewing",
    ansiColor: "#22d3ee",
  },
  media: {
    color: "#f472b6",
    bg: "rgba(244, 114, 182, 0.06)",
    icon: Sparkles,
    label: "Generating",
    ansiColor: "#f472b6",
  },
  browser: {
    color: "#818cf8",
    bg: "rgba(129, 140, 248, 0.06)",
    icon: Globe,
    label: "Browsing",
    ansiColor: "#818cf8",
  },
  monologue: {
    color: "#a78bfa",
    bg: "rgba(167, 139, 250, 0.04)",
    icon: Brain,
    label: "Planning",
    ansiColor: "#c084fc",
  },
  generic: {
    color: "#9ca3af",
    bg: "rgba(156, 163, 175, 0.04)",
    icon: Wrench,
    label: "Working",
    ansiColor: "#9ca3af",
  },
};

/* ── Detection ─────────────────────────────────────────── */

export function detectActionCategory(step: string, stepLabel: string, text: string): ActionCategory {
  const normalized = `${step} ${stepLabel} ${text}`.toLowerCase();

  if (/\bsearch\b|\bweb_search\b|\btavily\b|\blookup\b|\bquery\b/.test(normalized)) return "search";
  if (/\bscrap\b|\bcrawl\b/.test(normalized)) return "browser";
  if (/\bfile_created\b|\bcreate file\b|\bfile created\b|\bnew file\b|\bwriting.*to\b/.test(normalized)) return "file_create";
  if (/\bedit\b|\bmodify\b|\bpatch\b|\bupdate file\b|\breplac\b/.test(normalized)) return "file_edit";
  if (/\bwrite\b|\bsave\b|\boutput\b|\bgenerat.*file\b/.test(normalized)) return "file_write";
  if (/\bread\b|\bfetch\b|\bload\b|\bget file\b/.test(normalized)) return "file_read";
  if (/\bterminal\b|\bexecute\b|\brun\b|\bshell\b|\bcommand\b|\bbuild\b|\bnpm\b|\bnpx\b|\bdocker\b|\bmake\b|\bgit\b/.test(normalized)) return "command";
  if (/\bnavigat\b|\bbrowser\b|\bclick\b|\bscreenshot\b|\bviewport\b/.test(normalized)) return "browser";
  if (/\bimage\b|\bvideo\b|\bmanim\b|\brender\b|\bffmpeg\b|\bgenerat.*media\b/.test(normalized)) return "media";
  if (/\bpreview\b|\bscene\b|\bviewport\b|\bdisplay\b/.test(normalized)) return "preview";
  if (/\bthink\b|\breason\b|\bplan\b|\bdraft\b|\banalyz\b|\breflect\b/.test(normalized)) return "think";
  if (step === "monologue" || step === "intent" || step === "turn_started" || step === "turn_complete") return "monologue";

  return "generic";
}

/* ── Extraction ───────────────────────────────────────── */

function extractFilePath(text: string): string | undefined {
  const match = text.match(/[`"']([^`"'\n]+\.(?:md|tsx|ts|js|jsx|json|css|html|py|rs|go|java|txt))[`"']/i);
  if (match) return match[1];
  const pathMatch = text.match(/(?:file|path)\s*:?\s*[`"']?([^`"'\n]+)[`"']?/i);
  if (pathMatch) return pathMatch[1].trim().slice(0, 80);
  return undefined;
}

function extractCommand(text: string): string | undefined {
  const match = text.match(/(?:running|execute|run|command):?\s*[`"']?([^`"'\n]{3,80})[`"']?/i);
  if (match) return match[1].trim();
  const shellMatch = text.match(/(?:^|\n)\$\s*([^\n]{3,80})/);
  if (shellMatch) return shellMatch[1].trim();
  return undefined;
}

function extractSearchQuery(text: string): string | undefined {
  const match = text.match(/(?:search|query|looking for|find)\s*:?\s*[`"']([^`"']+)[`"']/i);
  if (match) return match[1].trim().slice(0, 100);
  return undefined;
}

function extractContext(text: string, type: ActionCategory): string {
  const normalized = text.trim();
  if (!normalized) return "";

  if (type === "command") {
    const cmd = extractCommand(text);
    if (cmd) return cmd.slice(0, 70);
  }
  if (type === "search") {
    const query = extractSearchQuery(text);
    if (query) return query;
  }
  if (type.startsWith("file_")) {
    const path = extractFilePath(text);
    if (path) return path;
  }

  if (normalized.length <= 50) return normalized;
  const firstSentence = normalized.split(/[.!?]/)[0];
  if (firstSentence && firstSentence.length > 10 && firstSentence.length < 80) {
    return firstSentence.trim();
  }
  return normalized.slice(0, 60) + (normalized.length > 60 ? "…" : "");
}

/* ── Build Actions ────────────────────────────────────── */

export function buildAgentActions(thoughts: ThoughtItem[]): AgentActionItem[] {
  return thoughts.map((t, idx) => {
    let stepLabel = t.step.replace(/_/g, " ");
    let status: ActionStatus = "completed";
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

    const type = detectActionCategory(t.step, stepLabel, t.text);
    const context = extractContext(t.text, type);
    const config = CATEGORY_CONFIG[type];

    return {
      id: `${t.step}-${idx}-${t.timestamp || Date.now()}`,
      type,
      label: config.label,
      context,
      detail: detail || null,
      status,
      durationMs,
      text: t.text,
      timestamp: t.timestamp,
      command: type === "command" ? extractCommand(t.text) : undefined,
      filePath: type.startsWith("file_") ? extractFilePath(t.text) : undefined,
      searchQuery: type === "search" ? extractSearchQuery(t.text) : undefined,
    };
  });
}

/* ── Sub-components ───────────────────────────────────── */

export function StatusIcon({ status }: { status: ActionStatus | "success" | "error" }) {
  switch (status) {
    case "success":
    case "completed":
      return <CheckCircle2 className="h-3 w-3 text-emerald-400/70" />;
    case "error":
    case "failed":
      return <AlertCircle className="h-3 w-3 text-red-400/70" />;
    case "running":
    case "pending":
      return <Loader2 className="h-3 w-3 animate-spin text-white/50" />;
    default:
      return null;
  }
}

export function TerminalCommand({ command, isStreaming }: { command: string; isStreaming?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 font-mono text-[11px]">
      <span className="text-white/30 select-none">$</span>
      <span className="text-white/70">{command}</span>
      {isStreaming && (
        <span className="inline-block h-3.5 w-1.5 bg-white/40 animate-pulse rounded-sm" />
      )}
    </div>
  );
}

export function FilePathBadge({ path, operation }: { path: string; operation: "create" | "read" | "write" | "edit" }) {
  const colorMap = {
    create: "text-emerald-400/80 bg-emerald-400/8 border-emerald-400/15",
    read: "text-blue-400/80 bg-blue-400/8 border-blue-400/15",
    write: "text-sky-400/80 bg-sky-400/8 border-sky-400/15",
    edit: "text-orange-400/80 bg-orange-400/8 border-orange-400/15",
  };
  const iconMap = { create: "+", read: "◆", write: "◆", edit: "~" };

  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-mono border ${colorMap[operation]}`}>
      <span className="opacity-50 select-none">{iconMap[operation]}</span>
      <span className="truncate max-w-[200px]">{path}</span>
    </span>
  );
}

export function SearchQueryBadge({ query }: { query: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-amber-400/8 px-1.5 py-0.5 text-[10px] font-medium text-amber-400/70 border border-amber-400/15">
      <Search className="h-2.5 w-2.5" />
      <span className="truncate max-w-[200px]">{query}</span>
    </span>
  );
}

/* ── Detail Overlay (opens on action click) ────────────── */

function ActionDetailOverlay({ action, onClose }: { action: AgentActionItem; onClose: () => void }) {
  const config = CATEGORY_CONFIG[action.type];
  const Icon = config.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/[0.08] bg-[#1a1a1e]/95 backdrop-blur-xl shadow-2xl animate-[scale-in_0.25s_cubic-bezier(0.34,1.56,0.64,1)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-xl"
            style={{ backgroundColor: config.bg }}
          >
            <Icon className="h-4 w-4" style={{ color: config.color }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-white/90">{config.label}</div>
            {action.durationMs != null && action.durationMs > 0 && (
              <div className="text-[11px] text-white/35 font-mono">
                {action.durationMs < 1000 ? `${action.durationMs}ms` : `${(action.durationMs / 1000).toFixed(1)}s`}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-white/40 transition hover:bg-white/[0.06] hover:text-white/70"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto scrollbar">
          {/* Rich context */}
          {action.command && (
            <div className="rounded-xl bg-black/30 border border-white/[0.05] px-4 py-3">
              <div className="text-[10px] uppercase tracking-wider text-white/30 mb-2">Command</div>
              <TerminalCommand command={action.command} />
            </div>
          )}

          {action.filePath && (
            <div className="rounded-xl bg-black/30 border border-white/[0.05] px-4 py-3">
              <div className="text-[10px] uppercase tracking-wider text-white/30 mb-2">File</div>
              <FilePathBadge
                path={action.filePath}
                operation={action.type === "file_create" ? "create" : action.type === "file_read" ? "read" : action.type === "file_write" ? "write" : "edit"}
              />
            </div>
          )}

          {action.searchQuery && (
            <div className="rounded-xl bg-black/30 border border-white/[0.05] px-4 py-3">
              <div className="text-[10px] uppercase tracking-wider text-white/30 mb-2">Search Query</div>
              <div className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5 text-amber-400/60" />
                <span className="text-[13px] text-white/70">{action.searchQuery}</span>
              </div>
            </div>
          )}

          {/* Full text */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/30 mb-2">Details</div>
            <p className="text-[13px] leading-relaxed text-white/65 whitespace-pre-wrap">{action.text}</p>
          </div>

          {action.detail && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-white/30 mb-2">Output</div>
              <pre className="rounded-xl bg-black/30 border border-white/[0.05] px-4 py-3 font-mono text-[11px] text-white/50 overflow-x-auto whitespace-pre-wrap">
                {action.detail}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────── */

export function AgentActionStream({ thoughts, isThinking = false, onActionClick }: AgentActionStreamProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [detailAction, setDetailAction] = useState<AgentActionItem | null>(null);

  const toggleRow = useCallback((id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const rows = useMemo<AgentActionItem[]>(() => buildAgentActions(thoughts), [thoughts]);

  if (thoughts.length === 0 && !isThinking) return null;

  return (
    <>
      <div className="my-3 select-none">
        <div className="relative overflow-hidden rounded-2xl transition-all duration-300">
          {/* Processing header */}
          <div className="flex items-center gap-2.5 px-1 py-2">
            <AiOrb size={isThinking ? 22 : 16} className="transition-all duration-500" />
            <span
              className={`text-[12.5px] font-medium transition-all duration-300 ${
                isThinking
                  ? "text-white/70"
                  : "text-white/30"
              }`}
            >
              {isThinking ? "Processing" : rows.length > 0 ? "Processed" : ""}
            </span>
            {isThinking && (
              <span className="flex gap-[3px] items-center ml-0.5">
                <span className="h-[3px] w-[3px] rounded-full bg-white/40 animate-[pulse-dot_1.4s_ease-in-out_infinite]" />
                <span className="h-[3px] w-[3px] rounded-full bg-white/40 animate-[pulse-dot_1.4s_ease-in-out_0.2s_infinite]" />
                <span className="h-[3px] w-[3px] rounded-full bg-white/40 animate-[pulse-dot_1.4s_ease-in-out_0.4s_infinite]" />
              </span>
            )}
          </div>

          {/* Action rows */}
          <div className="relative flex flex-col gap-0.5 px-0.5">
            {rows.map((row, idx) => {
              const config = CATEGORY_CONFIG[row.type];
              const isExpanded = expandedRows.has(row.id);
              const Icon = config.icon;
              const isActive = row.status === "running" || row.status === "pending";

              return (
                <div key={row.id} className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => toggleRow(row.id)}
                    className="group relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all duration-200 hover:bg-white/[0.04] active:scale-[0.995] animate-[row-fade_0.3s_cubic-bezier(0.34,1.56,0.64,1)_both]"
                    style={{ animationDelay: `${Math.min(idx * 35, 250)}ms` }}
                    aria-expanded={isExpanded}
                  >
                    {/* Category icon */}
                    <div className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center">
                      {isActive && (
                        <div
                          className="absolute h-5 w-5 rounded-full animate-ping opacity-15"
                          style={{ backgroundColor: config.color }}
                        />
                      )}
                      <Icon
                        className={`h-3.5 w-3.5 transition-all duration-300 ${isActive ? "opacity-100" : "opacity-50"}`}
                        style={{ color: config.color }}
                      />
                    </div>

                    {/* Content */}
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span
                        className={`shrink-0 text-[12.5px] font-medium transition-colors duration-200 ${isActive ? "text-white/85" : "text-white/55"}`}
                      >
                        {config.label}
                      </span>
                      {row.context && (
                        <>
                          <span className="shrink-0 text-[12px] text-white/15 select-none">·</span>
                          <span className="truncate text-[11.5px] text-white/35 font-mono">
                            {row.type === "command" && row.command ? (
                              <span className="flex items-center gap-1">
                                <span className="text-white/20">$</span>
                                <span className="truncate">{row.command.slice(0, 45)}</span>
                              </span>
                            ) : row.type === "search" && row.searchQuery ? (
                              <SearchQueryBadge query={row.searchQuery} />
                            ) : row.type.startsWith("file_") && row.filePath ? (
                              <FilePathBadge
                                path={row.filePath}
                                operation={row.type === "file_create" ? "create" : row.type === "file_read" ? "read" : row.type === "file_write" ? "write" : "edit"}
                              />
                            ) : (
                              row.context
                            )}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Right side */}
                    <div className="flex shrink-0 items-center gap-1.5">
                      {row.durationMs != null && row.durationMs > 0 && (
                        <span className="text-[10px] font-mono text-white/20">
                          {row.durationMs < 1000 ? `${row.durationMs}ms` : `${(row.durationMs / 1000).toFixed(1)}s`}
                        </span>
                      )}
                      {row.status === "running" && (
                        <Loader2 className="h-3 w-3 animate-spin text-white/30" />
                      )}
                      {row.status === "failed" && (
                        <AlertCircle className="h-3 w-3 text-red-400/50" />
                      )}
                      <ChevronRight
                        className={`h-3 w-3 text-white/20 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                      />
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="ml-8 mr-2 mb-1 overflow-hidden animate-[slide-up-fade_0.2s_ease-out]">
                      <button
                        type="button"
                        onClick={() => {
                          setDetailAction(row);
                          onActionClick?.(row);
                        }}
                        className="group/detail w-full text-left rounded-xl px-3.5 py-3 text-[12px] leading-relaxed text-white/55 border border-white/[0.04] bg-white/[0.015] transition-all duration-200 hover:bg-white/[0.03] hover:border-white/[0.08] active:scale-[0.998]"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Icon className="h-3.5 w-3.5" style={{ color: config.color, opacity: 0.7 }} />
                            <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: config.color, opacity: 0.7 }}>
                              {config.label}
                            </span>
                          </div>
                          <ExternalLink className="h-3 w-3 text-white/20 opacity-0 group-hover/detail:opacity-100 transition-opacity" />
                        </div>

                        {row.command && <TerminalCommand command={row.command} />}
                        {row.filePath && (
                          <div className="mt-1.5">
                            <FilePathBadge
                              path={row.filePath}
                              operation={row.type === "file_create" ? "create" : row.type === "file_read" ? "read" : row.type === "file_write" ? "write" : "edit"}
                            />
                          </div>
                        )}
                        {row.searchQuery && (
                          <div className="mt-1.5">
                            <SearchQueryBadge query={row.searchQuery} />
                          </div>
                        )}

                        <p className="mt-2 whitespace-pre-wrap line-clamp-3">{row.text}</p>

                        {row.detail && (
                          <p className="mt-2 overflow-x-auto rounded-lg bg-black/20 px-2.5 py-2 font-mono text-[10.5px] text-white/35 line-clamp-4">
                            {row.detail}
                          </p>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {isThinking && (
              <div className="flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 animate-[row-fade_0.3s_ease-out]">
                <div className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center">
                  <AiOrb size={18} />
                </div>
                <span className="text-[12.5px] font-medium text-white/50">Processing</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Detail overlay */}
      {detailAction && (
        <ActionDetailOverlay action={detailAction} onClose={() => setDetailAction(null)} />
      )}
    </>
  );
}
