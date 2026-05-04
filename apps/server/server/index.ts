import { createServer } from "node:http";

import { WebSocketServer } from "ws";

import "./env.js";
import { createApp } from "./create-app.js";
import { shutdownSandboxRuntime } from "./sandbox/skill-runtime.js";
import { shutdownSessions } from "./state/session.js";
import { shutdownTokenUsage } from "./state/token-usage.js";
import { setupWebSocketHandler } from "./ws/handler.js";

const app = createApp();
const port = Number(process.env.PORT ?? 8000);
const server = createServer(app);
const wsServer = new WebSocketServer({ noServer: true });

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

server.listen(port, () => {
  console.log(`GVE JS backend listening on http://localhost:${port}`);
});

// ── Graceful shutdown ──
const SHUTDOWN_TIMEOUT_MS = 30_000;

function gracefulShutdown(signal: "SIGTERM" | "SIGINT"): void {
  console.log(`[Server] Received ${signal}. Flushing sessions and shutting down...`);

  const timeout = setTimeout(() => {
    console.error("[Server] Shutdown timed out. Forcing exit.");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  void (async () => {
    try {
      await shutdownSandboxRuntime({ deleteIdleSandboxes: true });
    } catch (error) {
      console.warn(`[Server] Sandbox runtime shutdown warning: ${error instanceof Error ? error.message : String(error)}`);
    }

    shutdownSessions();
    shutdownTokenUsage();

    server.close((err) => {
      clearTimeout(timeout);
      if (err) {
        console.error("[Server] Error closing server:", err);
        process.exit(1);
      }
      console.log("[Server] Closed gracefully.");
      process.exit(0);
    });
  })();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

