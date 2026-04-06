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

function runTurn(sessionId, requestId, content, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const start = Date.now();

    const timeout = setTimeout(() => {
      try { ws.close(); } catch {}
      resolve({ kind: "timeout", elapsedMs: Date.now() - start });
    }, timeoutMs);

    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "message.send",
        payload: {
          sessionId,
          content,
          requestId,
          clientMessageId: requestId,
          idempotencyKey: requestId
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

      if (evt?.type === "turn:complete" && String(payload?.requestId ?? "") === requestId) {
        clearTimeout(timeout);
        try { ws.close(); } catch {}
        resolve({ kind: "turn:complete", elapsedMs: Date.now() - start });
      }

      if (evt?.type === "turn:error" && String(payload?.requestId ?? "") === requestId) {
        clearTimeout(timeout);
        try { ws.close(); } catch {}
        resolve({
          kind: "turn:error",
          elapsedMs: Date.now() - start,
          code: payload?.error?.code ?? null,
          stage: payload?.error?.stage ?? null
        });
      }
    });

    ws.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ kind: "ws:error", elapsedMs: Date.now() - start, message: error?.message ?? String(error) });
    });
  });
}

const session = await postJson("/api/v1/sessions", {});
if (!session?.body?.sessionId) {
  console.log(JSON.stringify({
    service: "websocket-gateway",
    testType: "soak",
    elapsedMs: Date.now() - startedAt,
    ok: false,
    checks: [{ name: "create_session", pass: false }],
    metrics: { sessionStatusCode: session?.statusCode ?? null },
    diagnostics: { message: "session_creation_failed" }
  }, null, 2));
  process.exit(1);
}

const sessionId = session.body.sessionId;
const results = [];

for (let index = 0; index < 5; index += 1) {
  const requestId = `ws-soak-${Date.now()}-${index}`;
  // eslint-disable-next-line no-await-in-loop
  const result = await runTurn(
    sessionId,
    requestId,
    `Hello from websocket soak turn ${index + 1}.`
  );
  results.push(result);
}

const completeCount = results.filter((entry) => entry.kind === "turn:complete").length;
const errorCount = results.filter((entry) => entry.kind === "turn:error").length;
const timeoutCount = results.filter((entry) => entry.kind === "timeout").length;
const wsErrorCount = results.filter((entry) => entry.kind === "ws:error").length;

const checks = [
  { name: "no_ws_errors", pass: wsErrorCount === 0 },
  { name: "no_timeouts", pass: timeoutCount === 0 },
  { name: "terminal_event_each_turn", pass: completeCount + errorCount === results.length }
];

const output = {
  service: "websocket-gateway",
  testType: "soak",
  elapsedMs: Date.now() - startedAt,
  ok: checks.every((check) => check.pass),
  checks,
  metrics: {
    totalTurns: results.length,
    completeCount,
    errorCount,
    timeoutCount,
    wsErrorCount,
    avgElapsedMs: Math.round(results.reduce((sum, entry) => sum + (entry.elapsedMs ?? 0), 0) / Math.max(1, results.length))
  },
  diagnostics: {
    results
  }
};

console.log(JSON.stringify(output, null, 2));
process.exit(output.ok ? 0 : 1);
