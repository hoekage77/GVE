import { Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import Sidebar from './Sidebar';
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

  return (
    <div className="relative z-10 h-[100dvh] w-screen flex flex-col bg-[#06090d] text-white">
      <div className={`app-body ${isWorkspaceRoute ? 'app-body--chat' : ''} flex-1 min-h-0 flex ${isWorkspaceRoute ? 'flex-col xl:flex-row' : ''}`}>
        <Sidebar />

        <main className={`app-main flex-1 flex min-h-0 ${isWorkspaceRoute ? 'flex-col xl:flex-row' : ''}`}>
          {children || <Outlet />}
        </main>
      </div>
    </div>
  );
}
