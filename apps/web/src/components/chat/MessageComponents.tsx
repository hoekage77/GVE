import { useMemo, useState, useEffect } from "react";
import { Sparkles, ChevronDown, Eye, Loader2, AlertTriangle, Code2, Film, Image as ImageIcon, ChevronLeft, ChevronRight } from "lucide-react";
import MarkdownRenderer from "./MarkdownRenderer";
import { ThoughtStream } from "./ThoughtStream";
import { SourceResultsList, type SourceResult } from "./meta/SourceResultsList";
import { InlineScenePreview } from "./InlineScenePreview";

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
    <div className={`flex flex-row-reverse min-w-0 gap-2.5 lg:gap-3 animate-message-enter ${isMetaVariant ? "mb-6" : "mb-4"}`}>
      <div className="flex-1 min-w-0 flex flex-col items-end">
        <div className="message-bubble-user max-w-[85%] inline-block">
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
  variant?: ChatMessageVariant;
  artifactCards?: ChatArtifactCard[];
  sceneCode?: string | null;
  sceneSkill?: string | null;
  sceneVersionId?: string | null;
  onSceneExpand?: () => void;
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
  const contextSource = formatContextLabel(assistantSource);
  const contextSkill = formatContextLabel(skill);
  const hasContextRow = Boolean(contextSource || contextSkill || assistantWarning || errorCode);

  return (
    <div className={`mb-4 flex min-w-0 gap-3 ${isThinking ? 'opacity-95' : ''}`}>
      <div className="min-w-0 flex-1">
        {thoughts.length > 0 && (
          <ThoughtStream thoughts={thoughts} isThinking={isThinking} thinkingDuration={thinkingDuration} />
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



        <div className={`markdown-message ${isThinking ? "text-white/50" : "text-white/90"}`}>
          {content ? (
            <MarkdownRenderer content={content} />
          ) : isThinking ? null : (
            <span>Thinking...</span>
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
  artifactCards = [],
  sceneCode,
  sceneSkill,
  sceneId,
  sceneVersionId,
  onSceneExpand,
  onSceneCode
}: AIMessageProps) {
  const isMetaVariant = variant === "meta";
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
    <div className={`flex min-w-0 gap-2.5 lg:gap-3 animate-message-enter ${isMetaVariant ? "mb-6" : "mb-4"}`}>
      <div className="flex-1 min-w-0">
        
        <div className="space-y-2 lg:space-y-3 w-full min-w-0">
          {/* Thoughts section */}
          {(thoughts.length > 0 || isThinking) && (
            <ThoughtStream thoughts={thoughts} isThinking={isThinking} thinkingDuration={thinkingDuration} />
          )}

          {content ? (
            <div className="markdown-message">
              <MarkdownRenderer content={content} />
            </div>
          ) : isThinking ? null : (
            <div className="markdown-message">
              <p>Thinking...</p>
            </div>
          )}

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

          {/* Inline Scene Preview */}
          {sceneCode && !isThinking && (
            <InlineScenePreview
              code={sceneCode}
              skill={sceneSkill || "threejs"}
              sceneId={sceneId || "scene"}
              versionId={sceneVersionId || ""}
              onExpand={onSceneExpand}
              onCode={onSceneCode}
            />
          )}

        </div>
      </div>
    </div>
  );
}
