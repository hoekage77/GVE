/**
 * AnimationManimTool — Render Python Manim scenes to video.
 *
 * Reads Manim code from the agent-turn Docker sandbox (if file_path is
 * provided) and dispatches rendering through the unified SkillRuntime
 * pipeline.  When SKILL_RUNTIME=daytona (the production default), this
 * automatically provisions a Daytona sandbox using the pre-built
 * manimcommunity/manim image.
 */

import { Tool } from "./Tool.js";
import { toolMetadata, methodMetadata, openapiSchema } from "./decorators.js";
import { executeSkillRuntime } from "../sandbox/skill-runtime.js";
import { ensureSandboxRunning } from "../sandbox/manager.js";
import { readFile } from "fs/promises";
import { join } from "path";

@toolMetadata(
  "Manim Animation",
  "Create educational math animations using Python Manim. Renders to MP4 video inside the sandbox.",
  { weight: 32, visible: true, usage_guide: "Use for precise mathematical visualizations, geometric proofs, and step-by-step derivations. Generates high-quality video output." }
)
export class AnimationManimTool extends Tool {
  @methodMetadata("Render Scene", "Render a Python Manim scene to video.")
  @openapiSchema({
    type: "function",
    function: {
      name: "render_scene",
      description:
        "Run Python Manim code in the sandbox and render it to an MP4 video. " +
        "For large scripts, first write the code to a file using sandbox_files_writeFile, " +
        "then pass the file_path instead of inlining code. The code should define a Scene subclass with a construct() method.",
      parameters: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "The session ID whose sandbox to target.",
          },
          code: {
            type: "string",
            description:
              "Python Manim code (inline). Must include 'from manim import *' and define a Scene subclass with construct(self). " +
              "For scripts longer than ~500 chars, prefer writing to a file via sandbox_files_writeFile and passing file_path instead.",
          },
          file_path: {
            type: "string",
            description:
              "Absolute path to a Python file already written in the sandbox (e.g. via sandbox_files_writeFile). " +
              "If provided, code is read from this file and the code parameter is ignored.",
          },
          scene_name: {
            type: "string",
            description: "Optional scene class name. If omitted, the first Scene subclass found is used.",
          },
        },
        required: ["session_id"],
      },
    },
  })
  async renderScene(args: { session_id: string; code?: string; file_path?: string; scene_name?: string }) {
    let resolvedCode = args.code ?? "";

    // If a file_path was provided, read it from the sandbox.
    // Try Daytona first, fall back to Docker workspace.
    if (args.file_path) {
      // Check Daytona workspace store
      try {
        const { getWorkspace: getDaytonaWs } = await import(
          "../sandbox/daytona-workspace-store.js"
        );
        const daytonaWs = getDaytonaWs(args.session_id);
        if (daytonaWs?.filesystem) {
          const result = await daytonaWs.filesystem.readFile(args.file_path);
          if (result.success) {
            resolvedCode = result.content ?? "";
          } else {
            return this.failResponse(
              `Failed to read file_path "${args.file_path}" from Daytona: ${result.error ?? "File not found"}`
            );
          }
        }
      } catch {
        // Daytona not available, fall through to Docker
      }

      // Fall back to Docker workspace
      if (!resolvedCode) {
        const container = await ensureSandboxRunning({ sessionId: args.session_id }).catch(() => null);
        if (!container || container.status !== "running") {
          return this.failResponse(`No active sandbox for session ${args.session_id}`);
        }
        try {
          const fullPath = join(container.workspacePath, args.file_path);
          resolvedCode = await readFile(fullPath, "utf-8");
        } catch (err: any) {
          return this.failResponse(`Failed to read file_path "${args.file_path}": ${err.message}`);
        }
      }
    }

    if (!resolvedCode.trim()) {
      return this.failResponse("No Manim code provided. Pass either 'code' or 'file_path'.");
    }

    try {
      const result = await executeSkillRuntime({
        skillId: "manim",
        code: resolvedCode,
        timeoutMs: 300_000,
        sessionId: args.session_id,
      });

      if (!result.success) {
        return this.failResponse(
          `Manim rendering failed: ${result.error ?? "Unknown error"}`
        );
      }

      return this.successResponse({
        success: true,
        media_url: result.mediaUrl ?? result.previewUrl ?? null,
        media_type: result.mediaType ?? "video/mp4",
        duration_ms: result.durationMs ?? 0,
        render_count: result.renderCount ?? 1,
        frame_count: result.frameCount ?? 0,
        file_path: args.file_path ?? null,
      });
    } catch (err: any) {
      return this.failResponse(`Manim execution error: ${err.message}`);
    }
  }

  @methodMetadata("Read Video", "Get information about a rendered video file.")
  @openapiSchema({
    type: "function",
    function: {
      name: "get_video_info",
      description: "Get the URL and metadata of the last rendered Manim video.",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "The session ID." },
        },
        required: ["session_id"],
      },
    },
  })
  async getVideoInfo(args: { session_id: string }) {
    return this.successResponse({
      message: "Use render_scene to generate video. The media_url field in the response contains the video link.",
    });
  }
}
