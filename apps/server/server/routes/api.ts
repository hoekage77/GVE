import { type Response, Router } from "express";
export const apiRouter = Router();

import { ZodError } from "zod";
import { getDaytonaEnvPreflight } from "../env.js";
import { getPool } from "../llm-pool.js";
import { 
  createSession, buildSessionResponse, buildWebSocketUrl, listSessions, listSessionMessages, 
  recordSceneVersion, buildSceneUpdatePayload, undoSceneVersion, redoSceneVersion, 
  previousArtifactVersion, nextArtifactVersion, selectSceneVersion, listSceneVersions, 
  initializeSessions, buildCodeUpdatePayload 
} from "../session-state.js";
import { executeChatTurn } from "./chat.js";
import { getSkillCatalog } from "../skill-registry.js";
import { streamMediaArtifact } from "../media-artifacts.js";
import { planTasks, executeTask, generateVisual, generateFromImage, modifyVisual } from "../pipeline/index.js";
import { broadcastEvent, broadcastCodeStream } from "../ws/streaming.js";
import { getCacheStats } from "../cache-manager.js";
import { getSandboxRuntimeMetrics } from "../skill-runtime.js";
import { wsClients } from "../ws/handler.js";
import { startupDaytonaPreflight } from "../startup-preflight.js";
import { metrics, computeP95Latency } from "../lib/metrics.js";
import { runWithTraceContext } from "../trace/context.js";
apiRouter.get("/healthz", (_req, res) => {
  const daytonaPreflight = getDaytonaEnvPreflight();
  const pool = getPool();
  const poolStatus = pool.getStatus();
  res.json({
    status: "ok",
    backend: "js",
    orchestration: "langgraph",
    llm: {
      pool: {
        enabledProviders: poolStatus.providers.filter((p) => p.state !== "disabled").length,
        totalProviders: poolStatus.providers.length,
        totalGenerations: poolStatus.totalGenerations,
        fallbackCount: poolStatus.fallbackCount,
        avgResponseMs: poolStatus.avgResponseMs,
      },
      primary: {
        provider: "moonshot-kimi",
        configured: Boolean(process.env.MOONSHOT_API_KEY),
        model: process.env.MOONSHOT_MODEL ?? "kimi-k2.5"
      }
    },
    daytona: {
      preflightOk: daytonaPreflight.ok,
      warningCount: daytonaPreflight.warnings.length,
      summary: daytonaPreflight.summary
    }
  });
});

apiRouter.get("/api/pool/status", (_req, res) => {
  const pool = getPool();
  res.json(pool.getStatus());
});

apiRouter.post("/api/v1/sessions", (req, res) => {
  metrics.sessionsCreated += 1;
  const sessionState = createSession(req.body?.sessionId);
  res.status(201).json(buildSessionResponse(sessionState, buildWebSocketUrl(req)));
});

apiRouter.get("/api/v1/sessions", (_req, res) => {
  res.json({
    sessions: listSessions()
  });
});

apiRouter.get("/api/v1/sessions/:sessionId/messages", (req, res) => {
  const sessionState = createSession(req.params.sessionId);

  res.json({
    sessionId: sessionState.sessionId,
    messages: listSessionMessages(sessionState.sessionId)
  });
});

apiRouter.post("/api/v1/sessions/:sessionId/messages", async (req, res) => {
  const sessionId = req.params.sessionId;
  const content = String(req.body?.content ?? req.body?.query ?? "").trim();
  const imageUrl = String(req.body?.imageUrl ?? "").trim();
  const imageData = String(req.body?.imageData ?? "").trim();
  const userId = String(req.header("x-user-id") ?? req.body?.userId ?? "").trim() || null;
  const requestId = String(req.header("x-request-id") ?? req.body?.requestId ?? "").trim() || null;

  if (!content && !imageUrl && !imageData) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Message content or image payload is required."
    });
    return;
  }

  try {
    const result = await runWithTraceContext(
      { sessionId, userId, requestId },
      () =>
        executeChatTurn(sessionId, content, req.body?.preferences, {
          imageUrl: imageUrl || null,
          imageData: imageData || null,
          requestId,
          transport: "rest"
        })
    );
    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
});

apiRouter.get("/api/v1/skills", (_req, res) => {
  res.json({
    skills: getSkillCatalog()
  });
});

