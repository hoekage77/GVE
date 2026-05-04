await import("./server/env.js");

const { initializeSessions } = await import("./server/session-state.js");
const { executeChatTurn } = await import("./server/routes/chat.js");
const { getPool } = await import("./server/llm/pool.js");

initializeSessions();

const pool = getPool();
console.log("[E2E] Provider pool status:");
console.log(JSON.stringify(pool.getStatus(), null, 2));

const sessionId = `e2e-${Date.now()}`;
const content = "Create a Three.js scene with a rotating colored cube and a point light. Keep it minimal.";

console.log(`\n[E2E] Session: ${sessionId}`);
console.log(`[E2E] Prompt: ${content}`);

const started = Date.now();
const result = await executeChatTurn(sessionId, content, { skill: "threejs", quality: "draft" }, {
  requestId: `e2e-${started}`,
  transport: "rest"
});

const duration = Date.now() - started;
console.log(`\n[E2E] Done in ${duration}ms`);
console.log(JSON.stringify({
  success: result.success,
  intent: result.intent,
  skill: result.skill,
  hasScene: !!result.scene,
  hasCode: !!result.scene?.code,
  codeLength: result.scene?.code?.length,
  error: result.error,
  providerUsed: result.providerUsage,
  durationMs: duration
}, null, 2));
