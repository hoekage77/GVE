import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Clapperboard, LayoutGrid, ListTodo, Menu, Plus, User } from 'lucide-react';
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
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchDeltaX, setTouchDeltaX] = useState(0);
  const sidebarRef = useRef<HTMLElement>(null);

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

  const closeMobileSidebar = useCallback(() => {
    if (isMobileViewport && !forceExpanded) {
      setIsCollapsed(true);
    }
  }, [isMobileViewport, forceExpanded]);

  const activeDestination = getActiveDestination(pathname);

  const navigateTo = useCallback((destination: SidebarDestination) => {
    const to = destination === 'chat' ? '/chat' : `/${destination}`;
    void navigate({ to });
    closeMobileSidebar();
  }, [navigate, closeMobileSidebar]);

  const handleCreateSession = useCallback(() => {
    startDraftSession();
    closeMobileSidebar();
  }, [startDraftSession, closeMobileSidebar]);

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

  // Swipe-to-dismiss gesture handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
    setTouchDeltaX(0);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const delta = e.touches[0].clientX - touchStartX;
    if (delta > 0) {
      setTouchDeltaX(delta);
    }
  }, [touchStartX]);

  const handleTouchEnd = useCallback(() => {
    if (touchDeltaX > 80) {
      setIsCollapsed(true);
    }
    setTouchStartX(null);
    setTouchDeltaX(0);
  }, [touchDeltaX]);

  const showMobileLauncher = isMobileViewport && isCollapsed && !forceExpanded;
  const isMobileOpen = isMobileViewport && !isCollapsed && !forceExpanded;

  const sidebarTranslateX = isMobileOpen ? Math.min(touchDeltaX, 280) : 0;

  return (
    <>
      {showMobileLauncher && (
        <button
          type="button"
          className="fixed left-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[100] flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/40 text-white/70 backdrop-blur-md transition-colors active:bg-black/60 active:text-white"
          onClick={() => setIsCollapsed(false)}
          aria-label="Open sidebar"
        >
          <Menu className="h-[18px] w-[18px]" />
        </button>
      )}

      {/* iOS-style backdrop: dark + heavy blur */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-[160] bg-black/50 backdrop-blur-xl"
          style={{
            opacity: 1 - (touchDeltaX / 280),
            transition: touchStartX !== null ? 'none' : 'opacity 0.35s cubic-bezier(0.32, 0.72, 0, 1)',
          }}
          onClick={() => setIsCollapsed(true)}
        />
      )}

      {/* Mobile sidebar panel: iOS slide-over */}
      {isMobileOpen && (
        <aside
          ref={sidebarRef}
          className="fixed inset-y-0 left-0 z-[161] flex w-[280px] flex-col overflow-hidden bg-[#1c1c1e]/80 backdrop-blur-2xl"
          style={{
            transform: `translateX(${sidebarTranslateX}px)`,
            transition: touchStartX !== null ? 'none' : 'transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)',
            borderTopRightRadius: '12px',
            borderBottomRightRadius: '12px',
            boxShadow: '4px 0 24px rgba(0,0,0,0.4)',
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <MobileSidebarContent
            activeDestination={activeDestination}
            navigateTo={navigateTo}
            handleCreateSession={handleCreateSession}
            sessionRows={sessionRows}
            activeSessionId={activeSessionId}
            selectSession={selectSession}
            closeMobileSidebar={closeMobileSidebar}
            isBootstrapping={isBootstrapping}
          />
        </aside>
      )}

      {/* Desktop sidebar */}
      {!showMobileLauncher && !isMobileOpen && (
        <aside className={`${isCollapsed ? 'w-[68px]' : 'w-[280px]'} flex min-h-0 flex-col overflow-hidden border-r border-white/5 bg-surface-2 transition-[width] duration-300 ease-in-out`}>
          <DesktopSidebarContent
            isCollapsed={isCollapsed}
            activeDestination={activeDestination}
            navigateTo={navigateTo}
            handleCreateSession={handleCreateSession}
            setIsCollapsed={setIsCollapsed}
            forceExpanded={forceExpanded}
            sessionRows={sessionRows}
            activeSessionId={activeSessionId}
            selectSession={selectSession}
            closeMobileSidebar={closeMobileSidebar}
            isBootstrapping={isBootstrapping}
          />
        </aside>
      )}
    </>
  );
}

