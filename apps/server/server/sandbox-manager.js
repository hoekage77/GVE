import { spawn, exec } from "child_process";
import { promisify } from "util";
import { randomBytes } from "crypto";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const execAsync = promisify(exec);

// Container configuration
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

// Container registry to track active sandboxes
const activeContainers = new Map(); // sessionId -> ContainerInfo

/**
 * @typedef {Object} ContainerInfo
 * @property {string} containerId - Docker container ID
 * @property {string} sessionId - Associated session ID
 * @property {string} workspacePath - Host path to workspace volume
 * @property {number} createdAt - Timestamp when container was created
 * @property {string} status - 'running', 'stopped', 'error'
 * @property {string[]} installedTools - List of installed tools/packages
 */

/**
 * Generate a unique container name
 * @param {string} sessionId
 * @returns {string}
 */
function generateContainerName(sessionId) {
  const random = randomBytes(4).toString("hex");
  const timestamp = Date.now();
  return `terranet-sandbox-${sessionId.slice(0, 8)}-${timestamp}-${random}`;
}

/**
 * Create a sandbox container for a session
 * @param {Object} options
 * @param {string} options.sessionId - Session identifier
 * @param {string[]} [options.tools] - Tools to pre-install
 * @param {number} [options.timeoutMs] - Container execution timeout
 * @returns {Promise<ContainerInfo>}
 */
export async function createSandbox({ sessionId, tools = [], timeoutMs = CONTAINER_TIMEOUT_MS }) {
  // Clean up existing container for this session if present
  await cleanupSessionSandbox(sessionId);

  const containerName = generateContainerName(sessionId);
  const workspacePath = join(tmpdir(), "terranet-sandboxes", sessionId);

  // Create workspace directory
  await mkdir(workspacePath, { recursive: true });

  // Initialize package.json for Node.js projects
  await initializeWorkspace(workspacePath, tools);

  try {
    // Build the sandbox image locally when it is not already available.
    await ensureSandboxImage();

    // Create Docker network if it doesn't exist
    await ensureSandboxNetwork();

    // Spawn the container
    const dockerArgs = [
      "run",
      "-d", // detached mode
      "--name", containerName,
      "--network", SANDBOX_NETWORK,
      "--memory", CONTAINER_MEMORY_LIMIT,
      "--cpus", CONTAINER_CPU_LIMIT,
      // Note: --read-only removed because npm install requires write access to cache
      // Security is maintained via tmpfs mounts and capability dropping
      "--tmpfs", "/tmp:noexec,nosuid,size=500m", // Increased from 100m for npm cache
      "--tmpfs", "/var/tmp:noexec,nosuid,size=200m", // Increased from 50m
      "--tmpfs", "/home/terranet/.npm:noexec,nosuid,size=150m", // NEW: npm cache tmpfs
      "--tmpfs", "/home/terranet/.node-gyp:noexec,nosuid,size=50m", // NEW: node gyp cache
      "-v", `${workspacePath}:/workspace:rw`,
      "-w", "/workspace",
      "-e", "NODE_ENV=production",
      "-e", "DISPLAY=:99", // For headless browser/GL
      "-e", "npm_config_cache=/tmp/.npm-cache", // NEW: Force npm cache to tmpfs
      "--cap-drop", "ALL", // Drop all capabilities
      "--cap-add", "CHOWN",
      "--cap-add", "SETGID",
      "--cap-add", "SETUID",
      "--security-opt", "no-new-privileges:true",
      SANDBOX_IMAGE,
      "sleep", "infinity" // Keep container running
    ];

    const { stdout: containerId } = await execAsync(`docker ${dockerArgs.join(" ")}`);
    const trimmedContainerId = containerId.trim();

    const containerInfo = {
      containerId: trimmedContainerId,
      sessionId,
      workspacePath,
      createdAt: Date.now(),
      status: "running",
      installedTools: [...tools]
    };

    activeContainers.set(sessionId, containerInfo);

    // Install requested tools
    if (tools.length > 0) {
      await installTools(trimmedContainerId, tools);
    }

    return containerInfo;
  } catch (error) {
    // Cleanup on failure
    await rm(workspacePath, { recursive: true, force: true });
    throw new Error(`Failed to create sandbox: ${error.message}`);
  }
}

