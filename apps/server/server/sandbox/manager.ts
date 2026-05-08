/**
 * Sandbox Manager — Docker container management for code execution
 */

import { spawn, exec } from "child_process";
import { promisify } from "util";
import { randomBytes } from "crypto";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const execAsync = promisify(exec);

const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE || "terranet/sandbox:latest";
const SANDBOX_AUTO_BUILD = process.env.SANDBOX_AUTO_BUILD !== "0";
const SANDBOX_NETWORK = process.env.SANDBOX_NETWORK || "terranet-sandbox";
const MAX_CONTAINERS_PER_SESSION = parseInt(process.env.MAX_CONTAINERS_PER_SESSION || "3", 10);
const CONTAINER_MEMORY_LIMIT = process.env.CONTAINER_MEMORY_LIMIT || "2g";
const CONTAINER_CPU_LIMIT = process.env.CONTAINER_CPU_LIMIT || "1.0";
const CONTAINER_TIMEOUT_MS = parseInt(process.env.CONTAINER_TIMEOUT_MS || "60000", 10);

const SANDBOX_MANAGER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SANDBOX_MANAGER_DIR, "..", "..", "..");
const SANDBOX_DOCKERFILE = process.env.SANDBOX_DOCKERFILE || join(REPO_ROOT, "apps", "server", "Dockerfile.sandbox");
const SANDBOX_BUILD_CONTEXT = process.env.SANDBOX_BUILD_CONTEXT || REPO_ROOT;

export interface ContainerInfo {
  containerId: string;
  sessionId: string;
  workspacePath: string;
  createdAt: number;
  status: "running" | "stopped" | "error";
  installedTools: string[];
}

export interface SandboxExecutionResult {
  success: boolean;
  containerId?: string;
  logs: string[];
  error?: string;
  durationMs: number;
}

export const activeContainers = new Map<string, ContainerInfo>();

function generateContainerName(sessionId: string): string {
  const random = randomBytes(4).toString("hex");
  const timestamp = Date.now();
  return `terranet-sandbox-${sessionId.slice(0, 8)}-${timestamp}-${random}`;
}

export async function createSandbox(options: { sessionId: string; tools?: string[]; timeoutMs?: number; keepAlive?: boolean }): Promise<ContainerInfo> {
  const { sessionId, tools = [], timeoutMs = CONTAINER_TIMEOUT_MS, keepAlive } = options;

  console.log(`[Sandbox] createSandbox called for ${sessionId}, keepAlive=${keepAlive}, tools=${tools.join(",")}`);
  await cleanupSessionSandbox(sessionId);

  const containerName = generateContainerName(sessionId);
  const workspacePath = join(tmpdir(), "terranet-sandboxes", sessionId);

  await mkdir(workspacePath, { recursive: true });
  // Ensure host Node.js process can write to workspace regardless of
  // ownership changes from inside the Docker container (entrypoint chown).
  await execAsync(`chmod 777 "${workspacePath}"`).catch(() => {});
  // Also ensure the parent sandboxes directory is accessible.
  const parentDir = join(tmpdir(), "terranet-sandboxes");
  await execAsync(`chmod 777 "${parentDir}"`).catch(() => {});
  await initializeWorkspace(workspacePath, tools);

  try {
    await ensureSandboxImage();
    await ensureSandboxNetwork();

    const dockerArgs = [
      "run", "-d",
      "--name", containerName,
      "--network", SANDBOX_NETWORK,
      "--memory", CONTAINER_MEMORY_LIMIT,
      "--cpus", CONTAINER_CPU_LIMIT,
      "--tmpfs", "/tmp:noexec,nosuid,size=500m",
      "--tmpfs", "/var/tmp:noexec,nosuid,size=200m",
      "--tmpfs", "/home/terranet/.npm:noexec,nosuid,size=150m",
      "--tmpfs", "/home/terranet/.node-gyp:noexec,nosuid,size=50m",
      "-v", `${workspacePath}:/workspace:rw`,
      "-w", "/workspace",
      "-e", "NODE_ENV=production",
      "-e", "DISPLAY=:99",
      "-e", "npm_config_cache=/tmp/.npm-cache",
      "--cap-drop", "ALL",
      "--cap-add", "CHOWN",
      "--cap-add", "SETGID",
      "--cap-add", "SETUID",
      "--security-opt", "no-new-privileges:true",
      SANDBOX_IMAGE,
      "sleep", "infinity"
    ];

    const { stdout: containerId } = await execAsync(`docker ${dockerArgs.join(" ")}`);
    const trimmedContainerId = containerId.trim();

    // Fix permissions so the non-root container user can write to the mounted workspace
    await execAsync(`docker exec -u root ${trimmedContainerId} chown -R terranet:terranet /workspace`);
    // Re-apply world-writable permissions so the host Node.js process
    // (different UID than container's terranet) can still write files.
    await execAsync(`chmod 777 "${workspacePath}"`).catch(() => {});

    const containerInfo: ContainerInfo = {
      containerId: trimmedContainerId,
      sessionId,
      workspacePath,
      createdAt: Date.now(),
      status: "running",
      installedTools: [...tools]
    };

    activeContainers.set(sessionId, containerInfo);

    if (tools.length > 0) {
      await installTools(trimmedContainerId, tools);
    }

    console.log(`[Sandbox] createSandbox SUCCESS for ${sessionId}: container=${trimmedContainerId.slice(0,8)}, activeContainers=${activeContainers.size}`);
    return containerInfo;
  } catch (error: any) {
    await rm(workspacePath, { recursive: true, force: true });
    throw new Error(`Failed to create sandbox: ${error.message}`);
  }
}

