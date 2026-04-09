/**
 * Agent Runner — Core agent loop executor for Kimi K2.5 Agent Mode
 *
 * Implements the agentic function-calling loop:
 *   1. Send messages + tool definitions to the model
 *   2. If response contains tool_calls → execute each tool → append results
 *   3. Loop until model produces a final text response (no tool_calls)
 *   4. Enforce max iteration limit to prevent runaway loops
 *
 * This is used by the self-debugging flow and can be extended for
 * any agentic use case (image analysis, research, etc).
 */

import { executeAgentTool } from "./agent-tools.js";

const moonshotBaseUrl = process.env.MOONSHOT_BASE_URL ?? "https://api.moonshot.ai/v1";
const moonshotModel = process.env.MOONSHOT_MODEL ?? "kimi-k2.5";
const moonshotApiKey = process.env.MOONSHOT_API_KEY;

function parseTemperature(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const moonshotAgentProfile = Object.freeze({
  temperature: parseTemperature(process.env.MOONSHOT_AGENT_TEMPERATURE, 1.0)
});

/**
 * Execute a single non-streaming chat completion with tools.
 * Returns the parsed response body.
 */
async function fetchAgentCompletion(messages, tools) {
  if (!moonshotApiKey) {
    throw new Error("MOONSHOT_API_KEY is not configured for agent mode.");
  }

  const payload = {
    model: moonshotModel,
    temperature: moonshotAgentProfile.temperature,
    messages,
    ...(tools && tools.length > 0 ? { tools } : {})
  };

  const response = await fetch(`${moonshotBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${moonshotApiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Agent mode request failed (${response.status}): ${bodyText.slice(0, 300)}`);
  }

  return response.json();
}

/**
 * Extract tool calls from an assistant message.
 * Returns an array of { id, name, arguments } or empty array if none.
 */
function extractToolCalls(assistantMessage) {
  if (!assistantMessage?.tool_calls || !Array.isArray(assistantMessage.tool_calls)) {
    return [];
  }

  return assistantMessage.tool_calls.map((tc) => ({
    id: tc.id,
    name: tc.function?.name ?? "unknown",
    arguments: parseToolArguments(tc.function?.arguments)
  }));
}

/**
 * Safely parse tool call arguments from the model's JSON string.
 */
function parseToolArguments(argsString) {
  if (!argsString || typeof argsString !== "string") {
    return {};
  }

  try {
    return JSON.parse(argsString);
  } catch {
    console.warn("[AgentRunner] Failed to parse tool arguments:", argsString.slice(0, 200));
    return {};
  }
}

function isManimSkill(skill) {
  return String(skill ?? "").trim().toLowerCase() === "manim";
}

function buildCodeFenceLanguage(skill) {
  return isManimSkill(skill) ? "python" : "javascript";
}

function extractCodeFromFinalText(finalText, skill) {
  const text = String(finalText ?? "");
  if (!text) {
    return null;
  }

  if (isManimSkill(skill)) {
    const manimMatch = text.match(/```(?:python|py)?\s*([\s\S]*?)```/i);
    return manimMatch ? manimMatch[1].trim() : null;
  }

  const jsMatch = text.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
  return jsMatch ? jsMatch[1].trim() : null;
}

/**
 * Run the agent loop until completion or max iterations.
 *
 * @param {object} options
 * @param {Array} options.messages - Initial messages array (system + user + any context)
 * @param {Array} options.tools - OpenAI-compatible tool definitions
 * @param {number} [options.maxIterations=5] - Max tool-call rounds
 * @param {Function} [options.onToolCall] - Callback: (toolName, args, iteration) => void
 * @param {Function} [options.onToolResult] - Callback: (toolName, result, iteration) => void
 * @param {Function} [options.onIteration] - Callback: (iteration, messageCount) => void
 * @returns {Promise<object>} { finalText, toolCallHistory, iterations, aborted }
 */
