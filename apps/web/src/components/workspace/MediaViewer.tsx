import { AlertCircle, Expand, Film, Heart, MessageCircle, Pause, Play, Share2, Volume2, VolumeX } from 'lucide-react';
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
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '0:00';
  }

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

  const videoKey = useMemo(
    () => `${src ?? 'empty'}|${mediaType ?? ''}`,
    [src, mediaType]
  );

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
    if (!isPlaying || isSeeking) {
      return;
    }

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

  const togglePlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !canPlay) {
      return;
    }

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

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
    revealChrome();
  }, [revealChrome]);

  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

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
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (doc.webkitExitFullscreen) {
        await doc.webkitExitFullscreen();
      }
      return;
    }

    if (element.requestFullscreen) {
      await element.requestFullscreen();
    } else if (element.webkitRequestFullscreen) {
      await element.webkitRequestFullscreen();
    }
  }, [revealChrome]);

  const handleSeekChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number.parseFloat(event.target.value);
    if (!Number.isFinite(nextTime)) {
      return;
    }

    setCurrentTimeSec(nextTime);
  }, []);

  const commitSeek = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.currentTime = currentTimeSec;
    setIsSeeking(false);
    scheduleChromeHide();
  }, [currentTimeSec, scheduleChromeHide]);

  const toggleLike = useCallback(() => {
    setIsLiked((previous) => !previous);
    revealChrome();
  }, [revealChrome]);

  const toggleDetail = useCallback(() => {
    setIsDetailExpanded((previous) => !previous);
    revealChrome();
  }, [revealChrome]);

  const handleShare = useCallback(async () => {
    if (!src) {
      return;
    }

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
      sharePulseTimerRef.current = window.setTimeout(() => {
        setIsSharePulsing(false);
      }, 950);
    } catch {
      setIsSharePulsing(false);
    }
  }, [clearSharePulseTimer, revealChrome, sceneId, src]);

  if (!src || src === 'about:blank') {
    const title = statusLabel;
    const detail = statusText
      ?? (sceneId ? `Scene ${sceneId} is still processing runtime output.` : 'Runtime output is still processing.');

    return (
      <div className="terranet-media-viewer terranet-media-viewer--empty" role="status">
        <div className="terranet-media-viewer__empty-icon" aria-hidden="true">
          <Film className="h-5 w-5" />
        </div>
        <p className="terranet-media-viewer__empty-title">{title}</p>
        <p className="terranet-media-viewer__empty-copy">
          {detail}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="terranet-media-viewer"
      onPointerMove={revealChrome}
      onPointerDown={revealChrome}
    >
      <video
        ref={videoRef}
        key={videoKey}
        className="terranet-media-viewer__player"
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
          if (isSeeking) {
            return;
          }
          setCurrentTimeSec(event.currentTarget.currentTime);
        }}
      >
        <source src={src} type={mediaType ?? 'video/mp4'} />
        Your browser does not support video playback.
      </video>

      <button
        type="button"
        className={`terranet-media-viewer__play-toggle ${isPlaying ? 'is-playing' : ''}`}
        onClick={() => {
          void togglePlayback();
        }}
        aria-label={isPlaying ? 'Pause preview video' : 'Play preview video'}
      >
        {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7" />}
      </button>

      <div className={`terranet-media-viewer__chrome ${chromeVisible ? 'is-visible' : ''}`}>
        <div className="terranet-media-viewer__topbar">
          <div className="terranet-media-viewer__scene-meta">
            <span className="terranet-media-viewer__scene-badge">Preview</span>
            {sceneId ? <span className="terranet-media-viewer__scene-id">{sceneId}</span> : null}
          </div>
          <span className={`terranet-media-viewer__stage terranet-media-viewer__stage--${statusStage}`}>
            {statusStage === 'ready' && isPlaying ? 'Playing' : statusLabel}
          </span>
        </div>

        <div className="terranet-media-viewer__bottombar">
          {shouldShowStatusCopy ? <p className="terranet-media-viewer__status-copy">{statusText}</p> : null}

          <div className="terranet-media-viewer__timeline-row">
            <span>{formatDuration(currentTimeSec)}</span>
            <input
              type="range"
              className="terranet-media-viewer__timeline"
              min={0}
              max={durationSec || 0}
              step={0.1}
              value={Math.min(currentTimeSec, durationSec || currentTimeSec)}
              onChange={handleSeekChange}
              onPointerDown={() => {
                setIsSeeking(true);
                revealChrome();
              }}
              onPointerUp={commitSeek}
              onKeyUp={commitSeek}
              aria-label="Seek video timeline"
              style={{ ['--progress' as string]: `${progress}%` }}
            />
            <span>{formatDuration(durationSec)}</span>
          </div>

          <div className="terranet-media-viewer__actions">
            <button
              type="button"
              className="terranet-media-viewer__action"
              onClick={() => {
                void togglePlayback();
              }}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button
              type="button"
              className="terranet-media-viewer__action"
              onClick={toggleMute}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              className="terranet-media-viewer__action"
              onClick={() => {
                void toggleFullscreen();
              }}
              aria-label="Toggle fullscreen"
            >
              <Expand className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className={`terranet-media-viewer__rail ${chromeVisible ? 'is-visible' : ''}`}>
        <button
          type="button"
          className={`terranet-media-viewer__rail-btn ${isLiked ? 'is-active' : ''}`}
          aria-label={isLiked ? 'Unlike scene' : 'Like scene'}
          onClick={toggleLike}
        >
          <Heart className="h-4 w-4" />
          <span>{isLiked ? 'Liked' : 'Like'}</span>
        </button>
        <button
          type="button"
          className={`terranet-media-viewer__rail-btn ${isDetailExpanded ? 'is-active' : ''}`}
          aria-label={isDetailExpanded ? 'Hide details' : 'Show details'}
          onClick={toggleDetail}
        >
          <MessageCircle className="h-4 w-4" />
          <span>{isDetailExpanded ? 'Details on' : 'Details'}</span>
        </button>
        <button
          type="button"
          className={`terranet-media-viewer__rail-btn ${isSharePulsing ? 'is-active is-pulsing' : ''}`}
          aria-label="Share scene"
          onClick={() => {
            void handleShare();
          }}
        >
          <Share2 className="h-4 w-4" />
          <span>Share</span>
        </button>
      </div>

      {loadFailed && (
        <div className="terranet-media-viewer__error" role="alert">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <span>Unable to load this video artifact. Try regenerating the scene.</span>
        </div>
      )}
    </div>
  );
}
