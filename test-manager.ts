import { createSandbox, cleanupAllSandboxes } from "./apps/server/server/sandbox/manager.ts";

async function run() {
  try {
    console.log("Creating sandbox...");
    const containerInfo = await createSandbox({
      sessionId: "test-session-manager",
      tools: ["d3"]
    });
    console.log("Sandbox created successfully!");
    console.log(containerInfo);
  } catch (err) {
    console.error("Failed:", err);
  } finally {
    console.log("Cleaning up...");
    await cleanupAllSandboxes();
  }
}

run();
