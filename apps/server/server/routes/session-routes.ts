import { Router } from "express";
import {
  requireAuth,
  requireAuthOrApiKey,
  resolveUserId,
  requireSessionOwnership,
  handleError,
  broadcastErrorEvent,
  extractMediaFields,
} from "./api-helpers.js";
import {
  createSession,
  buildSessionResponse,
  buildWebSocketUrl,
  listSessions,
  listSessionMessages,
  recordSceneVersion,
  buildSceneUpdatePayload,
  undoSceneVersion,
  redoSceneVersion,
  previousArtifactVersion,
  nextArtifactVersion,
  selectSceneVersion,
  listSceneVersions,
  buildCodeUpdatePayload,
  getOrCreateInternalSession,
} from "../state/session.js";
import { executeChatTurn } from "./chat.js";
import { runMultiAgentAnalysis } from "../agents/analyzer.js";
import { modifyVisual } from "../pipeline/index.js";
import { broadcastEvent } from "../ws/streaming.js";
import { runWithTraceContext } from "../trace/context.js";
import { checkTokenLimit } from "../state/token-usage.js";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { sessionRepo } from "../db/repositories/session-repo.js";
import { messageRepo } from "../db/repositories/message-repo.js";

export const sessionRouter = Router();

sessionRouter.post("/api/v1/sessions", requireAuthOrApiKey, (req, res) => {
  try {
    const userId = resolveUserId(req);
    const sessionState = createSession(req.body?.sessionId, userId);
    const wsUrl = buildWebSocketUrl(req);
    res.json(buildSessionResponse(sessionState, wsUrl));
  } catch (error) {
    handleError(error, res);
  }
});