export async function runAgentLoop({
  messages,
  tools,
  maxIterations = 5,
  onToolCall,
  onToolResult,
  onIteration
}) {
  const conversationMessages = [...messages];
  const toolCallHistory = [];
  let iterations = 0;
  let aborted = false;

  console.log(`[AgentRunner] Starting agent loop (max ${maxIterations} iterations, ${tools.length} tools).`);

  while (iterations < maxIterations) {
    iterations += 1;

    if (typeof onIteration === "function") {
      onIteration(iterations, conversationMessages.length);
    }

    console.log(`[AgentRunner] Iteration ${iterations}/${maxIterations} — sending ${conversationMessages.length} messages.`);

    // Call the model with current conversation + tools
    const responsePayload = await fetchAgentCompletion(conversationMessages, tools);
    const choice = responsePayload?.choices?.[0];

    if (!choice) {
      console.warn("[AgentRunner] No choice in response, aborting.");
      aborted = true;
      break;
    }

    const assistantMessage = choice.message;
    const finishReason = choice.finish_reason;

    // Append the assistant's message to the conversation
    conversationMessages.push(assistantMessage);

    // Check if the model wants to call tools
    const toolCalls = extractToolCalls(assistantMessage);

    if (toolCalls.length === 0 || finishReason === "stop") {
      // No tool calls — the agent is done
      console.log(`[AgentRunner] Agent completed after ${iterations} iteration(s). Finish reason: ${finishReason}`);
      return {
        finalText: assistantMessage.content ?? "",
        toolCallHistory,
        iterations,
        aborted: false
      };
    }

    // Execute each tool call and append results
    console.log(`[AgentRunner] Agent requested ${toolCalls.length} tool call(s).`);

    for (const tc of toolCalls) {
      if (typeof onToolCall === "function") {
        onToolCall(tc.name, tc.arguments, iterations);
      }

      console.log(`[AgentRunner]   → Executing tool: ${tc.name}`);
      let toolResult;

      try {
        toolResult = await executeAgentTool(tc.name, tc.arguments);
      } catch (err) {
        toolResult = {
          error: err instanceof Error ? err.message : "Tool execution failed",
          success: false
        };
      }

      if (typeof onToolResult === "function") {
        onToolResult(tc.name, toolResult, iterations);
      }

      // Record in history
      toolCallHistory.push({
        iteration: iterations,
        tool: tc.name,
        args: tc.arguments,
        result: toolResult
      });

      // Append tool result as a tool-role message for the next iteration
      conversationMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(toolResult)
      });
    }
  }

  // If we exit the loop, we hit the iteration limit
  if (!aborted) {
    aborted = true;
    console.warn(`[AgentRunner] Max iterations (${maxIterations}) reached. Returning last state.`);
  }

  // Try to extract any text from the last assistant message
  const lastAssistant = conversationMessages
    .filter((m) => m.role === "assistant")
    .pop();

  return {
    finalText: lastAssistant?.content ?? "",
    toolCallHistory,
    iterations,
    aborted
  };
}

/**
 * Run a self-debugging agent session.
 *
 * Given failed code+errors, instructs the agent to fix the code using
 * validate_code and fix_code tools.
 *
 * @param {object} options
 * @param {string} options.originalQuery - The user's original query
 * @param {string} options.failedCode - The code that failed validation
 * @param {Array} options.validationErrors - Array of error objects from validateCode()
 * @param {string} options.skill - The target skill (threejs, p5js, d3js, animejs)
 * @param {Array} options.tools - Tool definitions to provide
 * @param {number} [options.maxIterations=3] - Max fix attempts
 * @param {Function} [options.onToolCall] - Tool call callback
 * @param {Function} [options.onToolResult] - Tool result callback
 * @param {Function} [options.onIteration] - Iteration callback
 * @returns {Promise<object>} { fixedCode, success, toolCallHistory, iterations }
 */