async function initializeWorkspace(workspacePath: string, tools: string[]): Promise<void> {
  const packageJson: any = {
    name: "terranet-scene",
    version: "1.0.0",
    type: "module",
    dependencies: {},
    scripts: {
      start: "node index.js",
      build: "vite build",
      preview: "vite preview"
    }
  };

  for (const tool of tools) {
    packageJson.dependencies[tool] = getToolVersion(tool);
  }

  await writeFile(join(workspacePath, "package.json"), JSON.stringify(packageJson, null, 2));

  const viteConfig = `
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    host: '0.0.0.0',
    port: 3000
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
`;
  await writeFile(join(workspacePath, "vite.config.js"), viteConfig);
}

async function ensureSandboxImage(): Promise<void> {
  try {
    await execAsync(`docker image inspect ${JSON.stringify(SANDBOX_IMAGE)}`);
    return;
  } catch {
    if (!SANDBOX_AUTO_BUILD) {
      throw new Error(`Sandbox image ${SANDBOX_IMAGE} is not available locally. Build it with: docker build -f apps/server/Dockerfile.sandbox -t ${SANDBOX_IMAGE} .`);
    }
  }

  await execAsync(`docker build --pull -f ${JSON.stringify(SANDBOX_DOCKERFILE)} -t ${JSON.stringify(SANDBOX_IMAGE)} ${JSON.stringify(SANDBOX_BUILD_CONTEXT)}`, { timeout: 30 * 60 * 1000 });
}

function getToolVersion(tool: string): string {
  const versions: Record<string, string> = {
    three: "^0.172.0",
    "@react-three/fiber": "^8.15.0",
    "@react-three/drei": "^9.92.0",
    postprocessing: "^6.36.0",
    p5: "^1.9.0",
    d3: "^7.8.0",
    animejs: "^3.2.0",
    gsap: "^3.12.0",
    vite: "^5.0.0"
  };
  return versions[tool] || "latest";
}

async function ensureSandboxNetwork(): Promise<void> {
  try {
    await execAsync(`docker network inspect ${SANDBOX_NETWORK}`);
  } catch {
    await execAsync(`docker network create ${SANDBOX_NETWORK} --driver bridge`);
  }
}

