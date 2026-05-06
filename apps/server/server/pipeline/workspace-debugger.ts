/**
 * Workspace Debugger — Iteratively patches broken files in a workspace after validation failures.
 */

import { getPool } from "../llm/pool.js";
import { recordTokenUsage } from "../state/token-usage.js";
import { validateWorkspace, type ValidationError, errorsByFile } from "./workspace-validator.js";
import { updateFile, type Workspace, type FileEntry } from "./workspace.js";
import { broadcastEvent } from "../ws/streaming.js";

export interface DebugResult {
  success: boolean;
  workspace: Workspace;
  iterations: DebugIteration[];
  finalErrors: ValidationError[];
}

export interface DebugIteration {
  iteration: number;
  filePath: string;
  errorsBefore: ValidationError[];
  patchApplied: boolean;
  errorsAfter: ValidationError[];
  durationMs: number;
}

const DEBUG_SYSTEM_PROMPT = `You are a precise code-debugging agent for a multi-file animation project.
You receive:
1. The original user request
2. A file tree showing all project files
3. One specific file that has errors
4. The error messages

Your task: fix ONLY the provided file. Do NOT modify other files.
Return the COMPLETE fixed file content inside a code fence.

Rules:
- Keep the fix minimal and targeted
- Preserve the file's purpose and structure
- Ensure imports/requires still resolve correctly
- Do NOT add comments explaining the fix
- If the error is a missing import, add it. If it's a syntax error, fix it.
- If the error involves an undefined variable/function from another file, check imports first.`;

async function fetchDebugCompletion(messages: any[]): Promise<string | null> {
  const pool = getPool();
  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    const acquired = pool.acquire({ requireCodeGeneration: true });
    if (!acquired) {
      console.warn("[WorkspaceDebugger] No LLM providers available.");
      return null;
    }

    const { provider, waitMs } = acquired;
    if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));

    try {
      const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
      const startMs = Date.now();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`
        },
        body: JSON.stringify({
          model: provider.model,
          temperature: 0.1,
          messages
        })
      });

      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          pool.markExhausted(provider.id, `HTTP ${response.status}`);
          attempt++;
          continue;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const json = await response.json();
      pool.recordRequest(provider.id, Date.now() - startMs);
      pool.markHealthy(provider.id);

      if (json?.usage) {
        recordTokenUsage(
          { providerId: provider.id, model: json.model ?? provider.model ?? null },
          json.usage
        );
      }

      return json?.choices?.[0]?.message?.content ?? null;
    } catch (err: any) {
      pool.markExhausted(provider.id, err.message || "debug-error");
      attempt++;
    }
  }

  return null;
}

function extractCodeFromResponse(text: string, skill = "javascript"): string | null {
  const fence = skill === "python" ? "python" : "javascript|js";
  const pattern = "```" + "(?:" + fence + ")?\\s*([\\s\\S]*?)" + "```";
  const regex = new RegExp(pattern, "i");
  const match = text.match(regex);
  return match ? match[1]?.trim() ?? null : text.trim();
}

async function patchFile(
  workspace: Workspace,
  filePath: string,
  errors: ValidationError[],
  originalQuery: string,
  skill: string
): Promise<{ workspace: Workspace; patched: boolean }> {
  const file = workspace.files[filePath];
  if (!file) return { workspace, patched: false };

  const errorText = errors.map(e => `[${e.severity.toUpperCase()}] ${e.line ? `Line ${e.line}: ` : ""}${e.message}`).join("\n");

  const fileTree = Object.keys(workspace.files)
    .map(p => `${p === workspace.entryPoint ? "★ " : "  "}${p} — ${workspace.files[p]!.purpose}`)
    .join("\n");

  const messages = [
    { role: "system", content: DEBUG_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `Original request: "${originalQuery}"`,
        "",
        "File tree:",
        fileTree,
        "",
        `File to fix: ${filePath}`,
        `Purpose: ${file.purpose}`,
        "",
        "Errors:",
        errorText,
        "",
        "Current content:",
        "```" + (skill === "python" ? "python" : "javascript"),
        file.content,
        "```",
        "",
        "Return the complete fixed file content inside a code fence."
      ].join("\n")
    }
  ];

  broadcastEvent("agent:file_start", {
    sessionId: "", // filled by caller
    path: filePath,
    action: "debug"
  });

  const response = await fetchDebugCompletion(messages);
  if (!response) return { workspace, patched: false };

  const fixedCode = extractCodeFromResponse(response, skill);
  if (!fixedCode || fixedCode === file.content.trim()) {
    return { workspace, patched: false };
  }

  const updated = updateFile(workspace, filePath, fixedCode, "patch");

  broadcastEvent("agent:patch_applied", {
    path: filePath,
    diff: {
      oldLines: file.content.split("\n").length,
      newLines: fixedCode.split("\n").length
    }
  });

  return { workspace: updated, patched: true };
}

