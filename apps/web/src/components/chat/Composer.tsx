import { useState, useRef, useEffect } from "react";
import { Plus, Send, Paperclip, X } from "lucide-react";

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isSending?: boolean;
  onStop?: () => void;
  placeholder?: string;
}

export function Composer({ 
  value, 
  onChange, 
  onSubmit, 
  isSending, 
  onStop,
  placeholder = "Message Terranet..."
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showAttachments, setShowAttachments] = useState(false);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !isSending) {
        onSubmit();
      }
    }
  };

  return (
    <div className="composer">
      <div className="composer-container">
        {/* Attachment menu */}
        {showAttachments && (
          <div className="composer-attachments">
            <button type="button" className="composer-attachment-item">
              <Paperclip className="h-4 w-4" />
              <span>Upload file</span>
            </button>
            <button type="button" className="composer-attachment-item">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18" />
              </svg>
              <span>Connect repo</span>
            </button>
          </div>
        )}

        <div className="composer-input-row">
          {/* Plus button for attachments */}
          <button
            type="button"
            className={`composer-button composer-button--plus ${showAttachments ? 'active' : ''}`}
            onClick={() => setShowAttachments(!showAttachments)}
            aria-label="Add attachment"
          >
            {showAttachments ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
          </button>

          {/* Text input */}
          <textarea
            ref={textareaRef}
            className="composer-textarea"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={isSending}
          />

          {/* Send/Stop button */}
          {isSending ? (
            <button
              type="button"
              className="composer-button composer-button--stop"
              onClick={onStop}
              aria-label="Stop generation"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5">
                <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className="composer-button composer-button--send"
              onClick={onSubmit}
              disabled={!value.trim()}
              aria-label="Send message"
            >
              <Send className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
      <div className="composer-footer">
        <span>AI-generated content. Verify important information.</span>
      </div>
    </div>
  );
}
