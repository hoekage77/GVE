await import("./server/env.js");

const { executeWithQualityLoop } = await import("./server/sandbox/execution.js");

const sessionId = `qt-${Date.now()}`;
const code = `const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
const geometry = new THREE.BoxGeometry();
const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);
camera.position.z = 5;
const controls = new OrbitControls(camera, renderer.domElement);
function animate() {
  requestAnimationFrame(animate);
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;
  renderer.render(scene, camera);
}
animate();`;

console.log(`[QT] Session: ${sessionId}`);
const result = await executeWithQualityLoop({
  sessionId,
  code,
  skill: "threejs",
  prompt: "Create a Three.js scene with a rotating colored cube and a point light. Keep it minimal.",
  tools: ["three"],
  mode: "draft",
  config: { maxIterations: 1, qualityThreshold: 50, enableAutoPatch: false, timeoutPerIterationMs: 30000 }
});

console.log(`[QT] success=${result.success}, stopReason=${result.stopReason}`);
console.log(`[QT] iterations=${result.iterations?.length}`);
result.iterations?.forEach((it: any, i: number) => {
  console.log(`[QT] iter ${i+1}: score=${it.score}, quality.composite=${it.quality?.composite}, execSuccess=${it.executionResult?.success}`);
});
console.log(`[QT] error=${result.error || 'none'}`);
