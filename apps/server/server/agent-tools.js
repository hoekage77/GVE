/**
 * Agent Tools — Tool definitions for Kimi K2.5 Agent Mode
 *
 * Provides structured tool definitions for the agent's function calling
 * and the server-side handlers that execute when the agent invokes them.
 *
 * Tool sets are organized by use-case:
 *  - Debug tools:         validate_code, fix_code, get_error_context
 *  - Runtime debug tools: validate_code, fix_code, execute_code, get_error_context
 *  - Generation tools:    validate_code, execute_code
 */

import { validateCode } from "./code-validator.js";
import { executeSkillRuntime } from "./skill-runtime.js";

function parsePositiveIntEnv(rawValue, fallbackValue, minimum = 1) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }

  return Math.max(minimum, parsed);
}

const runtimeExecutionTimeoutMs = parsePositiveIntEnv(
  process.env.RUNTIME_EXEC_TIMEOUT_MS,
  2200,
  300
);
const manimRuntimeExecutionTimeoutMs = parsePositiveIntEnv(
  process.env.RUNTIME_EXEC_TIMEOUT_MANIM_MS,
  90_000,
  2_000
);
const runtimeExecutionMaxFrames = parsePositiveIntEnv(
  process.env.RUNTIME_EXEC_MAX_FRAMES,
  48,
  1
);

function resolveRuntimeExecutionTimeoutMs(skillId) {
  return skillId === "manim" ? manimRuntimeExecutionTimeoutMs : runtimeExecutionTimeoutMs;
}

function getRemainingBudgetMs(deadlineAtMs) {
  if (!Number.isFinite(deadlineAtMs)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, deadlineAtMs - Date.now());
}

function computeBoundedTimeoutMs(deadlineAtMs, configuredTimeoutMs, minimumTimeoutMs = 300) {
  const remainingMs = getRemainingBudgetMs(deadlineAtMs);
  if (!Number.isFinite(remainingMs)) {
    return configuredTimeoutMs;
  }

  if (remainingMs <= 0) {
    return 0;
  }

  const minimum = Math.min(minimumTimeoutMs, remainingMs);
  return Math.max(minimum, Math.min(configuredTimeoutMs, remainingMs));
}

// ── Tool Definitions (OpenAI-compatible function calling schema) ──

const toolDefinitions = {
  validate_code: {
    type: "function",
    function: {
      name: "validate_code",
      description: "Validate generated scene code for syntax errors, security violations, and API compliance. Returns validation results with specific error details.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The scene code to validate."
          },
          skill: {
            type: "string",
            enum: ["threejs", "p5js", "d3js", "animejs", "manim"],
            description: "The rendering skill/engine the code targets."
          }
        },
        required: ["code", "skill"]
      }
    }
  },

  fix_code: {
    type: "function",
    function: {
      name: "fix_code",
      description: "Submit corrected scene code after seeing validation errors. The code will be re-validated automatically. Returns validation results for the fixed code.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The corrected scene code."
          },
          skill: {
            type: "string",
            enum: ["threejs", "p5js", "d3js", "animejs", "manim"],
            description: "The rendering skill/engine the code targets."
          },
          changes_made: {
            type: "string",
            description: "Brief description of what was fixed."
          }
        },
        required: ["code", "skill"]
      }
    }
  },

  execute_code: {
    type: "function",
    function: {
      name: "execute_code",
      description: "Execute validated scene code in a sandboxed runtime environment to test rendering. Returns render stats and any runtime errors.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The validated scene code to execute."
          },
          skill: {
            type: "string",
            enum: ["threejs", "p5js", "d3js", "animejs", "manim"],
            description: "The rendering skill/engine."
          }
        },
        required: ["code", "skill"]
      }
    }
  },

  get_error_context: {
    type: "function",
    function: {
      name: "get_error_context",
      description: "Retrieve the original user query and full validation error details for the failed code. Use this to understand what the user wanted and what went wrong before attempting a fix.",
      parameters: {
        type: "object",
        properties: {
          include_code: {
            type: "boolean",
            description: "Whether to include the full failed code in the response. Defaults to false to save tokens."
          }
        },
        required: []
      }
    }
  }
};

// ── Flat array for backward compatibility ──

export const agentToolDefinitions = Object.values(toolDefinitions);

// ── Filtered tool sets by use-case ──

/**
 * Get tool definitions for the self-debugging flow.
 * Includes: validate_code, fix_code, get_error_context
 */
export function getDebugTools() {
  return [
    toolDefinitions.validate_code,
    toolDefinitions.fix_code,
    toolDefinitions.get_error_context
  ];
}

/**
 * Get tool definitions for runtime error recovery.
 * Includes execute_code so the agent can verify fixes against sandbox execution.
 */
export function getRuntimeDebugTools() {
  return [
    toolDefinitions.validate_code,
    toolDefinitions.fix_code,
    toolDefinitions.execute_code,
    toolDefinitions.get_error_context
  ];
}

/**
 * Get tool definitions for agent-powered generation.
 * Includes: validate_code, execute_code
 */
export function getGenerationTools() {
  return [
    toolDefinitions.validate_code,
    toolDefinitions.execute_code
  ];
}

/**
 * Get all available tool definitions.
 */
export function getAllTools() {
  return agentToolDefinitions;
}

// ── Shared error context store ──
// Populated by the orchestrator before starting a debug session,
// read by the get_error_context tool handler.

let _currentErrorContext = null;

