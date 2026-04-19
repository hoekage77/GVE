import { useMemo, useState, useEffect } from "react";
import { Sparkles, ChevronDown, Eye, Loader2, AlertTriangle, Code2, Film, Image as ImageIcon, ChevronLeft, ChevronRight } from "lucide-react";
import MarkdownRenderer from "./MarkdownRenderer";
import { ThoughtTraceToggle } from "./meta/ThoughtTraceToggle";
import { SourceResultsList, type SourceResult } from "./meta/SourceResultsList";

export type ChatMessageVariant = "legacy" | "meta";

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
  variant?: ChatMessageVariant;
}

function formatTime(timestamp?: number): string {
  if (!timestamp) {
    return "";
  }

  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function UserMessage({ content, timestamp, variant = "legacy" }: UserMessageProps) {
  const isMetaVariant = variant === "meta";

  return (
    <div className={`flex min-w-0 gap-2.5 lg:gap-3 animate-[slideInUp_0.3s_ease-out] ${isMetaVariant ? "mb-3 lg:mb-5" : "mb-3 lg:mb-4"}`}>
      <div className="mt-0.5 grid h-7 w-7 lg:h-8 lg:w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 text-xs lg:text-sm font-bold text-white shadow-[0_0_15px_rgba(56,189,248,0.3)]">
        A
      </div>
      <div className="flex-1 min-w-0">
        <div className="mb-1 lg:mb-1.5 flex items-center gap-2">
          <span className={isMetaVariant ? "text-[10px] lg:text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45" : "text-xs lg:text-sm font-semibold text-white"}>You</span>
          {timestamp && <span className={isMetaVariant ? "text-[10px] lg:text-[11px] font-medium text-white/35" : "text-[11px] lg:text-xs text-white/40"}>{formatTime(timestamp)}</span>}
        </div>
        <p className={isMetaVariant ? "break-words text-[0.88rem] lg:text-[0.95rem] leading-[1.6] lg:leading-[1.68] text-white/92" : "break-words text-[13px] lg:text-sm leading-relaxed text-white/95"}>{content}</p>
      </div>
    </div>
  );
}

// === AI Message ===

interface ThoughtItem {
  text: string;
  step: string;
  timestamp: number;
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
  variant?: ChatMessageVariant;
  artifactCards?: ChatArtifactCard[];
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

const STEP_LABELS: Record<string, string> = {
  turn_started: "Thinking",
  parse_intent: "Understanding request",
  intent_parsed: "Understanding request",
  select_skill: "Selecting skill",
  build_prompt: "Building prompt",
  generate_code: "Generating code",
  code_generated: "Code ready",
  code_modified: "Modifying scene",
  validate_code: "Validating code",
  validation_failed: "Recovering from error",
  execute_code: "Executing in sandbox",
  executing: "Running scene",
  execution_skipped: "Skipping execution",
  sync_state: "Syncing state",
  turn_complete: "Done",
  turn_error: "Error",
  post_narration: "Narrating",
  image_analyzing: "Analyzing image",
  image_generating: "Generating from image",
};

function toStepLabel(step: string): string {
  return STEP_LABELS[step] ?? step.replace(/_/g, " ");
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

function MetaAIMessage({
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
  onScenePreview
}: AIMessageProps) {
  const [thoughtsExpanded, setThoughtsExpanded] = useState(false);
  const showSceneFooter = Boolean((onScenePreview || onSceneCode) && !isThinking);
  const compactSceneId = compactSceneName(sceneId);
  const sourceResults = useMemo(() => extractSourceResults(content, meta), [content, meta]);
  const stepLabel = toStepLabel(thinkingStep);
  const contextSource = formatContextLabel(assistantSource);
  const contextSkill = formatContextLabel(skill);
  const hasContextRow = Boolean(contextSource || contextSkill || assistantWarning || errorCode);

  return (
    <div className={`mb-4 flex min-w-0 gap-3 ${isThinking ? 'opacity-95' : ''}`}>
      <div className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.04] text-white/85 ${isThinking ? 'animate-pulse' : ''}`}>
        <Sparkles className={`h-4 w-4 ${isThinking ? "thinking-sparkle" : ""}`} />
      </div>

      <div className="min-w-0 flex-1">
        {thoughts.length > 0 && !isThinking && (
          <ThoughtTraceToggle thoughts={thoughts} durationMs={thinkingDuration} />
        )}

        {sceneId && !isThinking && (
          <div className="mb-2 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-white/45">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Viewed</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${isPreviewActive ? 'border-cyan-300/55 bg-cyan-300/15 text-cyan-100' : 'border-white/15 bg-white/[0.05] text-white/75'}`}>
              {compactSceneId || "Scene"}
            </span>
          </div>
        )}

        {hasContextRow && !isThinking && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5" aria-label="Assistant context">
            {contextSkill && <span className="rounded-full border border-white/12 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/70">Skill: {contextSkill}</span>}
            {contextSource && <span className="rounded-full border border-white/12 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/70">Source: {contextSource}</span>}
            {assistantWarning && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/15 px-2 py-0.5 text-[10px] text-amber-200">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Fallback</span>
              </span>
            )}
            {errorCode && <span className="rounded-full border border-red-400/40 bg-red-400/15 px-2 py-0.5 text-[10px] text-red-200">{errorCode}</span>}
          </div>
        )}

        {isThinking && (
          <div className="mb-2 rounded-lg border border-white/12 bg-white/[0.04] p-2" role="status" aria-live="polite">
            <div className="flex items-center gap-2 text-sm text-white/85">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>{thinkingText?.trim() ? thinkingText : `${stepLabel}...`}</span>
            </div>
            <div className="mt-1 text-[11px] uppercase tracking-[0.08em] text-white/45">{stepLabel}</div>
          </div>
        )}

        <div className="markdown-message break-words text-[0.88rem] leading-[1.6] text-white/90 lg:text-[0.94rem] lg:leading-[1.72]">
          {content ? (
            <MarkdownRenderer content={content} />
          ) : isThinking ? null : (
            <span className="text-white/50">Thinking...</span>
          )}
        </div>

        {!isThinking && <SourceResultsList sources={sourceResults} />}

        {timestamp && !isThinking && (
          <div className="mt-2 text-[11px] text-white/40">{formatTime(timestamp)}</div>
        )}

        {showSceneFooter && (
          <div className="mt-2 flex items-center gap-2">
            {onSceneCode && (
              <button
                type="button"
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] transition ${isCodeActive ? 'border-fuchsia-300/45 bg-fuchsia-300/15 text-fuchsia-100' : 'border-white/12 bg-white/5 text-white/65 hover:bg-white/10'}`}
                onClick={onSceneCode}
                aria-label="Open code"
                title={compactSceneId ? `Open ${compactSceneId} code` : "Open scene code"}
              >
                <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
                Code
              </button>
            )}

            {onScenePreview && (
              <button
                type="button"
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] transition ${isPreviewActive ? 'border-cyan-300/45 bg-cyan-300/15 text-cyan-100' : 'border-white/12 bg-white/5 text-white/65 hover:bg-white/10'}`}
                onClick={onScenePreview}
                aria-label="Open preview"
                title={compactSceneId ? `Open ${compactSceneId} preview` : "Open scene preview"}
              >
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                Preview
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function AIMessage({
  content,
  thoughts = [],
  isThinking = false,
  thinkingText,
  thinkingDuration = 0,
  timestamp,
  variant = "legacy",
  artifactCards = []
}: AIMessageProps) {
  const isMetaVariant = variant === "meta";
  const [isThoughtsOpen, setIsThoughtsOpen] = useState(false);
  const [activeArtifactIndex, setActiveArtifactIndex] = useState(0);

  useEffect(() => {
    if (artifactCards.length === 0) {
      setActiveArtifactIndex(0);
      return;
    }

    setActiveArtifactIndex((previous) => Math.min(previous, artifactCards.length - 1));
  }, [artifactCards]);

  const activeArtifact = artifactCards[activeArtifactIndex] ?? null;

  const handlePreviousArtifact = () => {
    setActiveArtifactIndex((previous) => Math.max(0, previous - 1));
  };

  const handleNextArtifact = () => {
    setActiveArtifactIndex((previous) => Math.min(artifactCards.length - 1, previous + 1));
  };

  return (
    <div className={`flex min-w-0 gap-2.5 lg:gap-3 animate-fade-in ${isMetaVariant ? "mb-3 lg:mb-5" : "mb-3 lg:mb-4"}`}>
      <div className="mt-0.5 grid h-7 w-7 lg:h-8 lg:w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-white to-gray-100 text-black shadow-lg">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="lg:w-4 lg:h-4">
          <path d="M12 2l9 4.5-9 4.5-9-4.5 9-4.5z"/>
          <path d="M3 10.5l9 4.5 9-4.5M3 15.5l9 4.5 9-4.5"/>
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="mb-1 lg:mb-1.5 flex items-center gap-2">
          <span className={isMetaVariant ? "text-[10px] lg:text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45" : "text-xs lg:text-sm font-semibold text-white"}>Lumina</span>
          {timestamp && <span className={isMetaVariant ? "text-[10px] lg:text-[11px] font-medium text-white/35" : "text-[11px] lg:text-xs text-white/40"}>{formatTime(timestamp)}</span>}
        </div>
        
        <div className="space-y-2 lg:space-y-3 w-full min-w-0">
          {/* Thoughts section */}
          {thoughts.length > 0 && (
            <div className="pb-1.5 lg:pb-2 border-b border-white/10">
              <button
                onClick={() => setIsThoughtsOpen(!isThoughtsOpen)}
                className={isMetaVariant ? "flex items-center gap-1.5 lg:gap-2 text-[9px] lg:text-[10px] font-semibold uppercase tracking-[0.1em] text-white/58 transition-colors duration-200 hover:text-white/90" : "flex items-center gap-2 text-[11px] lg:text-xs text-white/60 transition-colors duration-200 hover:text-white/90"}
              >
                <ChevronDown className={`w-3 h-3 transition-transform duration-300 ${isThoughtsOpen ? 'rotate-180' : ''}`} />
                Thought for {Math.max(thinkingDuration / 1000, 0.1).toFixed(1)} seconds
              </button>
              {isThoughtsOpen && (
                <div className="mt-2 space-y-1.5 p-2 bg-white/[0.03] rounded-lg border border-white/5">
                  {thoughts.map((thought, i) => (
                    <div
                      key={i}
                      className={isMetaVariant ? "text-[11px] leading-relaxed text-white/52" : "text-xs text-white/50 leading-relaxed"}
                      style={{
                        animation: 'slide-down 0.3s ease-out',
                        animationDelay: `${i * 50}ms`
                      }}
                    >
                      <span className={isMetaVariant ? "font-mono text-[10px] uppercase tracking-[0.08em] text-white/30" : "font-mono text-white/30"}>{thought.step}:</span>
                      <p className="mt-0.5">{thought.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {content ? (
            <p className={isMetaVariant ? "break-words text-[0.88rem] lg:text-[0.94rem] leading-[1.6] lg:leading-[1.72] text-white/90" : "break-words text-[13px] lg:text-sm leading-relaxed text-white/90"}>{content}</p>
          ) : isThinking ? (
            <div className={`inline-flex items-center gap-2 ${isMetaVariant ? "text-[0.9rem] text-white/72" : "text-sm text-white/70"}`}>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{thinkingText?.trim() || "Thinking..."}</span>
            </div>
          ) : null}

          {activeArtifact && (() => {
            const thumbnailUrl = normalizePreviewUrl(activeArtifact.previewUrl);
            const showVideo = isVideoThumbnail(thumbnailUrl, activeArtifact.mediaType);
            const skillLabel = (activeArtifact.skill || "scene").toUpperCase();
            const artifactKindLabel = activeArtifact.outputKind === "media" ? "Generated media artifact" : "Generated scene artifact";
            const compactName = compactSceneName(activeArtifact.sceneId) || "Scene artifact";

            return (
            <div className="border-t border-white/[0.14] pt-2">
              {/* ── Mobile: Compact Pill ── */}
              <div className="lg:hidden">
                <div className="flex items-center gap-2 rounded-xl border border-white/12 bg-white/[0.04] p-2">
                  {/* Thumbnail mini */}
                  <div className="h-10 w-14 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-[#151c29] to-[#140d17]">
                    {thumbnailUrl ? (
                      showVideo ? (
                        <video src={thumbnailUrl} className="h-full w-full object-cover" muted loop autoPlay playsInline />
                      ) : (
                        <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                      )
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-white/40">
                        <ImageIcon className="h-3 w-3" />
                      </div>
                    )}
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-white/60">
                        {activeArtifact.outputKind === "media" ? <Film className="h-2.5 w-2.5" /> : <Sparkles className="h-2.5 w-2.5" />}
                        {skillLabel}
                      </span>
                      <span className="text-[9px] text-white/35">•</span>
                      <span className="truncate text-[10px] font-medium text-white/75">{compactName}</span>
                    </div>
                    <p className="text-[9px] text-white/45 mt-0.5">{artifactKindLabel}</p>
                  </div>
                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      className={`inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[9px] font-semibold uppercase tracking-[0.06em] transition ${activeArtifact.isPreviewActive ? "border-cyan-300/45 bg-cyan-300/15 text-cyan-100" : "border-white/12 bg-white/5 text-white/65 active:bg-white/10"} disabled:opacity-40`}
                      onClick={activeArtifact.onPreview}
                      disabled={!activeArtifact.onPreview}
                    >
                      <Eye className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className={`inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[9px] font-semibold uppercase tracking-[0.06em] transition ${activeArtifact.isCodeActive ? "border-fuchsia-300/45 bg-fuchsia-300/15 text-fuchsia-100" : "border-white/12 bg-white/5 text-white/65 active:bg-white/10"} disabled:opacity-40`}
                      onClick={activeArtifact.onCode}
                      disabled={!activeArtifact.onCode}
                    >
                      <Code2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Desktop: Full Cinematic Card ── */}
              <div
                className="hidden lg:block"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    handlePreviousArtifact();
                  }
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    handleNextArtifact();
                  }
                }}
              >
                <div className="group overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-b from-[#121723]/95 via-[#0d1118]/92 to-[#090c12]/95 shadow-[0_22px_45px_-28px_rgba(0,0,0,0.85)] focus:outline-none focus:ring-2 focus:ring-cyan-300/40">
                  <article key={activeArtifact.versionId} className="relative">
                    <div className="relative h-44 overflow-hidden bg-gradient-to-br from-[#151c29] via-[#0b1118] to-[#140d17]">
                      {thumbnailUrl ? (
                        showVideo ? (
                          <video src={thumbnailUrl} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" muted loop autoPlay playsInline />
                        ) : (
                          <img src={thumbnailUrl} alt={`Preview for ${activeArtifact.sceneId}`} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" loading="lazy" />
                        )
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 bg-[radial-gradient(circle_at_50%_30%,rgba(56,189,248,0.12),rgba(0,0,0,0))] text-white/60">
                          <span className="grid h-9 w-9 place-items-center rounded-full border border-white/18 bg-white/[0.06]">
                            <ImageIcon className="h-4 w-4" />
                          </span>
                          <span className="text-[11px] font-medium tracking-[0.04em] text-white/68">Preview appears after render</span>
                        </div>
                      )}
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/10" />
                      <div className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full border border-white/25 bg-black/55 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/88 backdrop-blur-sm">
                        {activeArtifact.outputKind === "media" ? <Film className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                        <span>{skillLabel}</span>
                      </div>
                      <span className="absolute right-2.5 top-2.5 rounded-full border border-white/25 bg-black/55 px-2.5 py-1 text-[10px] font-medium text-white/82 backdrop-blur-sm">
                        {activeArtifact.versionLabel}
                      </span>
                      <div className="absolute inset-x-2.5 bottom-2.5 flex items-end justify-between gap-2">
                        <div className="min-w-0">
                          <p className={isMetaVariant ? "truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-white" : "truncate text-xs font-semibold text-white"}>{compactName}</p>
                          <p className={isMetaVariant ? "text-[10px] font-medium text-white/62" : "text-[11px] text-white/60"}>{artifactKindLabel}</p>
                        </div>
                        {showVideo && (
                          <span className="inline-flex items-center rounded-full border border-cyan-300/40 bg-cyan-300/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-cyan-100">Loop</span>
                        )}
                      </div>
                    </div>
                    <div className="border-t border-white/10 bg-black/25 p-2.5">
                      <div className="flex items-center gap-2">
                        <button type="button" className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition ${activeArtifact.isPreviewActive ? "border-cyan-300/45 bg-cyan-300/15 text-cyan-100" : "border-white/15 bg-white/5 text-white/72 hover:bg-white/10 hover:text-white"} disabled:cursor-not-allowed disabled:opacity-45`} onClick={activeArtifact.onPreview} disabled={!activeArtifact.onPreview}>
                          <Eye className="h-3.5 w-3.5" />Preview
                        </button>
                        <button type="button" className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition ${activeArtifact.isCodeActive ? "border-fuchsia-300/45 bg-fuchsia-300/15 text-fuchsia-100" : "border-white/15 bg-white/5 text-white/72 hover:bg-white/10 hover:text-white"} disabled:cursor-not-allowed disabled:opacity-45`} onClick={activeArtifact.onCode} disabled={!activeArtifact.onCode}>
                          <Code2 className="h-3.5 w-3.5" />Code
                        </button>
                      </div>
                    </div>
                  </article>
                </div>
              </div>

              {/* Carousel thumbnails (multi-artifact, desktop only) */}
              {artifactCards.length > 1 && (
                <div className="mt-2.5 hidden lg:flex items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/[0.04] text-white/72 transition hover:border-white/30 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                    onClick={handlePreviousArtifact}
                    disabled={activeArtifactIndex === 0}
                    aria-label="Previous artifact"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>

                  <div className="flex-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                    <div className="flex min-w-max gap-2.5 pr-0.5">
                      {artifactCards.map((artifact, artifactIndex) => {
                        const thumbnailUrl = normalizePreviewUrl(artifact.previewUrl);
                        const showVideo = isVideoThumbnail(thumbnailUrl, artifact.mediaType);
                        const isActive = artifactIndex === activeArtifactIndex;

                        return (
                          <button
                            key={artifact.versionId}
                            type="button"
                            onClick={() => setActiveArtifactIndex(artifactIndex)}
                            className={`group relative h-16 w-28 shrink-0 overflow-hidden rounded-lg border transition-all duration-200 ${isActive ? "border-cyan-300/55 ring-2 ring-cyan-300/35" : "border-white/15 hover:border-white/35"}`}
                            aria-label={`Select ${artifact.versionLabel}`}
                          >
                            {thumbnailUrl ? (
                              showVideo ? (
                                <video src={thumbnailUrl} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" muted loop autoPlay playsInline />
                              ) : (
                                <img src={thumbnailUrl} alt={`Thumbnail ${artifact.versionLabel}`} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
                              )
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-[#111827] text-white/40">
                                <ImageIcon className="h-4 w-4" />
                              </div>
                            )}

                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />

                            <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-medium text-white/85 backdrop-blur-sm">
                              {artifact.versionLabel}
                            </span>

                            {isActive && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-cyan-200 shadow-[0_0_0_3px_rgba(34,211,238,0.25)]" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/[0.04] text-white/72 transition hover:border-white/30 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                    onClick={handleNextArtifact}
                    disabled={activeArtifactIndex >= artifactCards.length - 1}
                    aria-label="Next artifact"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
            );
          })()}

        </div>
      </div>
    </div>
  );
}
