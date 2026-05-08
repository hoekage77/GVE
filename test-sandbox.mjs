import { createSandbox, ensureSandboxRunning } from "./apps/server/server/sandbox/manager.js";

async function test() {
  try {
    const result = await ensureSandboxRunning({ sessionId: "test-manim-session", keepAlive: true });
    console.log("Sandbox:", result);
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
