import { AlertCircle, Film } from 'lucide-react';
import { useMemo, useState } from 'react';

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

export default function MediaViewer({ src, mediaType, sceneId, statusStage = 'idle', statusText }: MediaViewerProps) {
  const [loadFailed, setLoadFailed] = useState(false);

  const videoKey = useMemo(
    () => `${src ?? 'empty'}|${mediaType ?? ''}`,
    [src, mediaType]
  );

  if (!src || src === 'about:blank') {
    const title = MEDIA_STAGE_TITLES[statusStage] ?? MEDIA_STAGE_TITLES.idle;
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
    <div className="terranet-media-viewer">
      <video
        key={videoKey}
        className="terranet-media-viewer__player"
        controls
        preload="metadata"
        playsInline
        onLoadedData={() => setLoadFailed(false)}
        onError={() => setLoadFailed(true)}
      >
        <source src={src} type={mediaType ?? 'video/mp4'} />
        Your browser does not support video playback.
      </video>

      {loadFailed && (
        <div className="terranet-media-viewer__error" role="alert">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <span>Unable to load this video artifact. Try regenerating the scene.</span>
        </div>
      )}
    </div>
  );
}
