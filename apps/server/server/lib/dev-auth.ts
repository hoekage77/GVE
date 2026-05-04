/**
 * Conditional Clerk middleware + auth helpers.
 * When CLERK_SECRET_KEY (backend) and CLERK_PUBLISHABLE_KEY are missing,
 * we run in dev-bypass mode: no real auth, all requests get a dev user.
 */
import type { Request, Response, NextFunction } from "express";
import { clerkMiddleware, requireAuth as clerkRequireAuth, getAuth as clerkGetAuth } from "@clerk/express";

const DUMMY_KEY = "pk_test_dGVzdC10ZXJyYW5ldC1jbGVyay5jbGVyay5hY2NvdW50cy5kZXYk";
const isProduction = process.env.NODE_ENV === "production";
const hasClerkKey = Boolean(
  process.env.CLERK_SECRET_KEY &&
  process.env.CLERK_PUBLISHABLE_KEY &&
  process.env.CLERK_PUBLISHABLE_KEY !== DUMMY_KEY
);

/* In production, auth MUST be configured. Fail closed. */
if (isProduction && !hasClerkKey) {
  throw new Error(
    "FATAL: Missing CLERK_SECRET_KEY or CLERK_PUBLISHABLE_KEY in production. " +
    "Authentication cannot be bypassed in production mode."
  );
}

export const DEV_USER_ID = "dev-user";

/* ── Conditional Clerk middleware ── */
export function conditionalClerkMiddleware() {
  if (hasClerkKey) {
    return clerkMiddleware();
  }
  // Dev mode: attach a mock auth object so getAuth(req) works
  return (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = { userId: DEV_USER_ID, sessionId: "dev-session" };
    next();
  };
}

/* ── Conditional requireAuth ── */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (hasClerkKey) {
    const auth = conditionalGetAuth(req);
    if (!auth?.userId) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Authentication required. Please sign in.",
      });
      return;
    }
    next();
  } else {
    next();
  }
}

/* ── Conditional getAuth ── */
export function conditionalGetAuth(req: Request): { userId: string | null; sessionId: string | null } {
  if (hasClerkKey) {
    return clerkGetAuth(req);
  }
  return (req as any).auth ?? { userId: DEV_USER_ID, sessionId: "dev-session" };
}
