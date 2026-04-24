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

const btnBase = "inline-flex items-center gap-1 px-2 py-1 border border-slate-600/40 rounded-md bg-slate-800/80 text-slate-300/80 text-[0.65rem] font-medium cursor-pointer transition-all duration-150 whitespace-nowrap hover:bg-slate-700/90 hover:border-slate-500/50 hover:text-slate-200/90 hover:-translate-y-px";
const btnSuccess = "bg-green-500/10 border-green-500/30 text-green-400/90 hover:bg-green-500/15 hover:border-green-500/40";
const btnIcon = "px-1 aspect-square";
const btnActive = "bg-blue-500/15 border-blue-500/40 text-blue-400/90";

export function MessageActions({
  content,
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
    <div className={`flex items-center gap-1 py-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 hover:opacity-100 [@media(hover:none)]:opacity-100 ${className}`}>
      {/* Copy button */}
      <button
        type="button"
        className={`${btnBase} ${copied ? btnSuccess : ""}`}
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
          className={btnBase}
          onClick={onEdit}
          aria-label="Edit message"
          title="Edit and resend"
        >
          <Pencil className="h-3 w-3" />
          <span>Edit</span>
        </button>
      )}

      {/* Regenerate button - for assistant messages */}
      {isAssistant && onRegenerate && (
        <button
          type="button"
          className={btnBase}
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
        <div className="inline-flex items-center gap-0.5 ml-0.5 pl-1.5 border-l border-slate-600/20">
          <button
            type="button"
            className={`${btnBase} ${btnIcon} ${feedbackGiven === "positive" ? btnActive : ""}`}
            onClick={() => handleFeedback("positive")}
            aria-label="Helpful"
            title="Helpful"
          >
            <ThumbsUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            className={`${btnBase} ${btnIcon} ${feedbackGiven === "negative" ? btnActive : ""}`}
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
