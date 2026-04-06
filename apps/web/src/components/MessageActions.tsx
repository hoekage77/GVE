import { useState, useCallback } from "react";
import { Copy, Check, RotateCcw, Pencil, ThumbsUp, ThumbsDown } from "lucide-react";

interface MessageActionsProps {
  content: string;
  messageId?: string;
  isAssistant: boolean;
  isError?: boolean;
  onRegenerate?: () => void;
  onEdit?: () => void;
  onFeedback?: (type: "positive" | "negative") => void;
  className?: string;
}

export function MessageActions({
  content,
  messageId,
  isAssistant,
  isError,
  onRegenerate,
  onEdit,
  onFeedback,
  className = ""
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<"positive" | "negative" | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [content]);

  const handleFeedback = useCallback((type: "positive" | "negative") => {
    setFeedbackGiven(type);
    onFeedback?.(type);
  }, [onFeedback]);

  return (
    <div className={`message-actions ${className}`}>
      {/* Copy button - available for all messages */}
      <button
        type="button"
        className={`message-action-btn ${copied ? "message-action-btn--success" : ""}`}
        onClick={handleCopy}
        aria-label={copied ? "Copied!" : "Copy message"}
        title={copied ? "Copied!" : "Copy to clipboard"}
      >
        {copied ? (
          <>
            <Check className="h-3 w-3" />
            <span>Copied</span>
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" />
            <span>Copy</span>
          </>
        )}
      </button>

      {/* Edit button - for user messages */}
      {!isAssistant && onEdit && (
        <button
          type="button"
          className="message-action-btn"
          onClick={onEdit}
          aria-label="Edit message"
          title="Edit and resend"
        >
          <Pencil className="h-3 w-3" />
          <span>Edit</span>
        </button>
      )}

      {/* Regenerate button - for assistant messages or errors */}
      {isAssistant && onRegenerate && (
        <button
          type="button"
          className="message-action-btn"
          onClick={onRegenerate}
          aria-label="Regenerate response"
          title="Regenerate response"
        >
          <RotateCcw className="h-3 w-3" />
          <span>Regenerate</span>
        </button>
      )}

      {/* Feedback buttons - for assistant messages */}
      {isAssistant && onFeedback && !isError && (
        <div className="message-actions__feedback">
          <button
            type="button"
            className={`message-action-btn message-action-btn--icon ${feedbackGiven === "positive" ? "message-action-btn--active" : ""}`}
            onClick={() => handleFeedback("positive")}
            aria-label="Helpful"
            title="Helpful"
          >
            <ThumbsUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            className={`message-action-btn message-action-btn--icon ${feedbackGiven === "negative" ? "message-action-btn--active" : ""}`}
            onClick={() => handleFeedback("negative")}
            aria-label="Not helpful"
            title="Not helpful"
          >
            <ThumbsDown className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
