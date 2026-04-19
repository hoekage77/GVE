// @ts-nocheck
import { createServer } from "node:http";

import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";

import { runDaytonaEnvPreflight } from "./env.js";
import { shutdownSandboxRuntime, getSandboxRuntimeMetrics } from "./skill-runtime.js";
import { initializeSessions, shutdownSessions } from "./session-state.js";
import { apiRouter } from "./routes/api.js";
import { setupWebSocketHandler, wsClients } from "./ws/handler.js";
import { getCacheStats } from "./cache-manager.js";
import { metrics, computeP95Latency } from "./lib/metrics.js";

const app = express();
const port = Number(process.env.PORT ?? 8000);
const server = createServer(app);
const wsServer = new WebSocketServer({ noServer: true });

export const startupDaytonaPreflight = runDaytonaEnvPreflight(console);

app.use(cors());
app.use(express.json({ limit: "8mb" }));

// Mount API routes
app.use("/", apiRouter);

// Set up WebSocket handler
setupWebSocketHandler(wsServer);

server.on("upgrade", (request, socket, head) => {
  if (request.url !== "/ws") {
    socket.destroy();
    return;
  }

  wsServer.handleUpgrade(request, socket, head, (websocket) => {
    wsServer.emit("connection", websocket, request);
  });
});

// Add /metrics to base express app
app.get("/metrics", (_req, res) => {
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

// ── Startup ──
initializeSessions();

server.listen(port, () => {
  console.log(`GVE JS backend listening on http://localhost:${port}`);
});

// ── Graceful shutdown ──
function gracefulShutdown(signal) {
  console.log(`[Server] Received ${signal}. Flushing sessions and shutting down...`);
  void (async () => {
    try {
      await shutdownSandboxRuntime({ deleteIdleSandboxes: true });
    } catch (error) {
      console.warn(`[Server] Sandbox runtime shutdown warning: ${error instanceof Error ? error.message : String(error)}`);
    }

    shutdownSessions();
    server.close(() => {
      console.log("[Server] Closed.");
      process.exit(0);
    });
  })();
  // Force exit after 5s if server doesn't close
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
