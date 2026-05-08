import { useMemo, useState, useRef, useEffect, memo } from "react";
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import MarkdownRenderer from "./MarkdownRenderer";
import { AgentActionStream } from "./AgentActionStream";
import { SourceResultsList, type SourceResult } from "./meta/SourceResultsList";
import { InlineScenePreview } from "./InlineScenePreview";
import { InlineMediaPreview } from "./InlineMediaPreview";
import { useChatStore } from "../../stores";
import type { MediaLifecycleStage, AgentFileEntry, AgentToolLogEntry } from "../../stores/chat/types";

export interface ChatArtifactCard {
  versionId: string;
  sceneId: string;
  versionLabel: string;
  skill: string | null;
  outputKind?: "code" | "media";
  mediaType?: string | null;
  previewUrl: string | null;
  isPreviewActive?: boolean;
  isCodeActive?: boolean;
  onPreview?: () => void;
  onCode?: () => void;
}

// === User Message ===

interface UserMessageProps {
  content: string;
  timestamp?: number;
}

function formatTime(timestamp?: number): string {
  if (!timestamp) {
    return "";
  }

  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function UserMessage({ content, timestamp }: UserMessageProps) {
  return (
    <div className="flex flex-row-reverse min-w-0 gap-2.5 lg:gap-3 animate-message-enter mb-5">
      <div className="flex-1 min-w-0 flex flex-col items-end">
        <div className="message-bubble-user max-w-[92%] inline-block">
          <p className="break-words text-[14px] lg:text-[15px] leading-[1.6] text-white/90">{content}</p>
        </div>
      </div>
    </div>
  );
}

// === AI Message ===

export interface ThoughtItem {
  text: string;
  step: string;
  timestamp: number;
  meta?: string[];
}

interface AIMessageProps {
  taskProgress?: any | null;
  content: string;
  thoughts?: ThoughtItem[];
  isThinking?: boolean;
  thinkingText?: string | null;
  thinkingStep?: string;
  thinkingDuration?: number;
  timestamp?: number;
  sceneId?: string;
  skill?: string;
  assistantSource?: string;
  assistantWarning?: boolean;
  errorCode?: string;
  meta?: string[];
  isPreviewActive?: boolean;
  isCodeActive?: boolean;
  onSceneCode?: () => void;
  onScenePreview?: () => void;
  artifactCards?: ChatArtifactCard[];
  sceneCode?: string | null;
  sceneSkill?: string | null;
  sceneVersionId?: string | null;
  onSceneExpand?: () => void;
  mediaUrl?: string | null;
  mediaType?: string | null;
  outputKind?: "code" | "media" | null;
  mediaStatusStage?: MediaLifecycleStage;
  mediaStatusText?: string | null;
  messageKind?: string | null;
  agentFiles?: AgentFileEntry[];
  agentToolLog?: AgentToolLogEntry[];
  isLatest?: boolean;
}

function compactSceneName(sceneId: string | undefined): string {
  const normalized = String(sceneId ?? "").trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= 16) {
    return normalized;
  }

  if (normalized.startsWith("scene-")) {
    return `scene-${normalized.slice(-6)}`;
  }

  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
}



function extractSourceResults(content: string, meta: string[] | undefined): SourceResult[] {
  const normalized = String(content ?? "").trim();

  const results: SourceResult[] = [];
  const seen = new Set<string>();

  const pushUnique = (label: string, url: string) => {
    const normalizedUrl = String(url ?? "").trim();
    if (!normalizedUrl || seen.has(normalizedUrl)) {
      return;
    }

    seen.add(normalizedUrl);
    results.push({ label: label.trim() || normalizedUrl, url: normalizedUrl });
  };

  if (normalized) {
    const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    let markdownMatch = markdownLinkPattern.exec(normalized);
    while (markdownMatch) {
      const label = markdownMatch[1]?.trim() || markdownMatch[2];
      const url = markdownMatch[2]?.trim();
      if (url) {
        pushUnique(label, url);
      }
      markdownMatch = markdownLinkPattern.exec(normalized);
    }

    const urlPattern = /(https?:\/\/[^\s)]+)/g;
    let urlMatch = urlPattern.exec(normalized);
    while (urlMatch) {
      const url = urlMatch[1]?.trim();
      if (url) {
        let label = url;
        try {
          const parsed = new URL(url);
          label = parsed.hostname.replace(/^www\./, "");
        } catch {
          // Keep the raw URL when parsing fails.
        }
        pushUnique(label, url);
      }
      urlMatch = urlPattern.exec(normalized);
    }
  }

  if (Array.isArray(meta)) {
    for (const entry of meta) {
      const normalizedEntry = String(entry ?? "").trim();
      if (!normalizedEntry) {
        continue;
      }

      if (normalizedEntry.startsWith("sourceUrl:")) {
        pushUnique("Source", normalizedEntry.slice("sourceUrl:".length));
        continue;
      }

      if (normalizedEntry.startsWith("citationUrl:")) {
        pushUnique("Citation", normalizedEntry.slice("citationUrl:".length));
        continue;
      }

      if (normalizedEntry.startsWith("referenceUrl:")) {
        pushUnique("Reference", normalizedEntry.slice("referenceUrl:".length));
        continue;
      }

      const directUrlMatch = normalizedEntry.match(/https?:\/\/\S+/);
      if (!directUrlMatch) {
        continue;
      }

      const url = directUrlMatch[0];
      const label = normalizedEntry.split(":", 1)[0] || "Source";
      pushUnique(label, url);
    }
  }

  return results.slice(0, 4);
}

