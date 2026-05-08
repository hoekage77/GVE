import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import {
  X,
  Terminal,
  FolderGit2,
  Monitor,
  Film,
  Activity,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  AlertCircle,
  FileCode,
  FileJson,
  FileText,
  FileType,
  File as FileIcon,
  Folder,
  ChevronDown,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  ArrowDownToLine,
  Brain,
  ExternalLink,
  Layers,
} from "lucide-react";
import { useChatStore } from "../../stores";
import type { AgentFileEntry, AgentToolLogEntry } from "../../stores/chat/types";
import type { ThoughtItem } from "../chat/MessageComponents";
import {
  buildAgentActions,
  CATEGORY_CONFIG,
  type AgentActionItem,
  StatusIcon,
  TerminalCommand,
  FilePathBadge,
  SearchQueryBadge,
} from "../chat/AgentActionStream";
import SceneViewer from "../SceneViewer";

/* ── Types ─────────────────────────────────────────────── */

type TerminalTab = "terminal" | "files" | "preview" | "media";

/* ── Helpers ───────────────────────────────────────────── */

function fileIconForName(name: string) {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  switch (ext) {
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
      return <FileCode className="h-3.5 w-3.5 text-yellow-400/80" />;
    case "py":
      return <FileCode className="h-3.5 w-3.5 text-blue-400/80" />;
    case "css":
    case "scss":
      return <FileText className="h-3.5 w-3.5 text-purple-400/80" />;
    case "json":
      return <FileJson className="h-3.5 w-3.5 text-orange-400/80" />;
    case "md":
      return <FileText className="h-3.5 w-3.5 text-white/60" />;
    case "html":
      return <FileType className="h-3.5 w-3.5 text-red-400/80" />;
    default:
      return <FileIcon className="h-3.5 w-3.5 text-white/40" />;
  }
}

function formatTimestamp(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/* ── CRT Styling ───────────────────────────────────────── */

function CRTScanlines() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 opacity-[0.03]"
      style={{
        background:
          "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.25) 2px, rgba(0,0,0,0.25) 4px)",
      }}
    />
  );
}

/* ── Tab Button ────────────────────────────────────────── */