apiRouter.get("/api/v1/media/:mediaKey", (req, res) => {
  streamMediaArtifact(req, res, req.params.mediaKey);
});

apiRouter.post("/api/v1/tasks/plan", async (req, res) => {
  try {
    metrics.plansCreated += 1;
    const result = await planTasks(req.body);
    const taskCount = Array.isArray((result as { tasks?: unknown }).tasks)
      ? ((result as { tasks: unknown[] }).tasks.length)
      : 0;
    broadcastEvent("tasks:planned", {
      planId: (result as { planId?: unknown }).planId,
      taskCount,
      summary: (result as { summary?: unknown }).summary
    });
    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
});

apiRouter.post("/api/v1/tasks/execute", async (req, res) => {
  const startedAt = Date.now();
  try {
    metrics.tasksExecuted += 1;
    broadcastEvent("task:started", {
      planId: req.body?.planId,
      taskId: req.body?.task?.id,
      action: req.body?.task?.action
    });

    const result = await executeTask(req.body);

    broadcastEvent("task:completed", {
      planId: result.planId,
      taskId: result.taskId,
      status: result.status,
      output: result.output,
      artifact: result.artifact,
      durationMs: Date.now() - startedAt
    });

    res.json(result);
  } catch (error) {
    broadcastEvent("task:failed", {
      planId: req.body?.planId,
      taskId: req.body?.task?.id,
      message: error instanceof Error ? error.message : "Unknown task error"
    });
    handleError(error, res);
  }
});

apiRouter.post("/api/v1/generate", async (req, res) => {
  const requestId = `req-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const sessionState = createSession(req.body?.sessionId);

  try {
    metrics.generations += 1;
    broadcastEvent("generation:started", { requestId });
    broadcastEvent("generation:progress", {
      requestId,
      stage: "orchestrating",
      message: "Running LangGraph generation pipeline"
    });

    const result = await generateVisual(req.body);
    const updatedSessionState = recordSceneVersion(sessionState.sessionId, {
      sceneId: result.sceneId,
      code: result.code,
      previewUrl: result.previewUrl,
      skill: result.skill,
      outputKind: result.outputKind ?? result.runtime?.outputKind ?? null,
      mediaType: result.mediaType ?? result.runtime?.mediaType ?? null,
      mediaUrl: result.mediaUrl ?? result.runtime?.mediaUrl ?? null,
      mediaArtifactId: result.mediaArtifactId ?? result.runtime?.mediaArtifactId ?? null,
      mediaDurationMs: result.mediaDurationMs ?? result.runtime?.mediaDurationMs ?? null,
      mediaFps: result.mediaFps ?? result.runtime?.mediaFps ?? null,
      mediaResolution: result.mediaResolution ?? result.runtime?.mediaResolution ?? null,
      mediaBytes: result.mediaBytes ?? result.runtime?.mediaBytes ?? null,
      assetPlan: result.assetPlan ?? null,
      explanation: result.explanation,
      source: "generate"
    });

    await broadcastCodeStream(updatedSessionState.sessionId, result.code, {
      mode: "generate",
      diff: result.diff ?? null
    });

    broadcastEvent("generation:complete", {
      requestId,
      sceneId: result.sceneId,
      previewUrl: result.previewUrl,
      outputKind: result.outputKind ?? result.runtime?.outputKind ?? null,
      mediaType: result.mediaType ?? result.runtime?.mediaType ?? null,
      mediaUrl: result.mediaUrl ?? result.runtime?.mediaUrl ?? null,
      mediaArtifactId: result.mediaArtifactId ?? result.runtime?.mediaArtifactId ?? null,
      mediaDurationMs: result.mediaDurationMs ?? result.runtime?.mediaDurationMs ?? null,
      mediaFps: result.mediaFps ?? result.runtime?.mediaFps ?? null,
      mediaResolution: result.mediaResolution ?? result.runtime?.mediaResolution ?? null,
      mediaBytes: result.mediaBytes ?? result.runtime?.mediaBytes ?? null,
      skill: result.skill,
      code: result.code,
      diff: result.diff ?? null,
      sessionId: updatedSessionState.sessionId,
      sceneVersion: updatedSessionState.currentScene?.version ?? 0
    });

    broadcastEvent("scene:update", buildSceneUpdatePayload(updatedSessionState));

    res.json({
      ...result,
      sessionId: updatedSessionState.sessionId,
      sceneVersion: updatedSessionState.currentScene?.version ?? 0,
      versionCount: updatedSessionState.versionCount,
      sceneState: updatedSessionState
    });
  } catch (error) {
    broadcastEvent("generation:error", {
      requestId,
      message: error instanceof Error ? error.message : "Unknown generation error"
    });
    handleError(error, res);
  }
});

// ── Image-to-Code endpoint ──

apiRouter.post("/api/v1/generate/from-image", async (req, res) => {
  const requestId = `req-img-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const sessionState = createSession(req.body?.sessionId);
  const imageUrl = req.body?.imageUrl || null;
  const imageData = req.body?.imageData || null;

  if (!imageUrl && !imageData) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "imageUrl or imageData (base64) is required."
    });
    return;
  }

  const resolvedImageUrl = imageUrl || (imageData ? `data:image/png;base64,${imageData}` : null);

  try {
    metrics.generations += 1;
    broadcastEvent("generation:started", { requestId, mode: "image-to-code" });
    broadcastEvent("generation:progress", {
      requestId,
      stage: "analyzing-image",
      message: "Analyzing reference image and generating scene code"
    });

    const result = await generateFromImage({
      imageUrl: resolvedImageUrl,
      query: req.body?.query ?? "",
      sessionId: sessionState.sessionId,
      preferences: req.body?.preferences
    });

    const updatedSessionState = recordSceneVersion(sessionState.sessionId, {
      sceneId: result.sceneId,
      code: result.code,
      previewUrl: result.previewUrl,
      skill: result.skill,
      outputKind: result.outputKind ?? result.runtime?.outputKind ?? null,
      mediaType: result.mediaType ?? result.runtime?.mediaType ?? null,
      mediaUrl: result.mediaUrl ?? result.runtime?.mediaUrl ?? null,
      mediaArtifactId: result.mediaArtifactId ?? result.runtime?.mediaArtifactId ?? null,
      mediaDurationMs: result.mediaDurationMs ?? result.runtime?.mediaDurationMs ?? null,
      mediaFps: result.mediaFps ?? result.runtime?.mediaFps ?? null,
      mediaResolution: result.mediaResolution ?? result.runtime?.mediaResolution ?? null,
      mediaBytes: result.mediaBytes ?? result.runtime?.mediaBytes ?? null,
      assetPlan: result.assetPlan ?? null,
      explanation: result.explanation,
      source: "image-to-code"
    });

    broadcastEvent("generation:complete", {
      requestId,
      sceneId: result.sceneId,
      previewUrl: result.previewUrl,
      outputKind: result.outputKind ?? result.runtime?.outputKind ?? null,
      mediaType: result.mediaType ?? result.runtime?.mediaType ?? null,
      mediaUrl: result.mediaUrl ?? result.runtime?.mediaUrl ?? null,
      mediaArtifactId: result.mediaArtifactId ?? result.runtime?.mediaArtifactId ?? null,
      mediaDurationMs: result.mediaDurationMs ?? result.runtime?.mediaDurationMs ?? null,
      mediaFps: result.mediaFps ?? result.runtime?.mediaFps ?? null,
      mediaResolution: result.mediaResolution ?? result.runtime?.mediaResolution ?? null,
      mediaBytes: result.mediaBytes ?? result.runtime?.mediaBytes ?? null,
      skill: result.skill,
      sessionId: updatedSessionState.sessionId,
      sceneVersion: updatedSessionState.currentScene?.version ?? 0,
      mode: "image-to-code"
    });

    broadcastEvent("scene:update", buildSceneUpdatePayload(updatedSessionState));

    res.json({
      ...result,
      sessionId: updatedSessionState.sessionId,
      sceneVersion: updatedSessionState.currentScene?.version ?? 0,
      versionCount: updatedSessionState.versionCount,
      sceneState: updatedSessionState
    });
  } catch (error) {
    broadcastEvent("generation:error", {
      requestId,
      mode: "image-to-code",
      message: error instanceof Error ? error.message : "Unknown image generation error"
    });
    handleError(error, res);
  }
});

