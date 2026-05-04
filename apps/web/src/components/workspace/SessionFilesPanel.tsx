import { FileCode2, Film, FolderOpen, Link2, Award } from 'lucide-react';
import { useMemo } from 'react';
import type { SceneAssetPlan, SceneVersion } from '../../api';
import { useChatStore } from '../../stores';
import AssetPlanSummary from './AssetPlanSummary';

interface SessionFilesPanelProps {
  sessionId: string | null;
  sceneVersions: SceneVersion[];
  currentVersionId?: string | null;
  currentSceneId?: string | null;
  assetPlan?: SceneAssetPlan | null;
}

type SessionFileItem = {
  id: string;
  name: string;
  kind: 'code' | 'media';
  versionLabel: string;
  detail: string;
  href?: string | null;
  isCurrent: boolean;
  qualityScore?: number;
  isFromIteration?: boolean;
};

function inferCodeExtension(skill: string | null | undefined): string {
  return String(skill ?? '').toLowerCase() === 'manim' ? 'py' : 'js';
}

function inferMediaExtension(mediaType: string | null | undefined, mediaUrl: string | null | undefined): string {
  const normalizedType = String(mediaType ?? '').toLowerCase();
  if (normalizedType.includes('video/mp4')) return 'mp4';
  if (normalizedType.includes('video/webm')) return 'webm';
  if (normalizedType.includes('image/png')) return 'png';
  if (normalizedType.includes('image/jpeg')) return 'jpg';
  if (normalizedType.includes('image/gif')) return 'gif';

  const pathPart = String(mediaUrl ?? '').split('?')[0];
  const fileMatch = pathPart.match(/\.([a-z0-9]{2,5})$/i);
  if (fileMatch) {
    return fileMatch[1].toLowerCase();
  }

  return 'bin';
}

function buildSessionFileItems(
  sceneVersions: SceneVersion[],
  currentVersionId: string | null | undefined,
  qualityScore?: number | null
): SessionFileItem[] {
  const sortedVersions = [...sceneVersions]
    .filter((version) => Boolean(version && typeof version.versionId === 'string'))
    .sort((left, right) => {
      const leftVersion = Number(left.version ?? 0);
      const rightVersion = Number(right.version ?? 0);
      if (leftVersion !== rightVersion) {
        return rightVersion - leftVersion;
      }

      const leftTimestamp = Date.parse(left.updatedAt ?? left.createdAt ?? '');
      const rightTimestamp = Date.parse(right.updatedAt ?? right.createdAt ?? '');
      return rightTimestamp - leftTimestamp;
    });

  const files: SessionFileItem[] = [];

  for (const version of sortedVersions) {
    const versionLabel = `v${version.version ?? 0}`;
    const sceneLabel = String(version.sceneId ?? 'scene').trim() || 'scene';
    const isCurrent = version.versionId === currentVersionId;
    const isFromIteration = isCurrent && qualityScore !== undefined && qualityScore !== null;

    if (typeof version.code === 'string' && version.code.trim().length > 0) {
      const extension = inferCodeExtension(version.skill);
      files.push({
        id: `${version.versionId}-code`,
        name: `${sceneLabel}.${versionLabel}.${extension}`,
        kind: 'code',
        versionLabel,
        detail: `${String(version.skill ?? 'runtime').toLowerCase()} source`,
        isCurrent,
        qualityScore: isFromIteration ? qualityScore : undefined,
        isFromIteration
      });
    }

    const mediaUrl = typeof version.mediaUrl === 'string' ? version.mediaUrl.trim() : '';
    if (mediaUrl.length > 0 && mediaUrl !== 'about:blank') {
      const mediaExtension = inferMediaExtension(version.mediaType, mediaUrl);
      files.push({
        id: `${version.versionId}-media`,
        name: `${sceneLabel}.${versionLabel}.${mediaExtension}`,
        kind: 'media',
        versionLabel,
        detail: `${version.mediaType ?? 'media'} output`,
        href: mediaUrl,
        isCurrent,
        qualityScore: isFromIteration ? qualityScore : undefined,
        isFromIteration
      });
    }
  }

  return files;
}

export default function SessionFilesPanel({
  sessionId,
  sceneVersions,
  currentVersionId,
  currentSceneId,
  assetPlan
}: SessionFilesPanelProps) {
  const { iterationState } = useChatStore();
  const finalScore = iterationState?.qualityReport?.finalScore ?? 
                     (iterationState?.iterations.length ? iterationState.iterations[iterationState.iterations.length - 1]?.qualitySignals?.composite : undefined);
  
  const files = useMemo(
    () => buildSessionFileItems(sceneVersions, currentVersionId, finalScore),
    [sceneVersions, currentVersionId, finalScore]
  );

  return (
    <div className="terranet-session-files">
      <section className="terranet-session-files__card" aria-label="Generated files for this session">
        <header className="terranet-session-files__header">
          <div className="terranet-session-files__title-wrap">
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
            <p className="terranet-session-files__title">Session Files</p>
          </div>
          {sessionId ? (
            <span className="terranet-session-files__session-pill">Session {sessionId.slice(0, 8)}</span>
          ) : null}
        </header>

        {files.length === 0 ? (
          <p className="terranet-session-files__empty">
            No generated files yet. Run a generation turn to populate source and media outputs.
          </p>
        ) : (
          <ul className="terranet-session-files__list">
            {files.map((file) => (
              <li
                key={file.id}
                className={`terranet-session-files__item ${file.isCurrent ? 'is-current' : ''}`}
              >
                <div className="terranet-session-files__item-main">
                  <p className="terranet-session-files__name">
                    {file.kind === 'code' ? <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Film className="h-3.5 w-3.5" aria-hidden="true" />}
                    <span>{file.name}</span>
                  </p>
                  <p className="terranet-session-files__meta">
                    {file.versionLabel} · {file.detail}
                    {file.qualityScore !== undefined && (
                      <span
                        className="terranet-session-files__quality-badge"
                        title="Quality score from iterations"
                      >
                        <Award className="h-3 w-3" aria-hidden="true" />
                        <span>{Math.round(file.qualityScore)}/100</span>
                      </span>
                    )}
                  </p>
                </div>

                <div className="terranet-session-files__item-right">
                  <span className="terranet-session-files__kind-pill">{file.kind === 'code' ? 'Source' : 'Output'}</span>
                  {file.href ? (
                    <a
                      href={file.href}
                      target="_blank"
                      rel="noreferrer"
                      className="terranet-session-files__open-link"
                    >
                      <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Open</span>
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AssetPlanSummary assetPlan={assetPlan} sceneId={currentSceneId ?? null} />
    </div>
  );
}
