import { WebSocket } from "ws";

const wsUrl = process.env.WS_TEST_URL ?? "ws://127.0.0.1:8000/ws";
const startedAt = Date.now();

function finish(result) {
  const output = {
    service: "websocket-gateway",
    testType: "direct",
    elapsedMs: Date.now() - startedAt,
    ...result
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(output.ok ? 0 : 1);
}

const ws = new WebSocket(wsUrl);
const timeout = setTimeout(() => {
  try { ws.close(); } catch {}
  finish({
    ok: false,
    checks: [
      { name: "connection_ready_event", pass: false }
    ],
    metrics: {
      wsUrl,
      readyEventReceived: false
    },
    diagnostics: {
      reason: "timeout_waiting_for_connection_ready"
    }
  });
}, 15000);

ws.on("message", (raw) => {
  let event;
  try {
    event = JSON.parse(String(raw));
  } catch {
    return;
  }

  if (event?.type !== "connection:ready") {
    return;
  }

  clearTimeout(timeout);
  try { ws.close(); } catch {}

  finish({
    ok: true,
    checks: [
      { name: "connection_ready_event", pass: true }
    ],
    metrics: {
      wsUrl,
      readyEventReceived: true,
      latestSeq: event?.payload?.latestSeq ?? null,
      backend: event?.payload?.backend ?? null,
      orchestration: event?.payload?.orchestration ?? null
    },
    diagnostics: null
  });
});

ws.on("error", (error) => {
  clearTimeout(timeout);
  finish({
    ok: false,
    checks: [
      { name: "ws_connection", pass: false }
    ],
    metrics: {
      wsUrl,
      readyEventReceived: false
    },
    diagnostics: {
      message: error?.message ?? String(error)
    }
  });
});
