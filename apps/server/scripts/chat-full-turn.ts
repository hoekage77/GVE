/**
 * Run one full chat turn (plan → resolve → sandbox) against the live stack.
 *
 * With CHAT_TURN_GRADIENT_ONLY=1 (default), strips other LLM API keys from the
 * process so the pool resolves only Gradient Kimi (requires GRADIENT_API_KEY).
 *
 * Usage (from repo root):
 *   npx tsx apps/server/scripts/chat-full-turn.ts
 *
 * Or from apps/server:
 *   npx tsx scripts/chat-full-turn.ts
 */

/** After `env.js` (loads `server/.env`), remove competing keys so the pool only sees Gradient. */
function stripOtherLlmKeysForGradient(): void {
  const enabled = process.env.CHAT_TURN_GRADIENT_ONLY !== "0";
  if (!enabled) return;

  const keys = [
    "MOONSHOT_API_KEY",
    "DEEPSEEK_API_KEY",
    "GROQ_API_KEY",
    "GEMINI_API_KEY",
    "TOGETHER_API_KEY"
  ];
  for (const k of keys) {
    if (process.env[k]) delete process.env[k];
  }
}

await import("../server/env.js");
stripOtherLlmKeysForGradient();
const { initializeSessions } = await import("../server/session-state.js");
const { executeChatTurn } = await import("../server/routes/chat.js");

initializeSessions();

const sessionId = process.env.CHAT_TEST_SESSION ?? `gradient-chat-${Date.now()}`;
const content =
  process.env.CHAT_TEST_MESSAGE ??
  "Create a minimal p5.js sketch: dark background and one cyan circle in the center. Keep the code short.";

console.log(`[chat-full-turn] sessionId=${sessionId}`);
console.log(`[chat-full-turn] message=${JSON.stringify(content)}`);
console.log(`[chat-full-turn] GRADIENT_API_KEY set=${Boolean(process.env.GRADIENT_API_KEY?.trim())}`);

const started = Date.now();
const result = await executeChatTurn(sessionId, content, { skill: "p5js", quality: "draft" }, {
  requestId: `chat-full-turn-${started}`,
  transport: "rest"
});

console.log(`[chat-full-turn] done in ${Date.now() - started}ms`);
console.log(JSON.stringify(result, null, 2));
