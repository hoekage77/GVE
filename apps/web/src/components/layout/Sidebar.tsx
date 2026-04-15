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

  return (
    <>
      {isMobileViewport && !isCollapsed && !forceExpanded && (
        <button
          type="button"
          className="app-sidebar-backdrop"
          onClick={() => setIsCollapsed(true)}
          aria-label="Close chat sidebar"
        />
      )}

      <aside className={`app-sidebar ${isCollapsed ? 'app-sidebar--collapsed' : 'app-sidebar--expanded'}`}>
        <div className="app-sidebar-header">
          {isCollapsed ? (
            <div className="app-sidebar-mini">
              <button
                type="button"
                className="app-sidebar-mini-profile-btn"
                onClick={() => setIsCollapsed(false)}
                aria-label="Expand sidebar"
                title="Open sidebar"
              >
                <img
                  src="https://i.pravatar.cc/40?img=12"
                  alt="Andrew Smith"
                  className="app-sidebar-mini-profile-photo"
                  loading="lazy"
                />
              </button>

              <p className="app-sidebar-mini-label">Main</p>

              <div className="app-sidebar-mini-top">
                <button
                  type="button"
                  className={`sidebar-mini-button ${activeDestination === 'chat' ? 'sidebar-mini-button--active' : ''}`}
                  onClick={() => navigateTo('chat')}
                  aria-label="Open studio"
                  title="Studio"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  className={`sidebar-mini-button ${activeDestination === 'scenes' ? 'sidebar-mini-button--active' : ''}`}
                  onClick={() => navigateTo('scenes')}
                  aria-label="Open scenes"
                  title="Scenes"
                >
                  <Clapperboard className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  className={`sidebar-mini-button ${activeDestination === 'tasks' ? 'sidebar-mini-button--active' : ''}`}
                  onClick={() => navigateTo('tasks')}
                  aria-label="Open tasks"
                  title="Tasks"
                >
                  <ListTodo className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  className={`sidebar-mini-button ${activeDestination === 'profile' ? 'sidebar-mini-button--active' : ''}`}
                  onClick={() => navigateTo('profile')}
                  aria-label="Open profile"
                  title="Profile"
                >
                  <User className="h-4 w-4" />
                </button>
              </div>

              <div className="app-sidebar-mini-bottom">
                <button
                  type="button"
                  className="sidebar-mini-cta"
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
              <div className="app-sidebar-profile-row">
                <img
                  src="https://i.pravatar.cc/40?img=12"
                  alt="Andrew Smith"
                  className="app-sidebar-profile-photo"
                  loading="lazy"
                />
                <div className="app-sidebar-profile-copy">
                  <span className="app-sidebar-profile-kicker">Product Designer</span>
                  <span className="app-sidebar-profile-name">Andrew Smith</span>
                </div>
                {!forceExpanded && (
                  <button
                    type="button"
                    className="sidebar-collapse-button"
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
            <nav className="app-sidebar-main-nav">
              <p className="app-sidebar-section-label">Workspace</p>

              <button
                type="button"
                className={`sidebar-item ${activeDestination === 'chat' ? 'sidebar-item--active' : ''}`}
                onClick={() => navigateTo('chat')}
              >
                <LayoutGrid className="h-4 w-4" />
                <span className="sidebar-item-label">Studio</span>
              </button>

              <button
                type="button"
                className={`sidebar-item ${activeDestination === 'scenes' ? 'sidebar-item--active' : ''}`}
                onClick={() => navigateTo('scenes')}
              >
                <Clapperboard className="h-4 w-4" />
                <span className="sidebar-item-label">Scenes</span>
              </button>

              <button
                type="button"
                className={`sidebar-item ${activeDestination === 'tasks' ? 'sidebar-item--active' : ''}`}
                onClick={() => navigateTo('tasks')}
              >
                <ListTodo className="h-4 w-4" />
                <span className="sidebar-item-label">Tasks</span>
              </button>

              <button
                type="button"
                className={`sidebar-item ${activeDestination === 'profile' ? 'sidebar-item--active' : ''}`}
                onClick={() => navigateTo('profile')}
              >
                <User className="h-4 w-4" />
                <span className="sidebar-item-label">Profile</span>
              </button>
            </nav>

            <section className="app-sidebar-messages">
              <div className="app-sidebar-messages-header">
                <p className="app-sidebar-section-label">Messages</p>
                <button
                  type="button"
                  className="sidebar-messages-add"
                  onClick={handleCreateSession}
                  aria-label="Create new chat"
                  title={isBootstrapping ? 'Loading...' : 'Create new chat'}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="app-sidebar-messages-list">
                {sessionRows.length === 0 ? (
                  <p className="app-sidebar-messages-empty">No messages yet</p>
                ) : (
                  sessionRows.map((session) => (
                    <button
                      key={session.sessionId}
                      type="button"
                      className={`app-sidebar-message-row ${session.sessionId === activeSessionId ? 'active' : ''}`}
                      onClick={() => {
                        void selectSession(session.sessionId);
                        closeMobileSidebar();
                      }}
                    >
                      <span className="app-sidebar-message-initial" aria-hidden="true">{getSessionInitial(session.title)}</span>
                      <span className="app-sidebar-message-name" title={session.title}>{session.title}</span>
                    </button>
                  ))
                )}
              </div>
            </section>

            <div className="app-sidebar-footer">
              <div className="sidebar-cta-card">
                <p className="sidebar-cta-title">Let&apos;s start!</p>
                <p className="sidebar-cta-copy">Creating or adding new tasks couldn&apos;t be easier</p>
                <button type="button" className="sidebar-cta-button" onClick={handleCreateSession}>
                  <Plus className="h-3.5 w-3.5" />
                  <span>{isBootstrapping ? 'Loading...' : 'Add New Task'}</span>
                </button>
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
