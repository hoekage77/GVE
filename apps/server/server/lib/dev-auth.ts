/**
 * Conditional Clerk middleware + auth helpers.
 * When CLERK_SECRET_KEY (backend) and CLERK_PUBLISHABLE_KEY are missing,
 * we run in dev-bypass mode: no real auth, all requests get a dev user.
 */
import type { Request, Response, NextFunction } from "express";
import { clerkMiddleware, requireAuth as clerkRequireAuth, getAuth as clerkGetAuth } from "@clerk/express";

const DUMMY_KEY = "pk_test_dGVzdC10ZXJyYW5ldC1jbGVyay5jbGVyay5hY2NvdW50cy5kZXYk";
const hasClerkKey = Boolean(
  process.env.CLERK_SECRET_KEY &&
  process.env.CLERK_PUBLISHABLE_KEY &&
  process.env.CLERK_PUBLISHABLE_KEY !== DUMMY_KEY
);

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
    clerkRequireAuth()(req, res, next);
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