apiRouter.post("/api/v1/sessions/:sessionId/modify", async (req, res) => {
  const sessionId = req.params.sessionId;
  const requestedRunMode = String(req.body?.runMode ?? "").trim().toLowerCase();
  const runMode = requestedRunMode === "rerun" ? "rerun" : "modify";
  const instructionInput = String(req.body?.instruction ?? req.body?.query ?? "").trim();
  const instruction = instructionInput || (runMode === "rerun" ? "Rerun current scene." : "");
  const codeOverride = typeof req.body?.codeOverride === "string" ? req.body.codeOverride : undefined;
  const sessionState = createSession(sessionId);

  if (!instruction) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Modification instruction is required."
    });
    return;
  }

  if (!sessionState.currentScene?.code) {
    res.status(404).json({
      error: "NOT_FOUND",
      message: "No scene available for the requested session."
    });
    return;
  }

  try {
    metrics.modifications += 1;
    broadcastEvent("code:started", {
      sessionId,
      sceneId: sessionState.currentScene.sceneId,
      instruction,
      runMode
    });

    const result = await modifyVisual({
      sessionId,
      instruction,
      runMode,
      codeOverride,
      preferences: req.body?.preferences,
      sceneState: sessionState
    });

    await broadcastCodeStream(sessionId, result.code, {
      mode: runMode,
      diff: result.diff ?? null
    });

    const isRejectedNoopModify = result.modifyOutcome === "rejected_noop";
    const updatedSessionState = isRejectedNoopModify
      ? sessionState
      : recordSceneVersion(sessionId, {
          sceneId: result.sceneId,
          code: result.code,
          previewUrl: result.previewUrl,
          skill: result.skill,
          outputKind: result.outputKind ?? result.runtime?.outputKind ?? null,
          mediaType: result.mediaType ?? result.runtime?.mediaType ?? null,
          mediaUrl: result.mediaUrl ?? result.runtime?.mediaUrl ?? null,
          mediaArtifactId: result.mediaArtifactId ?? result.runtime?.mediaArtifactId ?? null,
          mediaDurationMs: result.mediaDurationMs ?? result.runtime?.mediaDurationMs ?? null,
          mediaFps: result.mediaFps ?? result.runtime?.mediaFps ?? null,
          mediaResolution: result.mediaResolution ?? result.runtime?.mediaResolution ?? null,
          mediaBytes: result.mediaBytes ?? result.runtime?.mediaBytes ?? null,
          assetPlan: result.assetPlan ?? null,
          explanation: result.explanation,
          source: "modify"
        });

    broadcastEvent("code:update", buildCodeUpdatePayload(updatedSessionState, {
      instruction,
      code: result.code,
      diff: result.diff,
      sceneVersion: updatedSessionState.currentScene?.version ?? 0,
      outputKind: result.outputKind ?? result.runtime?.outputKind ?? null,
      mediaType: result.mediaType ?? result.runtime?.mediaType ?? null,
      mediaUrl: result.mediaUrl ?? result.runtime?.mediaUrl ?? null,
      mediaArtifactId: result.mediaArtifactId ?? result.runtime?.mediaArtifactId ?? null,
      mediaDurationMs: result.mediaDurationMs ?? result.runtime?.mediaDurationMs ?? null,
      mediaFps: result.mediaFps ?? result.runtime?.mediaFps ?? null,
      mediaResolution: result.mediaResolution ?? result.runtime?.mediaResolution ?? null,
      mediaBytes: result.mediaBytes ?? result.runtime?.mediaBytes ?? null,
      modifyOutcome: result.modifyOutcome ?? null,
      noopReason: result.noopReason ?? null,
      runMode
    }));

    if (!isRejectedNoopModify) {
      broadcastEvent("scene:update", buildSceneUpdatePayload(updatedSessionState));
    }

    res.json({
      ...result,
      sessionId,
      sceneVersion: updatedSessionState.currentScene?.version ?? 0,
      versionCount: updatedSessionState.versionCount,
      sceneState: updatedSessionState
    });
  } catch (error) {
    broadcastEvent("code:error", {
      sessionId,
      sceneId: sessionState.currentScene.sceneId,
      instruction,
      runMode,
      message: error instanceof Error ? error.message : "Unknown modification error"
    });
    handleError(error, res);
  }
});

