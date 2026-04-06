import { Outlet } from '@tanstack/react-router';
import { useEffect } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import { useChatStore } from '../../stores';

interface MainLayoutProps {
  children?: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const initialize = useChatStore((state) => state.initialize);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  return (
    <div className="app-layout">
      <Header />
      <div className="app-body">
        <Sidebar />
        <main className="app-main">
          {children || <Outlet />}
        </main>
      </div>
    </div>
  );
}