export async function runSelfDebugSession({
  originalQuery,
  failedCode,
  validationErrors,
  skill,
  tools,
  maxIterations = 3,
  onToolCall,
  onToolResult,
  onIteration
}) {
  const manim = isManimSkill(skill);
  const codeFenceLanguage = buildCodeFenceLanguage(skill);
  const errorSummary = validationErrors
    .map((e) => `[${e.code}] ${e.message}${e.line ? ` (line ${e.line})` : ""}`)
    .join("\n");

  const systemPrompt = [
    manim
      ? "You are a Python Manim code debugging agent for a visual generation engine."
      : "You are a JavaScript code debugging agent for a visual generation engine.",
    "The user asked for a visualization and I generated code, but it failed validation.",
    "Your job is to fix the code so it passes validation.",
    "",
    "Rules:",
    `- The code must target the ${skill} rendering engine/runtime.`,
    manim
      ? "- Return valid Python Manim code with one scene class named GVERichScene and construct(self)."
      : skill === "threejs"
        ? "- Assume scene, camera, renderer, THREE, and OrbitControls are pre-initialized globals."
        : skill === "p5js"
          ? "- The code should define setup() and/or draw() functions or use createCanvas()."
          : skill === "animejs"
            ? "- Use the anime global API for timeline/tween animation and target DOM/SVG nodes."
            : "- The code should use the d3 namespace for DOM manipulation.",
    manim
      ? "- Include from manim import * near the top. If NumPy is used, include import numpy as np."
      : "- Do NOT use eval(), Function constructor, fetch(), require(), or import().",
    manim
      ? "- Use modern Manim APIs: Axes/NumberPlane should use x_range/y_range, not x_min/x_max/y_min/y_max."
      : "- Do NOT use any Node.js APIs (process, fs, child_process).",
    manim ? "- Avoid filesystem/network/subprocess operations." : null,
    "- Use the fix_code tool to submit your corrected code.",
    "- If fix_code says the code still has issues, keep fixing until it passes.",
    "- Once the code validates successfully, respond with the final working code in a code block."
  ].filter(Boolean).join("\n");

  const userPrompt = [
    `Original user request: "${originalQuery}"`,
    "",
    "The following code was generated but failed validation:",
    `\`\`\`${codeFenceLanguage}`,
    failedCode,
    "```",
    "",
    "Validation errors:",
    errorSummary,
    "",
    "Please fix this code. Use the fix_code tool to submit your corrected version."
  ].join("\n");

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  console.log(`[SelfDebug] Starting debug session for skill=${skill}, ${validationErrors.length} error(s).`);

  const result = await runAgentLoop({
    messages,
    tools,
    maxIterations,
    onToolCall,
    onToolResult,
    onIteration
  });

  // Try to extract fixed code from the agent's final response or tool history
  let fixedCode = null;
  let success = false;

  // Check tool call history for the last successful fix_code or validate_code call
  const lastSuccessfulFix = [...result.toolCallHistory]
    .reverse()
    .find((tc) =>
      (tc.tool === "fix_code" || tc.tool === "validate_code") &&
      tc.result?.valid === true
    );

  if (lastSuccessfulFix) {
    fixedCode = lastSuccessfulFix.args.code;
    success = true;
    console.log(`[SelfDebug] Successfully fixed code via ${lastSuccessfulFix.tool} tool.`);
  } else if (result.finalText) {
    // Try extracting code from the agent's final text response
    const extractedCode = extractCodeFromFinalText(result.finalText, skill);
    if (extractedCode) {
      fixedCode = extractedCode;
      // We'll need to re-validate this outside
      console.log("[SelfDebug] Extracted code from agent's final text response.");
    }
  }

  if (!success && !fixedCode) {
    console.warn("[SelfDebug] Agent could not produce fixed code.");
  }

  return {
    fixedCode,
    success,
    toolCallHistory: result.toolCallHistory,
    iterations: result.iterations,
    aborted: result.aborted,
    finalText: result.finalText
  };
}

/**
 * Run a runtime-focused self-debugging agent session.
 *
 * Unlike validation-only self-debug, this flow allows execute_code tool calls
 * so the agent can verify fixes against sandbox runtime failures.
 *
 * @param {object} options
 * @param {string} options.originalQuery - User's original request
 * @param {string} options.failedCode - Code that failed at runtime
 * @param {string} options.runtimeError - Runtime error message
 * @param {string} [options.runtimeStatus] - Runtime status label
 * @param {string} options.skill - Target skill
 * @param {Array} options.tools - Tool definitions
 * @param {number} [options.maxIterations=3] - Max fix attempts
 * @param {Function} [options.onToolCall]
 * @param {Function} [options.onToolResult]
 * @param {Function} [options.onIteration]
 * @param {Array<string>} [options.compatibilityHints] - Compatibility-safe hints for unsupported APIs
 * @returns {Promise<object>} { fixedCode, success, toolCallHistory, iterations }
 */
