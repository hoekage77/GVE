import { Router } from "express";
import { requireAuth, resolveUserId, handleError, extractMediaFields } from "./api-helpers.js";
import {
  createSession,
  recordSceneVersion,
  buildSceneUpdatePayload,
} from "../state/session.js";
import { generateVisual, generateFromImage } from "../pipeline/index.js";
import { generateMultiFileVisual } from "../pipeline/project-pipeline.js";
import { broadcastEvent } from "../ws/streaming.js";
import { checkTokenLimit } from "../state/token-usage.js";

export const generationRouter = Router();

generationRouter.post("/api/v1/generate", requireAuth, async (req: any, res: any) => {
  const requestId = `req-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const sessionState = createSession(req.body?.sessionId);
  const userId = resolveUserId(req);

  const limitCheck = checkTokenLimit(sessionState.sessionId, userId);
  if (!limitCheck.allowed) {
    res.status(429).json({ error: "TOKEN_LIMIT_EXCEEDED", message: `Token limit exceeded (${limitCheck.scope} scope).` });
    return;
  }

  try {
    broadcastEvent("generation:started", { requestId, sessionId: sessionState.sessionId });
    const result: any = await generateVisual(req.body);
    const sceneSnapshot = {
      sceneId: result.sceneId,
      code: result.code,
      previewUrl: result.previewUrl,
      skill: result.skill,
      ...extractMediaFields(result),
      assetPlan: result.assetPlan ?? null,
      explanation: result.explanation,
      source: "generate" as const,
    };

    const updatedSessionState = recordSceneVersion(sessionState.sessionId, sceneSnapshot);

    broadcastEvent("generation:complete", {
      requestId,
      sceneId: result.sceneId,
      previewUrl: result.previewUrl,
      ...extractMediaFields(result),
      skill: result.skill,
      sessionId: updatedSessionState.sessionId,
      sceneVersion: updatedSessionState.currentScene?.version ?? 0,
    });

    broadcastEvent("scene:update", buildSceneUpdatePayload(updatedSessionState.sessionId));
    res.json({ ...result, sessionId: updatedSessionState.sessionId, sceneVersion: updatedSessionState.currentScene?.version ?? 0, versionCount: updatedSessionState.versionCount, sceneState: updatedSessionState });
  } catch (error) {
    broadcastEvent("generation:error", { requestId, message: error instanceof Error ? error.message : "Unknown generation error" });
    handleError(error, res);
  }
});

generationRouter.post("/api/v1/generate/multi-file", requireAuth, async (req: any, res: any) => {
  const requestId = `req-mf-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const sessionState = createSession(req.body?.sessionId);
  const userId = resolveUserId(req);
  const query = String(req.body?.query ?? req.body?.content ?? "").trim();
  const preferredSkill = (req.body?.skill ?? "threejs") as any;
  const quality = (req.body?.quality ?? "standard") as "draft" | "standard" | "high";

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
    const result = await generateMultiFileVisual(
      { query, preferredSkill, sessionId: sessionState.sessionId, quality },
      (event) => broadcastEvent("generation:progress", { requestId, ...event })
    );

    broadcastEvent("generation:complete", { requestId, sessionId: sessionState.sessionId, multiFile: true });

    res.json({
      requestId, sessionId: sessionState.sessionId, success: result.success,
      plan: result.plan, workspace: result.workspace, fileList: result.fileList,
      totalLines: result.totalLines, sourceTree: result.sourceTree,
      qualityReport: result.qualityReport, iterations: result.iterations, error: result.error,
    });
  } catch (error) {
    broadcastEvent("generation:error", { requestId, message: error instanceof Error ? error.message : "Unknown generation error" });
    handleError(error, res);
  }
});

generationRouter.post("/api/v1/generate/from-image", requireAuth, async (req: any, res: any) => {
  const requestId = `req-img-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const sessionState = createSession(req.body?.sessionId);
  const imageUrl = req.body?.imageUrl || null;
  const imageData = req.body?.imageData || null;

  if (!imageUrl && !imageData) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Image URL or image data is required." });
    return;
  }

  try {
    const result: any = await generateFromImage({ imageUrl, imageData, sessionId: sessionState.sessionId, ...req.body });
    const sceneSnapshot = {
      sceneId: result.sceneId,
      code: result.code,
      previewUrl: result.previewUrl,
      skill: result.skill,
      ...extractMediaFields(result),
      assetPlan: result.assetPlan ?? null,
      explanation: result.explanation,
      source: "image-to-code" as const,
    };

    const updatedSessionState = recordSceneVersion(sessionState.sessionId, sceneSnapshot);

    broadcastEvent("generation:complete", {
      requestId, sceneId: result.sceneId, previewUrl: result.previewUrl,
      ...extractMediaFields(result), skill: result.skill,
      sessionId: updatedSessionState.sessionId, sceneVersion: updatedSessionState.currentScene?.version ?? 0,
    });

    res.json({ ...result, sessionId: updatedSessionState.sessionId, sceneVersion: updatedSessionState.currentScene?.version ?? 0, versionCount: updatedSessionState.versionCount });
  } catch (error) {
    broadcastEvent("generation:error", { requestId, mode: "image-to-code", message: error instanceof Error ? error.message : "Unknown image generation error" });
    handleError(error, res);
  }
});