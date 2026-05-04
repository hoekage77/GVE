import { useRef, useState, useEffect } from "react";
import { Send, X, Plus, ChevronDown } from "lucide-react";
import { type LlmProviderItem } from "../../api";

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
  variant?: "legacy" | "meta";
  participantLabel?: string;
  modelLabel?: string;
  providers?: LlmProviderItem[];
  activeProviderId?: string;
  onProviderChange?: (id: string) => void;
  connectionState?: "connecting" | "open" | "closed" | "error";
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
  placeholder = "Message GenVis...",
  providers = [],
  activeProviderId = "auto",
  onProviderChange,
  connectionState = "closed"
}: ComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const canSubmit = value.trim().length > 0 || Boolean(attachedImage);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [value]);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit && !isSending) {
        onSubmit();
      }
    }
  };

  const activeProvider = providers.find(p => p.id === activeProviderId);

  return (
    <div className="relative flex flex-col gap-2">
      {/* Attached Image Preview */}
      {attachedImage && (
        <div className="flex px-1">
          <div className="relative group rounded-xl overflow-hidden border border-white/10 bg-white/5 shadow-lg">
            <img 
              src={attachedImage.previewUrl} 
              alt="Attachment" 
              className="h-20 w-20 object-cover opacity-90 transition-opacity group-hover:opacity-100" 
            />
            <button 
              onClick={onRemoveImage}
              className="absolute top-1 right-1 h-5 w-5 flex items-center justify-center rounded-full bg-black/60 text-white/80 hover:bg-black/80 hover:text-white transition-all scale-90 group-hover:scale-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-[52px] items-end gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-2 shadow-lg transition-all duration-200 focus-within:composer-glow focus-within:border-ide-accent/40 focus-within:bg-white/[0.06] lg:min-h-[56px] lg:p-2.5">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageInputChange}
        />

        {/* Connection status + Model Selector */}
        <div className="flex items-center gap-1.5 pb-1">
          <div
            className={`h-2 w-2 rounded-full transition-all duration-300 ${
              connectionState === "open"
                ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]"
                : connectionState === "connecting"
                ? "bg-amber-400 animate-pulse"
                : "bg-red-400/80"
            }`}
            title={connectionState === "open" ? "Connected" : connectionState === "connecting" ? "Connecting..." : "Disconnected"}
          />
        </div>
        
        {/* Model Selector */}
        <div className="relative group">
          <div className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium text-meta-muted/80 hover:text-meta-text cursor-pointer transition-colors">
            <span>{activeProvider?.name || "Auto"}</span>
            <ChevronDown className="h-3 w-3 opacity-70" />
          </div>
          <select
            value={activeProviderId}
            onChange={(e) => onProviderChange?.(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
          >
            <option value="auto">Auto (Recommended)</option>
            {providers.map(p => (
              <option key={p.id} value={p.id} disabled={p.state === 'disabled'}>
                {p.name} {p.state === 'cooldown' ? '(Cooldown)' : ''}
              </option>
            ))}
          </select>
        </div>
        
        <div className="flex min-w-0 flex-1 flex-col justify-center pb-1.5 pt-1.5">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="composer-textarea w-full bg-transparent text-[15px] text-white/90 outline-none placeholder:text-meta-muted/60 resize-none overflow-y-auto"
            disabled={isSending}
            rows={1}
          />
        </div>

        {isSending ? (
          <button
            onClick={onStop}
            type="button"
            className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-400 transition-colors hover:bg-red-500/30"
          >
            <div className="h-3 w-3 rounded-[2px] bg-currentColor" />
          </button>
        ) : (
          <button
            onClick={() => { if (canSubmit) onSubmit(); }}
            disabled={!canSubmit}
            type="button"
            className={`mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all duration-200 ${canSubmit ? 'bg-ide-accent text-white hover:bg-ide-accent/90 shadow-md' : 'bg-white/5 text-meta-muted/30'}`}
          >
            <Send className="h-[18px] w-[18px] translate-x-[1px]" strokeWidth={2.5} />
          </button>
        )}

        <button
          type="button"
          className="mb-1 rounded-full p-1.5 text-meta-muted/80 transition-colors hover:bg-white/10 hover:text-meta-text"
          onClick={() => fileInputRef.current?.click()}
          title="Attach image"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      {attachmentError && (
        <div className="flex items-center justify-center px-1">
          <div className="rounded-lg bg-red-950/40 px-2 py-1 text-[10px] text-red-400 shadow-sm border border-red-500/20">
            {attachmentError}
          </div>
        </div>
      )}
    </div>
  );
}
