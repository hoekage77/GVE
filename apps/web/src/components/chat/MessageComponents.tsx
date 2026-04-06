import { useState } from "react";
import { Sparkles, ChevronDown, Eye, Code2 } from "lucide-react";
import MarkdownRenderer from "./MarkdownRenderer";

// === User Message ===

interface UserMessageProps {
  content: string;
  timestamp?: number;
}

export function UserMessage({ content, timestamp }: UserMessageProps) {
  return (
    <div className="message-row message-row--user">
      <div className="message-content">
        <div className="message-bubble message-bubble--user">
          <div className="message-text">{content}</div>
        </div>
        {timestamp && (
          <div className="message-meta">
            {new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
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
  activeSceneView?: 'preview' | 'code' | null;
  onSceneAction?: (action: 'preview' | 'code') => void;
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

export function AIMessage({
  content,
  thoughts = [],
  isThinking,
  thinkingText,
  thinkingStep = "turn_started",
  thinkingDuration,
  timestamp,
  sceneId,
  activeSceneView,
  onSceneAction
}: AIMessageProps) {
  const showSceneFooter = Boolean(sceneId && onSceneAction && !isThinking);
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
                {STEP_LABELS[thinkingStep] ?? thinkingStep.replace(/_/g, " ")}
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
          <div className="ai-message-scene-footer" aria-label="Scene actions">

            <div className="ai-message-scene-footer__actions">
              <button
                type="button"
                className={`ai-message-scene-footer__button ${activeSceneView === 'code' ? 'is-active' : ''}`}
                onClick={() => onSceneAction?.('code')}
                aria-label="Open code"
              >
                <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
                Code
              </button>
              <button
                type="button"
                className={`ai-message-scene-footer__button ${activeSceneView === 'preview' ? 'is-active' : ''}`}
                onClick={() => onSceneAction?.('preview')}
                aria-label="Open preview"
              >
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                Preview
              </button>
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
    ? `Thought for ${(duration / 1000).toFixed(1)} seconds`
    : "Thought process";

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
              <span className="thought-step">{thought.step.toUpperCase()}</span>
              <p className="thought-text">{thought.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