async function installTools(containerId: string, tools: string[], maxRetries = 3): Promise<void> {
  if (tools.length === 0) return;

  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const delay = Math.pow(2, attempt - 1) * 1000;
      if (attempt > 1) {
        console.log(`npm install attempt ${attempt}/${maxRetries} after ${delay}ms delay`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // Use --legacy-peer-deps to avoid ERESOLVE conflicts with transitive peer deps.
      // The npm cache path is already configured via the npm_config_cache env var
      // set in the docker run arguments — no need for a global npm config command.
      const npmInstall = `docker exec ${containerId} npm install ${tools.join(" ")} --save --prefer-offline --legacy-peer-deps`;
      await execAsync(npmInstall, { timeout: 120000 });
      console.log(`npm install succeeded on attempt ${attempt}`);
      return;
    } catch (err: any) {
      lastError = err;
      console.warn(`npm install attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      if (attempt === maxRetries) {
        throw new Error(`npm install failed after ${maxRetries} attempts: ${err.message}`);
      }
    }
  }
  throw lastError;
}

async function isContainerRunning(containerId: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`docker inspect -f '{{.State.Running}}' ${containerId}`);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

export async function getActiveContainer(sessionId: string): Promise<ContainerInfo | null> {
  const container = activeContainers.get(sessionId);

  if (container) {
    const stillRunning = await isContainerRunning(container.containerId);
    if (stillRunning) {
      container.status = 'running';
      return container;
    }
    console.log(`[Sandbox] Container ${container.containerId.slice(0, 8)} for ${sessionId} is dead (status: ${container.status}). Cleaning up...`);
    await cleanupSessionSandbox(sessionId);
  }

  return null;
}

export async function ensureSandboxRunning(options: { sessionId: string; tools?: string[]; timeoutMs?: number; keepAlive?: boolean }): Promise<ContainerInfo> {
  const { sessionId } = options;
  const existing = await getActiveContainer(sessionId);
  if (existing) return existing;

  console.log(`[Sandbox] No running container for ${sessionId}. Creating new sandbox...`);
  return createSandbox(options);
}

export async function executeInSandbox(
  options: {
    sessionId: string;
    code: string;
    skill: string;
    timeoutMs?: number;
    files?: Record<string, string>;
    skills?: string[];
    fileSkills?: Record<string, string>;
  }
): Promise<SandboxExecutionResult> {
  const {
    sessionId,
    code,
    skill,
    timeoutMs = CONTAINER_TIMEOUT_MS,
    files,
    skills,
    fileSkills
  } = options;
  console.log(`[Sandbox] executeInSandbox called for ${sessionId}, activeContainers=${activeContainers.size}, keys=[${Array.from(activeContainers.keys()).join(",")}]`);

  // Auto-recover: ensure the Docker container is actually running
  const container = await ensureSandboxRunning({ sessionId }).catch((err: any) => {
    console.error(`[Sandbox] ensureSandboxRunning failed for ${sessionId}: ${err.message}`);
    return null;
  });

  if (!container || container.status !== "running") {
    console.error(`[Sandbox] No active container for ${sessionId}. status=${container?.status ?? "null"}`);
    throw new Error("No active sandbox for session. Create one first.");
  }

  const containerId = container.containerId;

  // Determine if this is a multi-skill execution
  const allSkills = skills && skills.length > 0
    ? [...new Set(skills)]
    : fileSkills
      ? [...new Set(Object.values(fileSkills))]
      : [skill];
  const isMultiSkill = allSkills.length > 1;

  const tmpHostPath = join(tmpdir(), `gve-cp-${sessionId.slice(0, 8)}`);
  await mkdir(tmpHostPath, { recursive: true });

  // Write all project files
  if (files && Object.keys(files).length > 0) {
    for (const [path, content] of Object.entries(files)) {
      const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/");
      const safePath = normalized.startsWith("/") ? normalized.slice(1) : normalized;
      if (safePath.split("/").some((segment) => segment === "..")) continue;
      const resolved = join(tmpHostPath, safePath);
      if (!resolved.startsWith(tmpHostPath + "/") && resolved !== tmpHostPath) continue;
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, content);
      await execAsync(`docker cp "${resolved}" ${containerId}:/workspace/${safePath}`);
    }
  }

  const htmlFile = "index.html";
  let htmlContent: string;

  if (isMultiSkill) {
    // Multi-skill: generate composite HTML with layered containers
    const entryFiles: Record<string, string> = {};
    const wrappedFiles: Record<string, string> = {};

    for (const s of allSkills) {
      const entryFileName = s === "p5js" ? `sketch-${s}.js` : `index-${s}.js`;
      entryFiles[s] = entryFileName;

      // Find the primary file for this skill or use a default
      const skillFilePath = fileSkills
        ? Object.entries(fileSkills).find(([, fskill]) => fskill === s)?.[0]
        : undefined;

      const skillCode = skillFilePath && files?.[skillFilePath]
        ? files[skillFilePath]
        : code;

      const wrapped = wrapUserCodeWithImports(skillCode, s);
      wrappedFiles[entryFileName] = wrapped;

      const hostFile = join(tmpHostPath, entryFileName);
      await writeFile(hostFile, wrapped);
      await execAsync(`docker cp "${hostFile}" ${containerId}:/workspace/${entryFileName}`);
    }

    htmlContent = generateCompositeHTMLWrapper(allSkills, entryFiles);
  } else {
    // Single skill: legacy behavior
    const entryFile = skill === "p5js" ? "sketch.js" : "index.js";
    const wrappedCode = wrapUserCodeWithImports(code, skill);
    const hostEntryFile = join(tmpHostPath, entryFile);
    await writeFile(hostEntryFile, wrappedCode);
    await execAsync(`docker cp "${hostEntryFile}" ${containerId}:/workspace/${entryFile}`);
    htmlContent = generateHTMLWrapper(skill, entryFile);
  }

  const hostHtmlFile = join(tmpHostPath, htmlFile);
  await writeFile(hostHtmlFile, htmlContent);
  await execAsync(`docker cp "${hostHtmlFile}" ${containerId}:/workspace/${htmlFile}`);

  await rm(tmpHostPath, { recursive: true, force: true }).catch(() => {});

  const validationResult = await validateCodeExecution(container.containerId, "index.js", timeoutMs);

  return {
    success: validationResult.success,
    containerId: container.containerId,
    logs: validationResult.logs,
    error: validationResult.error,
    durationMs: validationResult.durationMs
  };
}

export function wrapUserCodeWithImports(code: string, skill: string): string {
  const importPreambles: Record<string, string> = {
    threejs: `import * as THREE from 'three';\nwindow.THREE = THREE;\ntry { const { OrbitControls } = await import('three/addons/controls/OrbitControls.js'); window.OrbitControls = OrbitControls; window.THREE.OrbitControls = OrbitControls; } catch(_e) {}\ntry { const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'); window.THREE.GLTFLoader = GLTFLoader; } catch(_e) {}\ntry { const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js'); window.THREE.DRACOLoader = DRACOLoader; } catch(_e) {}\ntry { const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js'); window.THREE.RGBELoader = RGBELoader; } catch(_e) {}\n`,
    p5js: `import p5 from 'p5';\nwindow.p5 = p5;\n`,
    d3js: `import * as d3 from 'd3';\nwindow.d3 = d3;\n`,
    animejs: `import anime from 'animejs';\nanime = anime.default || anime;\nwindow.anime = anime;\n`
  };

  const preamble = importPreambles[skill] || '';
  if (!preamble) return code;

  return `${preamble}\n${code}`;
}

/* ── Multi-skill composite rendering ── */

const SKILL_Z_LAYERS: Record<string, number> = {
  threejs: 0,
  p5js: 1,
  d3js: 2,
  animejs: 3,
};

const SKILL_CONTAINERS: Record<string, string> = {
  threejs: '<canvas id="three-canvas" style="position:absolute;inset:0;width:100%;height:100%;z-index:0;"></canvas>',
  p5js:    '<div id="p5-container" style="position:absolute;inset:0;width:100%;height:100%;z-index:1;"></div>',
  d3js:    '<svg id="d3-svg" style="position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none;"></svg>',
  animejs: '<div id="anime-stage" style="position:absolute;inset:0;width:100%;height:100%;z-index:3;pointer-events:none;"></div>',
};

const SKILL_IMPORT_PREAMBLES: Record<string, string> = {
  threejs: `import * as THREE from 'three';\nwindow.THREE = THREE;\ntry { const { OrbitControls } = await import('three/addons/controls/OrbitControls.js'); window.OrbitControls = OrbitControls; window.THREE.OrbitControls = OrbitControls; } catch(_e) {}\ntry { const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'); window.THREE.GLTFLoader = GLTFLoader; } catch(_e) {}\ntry { const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js'); window.THREE.DRACOLoader = DRACOLoader; } catch(_e) {}\ntry { const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js'); window.THREE.RGBELoader = RGBELoader; } catch(_e) {}\n`,
  p5js:    `import p5 from 'p5';\nwindow.p5 = p5;\n`,
  d3js:    `import * as d3 from 'd3';\nwindow.d3 = d3;\n`,
  animejs: `import anime from 'animejs';\nanime = anime.default || anime;\nwindow.anime = anime;\n`,
};

function generateHTMLWrapper(skill: string, entryFile: string): string {
  const singleSkillHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GenVis Scene</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { overflow: hidden; background: #0f172a; }
    #canvas-container { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="canvas-container"></div>
  <script type="module" src="./${entryFile}"></script>
</body>
</html>`;
  return singleSkillHtml;
}

/**
 * Build a composite HTML document that can host multiple skill runtimes simultaneously.
 * Each skill gets its own layered container (canvas/SVG/DIV) with a shared message bus.
 */
export function generateCompositeHTMLWrapper(
  skills: string[],
  entryFiles: Record<string, string>
): string {
  const uniqueSkills = [...new Set(skills)].sort((a, b) => (SKILL_Z_LAYERS[a] ?? 99) - (SKILL_Z_LAYERS[b] ?? 99));

  const containerDivs = uniqueSkills
    .map((s) => SKILL_CONTAINERS[s] || `<div id="${s}-layer" style="position:absolute;inset:0;width:100%;height:100%;z-index:${SKILL_Z_LAYERS[s] ?? 99};"></div>`)
    .join("\n  ");

  const moduleScripts = uniqueSkills
    .map((s) => {
      const entry = entryFiles[s];
      if (!entry) return "";
      return `<script type="module" src="./${entry}"></script>`;
    })
    .filter(Boolean)
    .join("\n  ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GenVis Multi-Skill Scene</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { overflow: hidden; background: #0f172a; }
    #scene-root { position: relative; width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="scene-root">
  ${containerDivs}
  </div>
  ${moduleScripts}
  <script>
    /* GenVis Shared Message Bus — allows cross-skill communication */
    window.GenVisBus = {
      _listeners: {},
      on(evt, fn) { (this._listeners[evt] = this._listeners[evt] || []).push(fn); },
      emit(evt, data) { (this._listeners[evt] || []).forEach(fn => fn(data)); }
    };
    window.addEventListener('error', e => console.error('[GenVis]', e.error?.message || e.message));
    window.addEventListener('unhandledrejection', e => console.error('[GenVis] Unhandled:', e.reason));
  </script>
</body>
</html>`;
}

async function validateCodeExecution(containerId: string, entryFile: string, timeoutMs: number): Promise<{ success: boolean; logs: string[]; error?: string; durationMs: number }> {
  const startTime = Date.now();

  try {
    const { stdout, stderr } = await execAsync(`docker exec ${containerId} node --check ${entryFile}`, { timeout: timeoutMs });
    console.log(`[Sandbox] node --check passed for ${entryFile}. stdout=${stdout?.slice(0,200)}`);
    return {
      success: true,
      logs: [stdout, stderr].filter(Boolean),
      durationMs: Date.now() - startTime
    };
  } catch (error: any) {
    const errMsg = error.stderr || error.message || "unknown";
    console.error(`[Sandbox] node --check FAILED for ${entryFile}: ${errMsg.slice(0, 500)}`);
    return {
      success: false,
      logs: error.stdout ? [error.stdout] : [],
      error: errMsg,
      durationMs: Date.now() - startTime
    };
  }
}

export async function buildScenePreview(options: { sessionId: string; code: string; skill: string }): Promise<{ previewUrl: string | null; artifacts: string[]; success: boolean; error?: string }> {
  const { sessionId, code, skill } = options;
  const container = activeContainers.get(sessionId);

  if (!container) {
    throw new Error("No active sandbox for session");
  }

  const entryFile = skill === "p5js" ? "sketch.js" : "scene.js";
  await writeFile(join(container.workspacePath, entryFile), code);
  await writeFile(join(container.workspacePath, "index.html"), generateHTMLWrapper(skill, entryFile));

  const serverPort = 3000;
  try {
    await execAsync(`docker exec -d ${container.containerId} npx vite --port ${serverPort} --host`, { timeout: 10000 });
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const { stdout: containerInfo } = await execAsync(`docker inspect --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${container.containerId}`);
    const containerIp = containerInfo.trim();

    return {
      previewUrl: `http://${containerIp}:${serverPort}`,
      artifacts: [entryFile, "index.html"],
      success: true
    };
  } catch (error: any) {
    return {
      previewUrl: null,
      artifacts: [],
      success: false,
      error: error.message
    };
  }
}

export async function getSandboxFile(sessionId: string, filePath: string): Promise<string> {
  const container = activeContainers.get(sessionId);
  if (!container) throw new Error("No active sandbox for session");

  const fullPath = join(container.workspacePath, filePath);
  return readFile(fullPath, "utf-8");
}

export async function listSandboxFiles(sessionId: string): Promise<string[]> {
  const container = activeContainers.get(sessionId);
  if (!container) throw new Error("No active sandbox for session");

  const { stdout } = await execAsync(`docker exec ${container.containerId} find /workspace -type f -name "*" | head -50`);
  return stdout.trim().split("\n").filter(Boolean).map((f) => f.replace("/workspace/", ""));
}

export async function cleanupSessionSandbox(sessionId: string): Promise<void> {
  const container = activeContainers.get(sessionId);

  if (container) {
    try {
      await execAsync(`docker stop -t 5 ${container.containerId}`).catch(() => {});
      await execAsync(`docker rm -f ${container.containerId}`).catch(() => {});
      await rm(container.workspacePath, { recursive: true, force: true }).catch(async (rmErr) => {
        // EACCES on node_modules — try chmod + force rm, then give up gracefully
        if ((rmErr as NodeJS.ErrnoException).code === "EACCES") {
          console.warn(`[Sandbox] Permission denied removing ${container.workspacePath}, attempting chmod...`);
          await execAsync(`chmod -R +w "${container.workspacePath}" 2>/dev/null || true`).catch(() => {});
          await rm(container.workspacePath, { recursive: true, force: true }).catch(() => {});
        }
      });
    } catch (error) {
      console.error(`Failed to cleanup sandbox for ${sessionId}:`, error);
    }
    activeContainers.delete(sessionId);
  }
}

export async function cleanupAllSandboxes(): Promise<void> {
  const sessions = Array.from(activeContainers.keys());
  await Promise.all(sessions.map((sessionId) => cleanupSessionSandbox(sessionId)));
}

export async function getSandboxMetrics(sessionId: string): Promise<{ cpu: string; memory: string; memoryPercent: string; status: string } | null> {
  const container = activeContainers.get(sessionId);
  if (!container) return null;

  try {
    const { stdout: stats } = await execAsync(`docker stats ${container.containerId} --no-stream --format "{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}"`);
    const [cpu, memory, memPerc] = stats.trim().split("|");

    return {
      cpu: cpu || "0%",
      memory: memory || "0B",
      memoryPercent: memPerc || "0%",
      status: container.status
    };
  } catch {
    return null;
  }
}

export async function healthCheck(): Promise<{ healthy: boolean; dockerAvailable: boolean; imageAvailable: boolean; error?: string }> {
  try {
    await execAsync("docker version");
    const { stdout: images } = await execAsync(`docker images ${SANDBOX_IMAGE} --format "{{.Repository}}"`);
    const imageAvailable = images.trim().length > 0;

    return { healthy: true, dockerAvailable: true, imageAvailable };
  } catch (error: any) {
    return { healthy: false, dockerAvailable: false, imageAvailable: false, error: error.message };
  }
}

process.on("SIGINT", async () => {
  console.log("\nCleaning up sandboxes...");
  await cleanupAllSandboxes();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await cleanupAllSandboxes();
});
