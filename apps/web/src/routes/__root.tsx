import { createRouter, RootRoute, Route, Outlet } from '@tanstack/react-router';
import { ClerkProvider, SignedIn, SignedOut } from '@clerk/clerk-react';
import AuthPage from '../pages/Auth';
import ChatPage from '../pages/Chat';
import ProfilePage from '../pages/Profile';
import ScenesPage from '../pages/Scenes';
import TasksPage from '../pages/Tasks';
import { MainLayout } from '../components/layout/MainLayout';
import { ToastContainer } from '../components/ToastContainer';

// Test Clerk key - replace with production key in deployment
const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_dGVzdC10ZXJyYW5ldC1jbGVyay5jbGVyay5hY2NvdW50cy5kZXYk';

// Root route with providers
const rootRoute = new RootRoute({
  component: () => (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <Outlet />
      <ToastContainer />
    </ClerkProvider>
  ),
});

function ProtectedAppShell() {
  return (
    <>
      <SignedIn>
        <MainLayout>
          <ChatPage />
        </MainLayout>
      </SignedIn>
      <SignedOut>
        <RedirectToAuth />
      </SignedOut>
    </>
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

// App home (auth entry)
const homeRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/',
  component: AuthEntryShell,
});

// Auth page (public)
const authRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/auth',
  component: AuthEntryShell,
});

// Chat page (protected)
const chatRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/chat',
  component: ProtectedAppShell,
});

// Scenes page (protected)
const scenesRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/scenes',
  component: () => (
    <>
      <SignedIn>
        <MainLayout>
          <ScenesPage />
        </MainLayout>
      </SignedIn>
      <SignedOut>
        <RedirectToAuth />
      </SignedOut>
    </>
  ),
});

// Tasks page (protected)
const tasksRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/tasks',
  component: () => (
    <>
      <SignedIn>
        <MainLayout>
          <TasksPage />
        </MainLayout>
      </SignedIn>
      <SignedOut>
        <RedirectToAuth />
      </SignedOut>
    </>
  ),
});

// Profile page (protected)
const profileRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/profile',
  component: () => (
    <>
      <SignedIn>
        <MainLayout>
          <ProfilePage />
        </MainLayout>
      </SignedIn>
      <SignedOut>
        <RedirectToAuth />
      </SignedOut>
    </>
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

// Create the route tree
const routeTree = rootRoute.addChildren([
  homeRoute,
  authRoute,
  chatRoute,
  scenesRoute,
  tasksRoute,
  profileRoute,
]);

// Create the router
export const router = createRouter({ routeTree });

// Register types
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
