import { createRouter, RootRoute, Route, Outlet } from '@tanstack/react-router';
import { ConditionalClerkProvider, SignedIn, SignedOut } from '../lib/clerk';
import { RequireAuth } from '../components/RequireAuth';
import AuthPage from '../pages/Auth';
import ChatPage from '../pages/Chat';
import ProfilePage from '../pages/Profile';
import ScenesPage from '../pages/Scenes';
import SessionsPage from '../pages/Sessions';
import TasksPage from '../pages/Tasks';
import AnimationTestPage from '../pages/AnimationTest';
import { MainLayout } from '../components/layout/MainLayout';
import { ToastContainer } from '../components/ToastContainer';

const FALLBACK_CLERK_KEY = "pk_test_dGVzdC10ZXJyYW5ldC1jbGVyay5jbGVyay5hY2NvdW50cy5kZXYk";

const rootRoute = new RootRoute({
  component: () => (
    <ConditionalClerkProvider fallbackKey={FALLBACK_CLERK_KEY}>
      <Outlet />
      <ToastContainer />
    </ConditionalClerkProvider>
  ),
});

function ProtectedAppShell({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <MainLayout>{children}</MainLayout>
    </RequireAuth>
  );
}

function AuthEntryShell() {
  return (
    <>
      <SignedIn>
        <RedirectToChat />
      </SignedIn>
      <SignedOut>
        <AuthPage />
      </SignedOut>
    </>
  );
}

const homeRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/',
  component: AuthEntryShell,
});

const authRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/auth',
  component: AuthEntryShell,
});

const chatRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/chat',
  component: () => (
    <ProtectedAppShell>
      <ChatPage />
    </ProtectedAppShell>
  ),
});

const scenesRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/scenes',
  component: () => (
    <ProtectedAppShell>
      <ScenesPage />
    </ProtectedAppShell>
  ),
});

const tasksRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/tasks',
  component: () => (
    <ProtectedAppShell>
      <TasksPage />
    </ProtectedAppShell>
  ),
});

const profileRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/profile',
  component: () => (
    <ProtectedAppShell>
      <ProfilePage />
    </ProtectedAppShell>
  ),
});

const sessionsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/sessions',
  component: () => (
    <ProtectedAppShell>
      <SessionsPage />
    </ProtectedAppShell>
  ),
});

function RedirectToAuth() {
  window.location.href = '/auth';
  return null;
}

function RedirectToChat() {
  window.location.href = '/chat';
  return null;
}

const testRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/test',
  component: AnimationTestPage,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  authRoute,
  chatRoute,
  scenesRoute,
  tasksRoute,
  sessionsRoute,
  profileRoute,
  testRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
