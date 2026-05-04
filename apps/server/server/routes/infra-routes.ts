import { Router } from "express";
import { requireAuth, resolveUserId, handleError } from "./api-helpers.js";
import { getDaytonaEnvPreflight } from "../env.js";
import { getPool } from "../llm/pool.js";
import { getSandboxRuntimeMetrics } from "../sandbox/skill-runtime.js";
import { getSkillCatalog } from "../skills/registry.js";
import { streamMediaArtifact } from "./media.js";
import { planTasks, executeTask } from "../pipeline/index.js";
import { broadcastEvent } from "../ws/streaming.js";
import { getCacheStats } from "../cache-manager.js";
import { wsClients } from "../ws/handler.js";
import { startupDaytonaPreflight } from "../startup-preflight.js";
import { metrics, computeP95Latency } from "../lib/metrics.js";
import { getSessionUsage, getUserDailyTokenUsage, getGlobalTokenTotals, getTokenLimitConfig } from "../state/token-usage.js";
import { getOrCreateInternalSession } from "../state/session.js";
import { getDedicatedSandboxStatus } from "../sandbox/dedicated-manager.js";
import { listProviders } from "@visual-runtime/shared";

export const infraRouter = Router();

infraRouter.get("/healthz", (_req: any, res: any) => {
  const daytonaPreflight = getDaytonaEnvPreflight();
  const pool = getPool();
  const poolStatus = pool.getStatus();
  res.json({
    status: "ok",
    backend: "js",
    orchestration: "langgraph",
    llm: {
      pool: {
        enabledProviders: poolStatus.providers.filter((p: any) => p.state !== "disabled").length,
        totalProviders: poolStatus.providers.length,
        totalGenerations: poolStatus.totalGenerations,
        fallbackCount: poolStatus.fallbackCount,
      },
    },
    runtime: {
      daytona: daytonaPreflight,
    },
    metrics: {
      errors: metrics.errors,
      p95LatencyMs: computeP95Latency(),
    },
  });
});

infraRouter.get("/metrics", (_req: any, res: any) => {
  const sandboxMetrics = getSandboxRuntimeMetrics();
  const poolStatus = getPool().getStatus();
  res.json({
    pool: poolStatus,
    sandbox: sandboxMetrics,
    errors: metrics.errors,
    p95LatencyMs: computeP95Latency(),
    wsConnections: wsClients.size,
  });
});

infraRouter.get("/api/v1/sandboxes/status", (_req: any, res: any) => {
  const sandboxMetrics = getSandboxRuntimeMetrics();
  const dedicatedStatus = getDedicatedSandboxStatus();
  res.json({ pool: sandboxMetrics, dedicated: dedicatedStatus });
});

infraRouter.get("/api/v1/skills", (_req: any, res: any) => {
  const skills = getSkillCatalog();
  res.json({ skills });
});

infraRouter.get("/api/v1/providers", async (_req: any, res: any) => {
  try {
    const providers = await listProviders();
    res.json({ providers });
  } catch {
    res.json({ providers: [] });
  }
});

infraRouter.get("/api/v1/usage", requireAuth, (req: any, res: any) => {
  const userId = resolveUserId(req);
  const sessionId = req.query.sessionId ? String(req.query.sessionId) : null;

  const response: any = {
    limits: getTokenLimitConfig(),
    global: getGlobalTokenTotals(),
  };

  if (userId) response.userDaily = getUserDailyTokenUsage(userId);
  if (sessionId) {
    const sessionState = getOrCreateInternalSession(sessionId);
    response.session = getSessionUsage(sessionId);
  }

  res.json(response);
});

infraRouter.get("/api/v1/media/:mediaKey", (req: any, res: any) => {
  streamMediaArtifact(req, res, (req.params as any).mediaKey);
});

infraRouter.post("/api/v1/tasks/plan", requireAuth, async (req: any, res: any) => {
  try {
    const tasks = await planTasks(req.body);
    broadcastEvent("tasks:planned", { planId: req.body?.planId, sessions: req.body?.sessions, tasks });
    res.json({ success: true, tasks });
  } catch (error) {
    handleError(error, res);
  }
});

infraRouter.post("/api/v1/tasks/execute", requireAuth, async (req: any, res: any) => {
  try {
    broadcastEvent("task:started", { planId: req.body?.planId, taskId: req.body?.task?.id });
    const result = await executeTask(req.body);
    broadcastEvent("task:completed", { planId: req.body?.planId, taskId: req.body?.task?.id, result });
    res.json({ success: true, result });
  } catch (error) {
    broadcastEvent("task:failed", { planId: req.body?.planId, taskId: req.body?.task?.id, message: error instanceof Error ? error.message : "Unknown task error" });
    handleError(error, res);
  }
});