/**
 * Initialize workspace with package.json and basic structure
 * @param {string} workspacePath
 * @param {string[]} tools
 */
async function initializeWorkspace(workspacePath, tools) {
  const packageJson = {
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

  // Add tool dependencies
  for (const tool of tools) {
    const version = getToolVersion(tool);
    packageJson.dependencies[tool] = version;
  }

  await writeFile(
    join(workspacePath, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  // Create vite.config.js for modern build tooling
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

/**
 * Ensure the sandbox image exists locally, building it from the repo Dockerfile when needed.
 */
async function ensureSandboxImage() {
  try {
    await execAsync(`docker image inspect ${JSON.stringify(SANDBOX_IMAGE)}`);
    return;
  } catch {
    if (!SANDBOX_AUTO_BUILD) {
      throw new Error(
        `Sandbox image ${SANDBOX_IMAGE} is not available locally. Build it with: docker build -f apps/server/Dockerfile.sandbox -t ${SANDBOX_IMAGE} .`
      );
    }
  }

  await execAsync(
    `docker build --pull -f ${JSON.stringify(SANDBOX_DOCKERFILE)} -t ${JSON.stringify(SANDBOX_IMAGE)} ${JSON.stringify(SANDBOX_BUILD_CONTEXT)}`,
    { timeout: 30 * 60 * 1000 }
  );
}

/**
 * Get default version for a tool
 * @param {string} tool
 * @returns {string}
 */
function getToolVersion(tool) {
  const versions = {
    three: "^0.160.0",
    "@react-three/fiber": "^8.15.0",
    "@react-three/drei": "^9.92.0",
    p5: "^1.9.0",
    d3: "^7.8.0",
    animejs: "^3.2.0",
    gsap: "^3.12.0",
    vite: "^5.0.0"
  };
  return versions[tool] || "latest";
}

/**
 * Ensure the sandbox Docker network exists
 */
async function ensureSandboxNetwork() {
  try {
    await execAsync(`docker network inspect ${SANDBOX_NETWORK}`);
  } catch {
    // Network doesn't exist, create it
    await execAsync(`docker network create ${SANDBOX_NETWORK} --driver bridge`);
  }
}

/**
 * Install tools in a running container with retry logic (fixes EROFS issue)
 * @param {string} containerId
 * @param {string[]} tools
 * @param {number} maxRetries - Number of retry attempts
 */
async function installTools(containerId, tools, maxRetries = 3) {
  if (tools.length === 0) return;

  // Configure npm to use tmpfs cache before install (prevents EROFS errors)
  const configCmd = `docker exec ${containerId} npm config set cache /tmp/.npm-cache --global`;
  try {
    await execAsync(configCmd, { timeout: 10000 });
  } catch (err) {
    console.warn(`Failed to configure npm cache: ${err.message}`);
  }

  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const delay = Math.pow(2, attempt - 1) * 1000; // exponential backoff: 0, 1s, 2s
      if (attempt > 1) {
        console.log(`npm install attempt ${attempt}/${maxRetries} after ${delay}ms delay`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // Use --prefer-offline to leverage any cached packages
      const npmInstall = `docker exec ${containerId} npm install ${tools.join(" ")} --save --prefer-offline`;
      await execAsync(npmInstall, { timeout: 120000 });
      console.log(`npm install succeeded on attempt ${attempt}`);
      return; // Success
    } catch (err) {
      lastError = err;
      console.warn(`npm install attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      if (attempt === maxRetries) {
        throw new Error(`npm install failed after ${maxRetries} attempts: ${err.message}`);
      }
    }
  }
  throw lastError;
}

/**
 * Execute code in a sandbox container
 * @param {Object} options
 * @param {string} options.sessionId
 * @param {string} options.code - Code to execute
 * @param {string} options.skill - Skill/framework being used
 * @param {number} [options.timeoutMs]
 * @returns {Promise<SandboxExecutionResult>}
 */
export async function executeInSandbox({ sessionId, code, skill, timeoutMs = CONTAINER_TIMEOUT_MS }) {
  const container = activeContainers.get(sessionId);

  if (!container || container.status !== "running") {
    throw new Error("No active sandbox for session. Create one first.");
  }

  // Write code to workspace
  const entryFile = skill === "p5js" ? "sketch.js" : "index.js";
  const htmlFile = "index.html";

  await writeFile(join(container.workspacePath, entryFile), code);

  // Create appropriate HTML wrapper based on skill
  const htmlContent = generateHTMLWrapper(skill, entryFile);
  await writeFile(join(container.workspacePath, htmlFile), htmlContent);

  // Execute the code (for now, just validate it can be parsed)
  const validationResult = await validateCodeExecution(container.containerId, entryFile, timeoutMs);

  return {
    success: validationResult.success,
    containerId: container.containerId,
    logs: validationResult.logs,
    error: validationResult.error,
    durationMs: validationResult.durationMs
  };
}

/**
 * Generate HTML wrapper for the skill
 * @param {string} skill
 * @param {string} entryFile
 * @returns {string}
 */
function generateHTMLWrapper(skill, entryFile) {
  const skillConfigs = {
    threejs: {
      scripts: [
        "https://cdnjs.cloudflare.com/ajax/libs/three.js/r160/three.min.js"
      ],
      init: ""
    },
    p5js: {
      scripts: [
        "https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"
      ],
      init: ""
    },
    d3js: {
      scripts: [
        "https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js"
      ],
      init: ""
    },
    animejs: {
      scripts: [
        "https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.2/anime.min.js"
      ],
      init: ""
    }
  };

  const config = skillConfigs[skill] || skillConfigs.threejs;
  const scriptTags = config.scripts.map(src => `<script src="${src}"></script>`).join("\n  ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terranet Scene</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { overflow: hidden; background: #0f172a; }
    #canvas-container { width: 100vw; height: 100vh; }
  </style>
  ${scriptTags}
</head>
<body>
  <div id="canvas-container"></div>
  <script type="module" src="./${entryFile}"></script>
</body>
</html>`;
}

/**
 * Validate code can be executed (basic Node.js parse)
 * @param {string} containerId
 * @param {string} entryFile
 * @param {number} timeoutMs
 * @returns {Promise<{success: boolean, logs: string[], error?: string, durationMs: number}>}
 */
async function validateCodeExecution(containerId, entryFile, timeoutMs) {
  const startTime = Date.now();

  try {
    // Run syntax check using Node.js
    const { stdout, stderr } = await execAsync(
      `docker exec ${containerId} node --check ${entryFile}`,
      { timeout: timeoutMs, cwd: "/workspace" }
    );

    const durationMs = Date.now() - startTime;

    return {
      success: true,
      logs: [stdout, stderr].filter(Boolean),
      durationMs
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    return {
      success: false,
      logs: error.stdout ? [error.stdout] : [],
      error: error.stderr || error.message,
      durationMs
    };
  }
}

/**
 * Build scene in sandbox and generate preview
 * @param {Object} options
 * @param {string} options.sessionId
 * @param {string} options.code
 * @param {string} options.skill
 * @returns {Promise<{previewUrl: string, artifacts: string[], success: boolean}>}
 */
export async function buildScenePreview({ sessionId, code, skill }) {
  const container = activeContainers.get(sessionId);
  if (!container) {
    throw new Error("No active sandbox for session");
  }

  // Write files
  const entryFile = skill === "p5js" ? "sketch.js" : "scene.js";
  await writeFile(join(container.workspacePath, entryFile), code);
  await writeFile(
    join(container.workspacePath, "index.html"),
    generateHTMLWrapper(skill, entryFile)
  );

  // Start a static server in the container
  const serverPort = 3000;
  try {
    await execAsync(
      `docker exec -d ${container.containerId} npx vite --port ${serverPort} --host`,
      { timeout: 10000 }
    );

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get container IP
    const { stdout: containerInfo } = await execAsync(
      `docker inspect --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${container.containerId}`
    );
    const containerIp = containerInfo.trim();

    return {
      previewUrl: `http://${containerIp}:${serverPort}`,
      artifacts: [entryFile, "index.html"],
      success: true
    };
  } catch (error) {
    return {
      previewUrl: null,
      artifacts: [],
      success: false,
      error: error.message
    };
  }
}

/**
 * Get files from sandbox workspace
 * @param {string} sessionId
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function getSandboxFile(sessionId, filePath) {
  const container = activeContainers.get(sessionId);
  if (!container) {
    throw new Error("No active sandbox for session");
  }

  const fullPath = join(container.workspacePath, filePath);
  return readFile(fullPath, "utf-8");
}

/**
 * List all files in sandbox workspace
 * @param {string} sessionId
 * @returns {Promise<string[]>}
 */
export async function listSandboxFiles(sessionId) {
  const container = activeContainers.get(sessionId);
  if (!container) {
    throw new Error("No active sandbox for session");
  }

  const { stdout } = await execAsync(
    `docker exec ${container.containerId} find /workspace -type f -name "*" | head -50`
  );

  return stdout.trim().split("\n").filter(Boolean).map(f => f.replace("/workspace/", ""));
}

/**
 * Cleanup sandbox for a session
 * @param {string} sessionId
 */
export async function cleanupSessionSandbox(sessionId) {
  const container = activeContainers.get(sessionId);

  if (container) {
    try {
      // Stop and remove container
      await execAsync(`docker stop -t 5 ${container.containerId}`).catch(() => {});
      await execAsync(`docker rm -f ${container.containerId}`).catch(() => {});

      // Cleanup workspace
      await rm(container.workspacePath, { recursive: true, force: true });
    } catch (error) {
      console.error(`Failed to cleanup sandbox for ${sessionId}:`, error);
    }

    activeContainers.delete(sessionId);
  }
}

/**
 * Cleanup all sandboxes (useful for server shutdown)
 */
export async function cleanupAllSandboxes() {
  const sessions = Array.from(activeContainers.keys());
  await Promise.all(sessions.map(sessionId => cleanupSessionSandbox(sessionId)));
}

/**
 * Get container metrics
 * @param {string} sessionId
 * @returns {Promise<{cpu: string, memory: string, status: string}>}
 */
export async function getSandboxMetrics(sessionId) {
  const container = activeContainers.get(sessionId);
  if (!container) {
    return null;
  }

  try {
    const { stdout: stats } = await execAsync(
      `docker stats ${container.containerId} --no-stream --format "{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}"`
    );
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

/**
 * Health check for sandbox system
 * @returns {Promise<{healthy: boolean, dockerAvailable: boolean, imageAvailable: boolean}>}
 */
export async function healthCheck() {
  try {
    // Check Docker is available
    await execAsync("docker version");

    // Check sandbox image exists
    const { stdout: images } = await execAsync(`docker images ${SANDBOX_IMAGE} --format "{{.Repository}}"`);
    const imageAvailable = images.trim().length > 0;

    return {
      healthy: true,
      dockerAvailable: true,
      imageAvailable
    };
  } catch (error) {
    return {
      healthy: false,
      dockerAvailable: false,
      imageAvailable: false,
      error: error.message
    };
  }
}

// Cleanup on process exit
process.on("SIGINT", async () => {
  console.log("\nCleaning up sandboxes...");
  await cleanupAllSandboxes();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await cleanupAllSandboxes();
});
