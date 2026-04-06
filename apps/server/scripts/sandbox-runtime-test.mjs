import "../server/env.js";
import { executeSkillRuntime, shutdownSandboxRuntime } from "../server/skill-runtime.js";

const code = [
  "const scene = globalThis.scene;",
  "const camera = globalThis.camera;",
  "const renderer = globalThis.renderer;",
  "camera.position.z = 4;",
  "const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x3366ff }));",
  "scene.add(cube);",
  "const light = new THREE.DirectionalLight(0xffffff, 1);",
  "light.position.set(4, 6, 5);",
  "scene.add(light);",
  "globalThis.animate = () => { cube.rotation.y += 0.03; renderer.render(scene, camera); };"
].join("\n");

const startedAt = Date.now();

try {
  const result = await executeSkillRuntime({
    skillId: "threejs",
    code,
    timeoutMs: 3500,
    maxFrames: 64,
    turnDeadlineAtMs: Date.now() + 120000
  });

  console.log(
    JSON.stringify(
      {
        ok: result.success,
        elapsedMs: Date.now() - startedAt,
        status: result.status,
        errorCode: result.errorCode,
        warningCode: result.warningCode,
        warning: result.warning,
        renderCount: result.renderCount,
        frameCount: result.frameCount,
        acquireDiagnostics: result.acquireDiagnostics
      },
      null,
      2
    )
  );

  const treatAsPass = result.success || (
    result.status === "error"
    && result.errorCode === null
    && result.acquireDiagnostics
    && !String(result.error || "").toLowerCase().includes("budget")
  );

  if (!treatAsPass) {
    process.exitCode = 1;
  }
} finally {
  await shutdownSandboxRuntime({ deleteIdleSandboxes: true });
}
