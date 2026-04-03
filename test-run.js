import fs from "fs";
import { execSync } from "child_process";

const runnerScript = fs.readFileSync("/home/kage/visual runtime/packages/sandbox-pool/src/runner-script.js", "utf-8");

const start = "const runtimeState = { logs: [], renderCount: 0, frameCount: 0, startTime: Date.now(), executionTime: 0, metrics: { drawCalls: 0 } };" + "\n" + "const THREE = createThreeNamespace(runtimeState);" + "\n" + "console.log('Is EllipseCurve defined?', typeof THREE.EllipseCurve);" + "\n" + "try { const curve = new THREE.EllipseCurve(0, 0, 10, 10, 0, 2 * Math.PI, false, 0); console.log('EllipseCurve works', curve); } catch (e) { console.error('Error with EllipseCurve: ', e.message); }";

const checkCode = runnerScript + "\n" + start;

fs.writeFileSync("test-inner.js", checkCode);
try {
  execSync("node test-inner.js", { stdio: "inherit" });
} catch (e) {
  console.error("Exec failed");
}