function formatContextLabel(value: string | undefined): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }

  return normalized.replace(/[_-]+/g, " ");
}

function normalizePreviewUrl(url: string | null | undefined): string | null {
  const normalized = String(url ?? "").trim();
  if (!normalized || normalized === "about:blank") {
    return null;
  }

  return normalized;
}

function isVideoThumbnail(url: string | null, mediaType: string | null | undefined): boolean {
  if (String(mediaType ?? "").toLowerCase().startsWith("video/")) {
    return true;
  }

  const normalized = String(url ?? "").toLowerCase();
  return /\.(mp4|webm|ogg|mov)(\?|$)/.test(normalized);
}

function isVideoArtifact(
  outputKind: "code" | "media" | null | undefined,
  mediaType: string | null | undefined,
  skill: string | null | undefined
): boolean {
  if (outputKind === "media") return true;
  if (String(mediaType ?? "").toLowerCase().startsWith("video/")) return true;
  if (String(skill ?? "").toLowerCase() === "manim") return true;
  return false;
}

/* ── Hooks ─────────────────────────────────────────────── */

/** Keeps thinking UI visible briefly after completion for a smooth transition */
function useGracePeriod(isThinking: boolean | undefined, graceMs: number = 400) {
  const [graceActive, setGraceActive] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isThinking) {
      setGraceActive(true);
      if (timerRef.current) clearTimeout(timerRef.current);
    } else if (graceActive) {
      timerRef.current = setTimeout(() => setGraceActive(false), graceMs);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isThinking, graceActive, graceMs]);

  return graceActive;
}

/** Blinking cursor for streaming text */
function StreamingCursor() {
  return (
    <span className="inline-block h-[1em] w-[2px] translate-y-[1px] animate-pulse bg-white/50 align-middle" />
  );
}

/* ── Compact thought pill for non-latest messages ── */

function CompactThoughtPill({ thoughts, thinkingDuration }: { thoughts: ThoughtItem[]; thinkingDuration?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (thoughts.length === 0) return null;

  const labels = thoughts
    .map((t) => {
      const fromMeta = t.meta?.find((m) => m.startsWith("stepLabel:"));
      return fromMeta ? fromMeta.substring("stepLabel:".length) : t.step.replace(/_/g, " ");
    })
    .filter(Boolean);

  const uniqueLabels = Array.from(new Set(labels));
  const preview = uniqueLabels.slice(0, 3).join(" · ");
  const moreCount = uniqueLabels.length - 3;

  return (
    <div className="mb-2">
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[11px] text-white/50 transition hover:bg-white/[0.06] hover:text-white/70"
        >
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-white/30" />
          <span className="font-medium text-white/60">{thoughts.length} action{thoughts.length !== 1 ? "s" : ""}</span>
          {preview && <span className="text-white/40">· {preview}{moreCount > 0 ? ` · +${moreCount}` : ""}</span>}
        </button>
      ) : (
        <div className="relative">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-[10px] text-white/40 transition hover:bg-white/[0.06] hover:text-white/60"
          >
            <span>Hide actions</span>
          </button>
          <AgentActionStream thoughts={thoughts} thinkingDuration={thinkingDuration} />
        </div>
      )}
    </div>
  );
}

