import { Eye, Code, X, Undo2, Redo2, SkipBack, SkipForward } from 'lucide-react';
import SceneViewer from '../SceneViewer';
import CodeEditor from '../CodeEditor';
import MediaViewer from './MediaViewer';
import { useChatStore } from '../../stores';
import { useMemo, useState } from 'react';

export default function WorkspacePanel() {
  const {
    sessions,
    activeSessionId,
    panelOpen,
    panelView,
    closePanel,
    openPanel,
    sendSceneCommand,
    selectSceneVersion,
    rerunScene,
    taskProgressBySession,
    isSending
  } = useChatStore();

  const [versionError, setVersionError] = useState<string | null>(null);
  const [isRerunning, setIsRerunning] = useState(false);

  const currentSession = useMemo(() =>
    sessions.find(s => s.sessionId === activeSessionId),
    [sessions, activeSessionId]
  );

  const currentScene = currentSession?.currentScene ?? null;
  const currentCode = currentScene?.code ?? null;
  const currentSkill = currentScene?.skill ?? null;
  const currentOutputKind = currentScene?.outputKind ?? null;
  const currentMediaType = currentScene?.mediaType ?? null;
  const currentMediaUrl = currentScene?.mediaUrl ?? currentScene?.previewUrl ?? null;
  const taskProgress = activeSessionId ? taskProgressBySession[activeSessionId] ?? null : null;

  const versions = currentSession?.versions ?? [];
  const computedVersionPointer = useMemo(() => {
    if (!currentSession) {
      return -1;
    }

    if (typeof currentSession.versionPointer === 'number') {
      return currentSession.versionPointer;
    }

    const currentVersionId = currentSession.currentScene?.versionId ?? null;
    if (currentVersionId) {
      const byIdIndex = versions.findIndex((version) => version.versionId === currentVersionId);
      if (byIdIndex >= 0) {
        return byIdIndex;
      }
    }

    return versions.findIndex((version) => (version as { isCurrent?: boolean }).isCurrent);
  }, [currentSession, versions]);

  const isMediaScene = currentOutputKind === 'media'
    || (typeof currentMediaType === 'string' && currentMediaType.startsWith('video/'))
    || currentSkill === 'manim';

  const activeVersionId = currentScene?.versionId
    ?? (computedVersionPointer >= 0 ? versions[computedVersionPointer]?.versionId ?? '' : '');

  const handleVersionSelect = async (nextVersionId: string) => {
    if (!nextVersionId || nextVersionId === activeVersionId) {
      return;
    }

    setVersionError(null);

    const selected = await selectSceneVersion(nextVersionId);
    if (!selected) {
      setVersionError('Unable to load the selected visual version.');
    }
  };

  const handleRunScene = async (code: string) => {
    if (isRerunning) {
      return;
    }

    setVersionError(null);
    setIsRerunning(true);

    try {
      const rerunSucceeded = await rerunScene({ codeOverride: code });
      if (!rerunSucceeded) {
        setVersionError('Unable to rerun the selected scene.');
        return;
      }

      openPanel('preview');
    } finally {
      setIsRerunning(false);
    }
  };

  if (!panelOpen || !panelView) return null;

  const dockClassName = `terranet-workspace-dock terranet-workspace-dock--${panelView}`;
  const bodyClassName = panelView === 'preview'
    ? 'terranet-workspace-dock__body terranet-workspace-dock__body--preview'
    : 'terranet-workspace-dock__body';

  return (
    <>
      <button
        type="button"
        className="terranet-workspace-backdrop"
        aria-label="Close workspace panel"
        onClick={closePanel}
      />
      <aside className={dockClassName}>
      <div className="terranet-workspace-dock__header">
        <div className="terranet-workspace-dock__header-left">
          <div className="terranet-workspace-dock__tabs">
            <button
              type="button"
              className={panelView === 'preview' ? 'active' : ''}
              onClick={() => openPanel('preview')}
              aria-label="Show preview"
            >
              <Eye className="h-4 w-4" />
              Preview
            </button>
            <button
              type="button"
              className={panelView === 'code' ? 'active' : ''}
              onClick={() => openPanel('code')}
              aria-label="Show code"
            >
              <Code className="h-4 w-4" />
              Code
            </button>
          </div>
          <div className="terranet-workspace-dock__history-controls">
            <button
              type="button"
              className="terranet-workspace-dock__history-btn"
              onClick={() => void sendSceneCommand('artifact.previous')}
              disabled={!currentSession?.canPreviousArtifact}
              title="Previous artifact"
              aria-label="Previous artifact"
            >
              <SkipBack className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="terranet-workspace-dock__history-btn"
              onClick={() => void sendSceneCommand('undo')}
              disabled={!currentSession?.canUndo}
              title="Undo"
              aria-label="Undo"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="terranet-workspace-dock__history-btn"
              onClick={() => void sendSceneCommand('redo')}
              disabled={!currentSession?.canRedo}
              title="Redo"
              aria-label="Redo"
            >
              <Redo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="terranet-workspace-dock__history-btn"
              onClick={() => void sendSceneCommand('artifact.next')}
              disabled={!currentSession?.canNextArtifact}
              title="Next artifact"
              aria-label="Next artifact"
            >
              <SkipForward className="h-4 w-4" />
            </button>
          </div>

          <div className="terranet-workspace-dock__version-select-wrap">
            <span className="terranet-workspace-dock__version-label">
              Visual Version
            </span>
            <div className="terranet-workspace-dock__version-select-shell">
              <select
                value={activeVersionId}
                onChange={(event) => {
                  void handleVersionSelect(event.target.value);
                }}
                disabled={versions.length <= 1 || isSending}
                aria-label="Select visual version"
              >
                {versions.map((version) => (
                  <option key={version.versionId} value={version.versionId}>
                    {`v${version.version}${version.artifactVersion ? ` · r${version.artifactVersion}` : ''} · ${version.skill ?? 'scene'}`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <button
          type="button"
          className="terranet-workspace-dock__close"
          onClick={closePanel}
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className={bodyClassName}>
        {panelView === 'preview' ? (
          <div className="terranet-workspace-dock__preview-stack">
            {isMediaScene ? (
              <MediaViewer
                src={currentMediaUrl}
                mediaType={currentMediaType}
                sceneId={currentScene?.sceneId ?? null}
                statusStage={taskProgress?.mediaStage ?? 'idle'}
                statusText={taskProgress?.mediaStatusText ?? null}
              />
            ) : (
              <SceneViewer code={currentCode} skill={currentSkill} />
            )}
          </div>
        ) : (
          <CodeEditor
            code={currentCode}
            skill={currentSkill}
            readOnly={true}
            runPending={isRerunning}
            onRun={(code) => {
              void handleRunScene(code);
            }}
          />
        )}
      </div>

      {versionError && (
        <p className="terranet-workspace-dock__version-error" role="alert">
          {versionError}
        </p>
      )}
      </aside>
    </>
  );
}
