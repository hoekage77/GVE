/**
 * Agent Runner — Core agent loop executor for Kimi K2.5 Agent Mode
 */

import { executeAgentTool } from "./agent-tools.js";

import { getPool } from "./llm-pool.js";

async function fetchAgentCompletion(messages: any[], tools: any[]) {
  const pool = getPool();
  let attempt = 0;
  const maxAttempts = 5;

  while (attempt < maxAttempts) {
    const acquired = pool.acquire({ requireCodeGeneration: true });
    if (!acquired) {
      throw new Error("No LLM providers available in the pool for agent mode.");
    }

    const { provider, waitMs } = acquired;
    if (waitMs > 0) {
      await new Promise(r => setTimeout(r, waitMs));
    }

    const payload = {
      model: provider.model,
      temperature: 0.1, // Agents generally prefer lower temperature for tool reliability
      messages,
      ...(tools && tools.length > 0 ? { tools } : {})
    };

    try {
      const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
      const startMs = Date.now();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          pool.markExhausted(provider.id, `HTTP ${response.status}`);
          attempt++;
          continue;
        }
        const bodyText = await response.text();
        throw new Error(`Agent request failed (${response.status}) via ${provider.id}: ${bodyText.slice(0, 300)}`);
      }

      pool.recordRequest(provider.id, Date.now() - startMs);
      pool.markHealthy(provider.id);
      return await response.json();
    } catch (err: any) {
      pool.markExhausted(provider.id, err.message || "network-error");
      attempt++;
    }
  }

  throw new Error("Agent loop exhausted all LLM pool providers after multiple attempts.");
}

function extractToolCalls(assistantMessage: any) {
  if (!assistantMessage?.tool_calls || !Array.isArray(assistantMessage.tool_calls)) {
    return [];
  }

  return assistantMessage.tool_calls.map((tc: any) => ({
    id: tc.id,
    name: tc.function?.name ?? "unknown",
    arguments: parseToolArguments(tc.function?.arguments)
  }));
}

