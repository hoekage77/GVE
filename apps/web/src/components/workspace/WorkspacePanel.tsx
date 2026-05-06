import { X, RotateCcw, SkipBack, SkipForward, Redo2, Undo2, FolderGit2, GitBranch } from 'lucide-react';
import SceneViewer from '../SceneViewer';
import CodeEditor from '../CodeEditor';
import MediaViewer from './MediaViewer';
import WorkspaceFileTree from './WorkspaceFileTree';
import WorkspaceFileViewer from './WorkspaceFileViewer';
import DiffViewer from './DiffViewer';
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
    taskProgressBySession,
    workspaceRecord
  } = useChatStore();

  const isPanelVisible = panelOpen && Boolean(panelView);

  const [panelError, setPanelError] = useState<string | null>(null);
  const [isRerunning, setIsRerunning] = useState(false);
  const [isMounted, setIsMounted] = useState(isPanelVisible);
  const [isVisible, setIsVisible] = useState(isPanelVisible);
  const [displayedView, setDisplayedView] = useState<'preview' | 'code' | 'files' | 'workspace' | 'diff'>(() => panelView ?? 'preview');

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

  // Multi-skill composite workspace
  const workspaceFiles = workspaceRecord?.files ?? null;
  const hasMultiSkillWorkspace = workspaceFiles && Object.keys(workspaceFiles).length > 1;
  const compositeFiles = hasMultiSkillWorkspace
    ? Object.fromEntries(Object.entries(workspaceFiles).map(([path, entry]) => [path, entry.content]))
    : undefined;
  const compositeFileSkills = hasMultiSkillWorkspace
    ? Object.fromEntries(Object.entries(workspaceFiles).map(([path, entry]) => [path, entry.skill]))
    : undefined;

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
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ease-out ${isVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        aria-label="Close workspace panel"
        onClick={closePanel}
      />
      <aside className={`fixed inset-y-0 right-0 z-50 h-full w-full min-h-0 min-w-0 border-l border-white/10 bg-[#0a0a0a] shadow-2xl transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none lg:w-[52vw] xl:w-[46vw] 2xl:w-[40vw] ${isVisible ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-6 opacity-0'} flex flex-col`}>
        
        {/* Scene Workspace */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 flex flex-col overflow-hidden">
            
            {/* Card Header (Tabs + Playback) */}
            <div className="px-2.5 py-2 shrink-0 flex items-center justify-between gap-1 border-b border-white/5 flex-wrap">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => openPanel('preview')}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition whitespace-nowrap ${activeView === 'preview' ? 'bg-white/12 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white/90'}`}
                >
                  Preview
                </button>
                <button
                  onClick={() => openPanel('code')}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition whitespace-nowrap ${activeView === 'code' ? 'bg-white/12 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white/90'}`}
                >
                  Code
                </button>
                <button
                  onClick={() => openPanel('workspace')}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition whitespace-nowrap ${activeView === 'workspace' ? 'bg-white/12 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white/90'}`}
                >
                  <FolderGit2 className="inline h-3 w-3 mr-0.5" />
                  Files
                </button>
                <button
                  onClick={() => openPanel('diff')}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition whitespace-nowrap ${activeView === 'diff' ? 'bg-white/12 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white/90'}`}
                >
                  <GitBranch className="inline h-3 w-3 mr-0.5" />
                  Diff
                </button>
              </div>

              <div className="flex items-center gap-0.5 shrink-0">
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
                    className="flex h-6 w-6 items-center justify-center rounded-md border border-white/5 bg-white/5 text-white/50 transition-all duration-150 hover:border-white/10 hover:bg-white/10 hover:text-white/90 disabled:opacity-30 flex-shrink-0"
                  >
                    <btn.icon className={`w-3 h-3 ${btn.isRefresh && isRerunning ? 'animate-spin' : ''}`} />
                  </button>
                ))}
                <button onClick={closePanel} className="flex h-6 w-6 items-center justify-center rounded-md border border-white/5 bg-white/5 text-white/50 transition-all duration-150 hover:border-white/10 hover:bg-white/10 hover:text-white/90 flex-shrink-0 ml-0.5" title="Close panel">
                  <X className="w-3 h-3" />
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
                      <SceneViewer
                        code={currentCode}
                        skill={currentSkill}
                        files={compositeFiles}
                        fileSkills={compositeFileSkills}
                      />
                    )}
                  </div>
                ) : activeView === 'code' ? (
                  <div className="absolute inset-0 z-20 bg-[#111]">
                    <CodeEditor
                      code={currentCode}
                      skill={currentSkill}
                      readOnly={true}
                      runPending={isRerunning}
                      onRun={(code) => { void handleRunScene(code); }}
                    />
                  </div>
                ) : activeView === 'workspace' ? (
                  <div className="absolute inset-0 z-20 flex">
                    <div className="w-[220px] shrink-0 border-r border-white/5 overflow-hidden">
                      <WorkspaceFileTree />
                    </div>
                    <div className="min-h-0 flex-1 overflow-hidden bg-[#111]">
                      <WorkspaceFileViewer />
                    </div>
                  </div>
                ) : (
                  <div className="absolute inset-0 z-20">
                    <DiffViewer />
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
