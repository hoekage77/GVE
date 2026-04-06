import { Eye, Code, X, Undo2, Redo2, SkipBack, SkipForward } from 'lucide-react';
import SceneViewer from '../SceneViewer';
import CodeEditor from '../CodeEditor';
import { useChatStore } from '../../stores';
import { useMemo } from 'react';

export default function WorkspacePanel() {
  const {
    sessions,
    activeSessionId,
    panelOpen,
    panelView,
    closePanel,
    openPanel,
    sendSceneCommand,
    sendMessage,
    isSending
  } = useChatStore();

  const currentSession = useMemo(() =>
    sessions.find(s => s.sessionId === activeSessionId),
    [sessions, activeSessionId]
  );

  const currentCode = currentSession?.currentScene?.code ?? null;
  const currentSkill = currentSession?.currentScene?.skill ?? null;

  if (!panelOpen || !panelView) return null;

  return (
    <aside className="terranet-workspace-dock">
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

      <div className="terranet-workspace-dock__body">
        {panelView === 'preview' ? (
          <div className="terranet-workspace-dock__preview-stack">
            <SceneViewer code={currentCode} skill={currentSkill} />
          </div>
        ) : (
          <CodeEditor code={currentCode} skill={currentSkill} readOnly={true} />
        )}
      </div>
    </aside>
  );
}
