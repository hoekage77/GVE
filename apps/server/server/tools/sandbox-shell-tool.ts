/**
 * SandboxShellTool — Execute shell commands inside Docker sandboxes.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { Tool } from "./Tool.js";
import { toolMetadata, methodMetadata, openapiSchema } from "./decorators.js";
import { ensureSandboxRunning } from "../sandbox/manager.js";

const execAsync = promisify(exec);

// Security: block dangerous commands
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\//,
  /mkfs/,
  /dd\s+if/,
  />\s*\/dev\/null/,
  /curl\s+.*\|\s*sh/,
  /wget\s+.*\|\s*sh/,
  /base64\s+-d/,
  /eval\s*\(/,
];

function isCommandBlocked(command: string): { blocked: boolean; reason?: string } {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return { blocked: true, reason: `Command matches blocked pattern: ${pattern.source}` };
    }
  }
  return { blocked: false };
}


async function getDaytonaExec(
  sessionId: string
): Promise<((cmd: string, opts?: { timeoutMs?: number }) => Promise<string>) | null> {
  try {
    const { getWorkspace } = await import("../sandbox/daytona-workspace-store.js");
    const ws = getWorkspace(sessionId);
    if (ws?.executeCommand) return ws.executeCommand;
  } catch {
    // Daytona store not available
  }
  return null;
}

@toolMetadata(
  "Sandbox Shell",
  "Execute shell commands inside the sandboxed container. Use this to install packages, run build scripts, or inspect the environment.",
  { weight: 16, visible: true, is_core: true }
)
export class SandboxShellTool extends Tool {
  @methodMetadata("Execute Command", "Run a shell command in the sandbox container.")
  @openapiSchema({
    type: "function",
    function: {
      name: "execute_command",
      description: "Execute a shell command inside the sandbox container. stdout and stderr are captured. Use for npm install, npm run build, ls, cat, etc.",
      parameters: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "The session ID whose sandbox container to target.",
          },
          command: {
            type: "string",
            description: "The shell command to execute. Be careful with quotes and escaping.",
          },
          timeout_ms: {
            type: "number",
            description: "Maximum time to wait in milliseconds.",
            default: 30000,
          },
          working_dir: {
            type: "string",
            description: "Working directory inside the container (relative to /workspace).",
            default: "/workspace",
          },
        },
        required: ["session_id", "command"],
      },
    },
  })
  async executeCommand(args: {
    session_id: string;
    command: string;
    timeout_ms?: number;
    working_dir?: string;
  }) {
    // Try Daytona first
    const daytonaExec = await getDaytonaExec(args.session_id);
    if (daytonaExec) {
      const blocked = isCommandBlocked(args.command);
      if (blocked.blocked) {
        return this.failResponse(`Command blocked for security: ${blocked.reason}`);
      }
      const timeout = Math.min(args.timeout_ms ?? 30000, 120000);
      try {
        const output = await daytonaExec(args.command, { timeoutMs: timeout });
        return this.successResponse({
          command: args.command,
          stdout: output.slice(0, 20000),
          stderr: "",
          exit_code: 0,
          truncated: output.length > 20000,
        });
      } catch (err: any) {
        return this.successResponse({
          command: args.command,
          stdout: (err.stdout ?? "").slice(0, 20000),
          stderr: (err.stderr ?? err.message ?? "").slice(0, 5000),
          exit_code: err.code ?? 1,
          failed: true,
        });
      }
    }

    const container = await ensureSandboxRunning({ sessionId: args.session_id }).catch(() => null);
    if (!container || container.status !== "running") {
      return this.failResponse(`No active sandbox for session ${args.session_id}`);
    }

    const blocked = isCommandBlocked(args.command);
    if (blocked.blocked) {
      return this.failResponse(`Command blocked for security: ${blocked.reason}`);
    }

    const timeout = Math.min(args.timeout_ms ?? 30000, 120000);
    const workDir = args.working_dir ?? "/workspace";

    try {
      const { stdout, stderr } = await execAsync(
        `docker exec -w ${JSON.stringify(workDir)} ${container.containerId} sh -c ${JSON.stringify(args.command)}`,
        { timeout }
      );

      return this.successResponse({
        command: args.command,
        stdout: stdout.slice(0, 20000),
        stderr: stderr.slice(0, 5000),
        exit_code: 0,
        truncated: stdout.length > 20000,
      });
    } catch (err: any) {
      return this.successResponse({
        command: args.command,
        stdout: (err.stdout ?? "").slice(0, 20000),
        stderr: (err.stderr ?? err.message ?? "").slice(0, 5000),
        exit_code: err.code ?? 1,
        failed: true,
      });
    }
  }

  @methodMetadata("Install Package", "Install an npm package inside the sandbox.")
  @openapiSchema({
    type: "function",
    function: {
      name: "npm_install",
      description: "Install npm packages in the sandbox. Equivalent to 'npm install <packages> --save'.",
      parameters: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "The session ID whose sandbox to target.",
          },
          packages: {
            type: "array",
            items: { type: "string" },
            description: "Package names to install (e.g. ['three', 'p5']).",
          },
        },
        required: ["session_id", "packages"],
      },
    },
  })
  async npmInstall(args: { session_id: string; packages: string[] }) {
    const packages = Array.isArray(args.packages) ? args.packages : [args.packages];
    const command = `npm install ${packages.join(" ")} --save --legacy-peer-deps`;
    return this.executeCommand({
      session_id: args.session_id,
      command,
      timeout_ms: 120000,
    });
  }
}
