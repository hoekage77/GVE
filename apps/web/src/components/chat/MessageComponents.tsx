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
    <div className={`flex flex-row-reverse min-w-0 gap-2.5 lg:gap-3 animate-[slideInUp_0.3s_ease-out] ${isMetaVariant ? "mb-3 lg:mb-5" : "mb-3 lg:mb-4"}`}>
      <div className="flex-1 min-w-0 text-right">
        <div className="mb-1 lg:mb-1.5 flex items-center justify-end gap-2">
          {timestamp && <span className={isMetaVariant ? "text-[9px] font-normal text-meta-muted/60 lg:text-[11px]" : "text-[10px] font-normal text-meta-muted lg:text-xs"}>{formatTime(timestamp)}</span>}
          <span className={isMetaVariant ? "text-[9px] font-semibold uppercase tracking-wider text-meta-muted/80 lg:text-[11px]" : "text-[10px] font-medium text-meta-muted lg:text-sm"}>You</span>
        </div>
        <div className="inline-block max-w-full">
          <p className={isMetaVariant ? "break-words text-[0.88rem] lg:text-[0.95rem] leading-[1.6] lg:leading-[1.68] text-white/92" : "break-words text-[13px] lg:text-sm leading-relaxed text-white/95"}>{content}</p>
        </div>
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

export function MetaAIMessage({
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
  const showSceneFooter = Boolean((onScenePreview || onSceneCode) && !isThinking);
  const compactSceneId = compactSceneName(sceneId);
  const sourceResults = useMemo(() => extractSourceResults(content, meta), [content, meta]);
  const stepLabel = toStepLabel(thinkingStep);
  const contextSource = formatContextLabel(assistantSource);
  const contextSkill = formatContextLabel(skill);
  const hasContextRow = Boolean(contextSource || contextSkill || assistantWarning || errorCode);

  return (
    <div className={`mb-4 flex min-w-0 gap-3 ${isThinking ? 'opacity-95' : ''}`}>
      <div className="min-w-0 flex-1">
        {thoughts.length > 0 && !isThinking && (
          <ThoughtTraceToggle thoughts={thoughts} durationMs={thinkingDuration} />
        )}

        {sceneId && !isThinking && (
          <div className="mb-2 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-white/45">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Viewed</span>
            <span className={`rounded border px-2 py-0.5 text-[10px] font-medium ${isPreviewActive ? "border-ide-accent/50 bg-ide-accent/10 text-meta-text" : "border-meta-border bg-surface-3 text-meta-muted"}`}>
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
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium uppercase tracking-wide transition-colors ${isCodeActive ? "border-ide-accent/50 bg-ide-accent/10 text-meta-text" : "border-meta-border bg-surface-3 text-meta-muted hover:bg-surface"}`}
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
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium uppercase tracking-wide transition-colors ${isPreviewActive ? "border-ide-accent/50 bg-ide-accent/10 text-meta-text" : "border-meta-border bg-surface-3 text-meta-muted hover:bg-surface"}`}
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
      <div className="flex-1 min-w-0">
        <div className="mb-1 lg:mb-1.5 flex items-center gap-2">
          <span className={isMetaVariant ? "text-[9px] font-semibold uppercase tracking-wider text-meta-muted/80 lg:text-[11px]" : "text-[10px] font-medium text-meta-muted lg:text-sm"}>Assistant</span>
          {timestamp && <span className={isMetaVariant ? "text-[9px] lg:text-[11px] font-medium text-white/30" : "text-[10px] lg:text-xs text-white/40"}>{formatTime(timestamp)}</span>}
        </div>
        
        <div className="space-y-2 lg:space-y-3 w-full min-w-0">
          {/* Thoughts section */}
          {thoughts.length > 0 && (
            <div className="pb-1.5 lg:pb-2">
              <button
                onClick={() => setIsThoughtsOpen(!isThoughtsOpen)}
                className={isMetaVariant ? "flex items-center gap-1.5 lg:gap-2 text-[9px] lg:text-[10px] font-semibold uppercase tracking-[0.1em] text-white/58 transition-colors duration-200 hover:text-white/90" : "flex items-center gap-2 text-[11px] lg:text-xs text-white/60 transition-colors duration-200 hover:text-white/90"}
              >
                <ChevronDown className={`w-3 h-3 transition-transform duration-300 ${isThoughtsOpen ? 'rotate-180' : ''}`} />
                <span className="hidden sm:inline">Thought for {Math.max(thinkingDuration / 1000, 0.1).toFixed(1)}s</span>
                <span className="sm:hidden">Thought ({Math.max(thinkingDuration / 1000, 0.1).toFixed(1)}s)</span>
              </button>
              {isThoughtsOpen && (
                <div className="mt-2 space-y-1.5 p-2 bg-white/[0.03] rounded-lg">
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
            const compactName = compactSceneName(activeArtifact.sceneId) || "Scene artifact";

            return (
              <div className="pt-2">
                <div className="inline-flex items-center gap-2 rounded-full bg-white/[0.04] p-1 pr-3 shadow-sm transition-all hover:bg-white/[0.08]">
                  {/* Tiny Thumbnail */}
                  <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full bg-black/40">
                    {thumbnailUrl ? (
                      showVideo ? (
                        <video src={thumbnailUrl} className="h-full w-full object-cover" muted loop autoPlay playsInline />
                      ) : (
                        <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                      )
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-white/30">
                        <ImageIcon className="h-3 w-3" />
                      </div>
                    )}
                  </div>

                  {/* Name & Label */}
                  <div className="flex min-w-0 flex-col leading-tight">
                    <span className="max-w-[120px] truncate text-[12px] font-medium text-white/90 sm:max-w-[200px]">{compactName}</span>
                    <span className="text-[9px] uppercase tracking-wider text-white/40">{skillLabel}</span>
                  </div>

                  {/* Action Divider */}
                  <div className="mx-1 h-4 w-px bg-white/10" />

                  {/* Actions */}
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${activeArtifact.isPreviewActive ? "bg-meta-accent/20 text-meta-accent" : "text-white/60 hover:bg-white/10 hover:text-white"}`}
                      onClick={activeArtifact.onPreview}
                      disabled={!activeArtifact.onPreview}
                      title="Open Preview"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${activeArtifact.isCodeActive ? "bg-meta-accent/20 text-meta-accent" : "text-white/60 hover:bg-white/10 hover:text-white"}`}
                      onClick={activeArtifact.onCode}
                      disabled={!activeArtifact.onCode}
                      title="View Code"
                    >
                      <Code2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Navigation Arrows for multi-artifact */}
                {artifactCards.length > 1 && (
                  <div className="mt-1.5 flex items-center gap-1.5 pl-1">
                    <button
                      type="button"
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-white/5 text-white/40 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
                      onClick={handlePreviousArtifact}
                      disabled={activeArtifactIndex === 0}
                    >
                      <ChevronLeft className="h-3 w-3" />
                    </button>
                    <span className="text-[10px] tabular-nums text-white/30">
                      {activeArtifactIndex + 1} / {artifactCards.length}
                    </span>
                    <button
                      type="button"
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-white/5 text-white/40 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
                      onClick={handleNextArtifact}
                      disabled={activeArtifactIndex >= artifactCards.length - 1}
                    >
                      <ChevronRight className="h-3 w-3" />
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