/**
 * Set the error context for the current debug session.
 * Call this before running the agent debug loop.
 *
 * @param {object} ctx
 * @param {string} ctx.originalQuery - The user's original query
 * @param {string} ctx.failedCode - The code that failed validation
 * @param {Array} [ctx.validationErrors] - Validation error objects
 * @param {string} ctx.skill - Target skill
 * @param {string} [ctx.runtimeError] - Runtime failure message
 * @param {string} [ctx.runtimeStatus] - Runtime status (error/skipped/etc)
 * @param {object} [ctx.runtimeDetails] - Additional runtime failure details
 * @param {Array<string>} [ctx.runtimeHints] - Compatibility hints for runtime mismatch recovery
 * @param {string} [ctx.compatibilityMode] - Compatibility strategy mode label
 * @param {number} [ctx.runtimeDebugDeadlineAtMs] - Absolute deadline (ms epoch) for runtime debug tools
 */
export function setErrorContext(ctx) {
  _currentErrorContext = ctx;
}

/**
 * Clear the error context after the debug session completes.
 */
export function clearErrorContext() {
  _currentErrorContext = null;
}

// ── Tool Handlers ──

/**
 * Execute an agent tool call and return the result.
 *
 * @param {string} toolName - Name of the tool to execute
 * @param {object} args - Tool arguments (parsed from agent response)
 * @returns {Promise<object>} Tool execution result
 */
export async function executeAgentTool(toolName, args) {
  switch (toolName) {
    case "validate_code":
      return handleValidateCode(args);
    case "fix_code":
      return handleFixCode(args);
    case "execute_code":
      return handleExecuteCode(args);
    case "get_error_context":
      return handleGetErrorContext(args);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

function handleValidateCode({ code, skill }) {
  const result = validateCode(code, skill ?? "threejs");
  return {
    valid: result.valid,
    passable: result.passable,
    errorCount: result.errors.length,
    errors: result.errors.map(e => ({
      code: e.code,
      message: e.message,
      line: e.line ?? null
    })),
    summary: result.valid
      ? "Code passes all validation checks."
      : `Found ${result.errors.length} issue(s): ${result.errors.map(e => e.message).join("; ")}`
  };
}

function handleFixCode({ code, skill, changes_made }) {
  // Fix submissions are re-validated automatically
  const result = validateCode(code, skill ?? "threejs");
  return {
    valid: result.valid,
    passable: result.passable,
    errorCount: result.errors.length,
    errors: result.errors.map(e => ({
      code: e.code,
      message: e.message,
      line: e.line ?? null
    })),
    changes_acknowledged: changes_made ?? "No description provided.",
    summary: result.valid
      ? "Fixed code passes all validation checks."
      : `Still has ${result.errors.length} issue(s): ${result.errors.map(e => e.message).join("; ")}`
  };
}

async function handleExecuteCode({ code, skill }) {
  try {
    const resolvedSkill = skill ?? "threejs";
    const timeoutMs = computeBoundedTimeoutMs(
      _currentErrorContext?.runtimeDebugDeadlineAtMs,
      resolveRuntimeExecutionTimeoutMs(resolvedSkill)
    );
    if (timeoutMs <= 0) {
      return {
        success: false,
        status: "error",
        error: "Runtime debug budget exhausted before execute_code call.",
        summary: "Execution skipped because runtime debug budget was exhausted."
      };
    }

    const runtimeResult = await executeSkillRuntime({
      skillId: resolvedSkill,
      code,
      timeoutMs,
      maxFrames: resolvedSkill === "manim" ? 1 : runtimeExecutionMaxFrames,
      turnDeadlineAtMs: _currentErrorContext?.runtimeDebugDeadlineAtMs
    });

    return {
      success: runtimeResult.success,
      status: runtimeResult.status,
      renderCount: runtimeResult.renderCount ?? 0,
      frameCount: runtimeResult.frameCount ?? 0,
      durationMs: runtimeResult.durationMs ?? 0,
      error: runtimeResult.error ?? null,
      warning: runtimeResult.warning ?? null,
      summary: runtimeResult.success
        ? `Rendered successfully: ${runtimeResult.renderCount} renders, ${runtimeResult.frameCount} frames in ${runtimeResult.durationMs}ms.`
        : `Execution failed: ${runtimeResult.error ?? "Unknown error"}`
    };
  } catch (err) {
    return {
      success: false,
      status: "error",
      error: err instanceof Error ? err.message : "Unknown execution error",
      summary: `Execution crashed: ${err instanceof Error ? err.message : "Unknown error"}`
    };
  }
}

function handleGetErrorContext({ include_code }) {
  if (!_currentErrorContext) {
    return {
      available: false,
      message: "No error context is currently set. The debug session may not have been initialized properly."
    };
  }

  const validationErrors = Array.isArray(_currentErrorContext.validationErrors)
    ? _currentErrorContext.validationErrors
    : [];
  const runtimeError = typeof _currentErrorContext.runtimeError === "string"
    ? _currentErrorContext.runtimeError
    : null;

  const normalizedErrors = validationErrors.map((e) => ({
    code: e.code,
    message: e.message,
    line: e.line ?? null
  }));

  if (runtimeError) {
    normalizedErrors.push({
      code: "RUNTIME_ERROR",
      message: runtimeError,
      line: null
    });
  }

  const ctx = {
    available: true,
    originalQuery: _currentErrorContext.originalQuery,
    skill: _currentErrorContext.skill,
    errorCount: normalizedErrors.length,
    errors: normalizedErrors,
    runtimeStatus: _currentErrorContext.runtimeStatus ?? null,
    runtimeDetails: _currentErrorContext.runtimeDetails ?? null,
    runtimeHints: Array.isArray(_currentErrorContext.runtimeHints) ? _currentErrorContext.runtimeHints : [],
    compatibilityMode: _currentErrorContext.compatibilityMode ?? null
  };

  if (include_code) {
    ctx.failedCode = _currentErrorContext.failedCode;
  }

  return ctx;
}
