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
    return sessions.map((session) => {
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
          className="fixed left-2.5 top-[calc(env(safe-area-inset-top)+0.62rem)] z-[160] inline-flex h-8.5 w-8.5 items-center justify-center rounded-[0.62rem] border border-[#dbe3ef] bg-white/90 text-slate-600 shadow-[0_10px_22px_-16px_rgba(15,23,42,0.55)] backdrop-blur transition-colors duration-200 hover:border-slate-300 hover:bg-white hover:text-slate-700"
          onClick={() => setIsCollapsed(false)}
          aria-label="Open chat sidebar"
          title="Open sidebar"
        >
          <LayoutGrid className="h-4 w-4" />
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
        <aside className={`${isCollapsed ? 'w-[72px]' : 'w-[260px]'} flex min-h-0 flex-col overflow-hidden border-r border-[#1a1a1a] bg-[#0a0a0a] transition-[width] duration-200`}>
        <div className="border-b border-[#1a1a1a] p-4">
          {isCollapsed ? (
            <div className="grid justify-items-center gap-2">
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#161616]"
                onClick={() => setIsCollapsed(false)}
                aria-label="Expand sidebar"
                title="Open sidebar"
              >
                <img
                  src="https://i.pravatar.cc/40?img=12"
                  alt="Andrew Smith"
                  className="h-10 w-10 object-cover"
                  loading="lazy"
                />
              </button>

              <p className="text-[10px] uppercase tracking-[0.12em] text-white/45">Main</p>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-[0.6rem] border transition-all duration-200 ${activeDestination === 'chat' ? 'border-sky-400/60 bg-sky-400/15 text-sky-200' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#808080] hover:border-[#333333] hover:bg-[#222222] hover:text-[#a0a0a0]'}`}
                  onClick={() => navigateTo('chat')}
                  aria-label="Open studio"
                  title="Studio"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-[0.6rem] border transition-all duration-200 ${activeDestination === 'scenes' ? 'border-sky-400/60 bg-sky-400/15 text-sky-200' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#808080] hover:border-[#333333] hover:bg-[#222222] hover:text-[#a0a0a0]'}`}
                  onClick={() => navigateTo('scenes')}
                  aria-label="Open scenes"
                  title="Scenes"
                >
                  <Clapperboard className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-[0.6rem] border transition-all duration-200 ${activeDestination === 'tasks' ? 'border-sky-400/60 bg-sky-400/15 text-sky-200' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#808080] hover:border-[#333333] hover:bg-[#222222] hover:text-[#a0a0a0]'}`}
                  onClick={() => navigateTo('tasks')}
                  aria-label="Open tasks"
                  title="Tasks"
                >
                  <ListTodo className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-[0.6rem] border transition-all duration-200 ${activeDestination === 'profile' ? 'border-sky-400/60 bg-sky-400/15 text-sky-200' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#808080] hover:border-[#333333] hover:bg-[#222222] hover:text-[#a0a0a0]'}`}
                  onClick={() => navigateTo('profile')}
                  aria-label="Open profile"
                  title="Profile"
                >
                  <User className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-1">
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[0.6rem] border border-sky-400/60 bg-sky-400/15 text-sky-200 transition-colors duration-200 hover:bg-sky-400/25"
                  onClick={handleCreateSession}
                  aria-label="Add new task"
                  title={isBootstrapping ? 'Loading...' : 'Add new task'}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5">
                <img
                  src="https://i.pravatar.cc/40?img=12"
                  alt="Andrew Smith"
                  className="h-10 w-10 rounded-xl object-cover"
                  loading="lazy"
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[10px] uppercase tracking-[0.12em] text-white/40">Product Designer</span>
                  <span className="truncate text-sm font-semibold text-white/90">Andrew Smith</span>
                </div>
                {!forceExpanded && (
                  <button
                    type="button"
                    className="inline-flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-[0.55rem] border border-[#2a2a2a] bg-[#1a1a1a] text-[#808080] transition-all duration-200 hover:border-[#333333] hover:bg-[#222222] hover:text-[#a0a0a0]"
                    onClick={() => setIsCollapsed(true)}
                    aria-label="Collapse sidebar"
                    title="Collapse sidebar"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {!isCollapsed && (
          <>
            <nav className="px-3 py-3">
              <p className="px-2 pb-2 text-[10px] uppercase tracking-[0.12em] text-white/45">Workspace</p>

              <button
                type="button"
                className={`mb-1 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-all duration-200 ${activeDestination === 'chat' ? 'border-sky-400/60 bg-sky-400/15 text-sky-100' : 'border-transparent text-white/65 hover:border-white/10 hover:bg-white/[0.04] hover:text-white/90'}`}
                onClick={() => navigateTo('chat')}
              >
                <LayoutGrid className="h-4 w-4" />
                <span>Studio</span>
              </button>

              <button
                type="button"
                className={`mb-1 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-all duration-200 ${activeDestination === 'scenes' ? 'border-sky-400/60 bg-sky-400/15 text-sky-100' : 'border-transparent text-white/65 hover:border-white/10 hover:bg-white/[0.04] hover:text-white/90'}`}
                onClick={() => navigateTo('scenes')}
              >
                <Clapperboard className="h-4 w-4" />
                <span>Scenes</span>
              </button>

              <button
                type="button"
                className={`mb-1 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-all duration-200 ${activeDestination === 'tasks' ? 'border-sky-400/60 bg-sky-400/15 text-sky-100' : 'border-transparent text-white/65 hover:border-white/10 hover:bg-white/[0.04] hover:text-white/90'}`}
                onClick={() => navigateTo('tasks')}
              >
                <ListTodo className="h-4 w-4" />
                <span>Tasks</span>
              </button>

              <button
                type="button"
                className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-all duration-200 ${activeDestination === 'profile' ? 'border-sky-400/60 bg-sky-400/15 text-sky-100' : 'border-transparent text-white/65 hover:border-white/10 hover:bg-white/[0.04] hover:text-white/90'}`}
                onClick={() => navigateTo('profile')}
              >
                <User className="h-4 w-4" />
                <span>Profile</span>
              </button>
            </nav>

            <section className="flex min-h-0 flex-1 flex-col px-3 pb-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/45">Messages</p>
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-white/65 transition-all duration-200 hover:bg-white/[0.08] hover:text-white"
                  onClick={handleCreateSession}
                  aria-label="Create new chat"
                  title={isBootstrapping ? 'Loading...' : 'Create new chat'}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                {sessionRows.length === 0 ? (
                  <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-white/45">No messages yet</p>
                ) : (
                  sessionRows.map((session) => (
                    <button
                      key={session.sessionId}
                      type="button"
                      className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all duration-200 ${session.sessionId === activeSessionId ? 'border-sky-400/45 bg-sky-400/12 text-sky-100' : 'border-transparent text-white/70 hover:border-white/10 hover:bg-white/[0.04] hover:text-white'}`}
                      onClick={() => {
                        void selectSession(session.sessionId);
                        closeMobileSidebar();
                      }}
                    >
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/[0.05] text-[11px] font-semibold" aria-hidden="true">{getSessionInitial(session.title)}</span>
                      <span className="truncate text-sm" title={session.title}>{session.title}</span>
                    </button>
                  ))
                )}
              </div>
            </section>

            <div className="border-t border-white/[0.08] p-3">
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                <p className="text-sm font-semibold text-white/95">Let&apos;s start!</p>
                <p className="mt-1 text-xs leading-5 text-white/55">Creating or adding new tasks couldn&apos;t be easier</p>
                <button type="button" className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-sky-400/45 bg-sky-400/15 px-3 py-2 text-sm font-medium text-sky-100 transition-all duration-200 hover:bg-sky-400/25" onClick={handleCreateSession}>
                  <Plus className="h-3.5 w-3.5" />
                  <span>{isBootstrapping ? 'Loading...' : 'Add New Task'}</span>
                </button>
              </div>
            </div>
          </>
        )}
        </aside>
      )}
    </>
  );
}