apiRouter.post("/api/v1/sessions/:sessionId/undo", (req, res) => {
  const sessionId = req.params.sessionId;
  metrics.undos += 1;

  const result = undoSceneVersion(sessionId);

  if (!result.success) {
    res.status(400).json({
      error: "UNDO_FAILED",
      message: result.reason,
      sceneState: result.state
    });
    return;
  }

  broadcastEvent("scene:update", buildSceneUpdatePayload(result.state));
  broadcastEvent("version:undo", {
    sessionId,
    versionPointer: result.state.versionPointer,
    versionCount: result.state.versionCount
  });

  res.json({
    success: true,
    sceneState: result.state
  });
});

apiRouter.post("/api/v1/sessions/:sessionId/redo", (req, res) => {
  const sessionId = req.params.sessionId;
  metrics.redos += 1;

  const result = redoSceneVersion(sessionId);

  if (!result.success) {
    res.status(400).json({
      error: "REDO_FAILED",
      message: result.reason,
      sceneState: result.state
    });
    return;
  }

  broadcastEvent("scene:update", buildSceneUpdatePayload(result.state));
  broadcastEvent("version:redo", {
    sessionId,
    versionPointer: result.state.versionPointer,
    versionCount: result.state.versionCount
  });

  res.json({
    success: true,
    sceneState: result.state
  });
});