function TabButton({
  active,
  tab,
  onClick,
  badge,
}: {
  active: boolean;
  tab: { id: TerminalTab; label: string; icon: React.ReactNode; desc: string };
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex flex-1 flex-col items-center gap-1 rounded-xl px-3 py-2.5 text-[11px] font-medium transition-all duration-200 ${
        active
          ? "bg-white/[0.06] text-[#79c0ff]"
          : "text-white/30 hover:bg-white/[0.03] hover:text-white/60"
      }`}
    >
      <div className={`transition-transform duration-200 ${active ? "scale-110" : "group-hover:scale-105"}`}>
        {tab.icon}
      </div>
      <span>{tab.label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400/20 px-1 text-[9px] font-bold text-amber-400">
          {badge}
        </span>
      )}
      {active && (
        <span className="absolute bottom-0.5 left-1/2 h-[2px] w-6 -translate-x-1/2 rounded-full bg-[#79c0ff] shadow-[0_0_8px_rgba(121,192,255,0.5)]" />
      )}
    </button>
  );
}

/* ── Scroll Control Hook ──────────────────────────────── */

function useScrollControl(isRunning: boolean, entryCount: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const prevEntryCountRef = useRef(entryCount);

  // Detect if user scrolls up and disable auto-scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 40;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setIsAtBottom(atBottom);
    setShowJumpButton(!atBottom && entryCount > 0);
    if (!atBottom && autoScrollEnabled) {
      setAutoScrollEnabled(false);
    }
  }, [entryCount, autoScrollEnabled]);

  // Auto-scroll when running and at bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !autoScrollEnabled) return;

    // Only auto-scroll if entries increased or we're actively running
    if (entryCount > prevEntryCountRef.current || isRunning) {
      el.scrollTop = el.scrollHeight;
    }
    prevEntryCountRef.current = entryCount;
  }, [entryCount, isRunning, autoScrollEnabled]);

  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setAutoScrollEnabled(true);
    setShowJumpButton(false);
    setIsAtBottom(true);
  }, []);

  return { scrollRef, isAtBottom, showJumpButton, autoScrollEnabled, handleScroll, jumpToBottom };
}

/* ── Character Typing Animation Hook ───────────────────── */

function useTypingAnimation(text: string | null, isActive: boolean, speed: number = 8) {
  const [displayText, setDisplayText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isActive || !text) {
      setDisplayText(text || "");
      setIsTyping(false);
      return;
    }

    setIsTyping(true);
    let index = 0;
    let current = "";

    const typeNext = () => {
      if (index >= text.length) {
        setDisplayText(text);
        setIsTyping(false);
        return;
      }

      const char = text[index];
      current += char;
      setDisplayText(current);
      index++;

      // Variable delay: faster for normal chars, slower for punctuation
      let delay = speed;
      if ('.!?,;:'.includes(char)) {
        delay = speed + Math.random() * 30 + 20;
      } else {
        delay = speed + Math.random() * 3;
      }

      timeoutRef.current = setTimeout(typeNext, delay);
    };

    typeNext();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [text, isActive, speed]);

  return { displayText, isTyping };
}

/* ── Terminal View (Primary) ───────────────────────────── */

function TerminalView({
  toolLog,
  thoughts,
  isRunning,
  thinkingText,
  thinkingStep,
}: {
  toolLog: AgentToolLogEntry[];
  thoughts: ThoughtItem[];
  isRunning: boolean;
  thinkingText: string | null;
  thinkingStep: string;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [playbackPaused, setPlaybackPaused] = useState(false);
  const [focusedEntryIndex, setFocusedEntryIndex] = useState<number | null>(null);

  const agentActions = useMemo(() => buildAgentActions(thoughts), [thoughts]);

  const allEntries = useMemo(() => {
    const entries: Array<
      | { kind: "action"; item: AgentActionItem }
      | { kind: "tool"; item: AgentToolLogEntry }
      | { kind: "live"; text: string; step: string }
    > = [];

    agentActions.forEach((action) => {
      entries.push({ kind: "action", item: action });
    });

    toolLog.forEach((tool) => {
      const hasAction = agentActions.some(
        (a) => a.text.includes(tool.tool) || tool.output.includes(a.context)
      );
      if (!hasAction) {
        entries.push({ kind: "tool", item: tool });
      }
    });

    if (isRunning && thinkingText) {
      entries.push({ kind: "live", text: thinkingText, step: thinkingStep });
    }

    return entries;
  }, [agentActions, toolLog, isRunning, thinkingText, thinkingStep]);

  const { scrollRef, showJumpButton, handleScroll, jumpToBottom } = useScrollControl(
    isRunning && !playbackPaused,
    allEntries.length
  );

  // Typing animation for the live thinking text
  const liveEntry = allEntries[allEntries.length - 1];
  const isLiveThinking = liveEntry?.kind === "live";
  const { displayText: typedThinkingText, isTyping } = useTypingAnimation(
    isLiveThinking ? liveEntry.text : null,
    isRunning && !playbackPaused,
    4
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Playback navigation
  const handlePlayPause = useCallback(() => {
    setPlaybackPaused((prev) => !prev);
  }, []);

  const handleSkipBack = useCallback(() => {
    if (allEntries.length === 0) return;
    setFocusedEntryIndex((prev) => {
      const next = prev === null ? Math.max(0, allEntries.length - 2) : Math.max(0, prev - 1);
      // Scroll to entry
      const el = scrollRef.current;
      if (el) {
        const entryEls = el.querySelectorAll('[data-entry-index]');
        const target = entryEls[next] as HTMLElement | undefined;
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
      return next;
    });
  }, [allEntries.length, scrollRef]);

  const handleSkipForward = useCallback(() => {
    if (allEntries.length === 0) return;
    setFocusedEntryIndex((prev) => {
      const next = prev === null ? allEntries.length - 1 : Math.min(allEntries.length - 1, prev + 1);
      const el = scrollRef.current;
      if (el) {
        const entryEls = el.querySelectorAll('[data-entry-index]');
        const target = entryEls[next] as HTMLElement | undefined;
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
      return next;
    });
  }, [allEntries.length, scrollRef]);

  const handleSkipToEnd = useCallback(() => {
    setFocusedEntryIndex(null);
    jumpToBottom();
    setPlaybackPaused(false);
  }, [jumpToBottom]);

  const handleReset = useCallback(() => {
    setFocusedEntryIndex(0);
    const el = scrollRef.current;
    if (el) {
      const entryEls = el.querySelectorAll('[data-entry-index]');
      const target = entryEls[0] as HTMLElement | undefined;
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        el.scrollTop = 0;
      }
    }
  }, [scrollRef]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="relative flex h-full flex-col overflow-auto scrollbar"
    >
      {/* Terminal header with playback controls */}
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-white/[0.04] bg-[#0a0a0a]/95 px-3 py-2 backdrop-blur-sm">
        <Activity className="h-3.5 w-3.5 text-[#79c0ff]/60" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-white/30">
          Agent Activity Log
        </span>

        {/* Playback controls */}
        {allEntries.length > 0 && (
          <div className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              onClick={handleReset}
              disabled={allEntries.length === 0}
              className="flex h-6 w-6 items-center justify-center rounded text-white/30 hover:bg-white/[0.06] hover:text-white/60 transition-colors disabled:opacity-30"
              title="Reset to start"
            >
              <SkipBack className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={handleSkipBack}
              disabled={allEntries.length === 0}
              className="flex h-6 w-6 items-center justify-center rounded text-white/30 hover:bg-white/[0.06] hover:text-white/60 transition-colors disabled:opacity-30"
              title="Previous action"
            >
              <ChevronRight className="h-3 w-3 rotate-180" />
            </button>
            <button
              type="button"
              onClick={handlePlayPause}
              className="flex h-6 w-6 items-center justify-center rounded text-white/40 hover:bg-white/[0.06] hover:text-white/80 transition-colors"
              title={playbackPaused ? "Resume live stream" : "Pause live stream"}
            >
              {playbackPaused ? (
                <Play className="h-3 w-3" />
              ) : (
                <Pause className="h-3 w-3" />
              )}
            </button>
            <button
              type="button"
              onClick={handleSkipForward}
              disabled={allEntries.length === 0}
              className="flex h-6 w-6 items-center justify-center rounded text-white/30 hover:bg-white/[0.06] hover:text-white/60 transition-colors disabled:opacity-30"
              title="Next action"
            >
              <ChevronRight className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={handleSkipToEnd}
              className="flex h-6 w-6 items-center justify-center rounded text-white/30 hover:bg-white/[0.06] hover:text-white/60 transition-colors"
              title="Skip to live"
            >
              <SkipForward className="h-3 w-3" />
            </button>
          </div>
        )}

        {isRunning && !playbackPaused && (
          <span className="ml-2 flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-400/70">
            <span className="flex h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            RUNNING
          </span>
        )}
        <span className="text-[10px] font-mono text-white/20 ml-2">
          {allEntries.length} entries
        </span>
      </div>

      {/* Timeline container */}
      <div className="relative flex flex-col">
        {/* Timeline connector line */}
        {allEntries.length > 0 && (
          <div className="absolute left-[23px] top-[14px] bottom-[14px] w-[1.5px] rounded-full bg-white/[0.04]" />
        )}

        {allEntries.length === 0 && (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-white/20">
            <Terminal className="h-8 w-8 text-white/10" />
            <span className="text-[11px] font-mono">No agent activity yet.</span>
            <span className="text-[10px] font-mono text-white/10">
              Activity will appear here when the agent starts working.
            </span>
          </div>
        )}

        {allEntries.map((entry, idx) => {
          const isFocused = focusedEntryIndex === idx;

          if (entry.kind === "action") {
            const action = entry.item;
            const config = CATEGORY_CONFIG[action.type];
            const Icon = config.icon;
            const isExpanded = expandedIds.has(action.id);
            const isActive = action.status === "running" || action.status === "pending";

            return (
              <motion.div
                key={`act-${idx}-${action.id}`}
                data-entry-index={idx}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: Math.min(idx * 0.03, 0.3) }}
                className={`flex flex-col border-b border-white/[0.02] transition-colors hover:bg-white/[0.01] ${
                  isFocused ? "bg-white/[0.03] ring-1 ring-inset ring-white/[0.06]" : ""
                } ${isActive ? "bg-white/[0.015]" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => toggleExpanded(action.id)}
                  className="flex w-full items-start gap-3 px-4 py-2.5 text-left"
                >
                  {/* Category dot with timeline alignment */}
                  <div className="relative z-10 mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                    {isActive ? (
                      <div
                        className="h-[10px] w-[10px] rounded-full animate-pulse"
                        style={{
                          backgroundColor: config.color,
                          boxShadow: `0 0 10px ${config.color}60`,
                        }}
                      />
                    ) : (
                      <div
                        className="h-[8px] w-[8px] rounded-full"
                        style={{
                          backgroundColor: config.color,
                          boxShadow: `0 0 6px ${config.color}40`,
                        }}
                      />
                    )}
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className="text-[11px] font-medium"
                        style={{ color: isActive ? `${config.color}cc` : "rgba(255,255,255,0.7)" }}
                      >
                        {action.label}
                      </span>
                      {action.context && (
                        <span className="truncate text-[10px] text-white/30 font-mono">
                          {action.type === "command" && action.command ? (
                            <TerminalCommand command={action.command} />
                          ) : action.type === "search" && action.searchQuery ? (
                            <SearchQueryBadge query={action.searchQuery} />
                          ) : action.type.startsWith("file_") && action.filePath ? (
                            <FilePathBadge
                              path={action.filePath}
                              operation={
                                action.type === "file_create"
                                  ? "create"
                                  : action.type === "file_read"
                                    ? "read"
                                    : action.type === "file_write"
                                      ? "write"
                                      : "edit"
                              }
                            />
                          ) : (
                            action.context
                          )}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-[10px] font-mono text-white/15">
                        {formatTimestamp(action.timestamp)}
                      </span>
                      {action.durationMs != null && action.durationMs > 0 && (
                        <span className="flex items-center gap-0.5 text-[10px] font-mono text-white/20">
                          <Clock className="h-2.5 w-2.5" />
                          {action.durationMs}ms
                        </span>
                      )}
                      {isActive && (
                        <span
                          className="text-[10px] font-mono animate-pulse"
                          style={{ color: config.color }}
                        >
                          RUNNING
                        </span>
                      )}
                      {action.status === "failed" && (
                        <span className="text-[10px] font-mono text-red-400/60">FAILED</span>
                      )}
                      <StatusIcon status={action.status} />
                    </div>
                  </div>

                  <div className="mt-0.5 shrink-0">
                    <ChevronRight
                      className={`h-3 w-3 text-white/15 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                    />
                  </div>
                </button>

                {/* Expanded detail with smooth height transition */}
                <motion.div
                  initial={false}
                  animate={{
                    height: isExpanded ? "auto" : 0,
                    opacity: isExpanded ? 1 : 0,
                  }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-2.5 pl-[43px]">
                    <div
                      className="rounded-md border border-white/[0.04] px-3 py-2.5 text-[11px] leading-relaxed"
                      style={{ backgroundColor: config.bg }}
                    >
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5" style={{ color: config.color }} />
                        <span
                          className="text-[10px] font-medium uppercase tracking-wider"
                          style={{ color: config.color }}
                        >
                          {action.label}
                        </span>
                        <span className="text-[10px] font-mono text-white/20">
                          #{action.id}
                        </span>
                      </div>

                      {/* Rich context display */}
                      {action.command && (
                        <div className="mb-1">
                          <TerminalCommand command={action.command} />
                        </div>
                      )}
                      {action.filePath && (
                        <div className="mb-1">
                          <FilePathBadge
                            path={action.filePath}
                            operation={
                              action.type === "file_create"
                                ? "create"
                                : action.type === "file_read"
                                  ? "read"
                                  : action.type === "file_write"
                                    ? "write"
                                    : "edit"
                            }
                          />
                        </div>
                      )}
                      {action.searchQuery && (
                        <div className="mb-1">
                          <SearchQueryBadge query={action.searchQuery} />
                        </div>
                      )}

                      <p className="whitespace-pre-wrap text-white/60">{action.text}</p>
                      {action.detail && (
                        <div className="mt-2 overflow-x-auto rounded bg-black/30 px-2 py-1.5 font-mono text-[10px] text-white/30">
                          {action.detail}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            );
          }

          if (entry.kind === "tool") {
            const tool = entry.item;
            return (
              <motion.div
                key={`tool-${idx}-${tool.id}`}
                data-entry-index={idx}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: Math.min(idx * 0.03, 0.3) }}
                className={`flex items-start gap-3 border-b border-white/[0.02] px-4 py-2 hover:bg-white/[0.01] ${
                  isFocused ? "bg-white/[0.03] ring-1 ring-inset ring-white/[0.06]" : ""
                }`}
              >
                <div className="relative z-10 mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                  <div
                    className="h-[8px] w-[8px] rounded-full"
                    style={{
                      backgroundColor: tool.status === "success" ? "#34d399" : tool.status === "error" ? "#f87171" : "#fbbf24",
                      boxShadow: `0 0 6px ${tool.status === "success" ? "#34d39940" : tool.status === "error" ? "#f8717140" : "#fbbf2440"}`,
                    }}
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[11px] font-medium text-white/50">{tool.tool}</span>
                  {tool.output && (
                    <span className="truncate text-[10px] text-white/20">{tool.output}</span>
                  )}
                </div>
                <span className="text-[10px] font-mono text-white/15">{tool.durationMs}ms</span>
              </motion.div>
            );
          }

          if (entry.kind === "live") {
            return (
              <motion.div
                key={`live-${idx}`}
                data-entry-index={idx}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="flex items-start gap-3 border-b border-white/[0.02] bg-amber-400/[0.02] px-4 py-2.5"
              >
                <div className="relative z-10 mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                  <div className="flex items-center gap-0.5">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse"
                      style={{ animationDelay: "0ms" }}
                    />
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse"
                      style={{ animationDelay: "150ms" }}
                    />
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse"
                      style={{ animationDelay: "300ms" }}
                    />
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[11px] font-medium text-white/60">{entry.step}</span>
                  <span className="text-[10px] text-white/30 font-mono">
                    {typedThinkingText}
                    {isTyping && (
                      <span className="inline-block h-3.5 w-1 bg-amber-400/60 animate-pulse ml-0.5" />
                    )}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-amber-400/40">LIVE</span>
              </motion.div>
            );
          }

          return null;
        })}
      </div>

      {/* Jump to bottom button */}
      {showJumpButton && (
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          type="button"
          onClick={jumpToBottom}
          className="sticky bottom-3 z-30 mx-auto flex items-center gap-1.5 rounded-full bg-[#0a0a0a]/90 border border-white/[0.08] px-3 py-1.5 text-[10px] font-mono text-white/60 shadow-lg backdrop-blur-sm hover:bg-white/[0.04] hover:text-white/80 transition-colors"
        >
          <ArrowDownToLine className="h-3 w-3" />
          Jump to live
        </motion.button>
      )}
    </div>
  );
}

/* ── Files View ────────────────────────────────────────── */

function FilesView({ files }: { files: AgentFileEntry[] }) {
  if (files.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-white/20">
        <FolderGit2 className="h-8 w-8 text-white/10" />
        <span className="text-[11px] font-mono">No files yet.</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-auto scrollbar p-2">
      <div className="rounded-md border border-white/[0.04] bg-black/30 p-2">
        <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-[#7ee787]/70 font-mono uppercase tracking-wider">
          <Folder className="h-3 w-3" />
          <span>Agent File System</span>
          <span className="ml-auto text-white/20">{files.length} file{files.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="mt-1 flex flex-col gap-0.5">
          {files.map((file, idx) => (
            <div
              key={`file-${idx}-${file.path}`}
              className="flex items-center gap-2 rounded px-2 py-1 text-[11px] font-mono text-[#7ee787]/80 hover:bg-white/[0.02] transition-colors"
            >
              {fileIconForName(file.path)}
              <span className="truncate">{file.path}</span>
              {file.lines != null && (
                <span className="ml-auto text-[10px] text-white/20">{file.lines}L</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Preview View ──────────────────────────────────────── */

function PreviewView({
  code,
  skill,
  sceneId,
  versionId,
}: {
  code: string | null;
  skill: string | null;
  sceneId: string | null;
  versionId: string | null;
}) {
  if (!code) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-white/20">
        <Monitor className="h-8 w-8 text-white/10" />
        <span className="text-[11px] font-mono">No preview available.</span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden bg-[#050505]">
      <SceneViewer
        key={`drawer-${versionId ?? "v"}-${sceneId ?? "s"}`}
        code={code}
        skill={skill || "threejs"}
        streaming={false}
      />
    </div>
  );
}

/* ── Media View ────────────────────────────────────────── */

function MediaView({
  mediaUrl,
  mediaType,
}: {
  mediaUrl: string | null;
  mediaType: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const isReady = Boolean(mediaUrl && mediaUrl !== "about:blank" && !loadFailed);

  if (!isReady) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-white/20">
        <Film className="h-8 w-8 text-white/10" />
        <span className="text-[11px] font-mono">No media available.</span>
      </div>
    );
  }

  return (
    <div className="relative flex h-full items-center justify-center bg-[#050505] p-4">
      <video
        ref={videoRef}
        className="max-h-full max-w-full rounded-lg"
        preload="metadata"
        playsInline
        muted
        loop
        controls
        autoPlay
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={() => setLoadFailed(true)}
      >
        <source src={mediaUrl!} type={mediaType ?? "video/mp4"} />
      </video>
      {!isPlaying && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md">
            <Play className="h-6 w-6 ml-1" />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main AgentTerminalDrawer ──────────────────────────── */

const TAB_CONFIG: { id: TerminalTab; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "terminal", label: "Terminal", icon: <Terminal className="h-4 w-4" />, desc: "Agent activity log" },
  { id: "files", label: "Files", icon: <FolderGit2 className="h-4 w-4" />, desc: "File system" },
  { id: "preview", label: "Preview", icon: <Monitor className="h-4 w-4" />, desc: "Scene preview" },
  { id: "media", label: "Media", icon: <Film className="h-4 w-4" />, desc: "Video output" },
];

export function AgentTerminalDrawer() {
  const workspaceOpen = useChatStore((state) => state.workspaceOpen);
  const closeWorkspace = useChatStore((state) => state.closeWorkspace);
  const sessions = useChatStore((state) => state.sessions);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const activeArtifactId = useChatStore((state) => state.activeArtifactId);

  // Agent state
  const agentFiles = useChatStore((state) => state.agentFiles);
  const agentToolLog = useChatStore((state) => state.agentToolLog);
  const isSending = useChatStore((state) => state.isSending);
  const thinkingText = useChatStore((state) => state.thinkingText);
  const thinkingStep = useChatStore((state) => state.thinkingStep);
  const taskProgressBySession = useChatStore((state) => state.taskProgressBySession);
  const messages = useChatStore((state) => state.messages);

  const [activeTab, setActiveTab] = useState<TerminalTab>("terminal");

  const session = sessions.find((s) => s.sessionId === activeSessionId);
  const artifact = session?.versions?.find((v) => v.versionId === activeArtifactId);
  const activeScene = artifact || session?.currentScene;

  // Get latest assistant message thoughts for the terminal
  const activeMessages = activeSessionId ? (messages[activeSessionId] ?? []) : [];
  const latestAssistantMsg = useMemo(() => {
    for (let i = activeMessages.length - 1; i >= 0; i--) {
      if (activeMessages[i]!.role === "assistant") {
        return activeMessages[i]!;
      }
    }
    return null;
  }, [activeMessages]);

  const thoughts: ThoughtItem[] = useMemo(() => {
    if (!latestAssistantMsg) return [];
    // Extract thoughts from message meta if available
    const meta = latestAssistantMsg.meta || [];
    const thoughtSteps = meta.filter((m: string) => m.startsWith("stepLabel:") || m.startsWith("step:"));
    if (thoughtSteps.length > 0) {
      return thoughtSteps.map((m: string, i: number) => ({
        text: latestAssistantMsg.content || m,
        step: m.replace("stepLabel:", "").replace("step:", ""),
        timestamp: Date.parse(latestAssistantMsg.createdAt) || Date.now(),
        meta,
      }));
    }
    return [];
  }, [latestAssistantMsg]);

  const activeTaskProgress = activeSessionId ? taskProgressBySession[activeSessionId] ?? null : null;
  const isTaskRunning = activeTaskProgress?.turnStatus === "running" || isSending;

  const runningCount = agentToolLog.filter((t) => t.status === "running").length;

  const handleTabChange = useCallback((tab: TerminalTab) => {
    setActiveTab(tab);
  }, []);

  if (!workspaceOpen) return null;

  return (
    <motion.div
      initial={false}
      animate={{ width: workspaceOpen ? 520 : 0, opacity: workspaceOpen ? 1 : 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.9 }}
      className="shrink-0 h-full overflow-hidden border-l border-white/[0.04]"
      style={{ background: "linear-gradient(180deg, #0a0a0a 0%, #0f0f12 100%)" }}
    >
      <div className="relative flex h-full w-[520px] flex-col overflow-hidden">
        <CRTScanlines />

        {/* Header */}
        <div className="relative z-20 flex items-center justify-between border-b border-white/[0.04] bg-[#0a0a0a]/80 px-4 py-3 md:px-5 md:py-4 backdrop-blur-sm">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#79c0ff]/10">
              <Layers className="h-4 w-4 text-[#79c0ff]" />
            </div>
            <div>
              <h3 className="text-[13px] font-semibold tracking-tight text-white/90 font-mono">
                Agent Terminal
              </h3>
              <p className="text-[10px] text-white/30 font-mono">
                {activeScene?.sceneId || "No active session"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isTaskRunning && (
              <span className="flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-400/70">
                <span className="flex h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                LIVE
              </span>
            )}
            <button
              type="button"
              onClick={closeWorkspace}
              className="group flex h-8 w-8 items-center justify-center rounded-full text-white/40 transition-all hover:bg-white/[0.06] hover:text-white"
            >
              <X className="h-4 w-4 transition-transform group-hover:rotate-90" />
            </button>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="relative z-20 flex items-center gap-1 border-b border-white/[0.04] bg-[#0a0a0a]/60 px-3 py-2 md:px-4 backdrop-blur-sm">
          {TAB_CONFIG.map((tab) => (
            <TabButton
              key={tab.id}
              active={activeTab === tab.id}
              tab={tab}
              onClick={() => handleTabChange(tab.id)}
              badge={tab.id === "terminal" ? runningCount : undefined}
            />
          ))}
        </div>

        {/* Content */}
        <div className="relative z-20 min-h-0 flex-1 overflow-hidden">
          {activeTab === "terminal" && (
            <TerminalView
              toolLog={agentToolLog}
              thoughts={thoughts}
              isRunning={isTaskRunning}
              thinkingText={thinkingText}
              thinkingStep={thinkingStep}
            />
          )}

          {activeTab === "files" && <FilesView files={agentFiles} />}

          {activeTab === "preview" && (
            <PreviewView
              code={activeScene?.code ?? null}
              skill={activeScene?.skill ?? null}
              sceneId={activeScene?.sceneId ?? null}
              versionId={activeScene?.versionId ?? null}
            />
          )}

          {activeTab === "media" && (
            <MediaView
              mediaUrl={artifact?.mediaUrl ?? activeScene?.mediaUrl ?? null}
              mediaType={artifact?.mediaType ?? activeScene?.mediaType ?? null}
            />
          )}
        </div>

        {/* Footer */}
        <div className="relative z-20 flex items-center gap-2 border-t border-white/[0.04] bg-[#0a0a0a]/80 px-4 py-1.5 backdrop-blur-sm">
          <div
            className={`flex h-1.5 w-1.5 rounded-full ${
              isTaskRunning ? "bg-amber-400 animate-pulse" : "bg-emerald-400/60"
            }`}
          />
          <span className="text-[9px] font-mono uppercase tracking-wider text-white/25">
            {activeTab} · {isTaskRunning ? "RUNNING" : "IDLE"} · {agentToolLog.length + thoughts.length} entries
          </span>
          <span className="ml-auto text-[9px] font-mono text-white/15">
            {agentFiles.length}F · {agentToolLog.filter((t) => t.status === "success").length} ok
          </span>
        </div>
      </div>
    </motion.div>
  );
}
