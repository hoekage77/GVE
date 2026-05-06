/**
 * Workspace Validator — Runs a multi-file workspace in the sandbox and returns per-file error maps.
 */

import { toSandboxPayload, type Workspace } from "./workspace.js";
import { executeInSandbox, type SandboxExecutionResult } from "../sandbox/manager.js";

export interface ValidationError {
  path: string;
  line?: number;
  column?: number;
  message: string;
  severity: "error" | "warning";
}

export interface WorkspaceValidationResult {
  success: boolean;
  errors: ValidationError[];
  sandboxResult: SandboxExecutionResult | null;
  entryPointError?: string;
}

export async function validateWorkspace(
  workspace: Workspace,
  sessionId: string
): Promise<WorkspaceValidationResult> {
  const payload = toSandboxPayload(workspace);
  const filesRecord: Record<string, string> = {};
  const fileSkills: Record<string, string> = {};
  for (const f of payload.files) {
    filesRecord[f.path] = f.content;
    const entry = workspace.files[f.path];
    if (entry) {
      const skill = Array.isArray(entry.skill) ? (entry.skill[0] ?? "threejs") : entry.skill;
      fileSkills[f.path] = skill;
    }
  }
  const allSkills = [...new Set(Object.values(fileSkills))];

  let sandboxResult: SandboxExecutionResult | null = null;
  try {
    sandboxResult = await executeInSandbox({
      sessionId,
      code: payload.files.find(f => f.path === workspace.entryPoint)?.content ?? "",
      skill: fileSkills[workspace.entryPoint] || allSkills[0] || "threejs",
      files: filesRecord,
      skills: allSkills.length > 1 ? allSkills : undefined,
      fileSkills
    });
  } catch (err: any) {
    return {
      success: false,
      errors: [{
        path: workspace.entryPoint,
        message: `Sandbox execution failed: ${err.message}`,
        severity: "error"
      }],
      sandboxResult: null,
      entryPointError: err.message
    };
  }

  const errors: ValidationError[] = [];

  // Map sandbox error logs to files
  if (sandboxResult?.error) {
    errors.push({
      path: workspace.entryPoint,
      message: sandboxResult.error,
      severity: "error"
    });
  }

  // Parse stack traces from logs
  if (sandboxResult?.logs && Array.isArray(sandboxResult.logs)) {
    const output = sandboxResult.logs.join("\n");
    const traceLines = output.split("\n");
    for (const line of traceLines) {
      // Pattern: at functionName (file:///workspace/src/file.js:line:col)
      const match = line.match(/at\s+.*?\s*\(file:\/\/\/workspace\/([^)]+)\)/);
      if (match) {
        const fileRef = match[1];
        if (!fileRef) continue;
        // fileRef might be "src/utils.js:42:15"
        const parts = fileRef.split(":");
        const path = parts[0] ?? "";
        const lineNum = parts[1] ? parseInt(parts[1], 10) : undefined;
        const colNum = parts[2] ? parseInt(parts[2], 10) : undefined;

        if (path) {
          errors.push({
            path,
            line: lineNum,
            column: colNum,
            message: line.trim(),
            severity: "error"
          });
        }
      }
    }
  }

  return {
    success: errors.length === 0 && (sandboxResult?.success ?? false),
    errors,
    sandboxResult
  };
}

/**
 * Group validation errors by file path for targeted debugging.
 */
export function errorsByFile(errors: ValidationError[]): Record<string, ValidationError[]> {
  const grouped: Record<string, ValidationError[]> = {};
  for (const err of errors) {
    const key = err.path;
    if (!grouped[key]) grouped[key] = [];
    grouped[key]!.push(err);
  }
  return grouped;
}
