import { X, RotateCcw, SkipBack, SkipForward, Redo2, Undo2 } from 'lucide-react';
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
    rerunScene,
    taskProgressBySession,
    isSending
  } = useChatStore();

  const [panelError, setPanelError] = useState<string | null>(null);
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

  const isMediaScene = currentOutputKind === 'media'
    || (typeof currentMediaType === 'string' && currentMediaType.startsWith('video/'))
    || currentSkill === 'manim';

  const handleRefreshPreview = async () => {
    if (isRerunning) {
      return;
    }

    setPanelError(null);
    setIsRerunning(true);

    try {
      const rerunSucceeded = await rerunScene();
      if (!rerunSucceeded) {
        setPanelError('Unable to refresh the selected scene.');
      }
    } finally {
      setIsRerunning(false);
    }
  };

  const handleRunScene = async (code: string) => {
    if (isRerunning) {
      return;
    }

    setPanelError(null);
    setIsRerunning(true);

    try {
      const rerunSucceeded = await rerunScene({ codeOverride: code });
      if (!rerunSucceeded) {
        setPanelError('Unable to rerun the selected scene.');
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
      <div className="terranet-workspace-dock__header terranet-workspace-dock__header--minimal">
        <div className="terranet-workspace-dock__header-left terranet-workspace-dock__header-left--minimal">
          <div className="terranet-workspace-dock__tabs terranet-workspace-dock__tabs--minimal">
            <button
              type="button"
              className={panelView === 'preview' ? 'active' : ''}
              onClick={() => openPanel('preview')}
              aria-label="Show preview"
            >
              Preview
            </button>
            <button
              type="button"
              className={panelView === 'code' ? 'active' : ''}
              onClick={() => openPanel('code')}
              aria-label="Show code"
            >
              Code
            </button>
          </div>
        </div>

        <div className="terranet-workspace-dock__header-right terranet-workspace-dock__header-right--minimal">
          {panelView === 'preview' && (
            <>
              <div className="terranet-workspace-dock__history-controls terranet-workspace-dock__history-controls--minimal">
                <button
                  type="button"
                  className="terranet-workspace-dock__history-btn terranet-workspace-dock__history-btn--minimal"
                  onClick={() => void sendSceneCommand('artifact.previous')}
                  disabled={!currentSession?.canPreviousArtifact}
                  title="Previous artifact"
                  aria-label="Previous artifact"
                >
                  <SkipBack className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="terranet-workspace-dock__history-btn terranet-workspace-dock__history-btn--minimal"
                  onClick={() => void sendSceneCommand('artifact.next')}
                  disabled={!currentSession?.canNextArtifact}
                  title="Next artifact"
                  aria-label="Next artifact"
                >
                  <SkipForward className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="terranet-workspace-dock__history-btn terranet-workspace-dock__history-btn--minimal"
                  onClick={() => void sendSceneCommand('redo')}
                  disabled={!currentSession?.canRedo}
                  title="Redo"
                  aria-label="Redo"
                >
                  <Redo2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="terranet-workspace-dock__history-btn terranet-workspace-dock__history-btn--minimal"
                  onClick={() => void sendSceneCommand('undo')}
                  disabled={!currentSession?.canUndo}
                  title="Undo"
                  aria-label="Undo"
                >
                  <Undo2 className="h-4 w-4" />
                </button>
              </div>

              <button
                type="button"
                className="terranet-workspace-dock__icon-action"
                onClick={() => {
                  void handleRefreshPreview();
                }}
                disabled={isSending || isRerunning}
                title="Refresh preview"
                aria-label="Refresh preview"
              >
                <RotateCcw className={`h-4 w-4 ${isRerunning ? 'is-spinning' : ''}`} />
              </button>
            </>
          )}

          <button
            type="button"
            className="terranet-workspace-dock__close terranet-workspace-dock__close--minimal"
            onClick={closePanel}
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className={bodyClassName}>
        {panelView === 'preview' ? (
          <div className="terranet-workspace-dock__preview-stack">
            <div className="terranet-workspace-dock__presentation-surface">
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

      {panelError && (
        <p className="terranet-workspace-dock__version-error" role="alert">
          {panelError}
        </p>
      )}
      </aside>
    </>
  );
}
