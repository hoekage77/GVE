import "../server/env.js";
import { executeSkillRuntime, shutdownSandboxRuntime } from "../server/skill-runtime.js";

const code = [
  "const scene = globalThis.scene;",
  "const camera = globalThis.camera;",
  "const renderer = globalThis.renderer;",
  "camera.position.z = 4;",
  "const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x55aaff }));",
  "scene.add(cube);",
  "globalThis.animate = () => { cube.rotation.y += 0.02; renderer.render(scene, camera); };"
].join("\n");

const startedAt = Date.now();
const runs = [];

try {
  for (let index = 0; index < 5; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await executeSkillRuntime({
      skillId: "threejs",
      code,
      timeoutMs: 3500,
      maxFrames: 64,
      turnDeadlineAtMs: Date.now() + 120000
    });

    runs.push({
      index: index + 1,
      success: result.success,
      status: result.status,
      errorCode: result.errorCode,
      warningCode: result.warningCode,
      durationMs: result.durationMs,
      acquireMode: result.acquireDiagnostics?.creationMode ?? result.acquireDiagnostics?.source ?? null
    });
  }

  const complete = runs.filter((run) => run.success).length;
  const failed = runs.length - complete;

  console.log(
    JSON.stringify(
      {
        ok: failed === 0,
        elapsedMs: Date.now() - startedAt,
        total: runs.length,
        complete,
        failed,
        runs
      },
      null,
      2
    )
  );

  if (failed > 0) {
    process.exitCode = 1;
  }
} finally {
  await shutdownSandboxRuntime({ deleteIdleSandboxes: true });
}