interface MobileSidebarContentProps {
  activeDestination: SidebarDestination;
  navigateTo: (d: SidebarDestination) => void;
  handleCreateSession: () => void;
  sessionRows: { sessionId: string; title: string; updatedAt: string }[];
  activeSessionId: string | null;
  selectSession: (id: string) => void;
  closeMobileSidebar: () => void;
  isBootstrapping: boolean;
}

function MobileSidebarContent({
  activeDestination,
  navigateTo,
  handleCreateSession,
  sessionRows,
  activeSessionId,
  selectSession,
  closeMobileSidebar,
  isBootstrapping,
}: MobileSidebarContentProps) {
  const destinations: { id: SidebarDestination; label: string; Icon: typeof Menu }[] = [
    { id: 'chat', label: 'Studio', Icon: LayoutGrid },
    { id: 'scenes', label: 'Scenes', Icon: Clapperboard },
    { id: 'tasks', label: 'Tasks', Icon: ListTodo },
    { id: 'profile', label: 'Profile', Icon: User },
  ];

  return (
    <>
      {/* Header with grab handle */}
      <div className="flex flex-col items-center px-4 pt-3 pb-1">
        <div className="mb-2 h-[4px] w-[36px] rounded-full bg-white/20" />
        <div className="flex w-full items-center justify-between">
          <span className="text-[13px] font-semibold text-white/90">Navigate</span>
          <button
            type="button"
            className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-blue-400 transition-colors active:bg-white/10"
            onClick={handleCreateSession}
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
        </div>
      </div>

      {/* Navigation list */}
      <div className="mx-3 mt-1 overflow-hidden rounded-[10px] bg-white/[0.07]">
        {destinations.map(({ id, label, Icon }) => {
          const isActive = activeDestination === id;
          return (
            <button
              key={id}
              type="button"
              className={`flex w-full items-center gap-3 px-3 py-[10px] text-left transition-colors active:bg-white/[0.08] ${
                isActive ? 'bg-blue-500/20' : ''
              } ${id !== 'chat' ? 'border-t border-white/[0.06]' : ''}`}
              onClick={() => navigateTo(id)}
            >
              <Icon className={`h-[18px] w-[18px] ${isActive ? 'text-blue-400' : 'text-white/50'}`} />
              <span className={`text-[14px] font-medium ${isActive ? 'text-white' : 'text-white/70'}`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Recents section */}
      <div className="flex min-h-0 flex-1 flex-col px-3 pt-4 pb-2">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/40">Recents</span>
        </div>

        <div className="scrollbar min-h-0 flex-1 space-y-[2px] overflow-y-auto">
          {sessionRows.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-[13px] text-white/30">No recent sessions</p>
            </div>
          ) : (
            sessionRows.map((session) => {
              const isActive = session.sessionId === activeSessionId;
              return (
                <button
                  key={session.sessionId}
                  type="button"
                  ref={isActive ? (el) => {
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                  } : undefined}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-[9px] text-left transition-colors active:bg-white/[0.08] ${
                    isActive
                      ? 'bg-blue-500/15'
                      : 'hover:bg-white/[0.04]'
                  }`}
                  onClick={() => {
                    void selectSession(session.sessionId);
                    closeMobileSidebar();
                  }}
                >
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold ${
                    isActive
                      ? 'bg-blue-500/25 text-blue-400'
                      : 'bg-white/[0.07] text-white/50'
                  }`}>
                    {getSessionInitial(session.title)}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className={`truncate text-[13px] font-medium leading-tight ${isActive ? 'text-white' : 'text-white/75'}`}>
                      {session.title}
                    </span>
                    <span className="text-[11px] leading-tight text-white/30">
                      {session.updatedAt}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="px-3 pb-[env(safe-area-inset-bottom,8px)] pt-1">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500/20 px-3 py-[10px] text-[14px] font-semibold text-blue-400 transition-colors active:bg-blue-500/30"
          onClick={handleCreateSession}
        >
          <Plus className="h-4 w-4" />
          <span>{isBootstrapping ? 'Loading...' : 'New Chat'}</span>
        </button>
      </div>
    </>
  );
}

interface DesktopSidebarContentProps {
  isCollapsed: boolean;
  activeDestination: SidebarDestination;
  navigateTo: (d: SidebarDestination) => void;
  handleCreateSession: () => void;
  setIsCollapsed: (v: boolean) => void;
  forceExpanded: boolean;
  sessionRows: { sessionId: string; title: string; updatedAt: string }[];
  activeSessionId: string | null;
  selectSession: (id: string) => void;
  closeMobileSidebar: () => void;
  isBootstrapping: boolean;
}

function DesktopSidebarContent({
  isCollapsed,
  activeDestination,
  navigateTo,
  handleCreateSession,
  setIsCollapsed,
  forceExpanded,
  sessionRows,
  activeSessionId,
  selectSession,
  closeMobileSidebar,
  isBootstrapping,
}: DesktopSidebarContentProps) {
  if (isCollapsed) {
    return (
      <div className="flex flex-col items-center gap-4 p-4">
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-3 text-meta-muted transition-colors hover:bg-surface hover:text-meta-text"
          onClick={() => setIsCollapsed(false)}
          aria-label="Open sidebar"
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="h-px w-8 bg-white/5" />

        <div className="flex flex-col gap-3">
          <button
            type="button"
            className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${activeDestination === 'scenes' ? 'bg-surface text-meta-text' : 'text-meta-muted hover:bg-surface hover:text-meta-text'}`}
            onClick={() => navigateTo('scenes')}
            aria-label="Scenes"
          >
            <Clapperboard className="h-4 w-4" />
          </button>

          <button
            type="button"
            className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${activeDestination === 'chat' ? 'bg-surface text-meta-text' : 'text-meta-muted hover:bg-surface hover:text-meta-text'}`}
            onClick={() => navigateTo('chat')}
            aria-label="Studio"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>

          <button
            type="button"
            className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${activeDestination === 'tasks' ? 'bg-surface text-meta-text' : 'text-meta-muted hover:bg-surface hover:text-meta-text'}`}
            onClick={() => navigateTo('tasks')}
            aria-label="Tasks"
          >
            <ListTodo className="h-4 w-4" />
          </button>

          <button
            type="button"
            className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${activeDestination === 'profile' ? 'bg-surface text-meta-text' : 'text-meta-muted hover:bg-surface hover:text-meta-text'}`}
            onClick={() => navigateTo('profile')}
            aria-label="Profile"
          >
            <User className="h-4 w-4" />
          </button>
        </div>

        <div className="h-px w-8 bg-white/5" />

        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-3 text-meta-muted transition-colors hover:bg-surface hover:text-meta-text"
          onClick={handleCreateSession}
          aria-label="New chat"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={handleCreateSession}
          className="flex flex-1 items-center gap-2 rounded-md bg-surface-3 px-3 py-2 text-sm font-medium text-meta-text transition-colors hover:bg-surface"
        >
          <Plus className="h-4 w-4 text-meta-muted" />
          <span>New Chat</span>
        </button>
        {!forceExpanded && (
          <button
            type="button"
            className="ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-3 text-meta-muted transition-colors hover:bg-surface hover:text-meta-text"
            onClick={() => setIsCollapsed(true)}
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      <nav className="px-3 py-2">
        <button
          type="button"
          className={`group mb-1 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors ${activeDestination === 'scenes' ? 'bg-surface text-meta-text' : 'text-meta-muted hover:bg-surface hover:text-meta-text'}`}
          onClick={() => navigateTo('scenes')}
        >
          <div className={`flex h-7 w-7 items-center justify-center rounded-md bg-surface-3 text-meta-muted transition-colors ${activeDestination === 'scenes' ? 'bg-surface text-meta-text' : ''}`}>
            <Clapperboard className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium">Scenes</span>
        </button>

        <button
          type="button"
          className={`group mb-1 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors ${activeDestination === 'chat' ? 'bg-surface text-meta-text' : 'text-meta-muted hover:bg-surface hover:text-meta-text'}`}
          onClick={() => navigateTo('chat')}
        >
          <div className={`flex h-7 w-7 items-center justify-center rounded-md bg-surface-3 text-meta-muted transition-colors ${activeDestination === 'chat' ? 'bg-surface text-meta-text' : ''}`}>
            <LayoutGrid className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium">Studio</span>
        </button>

        <button
          type="button"
          className={`group mb-1 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors ${activeDestination === 'tasks' ? 'bg-surface text-meta-text' : 'text-meta-muted hover:bg-surface hover:text-meta-text'}`}
          onClick={() => navigateTo('tasks')}
        >
          <div className={`flex h-7 w-7 items-center justify-center rounded-md bg-surface-3 text-meta-muted transition-colors ${activeDestination === 'tasks' ? 'bg-surface text-meta-text' : ''}`}>
            <ListTodo className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium">Tasks</span>
        </button>

        <button
          type="button"
          className={`group flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors ${activeDestination === 'profile' ? 'bg-surface text-meta-text' : 'text-meta-muted hover:bg-surface hover:text-meta-text'}`}
          onClick={() => navigateTo('profile')}
        >
          <div className={`flex h-7 w-7 items-center justify-center rounded-md bg-surface-3 text-meta-muted transition-colors ${activeDestination === 'profile' ? 'bg-surface text-meta-text' : ''}`}>
            <User className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium">Profile</span>
        </button>
      </nav>

      <section className="flex min-h-0 flex-1 flex-col px-3 pb-3">
        <div className="mb-2 flex items-center justify-between px-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-meta-muted">Recents</p>
        </div>

        <div className="scrollbar min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
          {sessionRows.length === 0 ? (
            <div className="rounded-md border border-dashed border-white/5 px-3 py-6 text-center">
              <p className="text-xs text-meta-muted">No history yet</p>
            </div>
          ) : (
            sessionRows.map((session) => {
              const isActive = session.sessionId === activeSessionId;
              return (
                <button
                  key={session.sessionId}
                  type="button"
                  ref={isActive ? (el) => {
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                  } : undefined}
                  className={`group relative flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-all duration-200 ${
                    isActive
                      ? 'bg-white/[0.06] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
                      : 'text-meta-muted hover:bg-white/[0.04] hover:text-white/80'
                  }`}
                  onClick={() => {
                    void selectSession(session.sessionId);
                    closeMobileSidebar();
                  }}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-meta-accent shadow-[0_0_8px_rgba(255,106,61,0.6)]" />
                  )}

                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold transition-colors ${
                    isActive
                      ? 'bg-meta-accent/15 text-meta-accent'
                      : 'bg-surface-3 text-meta-muted group-hover:bg-white/[0.06] group-hover:text-white/70'
                  }`}>
                    {getSessionInitial(session.title)}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className={`truncate text-sm font-medium ${isActive ? 'text-white' : ''}`} title={session.title}>
                      {session.title}
                    </span>
                    <span className={`text-[10px] ${isActive ? 'text-white/40' : 'text-meta-muted'}`}>
                      {session.updatedAt}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      <div className="p-3">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-md bg-surface-3 px-3 py-2.5 text-sm font-medium text-meta-text transition-colors hover:bg-surface"
          onClick={handleCreateSession}
        >
          <Plus className="h-4 w-4" />
          <span>{isBootstrapping ? 'Loading...' : 'New Chat'}</span>
        </button>
      </div>
    </>
  );
}