const MetaAIMessageInner = memo(function MetaAIMessageInner({
  content,
  thoughts = [],
  isThinking,
  thinkingText,
  thinkingStep = "turn_started",
  thinkingDuration,
  timestamp,
  sceneId,
  skill,
  assistantSource,
  assistantWarning,
  errorCode,
  meta,
  isPreviewActive = false,
  isCodeActive = false,
  onSceneCode,
  onScenePreview,
  mediaUrl,
  mediaType,
  outputKind,
  mediaStatusStage,
  mediaStatusText,
  onSceneExpand,
  sceneCode,
  sceneSkill,
  sceneVersionId,
  messageKind,
  agentFiles,
  agentToolLog,
  isLatest = false,
}: AIMessageProps) {
  const sourceResults = useMemo(() => extractSourceResults(content, meta), [content, meta]);

  // Grace period: keep thinking UI visible briefly after completion
  const graceActive = useGracePeriod(isThinking, 400);
  const showThinkingUI = isThinking || graceActive;

  return (
    <div className="mb-4 flex min-w-0 gap-3 animate-message-enter">
      <div className="min-w-0 flex-1">
        {thoughts.length > 0 && (isLatest || showThinkingUI ? (
          <motion.div
            initial={false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <AgentActionStream thoughts={thoughts} isThinking={showThinkingUI} thinkingDuration={thinkingDuration} />
          </motion.div>
        ) : (
          <CompactThoughtPill thoughts={thoughts} thinkingDuration={thinkingDuration} />
        ))}

        {errorCode && !showThinkingUI && (
          <div className="mb-2 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-lg border border-red-400/30 bg-red-400/8 px-2.5 py-1 text-[11px] text-red-300/80">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              <span>{errorCode}</span>
            </span>
          </div>
        )}



        <div className={`markdown-message ${showThinkingUI ? "text-white/50" : "text-white/90"}`}>
          {content ? (
            <>
              <MarkdownRenderer content={content} />
              {showThinkingUI && <StreamingCursor />}
            </>
          ) : showThinkingUI ? null : (
            <span>Thinking...</span>
          )}
        </div>

        {/* Inline artifact preview — media takes priority over code scene */}
        {isVideoArtifact(outputKind, mediaType, skill) && (
          <InlineMediaPreview
            src={mediaUrl ?? null}
            mediaType={mediaType}
            sceneId={sceneId || "video"}
            skill={skill || "video"}
            statusStage={mediaStatusStage}
            statusText={mediaStatusText}
            onExpand={onSceneExpand}
          />
        )}
        {sceneCode && !isVideoArtifact(outputKind, mediaType, skill) && (
          <InlineScenePreview
            code={sceneCode}
            skill={sceneSkill || "threejs"}
            sceneId={sceneId || "scene"}
            versionId={sceneVersionId || ""}
            onExpand={onSceneExpand}
            streaming={showThinkingUI}
          />
        )}

        {!showThinkingUI && <SourceResultsList sources={sourceResults} />}

        {timestamp && !showThinkingUI && (
          <div className="mt-2 text-[11px] text-white/40">{formatTime(timestamp)}</div>
        )}


      </div>
    </div>
  );
}, (prev, next) => {
  // Custom comparison: only re-render if stable props changed or streaming state is active
  const isPrevSettled = !prev.isThinking && prev.content.length > 0;
  const isNextSettled = !next.isThinking && next.content.length > 0;

  if (isPrevSettled && isNextSettled) {
    // Both settled: skip re-render if content/media/scene code haven't changed
    return (
      prev.content === next.content &&
      prev.sceneCode === next.sceneCode &&
      prev.sceneSkill === next.sceneSkill &&
      prev.sceneVersionId === next.sceneVersionId &&
      prev.mediaUrl === next.mediaUrl &&
      prev.mediaType === next.mediaType &&
      prev.mediaStatusStage === next.mediaStatusStage &&
      prev.outputKind === next.outputKind &&
      prev.messageKind === next.messageKind &&
      prev.assistantWarning === next.assistantWarning &&
      prev.errorCode === next.errorCode &&
      prev.isLatest === next.isLatest &&
      prev.isPreviewActive === next.isPreviewActive &&
      prev.isCodeActive === next.isCodeActive
      // Note: thoughts, agentFiles, agentToolLog are allowed to change for the last
      // message during streaming, but once settled we assume they are stable.
    );
  }

  // During streaming or if either is unsettled, use default shallow comparison
  return false;
});

export function MetaAIMessage(props: AIMessageProps) {
  return <MetaAIMessageInner {...props} />;
}

export function AIMessage(props: AIMessageProps) {
  return <MetaAIMessage {...props} />;
}
