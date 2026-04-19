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
      <div className={`flex min-h-0 flex-1 overflow-hidden ${isWorkspaceRoute ? 'relative isolate flex-row' : ''}`}>
        <Sidebar />

        <main className={`flex min-h-0 flex-1 ${isWorkspaceRoute ? 'max-w-none bg-[radial-gradient(120%_100%_at_0%_0%,rgba(56,189,248,0.12)_0%,rgba(56,189,248,0)_45%),radial-gradient(90%_70%_at_100%_0%,rgba(236,72,153,0.08)_0%,rgba(236,72,153,0)_42%),#06090d] flex-col lg:flex-row' : ''}`}>
          {children || <Outlet />}
        </main>
      </div>
    </div>
  );
}
