import { X, RotateCcw, SkipBack, SkipForward, Redo2, Undo2 } from 'lucide-react';
import SceneViewer from '../SceneViewer';
import CodeEditor from '../CodeEditor';
import MediaViewer from './MediaViewer';
import { useChatStore } from '../../stores';
import { useEffect, useMemo, useState } from 'react';

const PANEL_EXIT_MS = 260;

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
    taskProgressBySession
  } = useChatStore();

  const isPanelVisible = panelOpen && Boolean(panelView);

  const [panelError, setPanelError] = useState<string | null>(null);
  const [isRerunning, setIsRerunning] = useState(false);
  const [isMounted, setIsMounted] = useState(isPanelVisible);
  const [isVisible, setIsVisible] = useState(isPanelVisible);
  const [displayedView, setDisplayedView] = useState<'preview' | 'code' | 'files'>(() => panelView ?? 'preview');

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

  useEffect(() => {
    if (!panelView) {
      return;
    }

    setDisplayedView(panelView);
  }, [panelView]);

  useEffect(() => {
    if (isPanelVisible) {
      setIsMounted(true);
      const enterTimer = setTimeout(() => setIsVisible(true), 16);
      return () => {
        clearTimeout(enterTimer);
      };
    }

    setIsVisible(false);
    const exitTimer = setTimeout(() => setIsMounted(false), PANEL_EXIT_MS);
    return () => {
      clearTimeout(exitTimer);
    };
  }, [isPanelVisible]);

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

  if (!isMounted) {
    return null;
  }

  const activeView = panelView ?? displayedView;

  return (
    <>
      <button
        type="button"
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 ease-out lg:hidden ${isVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        aria-label="Close workspace panel"
        onClick={closePanel}
      />
      <aside className={`fixed inset-y-0 right-0 z-50 h-full w-full border-l border-white/10 bg-[#0a0a0a] shadow-2xl transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none lg:static lg:flex-1 ${isVisible ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-6 opacity-0'} flex flex-col`}>
        
        {/* Scene Workspace */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 flex flex-col overflow-hidden">
            
            {/* Card Header (Tabs + Playback) */}
            <div className="px-4 py-3 shrink-0 flex items-center justify-between border-b border-white/5">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openPanel('preview')}
                  className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${activeView === 'preview' ? 'bg-white/12 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white/90'}`}
                >
                  Preview
                </button>
                <button
                  onClick={() => openPanel('code')}
                  className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${activeView === 'code' ? 'bg-white/12 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white/90'}`}
                >
                  Code
                </button>
              </div>

              <div className="flex items-center gap-1">
                {[
                  { icon: SkipBack, action: 'artifact.previous', disabled: !currentSession?.canPreviousArtifact },
                  { icon: SkipForward, action: 'artifact.next', disabled: !currentSession?.canNextArtifact },
                  { icon: Redo2, action: 'redo', disabled: !currentSession?.canRedo },
                  { icon: Undo2, action: 'undo', disabled: !currentSession?.canUndo },
                  { icon: RotateCcw, action: 'refresh', isRefresh: true }
                ].map((btn, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      if (btn.isRefresh) handleRefreshPreview();
                      else sendSceneCommand(btn.action as any);
                    }}
                    disabled={btn.disabled || (btn.isRefresh && isRerunning)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/5 bg-white/5 text-white/50 transition-all duration-150 hover:border-white/10 hover:bg-white/10 hover:text-white/90 disabled:opacity-30"
                  >
                    <btn.icon className={`w-4 h-4 ${btn.isRefresh && isRerunning ? 'animate-spin' : ''}`} />
                  </button>
                ))}
                <div className="w-px h-6 bg-white/10 mx-1"></div>
                <button onClick={closePanel} className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/5 bg-white/5 text-white/50 transition-all duration-150 hover:border-white/10 hover:bg-white/10 hover:text-white/90">
                  <X className="w-4 h-4" />
                </button>
              </div>

            </div>

            {/* Viewport Area */}
            <div className="flex-1 relative min-h-0 overflow-hidden flex flex-col">
              <div className={`group relative h-full w-full overflow-hidden transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
                
                {activeView === 'preview' ? (
                  <div className="absolute inset-0 z-20">
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
                  <div className="absolute inset-0 z-20 bg-[#111]">
                    <CodeEditor
                      code={currentCode}
                      skill={currentSkill}
                      readOnly={true}
                      runPending={isRerunning}
                      onRun={(code) => { void handleRunScene(code); }}
                    />
                  </div>
                )}


                
              </div>
            </div>
            
            {panelError && (
              <div className="border-t border-red-500/20 bg-red-500/10 p-3 text-[13px] font-medium text-red-400">
                {panelError}
              </div>
            )}
            
          </div>
        </div>

      </aside>
    </>
  );
}
