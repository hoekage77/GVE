import { Router } from "express";
import {
  requireAuth,
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

export const sessionRouter = Router();

sessionRouter.post("/api/v1/sessions", requireAuth, (req, res) => {
  const sessionState = createSession(req.body?.sessionId);
  const wsUrl = buildWebSocketUrl(req);
  res.json(buildSessionResponse(sessionState, wsUrl));
});

sessionRouter.get("/api/v1/sessions", requireAuth, (req, res) => {
  const userId = resolveUserId(req);
  res.json({ sessions: listSessions(userId) });
});

sessionRouter.get("/api/v1/sessions/:sessionId/messages", requireSessionOwnership, (_req, res) => {
  const sessionId = String(_req.params.sessionId);
  const messages = listSessionMessages(sessionId);
  res.json({ messages });
});

sessionRouter.post("/api/v1/sessions/:sessionId/messages", requireSessionOwnership, async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const content = String(req.body?.content ?? req.body?.query ?? "").trim();
  const imageUrl = String(req.body?.imageUrl ?? "").trim();
  const imageData = String(req.body?.imageData ?? "").trim();
  const userId = resolveUserId(req);
  const requestId = String(req.header("x-request-id") ?? req.body?.requestId ?? "").trim() || null;

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