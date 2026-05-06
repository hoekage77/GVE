import { ZodError } from "zod";
import { requireAuth, conditionalGetAuth } from "../lib/dev-auth.js";
import { broadcastEvent } from "../ws/streaming.js";
import { metrics } from "../lib/metrics.js";
import { getOrCreateInternalSession, isSessionOwner } from "../state/session.js";
import { apiKeyRepo } from "../db/repositories/apikey-repo.js";
import type { Request, Response, NextFunction } from "express";

export { requireAuth };

export function resolveUserId(req: Request): string | null {
  // Check API key auth first
  const apiKeyId = (req as any).apiKeyUserId;
  if (apiKeyId) return apiKeyId;

  const clerkAuth = conditionalGetAuth(req);
  if (clerkAuth.userId) return clerkAuth.userId;
  return String(req.header("x-user-id") ?? req.body?.userId ?? "").trim() || null;
}

/**
 * Dual-auth middleware: tries API key first, then Clerk JWT.
 */
export function requireAuthOrApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKeyHeader = req.headers["x-api-key"];
  if (typeof apiKeyHeader === "string" && apiKeyHeader.trim().length > 0) {
    const keyHash = apiKeyRepo.hash(apiKeyHeader.trim());
    const row = apiKeyRepo.findByHash(keyHash);
    if (row) {
      apiKeyRepo.touch(row.id);
      (req as any).apiKeyUserId = row.user_id;
      (req as any).authMethod = "api_key";
      (req as any).apiKeyScopes = JSON.parse(row.scopes);
      next();
      return;
    }
  }

  // Fall back to Clerk JWT
  requireAuth(req, res, next);
}

/**
 * Require a specific API key scope.
 */
export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const scopes = (req as any).apiKeyScopes as string[] | undefined;
    if (scopes && !scopes.includes("*") && !scopes.includes(scope)) {
      res.status(403).json({ error: "FORBIDDEN", message: `API key lacks required scope: ${scope}` });
      return;
    }
    next();
  };
}

export function requireSessionOwnership(req: Request, res: Response, next: NextFunction) {
  const sessionId = req.params.sessionId || req.body?.sessionId;
  if (!sessionId) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Session ID is required." });
    return;
  }
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Authentication required." });
    return;
  }
  const session = getOrCreateInternalSession(sessionId);
  if (!isSessionOwner(session, userId)) {
    res.status(403).json({ error: "FORBIDDEN", message: "Access denied. You do not own this session." });
    return;
  }
  next();
}

export function handleError(error: unknown, res: Response): void {
  metrics.errors += 1;
  if (error instanceof ZodError) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Request payload failed schema validation.",
      issues: error.issues,
    });
    return;
  }
  console.error("[api] Unhandled error:", error instanceof Error ? `${error.message}\n${error.stack}` : error);
  res.status(500).json({
    error: "INTERNAL_ERROR",
    message: "An unexpected error occurred. Please try again.",
  });
}

export function broadcastErrorEvent(
  eventType: string,
  error: unknown,
  extra: Record<string, unknown> = {}
): void {
  broadcastEvent(eventType, {
    ...extra,
    message: error instanceof Error ? error.message : "Unknown error",
  });
}

const MEDIA_FIELDS = [
  "outputKind", "mediaType", "mediaUrl", "mediaArtifactId",
  "mediaDurationMs", "mediaFps", "mediaResolution", "mediaBytes",
] as const;

export function extractMediaFields(result: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const field of MEDIA_FIELDS) {
    out[field] = result[field] ?? result.runtime?.[field] ?? null;
  }
  return out;
}