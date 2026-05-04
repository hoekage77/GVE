import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { SignedIn, SignedOut } from '../lib/clerk';

function RedirectToAuth() {
  useEffect(() => {
    const timer = setTimeout(() => {
      window.location.href = '/auth';
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex min-h-svh items-center justify-center bg-auth-bg text-white">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-auth-accent border-t-transparent" />
        <h1 className="text-xl font-semibold">Authentication required. Please sign in.</h1>
        <p className="text-sm text-white/60">Redirecting to login page...</p>
      </div>
    </div>
  );
}

export function RequireAuth({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>{fallback ?? <RedirectToAuth />}</SignedOut>
    </>
  );
}