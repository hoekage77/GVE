/**
 * Conditional Clerk auth wrapper.
 * When VITE_CLERK_PUBLISHABLE_KEY is unset or is the known dummy fallback,
 * we bypass Clerk entirely and render a mock "signed-in" dev user.
 * This prevents 400 Bad Request spam in local development.
 */
import type { ReactNode } from "react";

const DUMMY_KEY = "pk_test_dGVzdC10ZXJyYW5ldC1jbGVyay5jbGVyay5hY2NvdW50cy5kZXYk";
const rawKey = (import.meta as any).env?.VITE_CLERK_PUBLISHABLE_KEY || "";
export const clerkEnabled = Boolean(rawKey) && rawKey !== DUMMY_KEY;

/* ── Mock user for dev mode ── */
const devUser = {
  id: "dev-user",
  firstName: "Developer",
  fullName: "Developer",
  primaryEmailAddress: { emailAddress: "dev@localhost" } as any,
  imageUrl: "",
};

/* ── Conditional ClerkProvider ── */
export function ConditionalClerkProvider({
  children,
  fallbackKey,
}: {
  children: ReactNode;
  fallbackKey: string;
}) {
  if (clerkEnabled) {
    const { ClerkProvider } = require("@clerk/clerk-react");
    return <ClerkProvider publishableKey={rawKey || fallbackKey}>{children}</ClerkProvider>;
  }
  return <>{children}</>;
}

/* ── SignedIn / SignedOut ── */
export function SignedIn({ children }: { children: ReactNode }) {
  if (clerkEnabled) {
    const { SignedIn: Real } = require("@clerk/clerk-react");
    return <Real>{children}</Real>;
  }
  return <>{children}</>;
}

export function SignedOut({ children }: { children: ReactNode }) {
  if (clerkEnabled) {
    const { SignedOut: Real } = require("@clerk/clerk-react");
    return <Real>{children}</Real>;
  }
  return null;
}

/* ── useUser hook ── */
export function useUser() {
  if (clerkEnabled) {
    const { useUser: real } = require("@clerk/clerk-react");
    return real();
  }
  return { isLoaded: true, isSignedIn: true, user: devUser as any };
}

/* ── useClerk hook ── */
export function useClerk() {
  if (clerkEnabled) {
    const { useClerk: real } = require("@clerk/clerk-react");
    return real();
  }
  return {
    signOut: async () => {
      window.location.reload();
    },
  } as any;
}

/* ── SignIn / SignUp components ── */
export function SignIn(props: any) {
  if (clerkEnabled) {
    const { SignIn: Real } = require("@clerk/clerk-react");
    return <Real {...props} />;
  }
  window.location.href = "/chat";
  return null;
}

export function SignUp(props: any) {
  if (clerkEnabled) {
    const { SignUp: Real } = require("@clerk/clerk-react");
    return <Real {...props} />;
  }
  window.location.href = "/chat";
  return null;
}
