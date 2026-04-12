import { Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { PanelLeftOpen } from 'lucide-react';
import Sidebar from './Sidebar';
import Header from './Header';
import { useChatStore } from '../../stores';

interface MainLayoutProps {
  children?: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const initialize = useChatStore((state) => state.initialize);
  const [isChatSidebarOpen, setIsChatSidebarOpen] = useState(false);
  const pathname = useRouterState({
    select: (state) => state.location.pathname
  });
  const isChatRoute = pathname.startsWith('/chat');

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (!isChatRoute && isChatSidebarOpen) {
      setIsChatSidebarOpen(false);
    }
  }, [isChatRoute, isChatSidebarOpen]);

  useEffect(() => {
    if (!isChatRoute || !isChatSidebarOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsChatSidebarOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isChatRoute, isChatSidebarOpen]);

  return (
    <div className="app-layout">
      {!isChatRoute && <Header />}
      <div className={`app-body ${isChatRoute ? 'app-body--chat' : ''}`}>
        {!isChatRoute && <Sidebar />}

        {isChatRoute && !isChatSidebarOpen && (
          <button
            type="button"
            className="chat-sidebar-launcher"
            onClick={() => setIsChatSidebarOpen(true)}
            aria-label="Open chat sidebar"
            title="Open sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}

        {isChatRoute && isChatSidebarOpen && (
          <>
            <button
              type="button"
              className="chat-sidebar-overlay"
              onClick={() => setIsChatSidebarOpen(false)}
              aria-label="Close chat sidebar"
            />
            <div className="chat-sidebar-sheet" role="dialog" aria-label="Chat sidebar">
              <Sidebar forceExpanded />
            </div>
          </>
        )}

        <main className="app-main">
          {children || <Outlet />}
        </main>
      </div>
    </div>
  );
}
