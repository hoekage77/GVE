import { useState, useRef, useEffect } from "react";
import { Plus, Send, Paperclip, X, Mic, Sparkles } from "lucide-react";

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
  variant = "legacy",
  participantLabel = "You",
  modelLabel = "Meta AI"
}: ComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showAttachments, setShowAttachments] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

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
    <div className="relative">
      <div className="h-[38px] lg:h-[42px] flex items-center gap-1.5 lg:gap-2 px-2.5 lg:px-3 bg-[#0a0a0a]/80 backdrop-blur-md border border-white/10 rounded-xl focus-within:border-white/30 focus-within:ring-1 focus-within:ring-sky-500/40 shadow-inner transition-all duration-300">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageInputChange}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 bg-transparent outline-none text-[13px] lg:text-[13.5px] placeholder:text-white/30"
          disabled={isSending}
        />
        <button
          type="button"
          className="text-white/40 hover:text-white/70 p-1 transition"
        >
          <Mic className="w-[18px] h-[18px]" />
        </button>
        {isSending ? (
          <button
            onClick={onStop}
            type="button"
            className="w-7 h-7 grid place-items-center rounded-lg bg-white/10 hover:bg-white/15 text-white/80 transition"
          >
            <X className="w-[14px] h-[14px] stroke-[2.5]" />
          </button>
        ) : (
          <button
            onClick={() => { if (canSubmit) onSubmit(); }}
            disabled={!canSubmit}
            type="button"
            className={`w-7 h-7 grid place-items-center rounded-lg transition ${canSubmit ? 'bg-white/10 hover:bg-white/15 text-white/80' : 'text-white/20'}`}
          >
            <Send className="w-[14px] h-[14px] stroke-[2]" />
          </button>
        )}
      </div>
      {attachmentError && <div className="absolute -top-10 left-0 text-red-400 text-xs px-3 py-1.5 bg-red-950/50 rounded-lg">{attachmentError}</div>}
    </div>
  );
}
