import { useState, useRef, useCallback, useEffect, memo } from "react";
import { Film, Play, AlertCircle, Loader2 } from "lucide-react";
import { InlineArtifactCard } from "./InlineArtifactCard";

interface InlineMediaPreviewProps {
  src: string | null;
  mediaType?: string | null;
  sceneId: string;
  skill: string;
  statusStage?: "idle" | "queued" | "generating" | "executing" | "syncing" | "ready" | "error";
  statusText?: string | null;
  onExpand?: () => void;
}

const InlineMediaPreviewInner = memo(function InlineMediaPreviewInner({
  src,
  mediaType,
  sceneId,
  skill,
  statusStage = "idle",
  statusText,
  onExpand,
}: InlineMediaPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const isReady = statusStage === "ready" && Boolean(src && src !== "about:blank" && !loadFailed);
  const isProcessing = !isReady && statusStage !== "error";
  const isError = statusStage === "error" || loadFailed;

  const statusDot: "ready" | "processing" | "error" = isError
    ? "error"
    : isProcessing
      ? "processing"
      : "ready";

  const togglePlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) {
      try {
        await video.play();
      } catch {
        setLoadFailed(true);
      }
    } else {
      video.pause();
    }
  }, []);

  useEffect(() => {
    setLoadFailed(false);
    setIsPlaying(false);
  }, [src, mediaType]);

  return (
    <InlineArtifactCard
      sceneId={sceneId}
      skill={skill}
      statusDot={statusDot}
      onExpand={onExpand}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-[#050505]">
        {isReady && src ? (
          <>
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              preload="metadata"
              playsInline
              muted
              loop
              autoPlay
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onError={() => setLoadFailed(true)}
              onClick={togglePlayback}
            >
              <source src={src} type={mediaType ?? "video/mp4"} />
            </video>

            {/* Subtle play/pause indicator */}
            <div
              className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${isPlaying ? "opacity-0" : "opacity-100"}`}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md">
                <Play className="h-5 w-5 ml-0.5" />
              </div>
            </div>
          </>
        ) : isProcessing ? (
          <div className="flex h-full w-full flex-col items-center justify-center">
            <Loader2 className="mb-3 h-8 w-8 animate-spin text-white/30" />
            <p className="text-xs font-medium text-white/50">
              {statusText ?? "Processing media..."}
            </p>
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/5">
              {isError ? (
                <AlertCircle className="h-5 w-5 text-red-400/70" />
              ) : (
                <Film className="h-5 w-5 text-white/30" />
              )}
            </div>
            <p className="text-xs font-medium text-white/50">
              {isError ? "Playback error" : statusText ?? "Media preview not ready"}
            </p>
          </div>
        )}
      </div>
    </InlineArtifactCard>
  );
}, (prev, next) => {
  // Deep comparison to prevent remounting video player during parent re-renders
  return (
    prev.src === next.src &&
    prev.mediaType === next.mediaType &&
    prev.sceneId === next.sceneId &&
    prev.skill === next.skill &&
    prev.statusStage === next.statusStage &&
    prev.statusText === next.statusText
  );
});

export function InlineMediaPreview(props: InlineMediaPreviewProps) {
  return <InlineMediaPreviewInner {...props} />;
}