function parseToolArguments(argsString: string) {
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

function isManimSkill(skill: string | undefined | null) {
  return String(skill ?? "").trim().toLowerCase() === "manim";
}

function buildCodeFenceLanguage(skill: string | undefined | null) {
  return isManimSkill(skill) ? "python" : "javascript";
}

function extractCodeFromFinalText(finalText: string | undefined | null, skill: string | undefined | null) {
  const text = String(finalText ?? "");
  if (!text) return null;

  if (isManimSkill(skill)) {
    const manimMatch = text.match(/```(?:python|py)?\s*([\s\S]*?)```/i);
    return manimMatch ? manimMatch[1]?.trim() ?? null : null;
  }

  const jsMatch = text.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
  return jsMatch ? jsMatch[1]?.trim() ?? null : null;
}

export async function runAgentLoop({
  messages,
  tools,
  maxIterations = 5,
  onToolCall,
  onToolResult,
  onIteration
}: any) {
  const conversationMessages = [...messages];
  const toolCallHistory: any[] = [];
  let iterations = 0;
  let aborted = false;

  console.log(`[AgentRunner] Starting agent loop (max ${maxIterations} iterations, ${tools?.length || 0} tools).`);

  while (iterations < maxIterations) {
    iterations += 1;

    if (typeof onIteration === "function") {
      onIteration(iterations, conversationMessages.length);
    }

    const responsePayload = await fetchAgentCompletion(conversationMessages, tools);
    const choice = responsePayload?.choices?.[0];

    if (!choice) {
      console.warn("[AgentRunner] No choice in response, aborting.");
      aborted = true;
      break;
    }

    const assistantMessage = choice.message;
    const finishReason = choice.finish_reason;

    conversationMessages.push(assistantMessage);

    const toolCalls = extractToolCalls(assistantMessage);

    if (toolCalls.length === 0 || finishReason === "stop") {
      return {
        finalText: assistantMessage.content ?? "",
        toolCallHistory,
        iterations,
        aborted: false
      };
    }

    for (const tc of toolCalls) {
      if (typeof onToolCall === "function") onToolCall(tc.name, tc.arguments, iterations);

      let toolResult;
      try {
        toolResult = await executeAgentTool(tc.name, tc.arguments);
      } catch (err: any) {
        toolResult = { error: err.message || "Tool execution failed", success: false };
      }

      if (typeof onToolResult === "function") onToolResult(tc.name, toolResult, iterations);

      toolCallHistory.push({ iteration: iterations, tool: tc.name, args: tc.arguments, result: toolResult });
      conversationMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(toolResult) });
    }
  }

  if (!aborted) aborted = true;

  const lastAssistant = conversationMessages.filter((m) => m.role === "assistant").pop();

  return { finalText: lastAssistant?.content ?? "", toolCallHistory, iterations, aborted };
}

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
}: any) {
  const manim = isManimSkill(skill);
  const codeFenceLanguage = buildCodeFenceLanguage(skill);
  const errorSummary = validationErrors.map((e: any) => `[${e.code}] ${e.message}${e.line ? ` (line ${e.line})` : ""}`).join("\n");

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

  const result = await runAgentLoop({ messages, tools, maxIterations, onToolCall, onToolResult, onIteration });

  let fixedCode = null;
  let success = false;

  const lastSuccessfulFix = [...result.toolCallHistory].reverse().find((tc) =>
    (tc.tool === "fix_code" || tc.tool === "validate_code") && tc.result?.valid === true
  );

  if (lastSuccessfulFix) {
    fixedCode = lastSuccessfulFix.args.code;
    success = true;
  } else if (result.finalText) {
    const extractedCode = extractCodeFromFinalText(result.finalText, skill);
    if (extractedCode) fixedCode = extractedCode;
  }

  return { fixedCode, success, toolCallHistory: result.toolCallHistory, iterations: result.iterations, aborted: result.aborted, finalText: result.finalText };
}

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
}: any) {
  const manim = isManimSkill(skill);
  const codeFenceLanguage = buildCodeFenceLanguage(skill);
  const normalizedHints = Array.isArray(compatibilityHints) ? compatibilityHints.filter((hint: any) => typeof hint === "string" && hint.trim().length > 0) : [];

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
    ...normalizedHints.map((hint: string) => `- ${hint}`)
  ].join("\n");

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  const result = await runAgentLoop({ messages, tools, maxIterations, onToolCall, onToolResult, onIteration });

  let fixedCode = null;
  let success = false;

  const lastSuccessfulExecution = [...result.toolCallHistory].reverse().find((tc) => tc.tool === "execute_code" && tc.result?.success === true && typeof tc.args?.code === "string");

  if (lastSuccessfulExecution) {
    fixedCode = lastSuccessfulExecution.args.code;
    success = true;
  } else if (!fixedCode) {
    const lastValidFix = [...result.toolCallHistory].reverse().find((tc) => tc.tool === "fix_code" && tc.result?.valid === true && typeof tc.args?.code === "string");
    if (lastValidFix) fixedCode = lastValidFix.args.code;
  }

  if (!fixedCode && result.finalText) {
    const extractedCode = extractCodeFromFinalText(result.finalText, skill);
    if (extractedCode) fixedCode = extractedCode;
  }

  return { fixedCode, success, toolCallHistory: result.toolCallHistory, iterations: result.iterations, aborted: result.aborted, finalText: result.finalText };
}

export async function attemptRuntimeAgentRecovery(options: any): Promise<any> {
  // Stub - will be fully extracted from orchestrator.ts later
  return {
    recovered: false,
    debugUsed: false,
    recoveredCode: options.failedCode,
    recoveredRuntime: options.runtimeResult,
    warning: "Runtime recovery not yet implemented",
    iterations: 0
  };
}
