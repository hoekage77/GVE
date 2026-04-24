import { AlertCircle, Expand, Film, Heart, Pause, Play, Share2, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface MediaViewerProps {
  src: string | null;
  mediaType?: string | null;
  sceneId?: string | null;
  statusStage?: 'idle' | 'queued' | 'generating' | 'executing' | 'syncing' | 'ready' | 'error';
  statusText?: string | null;
}

const MEDIA_STAGE_TITLES: Record<NonNullable<MediaViewerProps['statusStage']>, string> = {
  idle: 'Video preview is not ready yet.',
  queued: 'Video runtime is queued.',
  generating: 'Generating video frames...',
  executing: 'Executing media runtime...',
  syncing: 'Syncing runtime output...',
  ready: 'Video artifact is ready.',
  error: 'Video generation encountered an issue.'
};

const CHROME_HIDE_DELAY_MS = 2600;

function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const seconds = Math.floor(totalSeconds);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export default function MediaViewer({ src, mediaType, sceneId, statusStage = 'idle', statusText }: MediaViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hideChromeTimerRef = useRef<number | null>(null);
  const sharePulseTimerRef = useRef<number | null>(null);

  const [loadFailed, setLoadFailed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [isLiked, setIsLiked] = useState(false);
  const [isDetailExpanded, setIsDetailExpanded] = useState(false);
  const [isSharePulsing, setIsSharePulsing] = useState(false);

  const videoKey = useMemo(() => `${src ?? 'empty'}|${mediaType ?? ''}`, [src, mediaType]);

  const statusLabel = MEDIA_STAGE_TITLES[statusStage] ?? MEDIA_STAGE_TITLES.idle;
  const progress = durationSec > 0 ? Math.min(100, Math.max(0, (currentTimeSec / durationSec) * 100)) : 0;
  const canPlay = Boolean(src && src !== 'about:blank' && !loadFailed);
  const shouldShowStatusCopy = Boolean(statusText && (isDetailExpanded || statusStage !== 'ready' || !isPlaying));

  const clearHideTimer = useCallback(() => {
    if (hideChromeTimerRef.current !== null) {
      window.clearTimeout(hideChromeTimerRef.current);
      hideChromeTimerRef.current = null;
    }
  }, []);

  const clearSharePulseTimer = useCallback(() => {
    if (sharePulseTimerRef.current !== null) {
      window.clearTimeout(sharePulseTimerRef.current);
      sharePulseTimerRef.current = null;
    }
  }, []);

  const scheduleChromeHide = useCallback(() => {
    clearHideTimer();
    if (!isPlaying || isSeeking) return;
    hideChromeTimerRef.current = window.setTimeout(() => {
      setChromeVisible(false);
    }, CHROME_HIDE_DELAY_MS);
  }, [clearHideTimer, isPlaying, isSeeking]);

  const revealChrome = useCallback(() => {
    setChromeVisible(true);
    scheduleChromeHide();
  }, [scheduleChromeHide]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTimeSec(0);
    setDurationSec(0);
    setLoadFailed(false);
    setChromeVisible(true);
    setIsLiked(false);
    setIsDetailExpanded(false);
    setIsSharePulsing(false);
    clearHideTimer();
    clearSharePulseTimer();
  }, [videoKey, clearHideTimer, clearSharePulseTimer]);

  useEffect(() => {
    if (!isPlaying) {
      setChromeVisible(true);
      clearHideTimer();
      return;
    }
    scheduleChromeHide();
    return clearHideTimer;
  }, [clearHideTimer, isPlaying, scheduleChromeHide]);

  useEffect(() => {
    return () => {
      clearHideTimer();
      clearSharePulseTimer();
    };
  }, [clearHideTimer, clearSharePulseTimer]);

  const togglePlayback = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const video = videoRef.current;
    if (!video || !canPlay) return;

    revealChrome();

    if (video.paused || video.ended) {
      try {
        await video.play();
      } catch {
        setLoadFailed(true);
      }
      return;
    }
    video.pause();
  }, [canPlay, revealChrome]);

  const toggleMute = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    const video = videoRef.current;
    if (!video) return;

    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
    revealChrome();
  }, [revealChrome]);

  const toggleFullscreen = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const container = containerRef.current;
    if (!container) return;

    revealChrome();

    const doc = document as Document & {
      webkitFullscreenElement?: Element;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    const element = container as HTMLDivElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };

    const fullscreenElement = document.fullscreenElement ?? doc.webkitFullscreenElement;
    if (fullscreenElement) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
      return;
    }

    if (element.requestFullscreen) await element.requestFullscreen();
    else if (element.webkitRequestFullscreen) await element.webkitRequestFullscreen();
  }, [revealChrome]);

  const handleSeekChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number.parseFloat(event.target.value);
    if (!Number.isFinite(nextTime)) return;
    setCurrentTimeSec(nextTime);
  }, []);

  const commitSeek = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = currentTimeSec;
    setIsSeeking(false);
    scheduleChromeHide();
  }, [currentTimeSec, scheduleChromeHide]);

  const toggleLike = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsLiked((prev) => !prev);
    revealChrome();
  }, [revealChrome]);

  const handleShare = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!src) return;

    revealChrome();
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({
          title: sceneId ? `Scene ${sceneId}` : 'Visual preview',
          text: sceneId ? `Check this scene: ${sceneId}` : 'Check this generated visual preview.',
          url: src
        });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(src);
      }
      setIsSharePulsing(true);
      clearSharePulseTimer();
      sharePulseTimerRef.current = window.setTimeout(() => setIsSharePulsing(false), 950);
    } catch {
      setIsSharePulsing(false);
    }
  }, [clearSharePulseTimer, revealChrome, sceneId, src]);

  // Empty State
  if (!src || src === 'about:blank') {
    const title = statusLabel;
    const detail = statusText ?? (sceneId ? `Scene ${sceneId} is still processing.` : 'Output is processing.');

    return (
      <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-900/50 p-8 text-center" role="status">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-800 text-neutral-400 mb-4" aria-hidden="true">
          <Film className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium text-neutral-200">{title}</p>
        <p className="mt-1 max-w-xs text-xs text-neutral-500">{detail}</p>
      </div>
    );
  }

  // Active State
  return (
    <div
      ref={containerRef}
      className="group relative flex h-full w-full overflow-hidden rounded-2xl bg-[#0a0a0a] ring-1 ring-inset ring-white/10"
      onPointerMove={revealChrome}
      onPointerDown={revealChrome}
      onClick={togglePlayback}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        key={videoKey}
        className="h-full w-full object-contain"
        preload="metadata"
        playsInline
        onLoadedMetadata={(event) => {
          setLoadFailed(false);
          setDurationSec(event.currentTarget.duration || 0);
          setIsMuted(event.currentTarget.muted);
        }}
        onLoadedData={() => setLoadFailed(false)}
        onError={() => setLoadFailed(true)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTimeSec(0);
          setChromeVisible(true);
        }}
        onTimeUpdate={(event) => {
          if (!isSeeking) setCurrentTimeSec(event.currentTarget.currentTime);
        }}
      >
        <source src={src} type={mediaType ?? 'video/mp4'} />
        Your browser does not support video playback.
      </video>

      {/* Center Play/Pause Overlay */}
      <div className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${!isPlaying ? 'opacity-100' : 'opacity-0'}`}>
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md">
          {isPlaying ? <Pause className="h-6 w-6 ml-0.5" /> : <Play className="h-6 w-6 ml-1" />}
        </div>
      </div>

      {/* Top Bar (Title & Tools) */}
      <div className={`absolute top-0 left-0 right-0 flex items-center justify-between p-4 bg-gradient-to-b from-black/60 to-transparent transition-opacity duration-300 ${chromeVisible || !isPlaying ? 'opacity-100' : 'opacity-0'}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-white backdrop-blur-md">Preview</span>
          {sceneId && <span className="font-mono text-[11px] text-white/70">{sceneId.slice(0, 8)}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={toggleLike} className={`flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20 ${isLiked ? 'text-rose-400' : ''}`}>
            <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
          </button>
          <button type="button" onClick={handleShare} className={`flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20 ${isSharePulsing ? 'text-sky-400' : ''}`}>
            <Share2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Bottom Bar (Controls & Timeline) */}
      <div className={`absolute bottom-0 left-0 right-0 flex flex-col gap-2 p-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent transition-opacity duration-300 ${chromeVisible || !isPlaying ? 'opacity-100' : 'opacity-0'}`} onClick={(e) => e.stopPropagation()}>
        {shouldShowStatusCopy && (
          <p className="text-xs text-white/70 mb-2 px-1">{statusText}</p>
        )}
        
        <div className="flex items-center gap-4 text-xs font-medium text-white/90">
          <button type="button" onClick={togglePlayback} className="hover:text-white transition-colors">
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          
          <span className="w-10 text-right tabular-nums">{formatDuration(currentTimeSec)}</span>
          
          <div className="relative flex h-5 flex-1 items-center group/timeline">
            <input
              type="range"
              min={0}
              max={durationSec || 0}
              step={0.1}
              value={Math.min(currentTimeSec, durationSec || currentTimeSec)}
              onChange={handleSeekChange}
              onPointerDown={() => { setIsSeeking(true); revealChrome(); }}
              onPointerUp={commitSeek}
              onKeyUp={commitSeek}
              className="absolute inset-0 w-full opacity-0 cursor-pointer z-10"
              aria-label="Seek video"
            />
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/20 transition-all group-hover/timeline:h-1.5">
              <div className="h-full bg-white transition-all duration-75" style={{ width: `${progress}%` }} />
            </div>
            {/* Scrubber handle */}
            <div 
              className="absolute h-3 w-3 rounded-full bg-white shadow opacity-0 group-hover/timeline:opacity-100 transition-opacity pointer-events-none"
              style={{ left: `calc(${progress}% - 6px)` }}
            />
          </div>
          
          <span className="w-10 tabular-nums">{formatDuration(durationSec)}</span>

          <button type="button" onClick={toggleMute} className="hover:text-white transition-colors ml-2">
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button type="button" onClick={toggleFullscreen} className="hover:text-white transition-colors">
            <Expand className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loadFailed && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-red-400">
            <AlertCircle className="h-8 w-8" />
            <span className="text-sm font-medium text-white">Playback Error</span>
            <span className="text-xs text-white/60">Unable to load media. Try regenerating.</span>
          </div>
        </div>
      )}
    </div>
  );
}
