import { useRef, useState } from "react";
import { Mic, Send, X, Plus } from "lucide-react";

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
  isSending, 
  onStop,
  placeholder = "Message GenVis..."
}: ComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const canSubmit = value.trim().length > 0 || Boolean(attachedImage);

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
      <div className="flex h-12 items-center gap-2 rounded-xl border border-white/20 bg-surface-3 px-3 shadow-2xl transition-all duration-200 focus-within:border-ide-accent/55 focus-within:ring-1 focus-within:ring-ide-accent/25 lg:h-14 lg:px-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageInputChange}
        />
        <button
          type="button"
          className="p-1 text-meta-muted transition-colors hover:text-meta-text"
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus className="w-5 h-5" />
        </button>
        <button
          type="button"
          className="p-1 text-meta-muted transition-colors hover:text-meta-text"
        >
          <Mic className="w-5 h-5" />
        </button>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-[15px] text-meta-text outline-none placeholder:text-meta-muted/50"
          disabled={isSending}
        />
        {isSending ? (
          <button
            onClick={onStop}
            type="button"
            className="grid h-7 w-7 place-items-center rounded-md border border-meta-border bg-surface text-meta-text transition-colors hover:bg-surface-2"
          >
            <X className="w-4 h-4 stroke-[2.5]" />
          </button>
        ) : (
          <button
            onClick={() => { if (canSubmit) onSubmit(); }}
            disabled={!canSubmit}
            type="button"
            className={`grid h-7 w-7 place-items-center rounded-md border transition-colors ${canSubmit ? 'border-ide-accent/35 bg-ide-accent/15 text-meta-text hover:bg-ide-accent/25' : 'border-transparent text-meta-muted/40'}`}
          >
            <Send className="w-4 h-4 stroke-[2]" />
          </button>
        )}
      </div>
      {attachmentError && <div className="absolute -top-10 left-0 text-red-400 text-xs px-3 py-1.5 bg-red-950/50 rounded-lg">{attachmentError}</div>}
    </div>
  );
}
