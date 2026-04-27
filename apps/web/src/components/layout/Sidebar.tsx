import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Clapperboard, LayoutGrid, ListTodo, Plus, User } from 'lucide-react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useChatStore, type Session, type SessionMessage } from '../../stores';

interface SidebarProps {
  forceExpanded?: boolean;
}

type SidebarDestination = 'chat' | 'scenes' | 'tasks' | 'profile';

const SIDEBAR_COLLAPSED_SESSION_KEY = 'terranet.sidebar.collapsed';

function getInitialCollapsedState(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  const stored = window.sessionStorage.getItem(SIDEBAR_COLLAPSED_SESSION_KEY);
  if (stored === null) {
    return true;
  }

  return stored === '1';
}

function compactSceneName(sceneId: string): string {
  const normalized = sceneId.trim();
  if (!normalized) {
    return sceneId;
  }

  if (normalized.length <= 16) {
    return normalized;
  }

  if (normalized.startsWith('scene-')) {
    return `scene-${normalized.slice(-6)}`;
  }

  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
}

function shortenSessionTitle(value: string, maxLength = 88): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'Untitled session';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function deriveSessionTitle(session: Session, messages: SessionMessage[]): string {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user' && message.content.trim().length > 0);

  if (latestUserMessage) {
    return shortenSessionTitle(latestUserMessage.content);
  }

  if (session.currentScene?.sceneId) {
    return compactSceneName(session.currentScene.sceneId);
  }

  return `Session ${session.sessionId.slice(0, 8)}`;
}

function getSessionInitial(title: string): string {
  const normalized = String(title ?? '').trim();
  if (!normalized) {
    return 'S';
  }

  const firstChar = normalized.charAt(0).toUpperCase();
  return /[A-Z0-9]/.test(firstChar) ? firstChar : 'S';
}

function formatUpdatedAt(value: string | undefined): string {
  if (!value) {
    return '';
  }

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return '';
  }

  const deltaMinutes = Math.floor((Date.now() - timestamp) / 60000);
  if (deltaMinutes < 1) {
    return 'Just now';
  }

  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }

  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }

  return new Date(value).toLocaleDateString();
}

function getActiveDestination(pathname: string): SidebarDestination {
  if (pathname.startsWith('/scenes')) {
    return 'scenes';
  }

  if (pathname.startsWith('/tasks')) {
    return 'tasks';
  }

  if (pathname.startsWith('/profile')) {
    return 'profile';
  }

  return 'chat';
}

