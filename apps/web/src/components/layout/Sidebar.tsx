import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Plus, MessageSquare, History, ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react';
import { useChatStore, type Session, type SessionMessage } from '../../stores';

interface SidebarProps {
  forceExpanded?: boolean;
}

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

function deriveSessionTitle(session: Session, messages: SessionMessage[]): string {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user' && message.content.trim().length > 0);

  if (latestUserMessage) {
    return latestUserMessage.content;
  }

  if (session.currentScene?.sceneId) {
    return compactSceneName(session.currentScene.sceneId);
  }

  return `Session ${session.sessionId.slice(0, 8)}`;
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

export default function Sidebar({ forceExpanded = false }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(() => (forceExpanded ? false : getInitialCollapsedState()));
  const [isHistoryOpen, setIsHistoryOpen] = useState(true);
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
              className="sidebar-mini-button"
              onClick={() => setIsCollapsed(false)}
              aria-label="Expand sidebar"
              title="Open sidebar"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="sidebar-mini-button sidebar-mini-button--new"
              onClick={handleCreateSession}
              aria-label="Create new chat"
              title={isBootstrapping ? 'Loading...' : 'New chat'}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="app-sidebar-header-row">
            <button type="button" className="new-chat-button" onClick={handleCreateSession}>
              <Plus className="h-4 w-4" />
              <span>{isBootstrapping ? 'Loading...' : 'New Chat'}</span>
            </button>
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
        )}
      </div>

      {!isCollapsed && (
        <>
          <nav className="app-sidebar-nav">
            <div className="nav-section">
              <button
                type="button"
                className="nav-section-header"
                onClick={() => setIsHistoryOpen(!isHistoryOpen)}
              >
                <History className="h-4 w-4" />
                <span>Recent Chats</span>
                <ChevronDown className={`h-3 w-3 ${isHistoryOpen ? 'rotated' : ''}`} />
              </button>

              {isHistoryOpen && (
                <div className="nav-items">
                  {sessionRows.length === 0 ? (
                    <div className="nav-item-empty">
                      <MessageSquare className="h-4 w-4" />
                      <span>No recent chats</span>
                    </div>
                  ) : (
                    sessionRows.map((session) => (
                      <button
                        key={session.sessionId}
                        type="button"
                        className={`nav-item ${session.sessionId === activeSessionId ? 'active' : ''}`}
                        onClick={() => {
                          void selectSession(session.sessionId);
                          closeMobileSidebar();
                        }}
                      >
                        <span className="nav-item-title">{session.title}</span>
                        <span className="nav-item-meta">{session.updatedAt}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </nav>

          <div className="app-sidebar-footer">
            <Link to="/profile" className="sidebar-link">
              Settings
            </Link>
          </div>
        </>
      )}
      </aside>
    </>
  );
}
