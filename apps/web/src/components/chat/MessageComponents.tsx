import { useMemo, useState } from "react";
import { Sparkles, ChevronDown, Eye, Loader2, AlertTriangle, Code2 } from "lucide-react";
import MarkdownRenderer from "./MarkdownRenderer";
import { ThoughtTraceToggle } from "./meta/ThoughtTraceToggle";
import { SourceResultsList, type SourceResult } from "./meta/SourceResultsList";

export type ChatMessageVariant = "legacy" | "meta";

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
  if (variant === "meta") {
    return (
      <div className="meta-message meta-message--user">
        <div className="meta-message__content meta-message__content--user">
          <div className="meta-message__user-bubble">
            <div className="meta-message__text">{content}</div>
          </div>
          {timestamp && <div className="meta-message__meta">{formatTime(timestamp)}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="message-row message-row--user">
      <div className="message-content">
        <div className="message-bubble message-bubble--user">
          <div className="message-text">{content}</div>
        </div>
        {timestamp && (
          <div className="message-meta">
            {formatTime(timestamp)}
          </div>
        )}
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
  const showSceneFooter = Boolean((onScenePreview || onSceneCode) && !isThinking);
  const compactSceneId = compactSceneName(sceneId);
  const sourceResults = useMemo(() => extractSourceResults(content, meta), [content, meta]);
  const stepLabel = toStepLabel(thinkingStep);
  const contextSource = formatContextLabel(assistantSource);
  const contextSkill = formatContextLabel(skill);
  const hasContextRow = Boolean(contextSource || contextSkill || assistantWarning || errorCode);

  return (
    <div className={`meta-message meta-message--assistant ${isThinking ? "is-thinking" : ""}`}>
      <div className={`meta-message__avatar ${isThinking ? "is-thinking" : ""}`}>
        <Sparkles className={`h-4 w-4 ${isThinking ? "thinking-sparkle" : ""}`} />
      </div>

      <div className="meta-message__content">
        {thoughts.length > 0 && !isThinking && (
          <ThoughtTraceToggle thoughts={thoughts} durationMs={thinkingDuration} />
        )}

        {sceneId && !isThinking && (
          <div className="meta-message__viewed-row">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Viewed</span>
            <span className={`meta-message__scene-pill ${isPreviewActive ? "is-active" : ""}`}>
              {compactSceneId || "Scene"}
            </span>
          </div>
        )}

        {hasContextRow && !isThinking && (
          <div className="meta-message__context-row" aria-label="Assistant context">
            {contextSkill && <span className="meta-message__context-pill">Skill: {contextSkill}</span>}
            {contextSource && <span className="meta-message__context-pill">Source: {contextSource}</span>}
            {assistantWarning && (
              <span className="meta-message__context-pill is-warning">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Fallback</span>
              </span>
            )}
            {errorCode && <span className="meta-message__context-pill is-error">{errorCode}</span>}
          </div>
        )}

        {isThinking && (
          <div className="meta-message__status-stack" role="status" aria-live="polite">
            <div className="meta-message__status-main">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>{thinkingText?.trim() ? thinkingText : `${stepLabel}...`}</span>
            </div>
            <div className="meta-message__status-sub">{stepLabel}</div>
          </div>
        )}

        <div className="meta-message__body">
          {content ? (
            <MarkdownRenderer content={content} />
          ) : isThinking ? null : (
            <span className="meta-message__placeholder">Thinking...</span>
          )}
        </div>

        {!isThinking && <SourceResultsList sources={sourceResults} />}

        {timestamp && !isThinking && (
          <div className="meta-message__meta">{formatTime(timestamp)}</div>
        )}

        {showSceneFooter && (
          <div className="meta-message__actions">
            {onSceneCode && (
              <button
                type="button"
                className={`meta-message__code-button ${isCodeActive ? "is-active" : ""}`}
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
                className={`meta-message__preview-button ${isPreviewActive ? "is-active" : ""}`}
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
  variant = "legacy"
}: AIMessageProps) {
  if (variant === "meta") {
    return (
      <MetaAIMessage
        content={content}
        thoughts={thoughts}
        isThinking={isThinking}
        thinkingText={thinkingText}
        thinkingStep={thinkingStep}
        thinkingDuration={thinkingDuration}
        timestamp={timestamp}
        sceneId={sceneId}
        skill={skill}
        assistantSource={assistantSource}
        assistantWarning={assistantWarning}
        errorCode={errorCode}
        meta={meta}
        isPreviewActive={isPreviewActive}
        isCodeActive={isCodeActive}
        onSceneCode={onSceneCode}
        onScenePreview={onScenePreview}
      />
    );
  }

  const showSceneFooter = Boolean((onScenePreview || onSceneCode) && !isThinking);
  const compactSceneId = compactSceneName(sceneId);

  return (
    <div className="message-row message-row--ai">
      <div className={`message-avatar message-avatar--ai ${isThinking ? "message-avatar--thinking" : ""}`}>
        <Sparkles className={`h-4 w-4 ${isThinking ? "thinking-sparkle" : ""}`} />
      </div>
      <div className="message-content">
        {/* Thought Process - collapsible */}
        {thoughts.length > 0 && !isThinking && (
          <ThoughtProcess
            thoughts={thoughts}
            duration={thinkingDuration}
          />
        )}

        {/* Message Content - with Markdown */}
        <div className="message-text message-text--ai">
          {content ? (
            <MarkdownRenderer content={content} />
          ) : isThinking ? null : (
            <span className="message-placeholder">Thinking...</span>
          )}
        </div>

        {/* Inline thinking indicator — streams live thought text */}
        {isThinking && (
          <div className="message-thinking" role="status" aria-live="polite">
            <span className="message-thinking__orb" aria-hidden="true">
              <span className="message-thinking__core" />
            </span>
            <span className="message-thinking__copy">
              <span className="message-thinking__title">
                {toStepLabel(thinkingStep)}
              </span>
              {thinkingText && (
                <span className="message-thinking__detail">{thinkingText}</span>
              )}
              <span className="message-thinking__track" aria-hidden="true">
                <span className="message-thinking__track-fill" />
              </span>
            </span>
          </div>
        )}

        {timestamp && !isThinking && (
          <div className="message-meta message-meta--ai">
            {new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </div>
        )}

        {showSceneFooter && (
          <div className="ai-message-artifact" aria-label="Generated visual artifact">
            <div className="ai-message-artifact__actions">
              {onSceneCode && (
                <button
                  type="button"
                  className={`ai-message-artifact__button ${isCodeActive ? 'is-active' : ''}`}
                  onClick={onSceneCode}
                  aria-label="Open code"
                  title={compactSceneId ? `Open ${compactSceneId} code` : 'Open scene code'}
                >
                  <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Code
                </button>
              )}

              {onScenePreview && (
                <button
                  type="button"
                  className={`ai-message-artifact__button ${isPreviewActive ? 'is-active' : ''}`}
                  onClick={onScenePreview}
                  aria-label="Open preview"
                  title={compactSceneId ? `Open ${compactSceneId} preview` : 'Open scene preview'}
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  Preview Scene
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// === Thought Process (DeepSeek-Style) ===

interface ThoughtProcessProps {
  thoughts: ThoughtItem[];
  duration?: number;
}

function ThoughtProcess({ thoughts, duration }: ThoughtProcessProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Format duration text
  const durationText = duration && duration > 0
    ? `Thoughts ${(duration / 1000).toFixed(1)}s`
    : "Thoughts";

  return (
    <div className="thought-process">
      <button
        type="button"
        className="thought-process-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <ChevronDown className={`h-4 w-4 ${isExpanded ? 'rotated' : ''}`} />
        <span>{durationText}</span>
      </button>

      {isExpanded && (
        <div className="thought-process-content">
          {thoughts.map((thought, index) => (
            <div key={index} className="thought-item">
              <span className="thought-step">{thought.step.replace(/_/g, ' ')}</span>
              <p className="thought-text">{thought.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
