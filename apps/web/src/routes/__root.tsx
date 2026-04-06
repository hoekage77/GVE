import { createRouter, RootRoute, Route, Outlet } from '@tanstack/react-router';
import { ClerkProvider, SignedIn, SignedOut } from '@clerk/clerk-react';
import LandingPage from '../pages/Landing';
import AuthPage from '../pages/Auth';
import ChatPage from '../pages/Chat';
import ProfilePage from '../pages/Profile';
import { MainLayout } from '../components/layout/MainLayout';

// Test Clerk key - replace with production key in deployment
const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_dGVzdC10ZXJyYW5ldC1jbGVyay5jbGVyay5hY2NvdW50cy5kZXYk';

// Root route with providers
const rootRoute = new RootRoute({
  component: () => (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <Outlet />
    </ClerkProvider>
  ),
});

// Landing page (public)
const landingRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LandingPage,
});

// Auth page (public)
const authRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/auth',
  component: AuthPage,
});

// Chat page (protected)
const chatRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/chat',
  component: () => (
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

// Create the route tree
const routeTree = rootRoute.addChildren([
  landingRoute,
  authRoute,
  chatRoute,
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