sessionRouter.get("/api/v1/sessions", requireAuthOrApiKey, (req, res) => {
  try {
    const userId = resolveUserId(req);
    const limit = Math.min(Number.parseInt(String(req.query.limit ?? "20"), 10) || 20, 100);
    const offset = Math.max(Number.parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
    const archived = req.query.archived === "true";

    const result = sessionRepo.findByOwner(userId!, { limit, offset, archived });
    const sessions = result.data.map((row) => ({
      sessionId: row.id,
      name: row.title,
      status: row.status,
      archived: Boolean(row.archived),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    res.json({ sessions, meta: result.meta });
  } catch (error) {
    handleError(error, res);
  }
});

sessionRouter.get("/api/v1/sessions/:sessionId", requireSessionOwnership, (req, res) => {
  try {
    const sessionId = String(req.params.sessionId);
    const row = sessionRepo.findById(sessionId);
    if (!row) {
      res.status(404).json({ error: "NOT_FOUND", message: "Session not found." });
      return;
    }
    res.json({ data: row, error: null });
  } catch (error) {
    handleError(error, res);
  }
});

sessionRouter.patch("/api/v1/sessions/:sessionId", requireSessionOwnership, (req, res) => {
  try {
    const sessionId = String(req.params.sessionId);
    const patch = req.body ?? {};
    const updated = sessionRepo.update(sessionId, {
      title: patch.title,
      status: patch.status,
      archived: patch.archived === true ? 1 : patch.archived === false ? 0 : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: "NOT_FOUND", message: "Session not found." });
      return;
    }
    res.json({ data: updated, error: null });
  } catch (error) {
    handleError(error, res);
  }
});

sessionRouter.delete("/api/v1/sessions/:sessionId", requireSessionOwnership, (req, res) => {
  try {
    const sessionId = String(req.params.sessionId);
    const deleted = sessionRepo.delete(sessionId);
    if (!deleted) {
      res.status(404).json({ error: "NOT_FOUND", message: "Session not found." });
      return;
    }
    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    handleError(error, res);
  }
});

sessionRouter.get("/api/v1/sessions/:sessionId/messages", requireSessionOwnership, (req, res) => {
  const sessionId = String(req.params.sessionId);
  const limit = Math.min(Number.parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  const offset = Math.max(Number.parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
  const before = String(req.query.before ?? "").trim() || undefined;

  const result = messageRepo.findBySession(sessionId, { limit, offset, before });
  const messages = result.data.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    kind: row.kind ?? undefined,
    meta: row.meta ? (JSON.parse(row.meta) as string[]) : [],
    error: row.error ? (JSON.parse(row.error) as any) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  res.json({ sessionId, messages });
});

sessionRouter.patch("/api/v1/sessions/:sessionId/messages/:messageId", requireSessionOwnership, (req, res) => {
  const messageId = String(req.params.messageId);
  const patch = req.body ?? {};
  const updated = messageRepo.update(messageId, {
    content: patch.content,
    kind: patch.kind,
  });
  if (!updated) {
    res.status(404).json({ error: "NOT_FOUND", message: "Message not found." });
    return;
  }
  res.json({ data: updated, error: null });
});

sessionRouter.delete("/api/v1/sessions/:sessionId/messages/:messageId", requireSessionOwnership, (req, res) => {
  const messageId = String(req.params.messageId);
  const deleted = messageRepo.delete(messageId);
  if (!deleted) {
    res.status(404).json({ error: "NOT_FOUND", message: "Message not found." });
    return;
  }
  res.json({ data: { deleted: true }, error: null });
});

sessionRouter.post("/api/v1/sessions/:sessionId/messages", requireSessionOwnership, async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const content = String(req.body?.content ?? req.body?.query ?? "").trim();
  const imageUrl = String(req.body?.imageUrl ?? "").trim();
  const imageData = String(req.body?.imageData ?? "").trim();
  const userId = resolveUserId(req);
  const requestId = String(req.header("x-request-id") ?? req.body?.requestId ?? "").trim() || null;
  const clientMessageId = String(req.body?.clientMessageId ?? "").trim() || null;

  const maxInputLength = Number.parseInt(process.env.MAX_INPUT_LENGTH ?? "16000", 10) || 16000;
  if (content.length > maxInputLength) {
    res.status(400).json({ error: "INPUT_TOO_LONG", message: `Input exceeds maximum allowed length of ${maxInputLength} characters.` });
    return;
  }

  const limitCheck = checkTokenLimit(sessionId, userId);
  if (!limitCheck.allowed) {
    res.status(429).json({
      error: "TOKEN_LIMIT_EXCEEDED",
      message: `Token limit exceeded (${limitCheck.scope} scope).`,
    });
    return;
  }

  try {
    const result = await runWithTraceContext({ sessionId, userId, requestId }, () =>
      executeChatTurn(sessionId, content, {}, {
        requestId,
        clientMessageId,
        imageUrl: imageUrl || undefined,
        imageData: imageData || undefined,
        transport: "rest",
      })
    );
    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
});

sessionRouter.post("/api/v1/sessions/:sessionId/analyze", requireSessionOwnership, async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const sessionState = getOrCreateInternalSession(sessionId);
  if (!sessionState?.currentScene?.code) {
    res.status(404).json({ error: "NOT_FOUND", message: "No code found to analyze in this session." });
    return;
  }
  broadcastEvent("agentState", { sessionId, isAnalyzing: true });
  try {
    const result = await runMultiAgentAnalysis(sessionState.currentScene.code);
    broadcastEvent("agent:analysis_complete", { sessionId, results: result.results, consensus: result.consensus, recommendations: result.recommendations });
    res.json({ success: true, consensus: result.consensus });
  } catch (error) {
    broadcastEvent("agentState", { sessionId, isAnalyzing: false, error: "Analysis failed. Please try again." });
    handleError(error, res);
  }
});

sessionRouter.post("/api/v1/sessions/:sessionId/modify", requireSessionOwnership, async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const instruction = String(req.body?.instruction ?? "").trim();
  const runMode = (req.body?.runMode === "rerun" ? "rerun" : "modify") as "rerun" | "modify";

  const sessionState = getOrCreateInternalSession(sessionId);
  if (!sessionState.currentScene?.code) {
    res.status(404).json({ error: "NOT_FOUND", message: "No code found to modify." });
    return;
  }

  broadcastEvent("code:started", { sessionId, sceneId: sessionState.currentScene.sceneId, instruction, runMode });

  let result: any;
  try {
    result = await modifyVisual({
      sessionId,
      instruction,
      runMode,
      codeOverride: req.body?.codeOverride ?? null,
      preferences: req.body?.preferences ?? {},
    });
  } catch (error) {
    broadcastEvent("code:error", { sessionId, sceneId: sessionState.currentScene?.sceneId, instruction, runMode, message: error instanceof Error ? error.message : "Unknown modification error" });
    handleError(error, res);
    return;
  }

  const sceneSnapshot = {
    sceneId: result.sceneId,
    code: result.code,
    previewUrl: result.previewUrl,
    skill: result.skill,
    ...extractMediaFields(result),
    assetPlan: result.assetPlan ?? null,
    explanation: result.explanation,
    source: "modify" as const,
  };

  const updatedSessionState = recordSceneVersion(sessionId, sceneSnapshot);

  broadcastEvent("code:update", buildCodeUpdatePayload(updatedSessionState.sessionId, {
    instruction,
    code: result.code,
    diff: result.diff,
    sceneVersion: updatedSessionState.currentScene?.version ?? 0,
    ...extractMediaFields(result),
    modifyOutcome: result.modifyOutcome ?? null,
    runMode,
  }));

  res.json({ ...result, sessionId, sceneVersion: updatedSessionState.currentScene?.version ?? 0, versionCount: updatedSessionState.versionCount });
});

sessionRouter.post("/api/v1/sessions/:sessionId/undo", requireSessionOwnership, (req, res) => {
  const sessionId = String(req.params.sessionId);
  const result = undoSceneVersion(sessionId);
  if (!result.success) {
    res.status(400).json({ error: "UNDO_FAILED", message: result.reason });
    return;
  }
  broadcastEvent("scene:update", result.state);
  res.json({ success: true, state: result.state });
});

sessionRouter.post("/api/v1/sessions/:sessionId/redo", requireSessionOwnership, (req, res) => {
  const sessionId = String(req.params.sessionId);
  const result = redoSceneVersion(sessionId);
  if (!result.success) {
    res.status(400).json({ error: "REDO_FAILED", message: result.reason });
    return;
  }
  broadcastEvent("scene:update", result.state);
  res.json({ success: true, state: result.state });
});

sessionRouter.post("/api/v1/sessions/:sessionId/artifacts/previous", requireSessionOwnership, (req, res) => {
  const sessionId = String(req.params.sessionId);
  const result = previousArtifactVersion(sessionId);
  res.json({ success: result.success, state: result.state });
});

sessionRouter.post("/api/v1/sessions/:sessionId/artifacts/next", requireSessionOwnership, (req, res) => {
  const sessionId = String(req.params.sessionId);
  const result = nextArtifactVersion(sessionId);
  res.json({ success: result.success, state: result.state });
});

sessionRouter.post("/api/v1/sessions/:sessionId/versions/select", requireSessionOwnership, (req, res) => {
  const sessionId = String(req.params.sessionId);
  const versionId = String(req.body?.versionId ?? "");
  const result = selectSceneVersion(sessionId, versionId);
  res.json({ success: result.success, state: result.state });
});

sessionRouter.get("/api/v1/sessions/:sessionId/versions", requireSessionOwnership, (req, res) => {
  const sessionId = String(req.params.sessionId);
  const versions = listSceneVersions(sessionId);
  res.json({ versions });
});

const PROJECT_ROOT = process.env.PROJECT_ROOT || join(import.meta.dirname ?? ".", "..", "..", "..", "..");

async function collectSourceFiles(dir: string, root: string, maxFiles = 200): Promise<Array<{ path: string; content: string }>> {
  const results: Array<{ path: string; content: string }> = [];
  const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);

  async function walk(current: string) {
    if (results.length >= maxFiles) return;
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && extensions.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
        try {
          const content = await readFile(full, "utf-8");
          results.push({ path: relative(root, full).replace(/\\/g, "/"), content: content.slice(0, 50000) });
        } catch {}
      }
    }
  }

  await walk(dir);
  return results;
}

sessionRouter.get("/api/scan-files", requireAuth, async (_req, res) => {
  try {
    const webSrc = join(PROJECT_ROOT, "apps", "web", "src");
    const files = await collectSourceFiles(webSrc, PROJECT_ROOT);
    res.json(files);
  } catch (error) {
    handleError(error, res);
  }
});