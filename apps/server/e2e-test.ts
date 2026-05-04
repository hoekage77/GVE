await import("./server/env.js");

const { initializeSessions } = await import("./server/state/session.js");
const { executeChatTurn } = await import("./server/routes/chat.js");

initializeSessions();

const sessionId = `e2e-${Date.now()}`;
const content = "Create a Three.js scene with a rotating colored cube and a point light. Keep it minimal.";

const started = Date.now();
const result = await executeChatTurn(sessionId, content, { skill: "threejs", quality: "draft" }, {
  requestId: `e2e-${started}`,
  transport: "rest"
});

console.log(`\n[E2E] Done in ${Date.now() - started}ms`);

console.log(`[E2E] result.result.code=${result.result?.code ? 'YES('+result.result.code.length+')' : 'NO'}`);

if (result.sceneState?.currentScene) {
  console.log(`[E2E] sceneState.currentScene keys: ${Object.keys(result.sceneState.currentScene).join(", ")}`);
  console.log(`[E2E] sceneState.currentScene.code=${result.sceneState.currentScene.code ? 'YES('+result.sceneState.currentScene.code.length+')' : 'NO'}`);
  console.log(`[E2E] sceneState.currentScene.previewUrl=${result.sceneState.currentScene.previewUrl}`);
}

if (result.result?.runtime) {
  console.log(`[E2E] runtime keys: ${Object.keys(result.result.runtime).join(", ")}`);
  console.log(`[E2E] runtime.success=${result.result.runtime.success}`);
  console.log(`[E2E] runtime.previewUrl=${result.result.runtime.previewUrl}`);
}