export async function debugWorkspace(
  workspace: Workspace,
  sessionId: string,
  originalQuery: string,
  options: {
    maxGlobalIterations?: number;
    maxPerFileAttempts?: number;
    skill?: string;
  } = {}
): Promise<DebugResult> {
  const {
    maxGlobalIterations = 5,
    maxPerFileAttempts = 3,
    skill = "javascript"
  } = options;

  let current = workspace;
  const iterations: DebugIteration[] = [];
  const fileAttemptCounts: Record<string, number> = {};

  for (let globalIter = 0; globalIter < maxGlobalIterations; globalIter++) {
    const validationStart = Date.now();
    const validation = await validateWorkspace(current, sessionId);
    const validationMs = Date.now() - validationStart;

    if (validation.success) {
      return {
        success: true,
        workspace: current,
        iterations,
        finalErrors: []
      };
    }

    const grouped = errorsByFile(validation.errors);
    const brokenFiles = Object.keys(grouped).filter(p => current.files[p]);

    if (brokenFiles.length === 0) {
      // Errors are in entry point or unknown location
      if (validation.entryPointError && current.files[current.entryPoint]) {
        brokenFiles.push(current.entryPoint);
      } else {
        break;
      }
    }

    // Pick the file with the most errors that hasn't exceeded per-file attempts
    const targetFile = brokenFiles
      .filter(f => (fileAttemptCounts[f] ?? 0) < maxPerFileAttempts)
      .sort((a, b) => grouped[b]!.length - grouped[a]!.length)[0];

    if (!targetFile) {
      break; // All files exhausted their attempts
    }

    const errorsBefore = grouped[targetFile]!;
    const patchStart = Date.now();

    broadcastEvent("agent:validation_failed", {
      sessionId,
      iteration: globalIter + 1,
      maxIterations: maxGlobalIterations,
      errors: errorsBefore.map(e => ({ path: e.path, line: e.line, message: e.message }))
    });

    const { workspace: patched, patched: didPatch } = await patchFile(
      current,
      targetFile,
      errorsBefore,
      originalQuery,
      skill
    );

    const patchMs = Date.now() - patchStart;
    fileAttemptCounts[targetFile] = (fileAttemptCounts[targetFile] ?? 0) + 1;

    if (!didPatch) {
      // Could not patch this file, mark it as exhausted
      fileAttemptCounts[targetFile] = maxPerFileAttempts;
      continue;
    }

    current = patched;

    // Re-validate just this file's errors to report progress
    const revalidation = await validateWorkspace(current, sessionId);
    const remainingForFile = revalidation.errors.filter(e => e.path === targetFile);

    iterations.push({
      iteration: globalIter + 1,
      filePath: targetFile,
      errorsBefore,
      patchApplied: didPatch,
      errorsAfter: remainingForFile,
      durationMs: patchMs + validationMs
    });

    broadcastEvent("agent:iteration_complete", {
      sessionId,
      iteration: globalIter + 1,
      maxIterations: maxGlobalIterations,
      filePath: targetFile,
      errorsRemaining: remainingForFile.length
    });
  }

  // Final validation
  const finalValidation = await validateWorkspace(current, sessionId);

  return {
    success: finalValidation.success,
    workspace: current,
    iterations,
    finalErrors: finalValidation.errors
  };
}
