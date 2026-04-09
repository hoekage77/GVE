import assert from "node:assert/strict";

const startedAt = Date.now();
const checks = [];

function runCheck(name, fn) {
  try {
    fn();
    checks.push({ name, pass: true });
  } catch (error) {
    checks.push({
      name,
      pass: false,
      message: error?.message ?? String(error)
    });
  }
}

process.env.MOONSHOT_API_KEY = process.env.MOONSHOT_API_KEY || "test-moonshot-key";
process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "test-deepseek-key";
process.env.GROQ_API_KEY = "";
process.env.GEMINI_API_KEY = "";
process.env.TOGETHER_API_KEY = "";
process.env.MOONSHOT_MODEL = process.env.MOONSHOT_MODEL || "kimi-k2.5";

const originalFetch = global.fetch;
let moonshotCalls = 0;
let deepseekCalls = 0;
let diagnostics = null;

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

global.fetch = async (url) => {
  const endpoint = String(url ?? "");

  if (endpoint.includes("moonshot.ai")) {
    moonshotCalls += 1;
    return jsonResponse(429, { error: { message: "rate limited" } });
  }

  if (endpoint.includes("deepseek.com")) {
    deepseekCalls += 1;
    return jsonResponse(200, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              intent: "User wants a rotating visual scene.",
              skill: "Three.js fits best for interactive 3D animation.",
              plan: "Generate scene setup, animate mesh, and return concise execution steps.",
              generating: "Create a renderer, camera, rotating mesh, and lighting.",
              validating: "Check syntax and runtime safety before execution.",
              executing: "Run in sandbox and verify render output.",
              complete: "Scene generation should complete with smooth rotation."
            })
          }
        }
      ]
    });
  }

  return jsonResponse(500, { error: { message: `Unexpected endpoint: ${endpoint}` } });
};

try {
  const { resetPool, getPool } = await import("../server/llm-pool.js");
  const { generateThinkingAnalysis } = await import("../server/orchestrator.js");

  resetPool();

  const analysis = await generateThinkingAnalysis("Create a rotating cube with soft cinematic lighting.");
  const status = getPool().getStatus();
  const moonshotStatus = status.providers.find((provider) => provider.id === "moonshot") ?? null;
  const deepseekStatus = status.providers.find((provider) => provider.id === "deepseek") ?? null;

  runCheck("analysis_generated", () => {
    assert.ok(analysis && typeof analysis === "object");
    assert.equal(typeof analysis.intent, "string");
  });

  runCheck("moonshot_attempted", () => {
    assert.ok(moonshotCalls >= 1, "Expected Moonshot to be attempted first.");
  });

  runCheck("deepseek_fallback_used", () => {
    assert.ok(deepseekCalls >= 1, "Expected DeepSeek fallback after Moonshot failure.");
  });

  runCheck("moonshot_marked_failed", () => {
    assert.ok((moonshotStatus?.totalFailures ?? 0) >= 1, "Expected Moonshot failure metric to increment.");
  });

  runCheck("deepseek_marked_success", () => {
    assert.ok((deepseekStatus?.totalSuccesses ?? 0) >= 1, "Expected DeepSeek success metric to increment.");
  });

  diagnostics = {
    moonshotCalls,
    deepseekCalls,
    moonshotState: moonshotStatus,
    deepseekState: deepseekStatus,
    analysisKeys: Object.keys(analysis ?? {})
  };
} catch (error) {
  runCheck("test_execution", () => {
    throw error;
  });

  diagnostics = {
    error: error?.message ?? String(error)
  };
} finally {
  global.fetch = originalFetch;
}

const passed = checks.filter((check) => check.pass).length;
const failed = checks.length - passed;
const output = {
  service: "llm-provider-failover",
  testType: "regression",
  elapsedMs: Date.now() - startedAt,
  ok: failed === 0,
  metrics: {
    totalChecks: checks.length,
    passed,
    failed
  },
  checks,
  diagnostics
};

console.log(JSON.stringify(output, null, 2));
process.exit(output.ok ? 0 : 1);