export async function runRuntimeDebugSession({
  originalQuery,
  failedCode,
  runtimeError,
  runtimeStatus,
  skill,
  tools,
  maxIterations = 3,
  onToolCall,
  onToolResult,
  onIteration,
  compatibilityHints = []
}) {
  const manim = isManimSkill(skill);
  const codeFenceLanguage = buildCodeFenceLanguage(skill);
  const normalizedHints = Array.isArray(compatibilityHints)
    ? compatibilityHints.filter((hint) => typeof hint === "string" && hint.trim().length > 0)
    : [];

  const systemPrompt = [
    manim
      ? "You are a Python Manim runtime-debugging agent for a visual generation engine."
      : "You are a JavaScript runtime-debugging agent for a visual generation engine.",
    "The code passed static validation but failed during sandbox execution.",
    "Your job is to fix runtime issues and verify execution success.",
    "",
    "Rules:",
    `- The code must target the ${skill} rendering engine/runtime.`,
    manim
      ? "- Return valid Python Manim code with one scene class named GVERichScene and construct(self)."
      : skill === "threejs"
        ? "- Assume scene, camera, renderer, THREE, and OrbitControls are pre-initialized globals."
        : skill === "p5js"
          ? "- The code should define setup() and/or draw() functions or use createCanvas()."
          : skill === "animejs"
            ? "- Use the anime global API for timeline/tween animation and target DOM/SVG nodes."
            : "- The code should use the d3 namespace for DOM manipulation.",
    manim
      ? "- Include from manim import * near the top. If NumPy is used, include import numpy as np."
      : "- Do NOT use eval(), Function constructor, fetch(), require(), or import().",
    manim
      ? "- Use modern Manim APIs: Axes/NumberPlane should use x_range/y_range, not x_min/x_max/y_min/y_max."
      : "- Do NOT use any Node.js APIs (process, fs, child_process).",
    manim ? "- Avoid filesystem/network/subprocess operations." : null,
    "- Use fix_code to submit corrected code.",
    "- Use execute_code to verify runtime behavior after fixes.",
    "- Keep iterating until execute_code returns success=true or you run out of iterations.",
    "- Once execution succeeds, return the final working code in a code block.",
    "- Prefer compatibility-safe API calls over cutting-edge constructors/methods.",
    "- Keep patches minimal and targeted to the failing API lines."
  ].filter(Boolean).join("\n");

  const userPrompt = [
    `Original user request: \"${originalQuery}\"`,
    `Runtime status: ${runtimeStatus ?? "error"}`,
    `Runtime error: ${runtimeError ?? "Unknown runtime error"}`,
    "",
    "The following code failed at runtime:",
    `\`\`\`${codeFenceLanguage}`,
    failedCode,
    "```",
    "",
    "Fix and verify this code.",
    normalizedHints.length > 0 ? "Compatibility hints:" : "",
    ...normalizedHints.map((hint) => `- ${hint}`)
  ].join("\n");

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  console.log(`[RuntimeDebug] Starting runtime debug session for skill=${skill}.`);

  const result = await runAgentLoop({
    messages,
    tools,
    maxIterations,
    onToolCall,
    onToolResult,
    onIteration
  });

  let fixedCode = null;
  let success = false;

  const lastSuccessfulExecution = [...result.toolCallHistory]
    .reverse()
    .find((tc) => tc.tool === "execute_code" && tc.result?.success === true && typeof tc.args?.code === "string");

  if (lastSuccessfulExecution) {
    fixedCode = lastSuccessfulExecution.args.code;
    success = true;
    console.log(`[RuntimeDebug] Successfully repaired runtime code in ${result.iterations} iteration(s).`);
  }

  if (!fixedCode) {
    const lastValidFix = [...result.toolCallHistory]
      .reverse()
      .find((tc) => tc.tool === "fix_code" && tc.result?.valid === true && typeof tc.args?.code === "string");

    if (lastValidFix) {
      fixedCode = lastValidFix.args.code;
      console.log("[RuntimeDebug] Found validated fix code, but runtime success was not confirmed in-loop.");
    }
  }

  if (!fixedCode && result.finalText) {
    const extractedCode = extractCodeFromFinalText(result.finalText, skill);
    if (extractedCode) {
      fixedCode = extractedCode;
      console.log("[RuntimeDebug] Extracted code from agent final text.");
    }
  }

  if (!success && !fixedCode) {
    console.warn("[RuntimeDebug] Agent could not produce runtime-repaired code.");
  }

  return {
    fixedCode,
    success,
    toolCallHistory: result.toolCallHistory,
    iterations: result.iterations,
    aborted: result.aborted,
    finalText: result.finalText
  };
}
