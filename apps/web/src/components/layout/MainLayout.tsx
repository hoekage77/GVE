import { Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import { useChatStore } from '../../stores';

interface MainLayoutProps {
  children?: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const initialize = useChatStore((state) => state.initialize);
  const pathname = useRouterState({
    select: (state) => state.location.pathname
  });
  const isChatRoute = pathname.startsWith('/chat');

  useEffect(() => {
    void initialize();
  }, [initialize]);

  return (
    <div className="app-layout">
      <Header />
      <div className={`app-body ${isChatRoute ? 'app-body--chat' : ''}`}>
        <Sidebar />

        <main className="app-main">
          {children || <Outlet />}
        </main>
      </div>
    </div>
  );
}
