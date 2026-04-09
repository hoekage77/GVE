import { useState, useRef, useEffect } from "react";
import { Plus, Send, Paperclip, X } from "lucide-react";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

interface ComposerImage {
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
  previewUrl: string;
}

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  attachedImage?: ComposerImage | null;
  onImageSelected?: (image: ComposerImage) => void;
  onRemoveImage?: () => void;
  isSending?: boolean;
  onStop?: () => void;
  placeholder?: string;
}

export function Composer({ 
  value, 
  onChange, 
  onSubmit, 
  attachedImage,
  onImageSelected,
  onRemoveImage,
  isSending, 
  onStop,
  placeholder = "Message GenVis..."
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showAttachments, setShowAttachments] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [value]);

  const canSubmit = value.trim().length > 0 || Boolean(attachedImage);

  const formatBytes = (valueInBytes: number) => {
    if (valueInBytes < 1024) {
      return `${valueInBytes} B`;
    }

    if (valueInBytes < 1024 * 1024) {
      return `${(valueInBytes / 1024).toFixed(1)} KB`;
    }

    return `${(valueInBytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }

        reject(new Error("Unable to read selected file."));
      };
      reader.onerror = () => reject(new Error("Unable to read selected file."));
      reader.readAsDataURL(file);
    });

  const handleImageSelect = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setAttachmentError("Please select an image file.");
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setAttachmentError("Image is too large. Please choose an image under 5 MB.");
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const [, base64Payload = ""] = dataUrl.split(",");

      if (!base64Payload) {
        setAttachmentError("Unable to process image payload.");
        return;
      }

      onImageSelected?.({
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        dataBase64: base64Payload,
        previewUrl: dataUrl
      });
      setAttachmentError(null);
      setShowAttachments(false);
    } catch {
      setAttachmentError("Unable to process the selected image.");
    }
  };

  const handleImageInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    await handleImageSelect(file);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit && !isSending) {
        onSubmit();
      }
    }
  };

  return (
    <div className="composer">
      <div className="composer-container">
        <input
          ref={fileInputRef}
          className="composer-file-input"
          type="file"
          accept="image/*"
          onChange={handleImageInputChange}
          tabIndex={-1}
          aria-hidden="true"
        />

        {attachedImage && (
          <div className="composer-image-chip" role="status" aria-live="polite">
            <img src={attachedImage.previewUrl} alt={attachedImage.name} />
            <div className="composer-image-chip__meta">
              <span className="composer-image-chip__name">{attachedImage.name}</span>
              <span className="composer-image-chip__size">{formatBytes(attachedImage.sizeBytes)}</span>
            </div>
            <button
              type="button"
              className="composer-image-chip__remove"
              onClick={onRemoveImage}
              aria-label="Remove attached image"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {attachmentError && <p className="composer-attachment-error">{attachmentError}</p>}

        {/* Attachment menu */}
        {showAttachments && (
          <div className="composer-attachments">
            <button
              type="button"
              className="composer-attachment-item"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="h-4 w-4" />
              <span>Upload image</span>
            </button>
            <button type="button" className="composer-attachment-item" disabled>
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
              disabled={!canSubmit}
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