apiRouter.post("/api/v1/sessions/:sessionId/artifacts/previous", (req, res) => {
  const sessionId = req.params.sessionId;
  metrics.artifactNavigations += 1;

  const result = previousArtifactVersion(sessionId);

  if (!result.success) {
    res.status(400).json({
      error: "ARTIFACT_NAVIGATION_FAILED",
      message: result.reason,
      sceneState: result.state
    });
    return;
  }

  broadcastEvent("scene:update", buildSceneUpdatePayload(result.state));
  broadcastEvent("artifact:navigate", {
    sessionId,
    direction: "previous",
    artifactPointer: result.state.artifactPointer,
    artifactCount: result.state.artifactCount,
    currentArtifactId: result.state.currentArtifactId
  });

  res.json({
    success: true,
    sceneState: result.state
  });
});

apiRouter.post("/api/v1/sessions/:sessionId/artifacts/next", (req, res) => {
  const sessionId = req.params.sessionId;
  metrics.artifactNavigations += 1;

  const result = nextArtifactVersion(sessionId);

  if (!result.success) {
    res.status(400).json({
      error: "ARTIFACT_NAVIGATION_FAILED",
      message: result.reason,
      sceneState: result.state
    });
    return;
  }

  broadcastEvent("scene:update", buildSceneUpdatePayload(result.state));
  broadcastEvent("artifact:navigate", {
    sessionId,
    direction: "next",
    artifactPointer: result.state.artifactPointer,
    artifactCount: result.state.artifactCount,
    currentArtifactId: result.state.currentArtifactId
  });

  res.json({
    success: true,
    sceneState: result.state
  });
});

apiRouter.post("/api/v1/sessions/:sessionId/versions/select", (req, res) => {
  const sessionId = req.params.sessionId;
  const versionId = typeof req.body?.versionId === "string" ? req.body.versionId : "";

  const result = selectSceneVersion(sessionId, versionId);

  if (!result.success) {
    res.status(400).json({
      error: "VERSION_SELECTION_FAILED",
      message: result.reason,
      sceneState: result.state
    });
    return;
  }

  broadcastEvent("scene:update", buildSceneUpdatePayload(result.state));

  res.json({
    success: true,
    sceneState: result.state
  });
});

apiRouter.get("/api/v1/sessions/:sessionId/versions", (req, res) => {
  const sessionId = req.params.sessionId;
  const result = listSceneVersions(sessionId);
  res.json(result);
});

function handleError(error: unknown, res: Response): void {
  metrics.errors += 1;

  if (error instanceof ZodError) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Request payload failed schema validation.",
      issues: error.issues
    });
    return;
  }

  res.status(500).json({
    error: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : "Unknown error"
  });
}

apiRouter.get("/metrics", (_req, res) => {
  const cacheStats = getCacheStats();
  const sandboxPool = getSandboxRuntimeMetrics();
  res.json({
    ...metrics,
    latencies: undefined,
    p95LatencyMs: computeP95Latency(),
    cache: cacheStats,
    sandboxPool,
    daytonaPreflight: startupDaytonaPreflight,
    wsConnections: wsClients.size,
    uptimeSeconds: Math.round(process.uptime())
  });
});
