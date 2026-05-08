import { Router } from "express";
import { requireAuthOrApiKey, resolveUserId, handleError } from "./api-helpers.js";
import { createSession } from "../state/session.js";
import { executeChatTurn } from "./chat.js";
import { broadcastEvent } from "../ws/streaming.js";
import { checkTokenLimit } from "../state/token-usage.js";
import { runWithTraceContext } from "../trace/context.js";

export const generationRouter = Router();

generationRouter.post("/api/v1/generate", requireAuthOrApiKey, async (req: any, res: any) => {
  const sessionState = createSession(req.body?.sessionId);
  const userId = resolveUserId(req);
  const query = String(req.body?.query ?? req.body?.content ?? req.body?.prompt ?? "").trim();
  const requestId = `req-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  if (!query) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "A description is required." });
    return;
  }

  const limitCheck = checkTokenLimit(sessionState.sessionId, userId);
  if (!limitCheck.allowed) {
    res.status(429).json({ error: "TOKEN_LIMIT_EXCEEDED", message: `Token limit exceeded (${limitCheck.scope} scope).` });
    return;
  }

  try {
    broadcastEvent("generation:started", { requestId, sessionId: sessionState.sessionId });
    const result = await runWithTraceContext({ sessionId: sessionState.sessionId, requestId, userId }, () =>
      executeChatTurn(sessionState.sessionId, query, req.body?.preferences ?? {}, {
        requestId,
        transport: "rest",
      })
    );
    res.json(result);
  } catch (error) {
    broadcastEvent("generation:error", { requestId, message: error instanceof Error ? error.message : "Unknown generation error" });
    handleError(error, res);
  }
});

generationRouter.post("/api/v1/generate/multi-file", requireAuthOrApiKey, async (req: any, res: any) => {
  const sessionState = createSession(req.body?.sessionId);
  const userId = resolveUserId(req);
  const query = String(req.body?.query ?? req.body?.content ?? "").trim();
  const requestId = `req-mf-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  if (!query) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "A description is required." });
    return;
  }

  const limitCheck = checkTokenLimit(sessionState.sessionId, userId);
  if (!limitCheck.allowed) {
    res.status(429).json({ error: "TOKEN_LIMIT_EXCEEDED", message: `Token limit exceeded (${limitCheck.scope} scope).` });
    return;
  }

  try {
    broadcastEvent("generation:started", { requestId, sessionId: sessionState.sessionId, multiFile: true });
    const result = await runWithTraceContext({ sessionId: sessionState.sessionId, requestId, userId }, () =>
      executeChatTurn(sessionState.sessionId, query, req.body?.preferences ?? {}, {
        requestId,
        transport: "rest",
      })
    );
    res.json(result);
  } catch (error) {
    broadcastEvent("generation:error", { requestId, message: error instanceof Error ? error.message : "Unknown generation error" });
    handleError(error, res);
  }
});

generationRouter.post("/api/v1/generate/from-image", requireAuthOrApiKey, async (req: any, res: any) => {
  const sessionState = createSession(req.body?.sessionId);
  const userId = resolveUserId(req);
  const query = String(req.body?.query ?? req.body?.content ?? req.body?.prompt ?? "").trim();
  const imageUrl = req.body?.imageUrl || null;
  const imageData = req.body?.imageData || null;
  const requestId = `req-img-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  if (!imageUrl && !imageData) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Image URL or image data is required." });
    return;
  }

  try {
    broadcastEvent("generation:started", { requestId, sessionId: sessionState.sessionId, mode: "image-to-code" });
    const result = await runWithTraceContext({ sessionId: sessionState.sessionId, requestId, userId }, () =>
      executeChatTurn(sessionState.sessionId, query || "Generate a scene from the attached image.", req.body?.preferences ?? {}, {
        requestId,
        transport: "rest",
        imageUrl: imageUrl || undefined,
        imageData: imageData || undefined,
      })
    );
    res.json(result);
  } catch (error) {
    broadcastEvent("generation:error", { requestId, mode: "image-to-code", message: error instanceof Error ? error.message : "Unknown image generation error" });
    handleError(error, res);
  }
});