export default function Sidebar({ forceExpanded = false }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(() => (forceExpanded ? false : getInitialCollapsedState()));
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.innerWidth <= 768;
  });
  const sessions = useChatStore((state) => state.sessions);
  const messages = useChatStore((state) => state.messages);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const isBootstrapping = useChatStore((state) => state.isBootstrapping);
  const startDraftSession = useChatStore((state) => state.startDraftSession);
  const selectSession = useChatStore((state) => state.selectSession);
  const pathname = useRouterState({
    select: (state) => state.location.pathname
  });
  const navigate = useNavigate();

  const sessionRows = useMemo(() => {
    return (sessions || [])
      .filter((session) => Boolean(session?.sessionId))
      .map((session) => {
        const sessionMessages = messages[session.sessionId] ?? [];
        return {
          sessionId: session.sessionId,
          title: deriveSessionTitle(session, sessionMessages),
          updatedAt: formatUpdatedAt(session.updatedAt)
        };
      });
  }, [messages, sessions]);

  const closeMobileSidebar = () => {
    if (isMobileViewport && !forceExpanded) {
      setIsCollapsed(true);
    }
  };

  const activeDestination = getActiveDestination(pathname);

  const navigateTo = (destination: SidebarDestination) => {
    const to = destination === 'chat' ? '/chat' : `/${destination}`;
    void navigate({ to });
    closeMobileSidebar();
  };

  const handleCreateSession = () => {
    startDraftSession();
    closeMobileSidebar();
  };

  useEffect(() => {
    if (forceExpanded) {
      setIsCollapsed(false);
    }
  }, [forceExpanded]);

  useEffect(() => {
    if (typeof window === 'undefined' || forceExpanded) {
      return;
    }

    window.sessionStorage.setItem(SIDEBAR_COLLAPSED_SESSION_KEY, isCollapsed ? '1' : '0');
  }, [forceExpanded, isCollapsed]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleResize = () => {
      setIsMobileViewport(window.innerWidth <= 768);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    if (!isMobileViewport || isCollapsed || forceExpanded) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsCollapsed(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [forceExpanded, isCollapsed, isMobileViewport]);

  const showMobileLauncher = isMobileViewport && isCollapsed && !forceExpanded;

  return (
    <>
      {showMobileLauncher && (
        <button
          type="button"
          className="fixed right-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[100] inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-600/50 bg-slate-800/90 text-slate-200 shadow-lg backdrop-blur transition-colors duration-200 hover:border-slate-400 hover:bg-slate-700 hover:text-white"
          onClick={() => setIsCollapsed(false)}
          aria-label="Open chat sidebar"
          title="Open sidebar"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </button>
      )}

      {isMobileViewport && !isCollapsed && !forceExpanded && (
        <button
          type="button"
          className="fixed inset-0 z-[161] border-none bg-slate-950/45 backdrop-blur-[2px]"
          onClick={() => setIsCollapsed(true)}
          aria-label="Close chat sidebar"
        />
      )}

      {!showMobileLauncher && (
        <aside className={`${isCollapsed ? 'w-[68px]' : 'w-[280px]'} flex min-h-0 flex-col overflow-hidden border-r border-white/5 bg-[#0d0d0d] transition-[width] duration-300 ease-in-out`}>
        <div className="p-4">
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-4">
              <button
                type="button"
                className="group inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] text-white/40 transition-all duration-300 hover:border-white/20 hover:bg-white/[0.05] hover:text-white"
                onClick={() => setIsCollapsed(false)}
                aria-label="Expand sidebar"
                title="Open sidebar"
              >
                <LayoutGrid className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" />
              </button>

              <div className="h-px w-8 bg-white/5" />

              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  className={`relative inline-flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-300 ${activeDestination === 'chat' ? 'bg-sky-500/10 text-sky-400 shadow-[0_0_12px_rgba(14,165,233,0.1)]' : 'text-white/40 hover:bg-white/[0.05] hover:text-white/80'}`}
                  onClick={() => navigateTo('chat')}
                  aria-label="Open studio"
                  title="Studio"
                >
                  <LayoutGrid className="h-5 w-5" />
                  {activeDestination === 'chat' && <div className="absolute -left-4 h-5 w-1 rounded-r-full bg-sky-500" />}
                </button>

                <button
                  type="button"
                  className={`relative inline-flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-300 ${activeDestination === 'scenes' ? 'bg-sky-500/10 text-sky-400 shadow-[0_0_12px_rgba(14,165,233,0.1)]' : 'text-white/40 hover:bg-white/[0.05] hover:text-white/80'}`}
                  onClick={() => navigateTo('scenes')}
                  aria-label="Open scenes"
                  title="Scenes"
                >
                  <Clapperboard className="h-5 w-5" />
                  {activeDestination === 'scenes' && <div className="absolute -left-4 h-5 w-1 rounded-r-full bg-sky-500" />}
                </button>

                <button
                  type="button"
                  className={`relative inline-flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-300 ${activeDestination === 'tasks' ? 'bg-sky-500/10 text-sky-400 shadow-[0_0_12px_rgba(14,165,233,0.1)]' : 'text-white/40 hover:bg-white/[0.05] hover:text-white/80'}`}
                  onClick={() => navigateTo('tasks')}
                  aria-label="Open tasks"
                  title="Tasks"
                >
                  <ListTodo className="h-5 w-5" />
                  {activeDestination === 'tasks' && <div className="absolute -left-4 h-5 w-1 rounded-r-full bg-sky-500" />}
                </button>

                <button
                  type="button"
                  className={`relative inline-flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-300 ${activeDestination === 'profile' ? 'bg-sky-500/10 text-sky-400 shadow-[0_0_12px_rgba(14,165,233,0.1)]' : 'text-white/40 hover:bg-white/[0.05] hover:text-white/80'}`}
                  onClick={() => navigateTo('profile')}
                  aria-label="Open profile"
                  title="Profile"
                >
                  <User className="h-5 w-5" />
                  {activeDestination === 'profile' && <div className="absolute -left-4 h-5 w-1 rounded-r-full bg-sky-500" />}
                </button>
              </div>

              <div className="h-px w-8 bg-white/5" />

              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-sky-500/20 bg-sky-500/5 text-sky-400 transition-all duration-300 hover:bg-sky-500/15"
                onClick={handleCreateSession}
                aria-label="New chat"
                title={isBootstrapping ? 'Loading...' : 'New chat'}
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between px-1">
              <button
                onClick={handleCreateSession}
                className="group flex flex-1 items-center gap-2.5 rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-2 text-sm font-medium text-white/90 transition-all duration-300 hover:border-white/10 hover:bg-white/[0.05]"
              >
                <Plus className="h-4 w-4 text-sky-400 transition-transform duration-300 group-hover:rotate-90" />
                <span>New Chat</span>
              </button>
              {!forceExpanded && (
                <button
                  type="button"
                  className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/5 bg-white/[0.02] text-white/40 transition-all duration-300 hover:border-white/10 hover:bg-white/[0.05] hover:text-white"
                  onClick={() => setIsCollapsed(true)}
                  aria-label="Collapse sidebar"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>

        {!isCollapsed && (
          <>
            <nav className="px-3 py-2">
              <button
                type="button"
                className={`group mb-1 flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-all duration-300 ${activeDestination === 'chat' ? 'border-white/10 bg-white/[0.06] text-white' : 'border-transparent text-white/50 hover:bg-white/[0.04] hover:text-white/80'}`}
                onClick={() => navigateTo('chat')}
              >
                <div className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-all duration-300 ${activeDestination === 'chat' ? 'border-sky-500/30 bg-sky-500/10 text-sky-400' : 'border-white/5 bg-white/[0.02] text-white/40 group-hover:border-white/10 group-hover:text-white/60'}`}>
                  <LayoutGrid className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium">Studio</span>
              </button>

              <button
                type="button"
                className={`group mb-1 flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-all duration-300 ${activeDestination === 'scenes' ? 'border-white/10 bg-white/[0.06] text-white' : 'border-transparent text-white/50 hover:bg-white/[0.04] hover:text-white/80'}`}
                onClick={() => navigateTo('scenes')}
              >
                <div className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-all duration-300 ${activeDestination === 'scenes' ? 'border-sky-500/30 bg-sky-500/10 text-sky-400' : 'border-white/5 bg-white/[0.02] text-white/40 group-hover:border-white/10 group-hover:text-white/60'}`}>
                  <Clapperboard className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium">Scenes</span>
              </button>

              <button
                type="button"
                className={`group mb-1 flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-all duration-300 ${activeDestination === 'tasks' ? 'border-white/10 bg-white/[0.06] text-white' : 'border-transparent text-white/50 hover:bg-white/[0.04] hover:text-white/80'}`}
                onClick={() => navigateTo('tasks')}
              >
                <div className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-all duration-300 ${activeDestination === 'tasks' ? 'border-sky-500/30 bg-sky-500/10 text-sky-400' : 'border-white/5 bg-white/[0.02] text-white/40 group-hover:border-white/10 group-hover:text-white/60'}`}>
                  <ListTodo className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium">Tasks</span>
              </button>

              <button
                type="button"
                className={`group flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-all duration-300 ${activeDestination === 'profile' ? 'border-white/10 bg-white/[0.06] text-white' : 'border-transparent text-white/50 hover:bg-white/[0.04] hover:text-white/80'}`}
                onClick={() => navigateTo('profile')}
              >
                <div className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-all duration-300 ${activeDestination === 'profile' ? 'border-sky-500/30 bg-sky-500/10 text-sky-400' : 'border-white/5 bg-white/[0.02] text-white/40 group-hover:border-white/10 group-hover:text-white/60'}`}>
                  <User className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium">Profile</span>
              </button>
            </nav>

            <section className="flex min-h-0 flex-1 flex-col px-3 pb-3">
              <div className="mb-2 flex items-center justify-between px-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/20">Recents</p>
              </div>

              <div className="scrollbar min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
                {sessionRows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/5 px-3 py-6 text-center">
                    <p className="text-xs text-white/20">No history yet</p>
                  </div>
                ) : (
                  sessionRows.map((session) => (
                    <button
                      key={session.sessionId}
                      type="button"
                      className={`group flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-all duration-300 ${session.sessionId === activeSessionId ? 'border-white/10 bg-white/[0.06] text-white' : 'border-transparent text-white/50 hover:bg-white/[0.04] hover:text-white/80'}`}
                      onClick={() => {
                        void selectSession(session.sessionId);
                        closeMobileSidebar();
                      }}
                    >
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-[10px] font-bold transition-all duration-300 ${session.sessionId === activeSessionId ? 'border-sky-500/30 bg-sky-500/10 text-sky-400' : 'border-white/5 bg-white/[0.02] text-white/30 group-hover:border-white/10 group-hover:text-white/50'}`}>
                        {getSessionInitial(session.title)}
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium" title={session.title}>{session.title}</span>
                        <span className="text-[10px] text-white/20 group-hover:text-white/30">{session.updatedAt}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </section>

            <div className="p-3">
              <button
                type="button"
                className="group flex w-full items-center justify-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5 text-sm font-medium text-white/60 transition-all duration-300 hover:border-white/10 hover:bg-white/[0.05] hover:text-white"
                onClick={handleCreateSession}
              >
                <Plus className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />
                <span>{isBootstrapping ? 'Loading...' : 'New Chat'}</span>
              </button>
            </div>
          </>
        )}
        </aside>
      )}
    </>
  );
}
