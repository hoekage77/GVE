import { Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import Sidebar from './Sidebar';
import { MetaHeader } from './MetaHeader';
import { useChatStore } from '../../stores';

interface MainLayoutProps {
  children?: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const initialize = useChatStore((state) => state.initialize);
  const pathname = useRouterState({
    select: (state) => state.location.pathname
  });
  const isWorkspaceRoute = pathname.startsWith('/chat')
    || pathname.startsWith('/scenes')
    || pathname.startsWith('/tasks');

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const isSidebarCollapsed = useChatStore((state) => state.isSidebarCollapsed);

  return (
    <div className="relative z-10 flex h-[100dvh] w-screen flex-row bg-surface text-meta-text">
      <Sidebar />
      <div className={`flex min-h-0 flex-1 flex-col overflow-hidden transition-[padding] duration-300 ${isWorkspaceRoute ? "relative isolate" : ""}`}>
        <MetaHeader />
        <main className={`flex min-h-0 w-full flex-1 bg-grid ${isWorkspaceRoute ? 'max-w-none flex-col' : ''}`}>
          {children || <Outlet />}
        </main>
      </div>
    </div>
  );
}
