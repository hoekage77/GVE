import http from "node:http";
import { WebSocket } from "ws";

const apiBase = process.env.WS_TEST_API_BASE ?? "http://127.0.0.1:8000";
const wsUrl = process.env.WS_TEST_URL ?? "ws://127.0.0.1:8000/ws";
const startedAt = Date.now();

function postJson(pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(`${apiBase}${pathname}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload)
      }
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => {
        raw += chunk;
      });
      res.on("end", () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(raw || "{}") });
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function runRuntimeFlow() {
  const created = await postJson("/api/v1/sessions", {});
  if (!created?.body?.sessionId) {
    return {
      ok: false,
      checks: [
        { name: "create_session", pass: false }
      ],
      metrics: {
        sessionStatusCode: created?.statusCode ?? null
      },
      diagnostics: {
        message: "session_creation_failed"
      }
    };
  }

  const sessionId = created.body.sessionId;
  const requestId = `ws-runtime-${Date.now()}`;
  const idempotencyKey = requestId;
  const seen = [];

  const terminal = await new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      try { ws.close(); } catch {}
      resolve({ type: "timeout", payload: null });
    }, 90000);

    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "message.send",
        payload: {
          sessionId,
          content: "Hello. Confirm websocket runtime event flow.",
          requestId,
          clientMessageId: requestId,
          idempotencyKey
        }
      }));
    });

    ws.on("message", (raw) => {
      let evt;
      try { evt = JSON.parse(String(raw)); } catch { return; }
      const payload = evt?.payload ?? {};
      if (payload?.sessionId && payload.sessionId !== sessionId) {
        return;
      }

      seen.push(evt?.type ?? "unknown");

      if (evt?.type === "turn:complete" && String(payload?.requestId ?? "") === requestId) {
        clearTimeout(timeout);
        try { ws.close(); } catch {}
        resolve({ type: "turn:complete", payload });
      }

      if (evt?.type === "turn:error" && String(payload?.requestId ?? "") === requestId) {
        clearTimeout(timeout);
        try { ws.close(); } catch {}
        resolve({ type: "turn:error", payload });
      }

      if (evt?.type === "message:error") {
        clearTimeout(timeout);
        try { ws.close(); } catch {}
        resolve({ type: "message:error", payload });
      }
    });

    ws.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ type: "ws:error", payload: { message: error?.message ?? String(error) } });
    });
  });

  const checks = [
    { name: "session_created", pass: true },
    { name: "ack_received", pass: seen.includes("message:ack") },
    { name: "terminal_event_received", pass: terminal.type === "turn:complete" || terminal.type === "turn:error" }
  ];

  return {
    ok: checks.every((check) => check.pass),
    checks,
    metrics: {
      sessionId,
      requestId,
      terminalType: terminal.type,
      eventTypes: [...new Set(seen)],
      eventCount: seen.length,
      turnErrorCode: terminal.payload?.error?.code ?? null,
      turnErrorStage: terminal.payload?.error?.stage ?? null
    },
    diagnostics: terminal.type === "turn:complete" || terminal.type === "turn:error"
      ? null
      : { terminal }
  };
}

const result = await runRuntimeFlow();
console.log(JSON.stringify({
  service: "websocket-gateway",
  testType: "runtime",
  elapsedMs: Date.now() - startedAt,
  ...result
}, null, 2));
process.exit(result.ok ? 0 : 1);
