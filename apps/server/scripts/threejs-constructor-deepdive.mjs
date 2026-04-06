import http from "node:http";
import { WebSocket } from "ws";

const apiBase = process.env.WS_TEST_API_BASE ?? "http://127.0.0.1:8000";
const wsUrl = process.env.WS_TEST_URL ?? "ws://127.0.0.1:8000/ws";
const turnTimeoutMs = Number.parseInt(process.env.THREEJS_DEEPDIVE_TURN_TIMEOUT_MS ?? "140000", 10);
const maxTurns = Math.max(1, Number.parseInt(process.env.THREEJS_DEEPDIVE_TURN_COUNT ?? "8", 10));
const testProfile = String(process.env.THREEJS_DEEPDIVE_PROFILE ?? "complex").trim().toLowerCase();

const standardPromptBank = [
  "Create a cinematic neon skyline with animated traffic and orbit controls.",
  "Build a procedural galaxy spiral with stars and camera drift.",
  "Make an abstract kinetic sculpture using tubes, curves, and soft shadows.",
  "Create a scene that uses THREE.MeshPhysicalNodeMaterial on a reflective animated sphere.",
  "Use THREE.ShadowMaterial on a large floor and animate multiple bouncing objects.",
  "Build a path animation that uses THREE.CatmullRomCurve3 and pulsing scale changes.",
  "Create a sci-fi portal scene with layered rings, fog, and emissive materials.",
  "Generate a detailed city block with instancing, custom materials, and moving lights."
];

const complexPromptBank = [
  "Generate a dense cyberpunk megacity at night with layered rain particles, volumetric fog, animated hologram billboards, moving traffic lanes, and full orbit controls.",
  "Create a large procedural alien forest with thousands of instanced plants, animated wind sway, fireflies, god rays, and reflective water with ripples.",
  "Build an advanced space battle scene with many moving ships, projectile trails, bloom-like emissive effects, asteroid debris fields, and cinematic camera motion.",
  "Design a surreal kinetic museum with many parametric sculptures, spline-driven motion, mirror-like surfaces, and dynamic multi-light choreography.",
  "Create a complex underwater city with caustic-like lighting, schools of fish, volumetric particulate haze, and animated coral structures.",
  "Generate a futuristic transit hub with multiple train lines, crowds represented by instanced meshes, animated signage, and long depth-of-field style composition.",
  "Build a giant orbital ring world scene with terrain patches, cloud layers, satellites, and moving sunlight transitions across large-scale geometry.",
  "Create an intricate cathedral interior with stained-glass style colored lighting, dust particles, many columns, and animated camera flythrough.",
  "Design a volcanic planet surface with flowing lava rivers, smoke plumes, heat distortion-like animation patterns, and eruptive debris.",
  "Generate a massive procedural canyon with layered rock strata, fog bands, bird flocks, and moving shadows from fast clouds.",
  "Create a highly detailed laboratory with robotic arms, cables, control screens, and synchronized mechanical animation loops.",
  "Build a mechanical clockwork world with interlocked gears, pistons, rotating rings, and chained motion dependencies."
];

const activePromptBank = testProfile === "standard" ? standardPromptBank : complexPromptBank;

function postJson(pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(`${apiBase}${pathname}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload)
      }
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => {
        raw += chunk;
      });
      res.on("end", () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(raw || "{}") });
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function extractConstructorSymbol(...texts) {
  for (const text of texts) {
    const value = String(text ?? "");
    const match = value.match(/([A-Za-z0-9_$.]+)\s+is not a constructor/i);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function samplePrompt(index) {
  return activePromptBank[index % activePromptBank.length];
}

function extractDeterministicFixes(explanation) {
  const text = String(explanation ?? "");
  const marker = "Deterministic runtime fixes applied:";
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) {
    return [];
  }

  const suffix = text.slice(markerIndex + marker.length).trim();
  const sentenceEnd = suffix.indexOf(".");
  const segment = (sentenceEnd >= 0 ? suffix.slice(0, sentenceEnd) : suffix).trim();
  if (!segment) {
    return [];
  }

  return segment
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function incrementCounter(counterMap, key) {
  const normalizedKey = key || "unknown";
  counterMap[normalizedKey] = (counterMap[normalizedKey] ?? 0) + 1;
}

function classifyTurnFailure(result) {
  if (!result) {
    return "none";
  }

  if (result.terminalType === "timeout") {
    return "timeout";
  }

  if (result.runtimeWarningCode === "RUNTIME_EXEC_SKIPPED_VALIDATION") {
    return "validation-skipped";
  }

  if (result.constructorError) {
    return "constructor-runtime";
  }

  if (result.terminalType === "turn:error") {
    return "runtime-error";
  }

  if (result.runtimeStatus === "degraded") {
    return "runtime-degraded";
  }

  return "none";
}

async function main() {
  const startedAt = Date.now();
  const sessionRes = await postJson("/api/v1/sessions", {});
  const sessionId = sessionRes?.body?.sessionId;

  if (!sessionId) {
    console.log(JSON.stringify({
      ok: false,
      reason: "session_creation_failed",
      response: sessionRes
    }, null, 2));
    process.exit(1);
  }

  const ws = new WebSocket(wsUrl);
  const pendingByRequestId = new Map();
  const eventCounts = {};
  const turnResults = [];

  await new Promise((resolve, reject) => {
    const openTimeout = setTimeout(() => {
      reject(new Error("websocket_open_timeout"));
    }, 15000);

    ws.on("open", () => {
      clearTimeout(openTimeout);
      resolve();
    });

    ws.on("error", (error) => {
      clearTimeout(openTimeout);
      reject(error);
    });
  });

  ws.on("message", (raw) => {
    let event;
    try {
      event = JSON.parse(String(raw));
    } catch {
      return;
    }

    const eventType = event?.type ?? "unknown";
    incrementCounter(eventCounts, eventType);

    const payload = event?.payload ?? {};
    if (payload?.sessionId && payload.sessionId !== sessionId) {
      return;
    }

    if (eventType !== "turn:complete" && eventType !== "turn:error") {
      return;
    }

    const requestId = String(payload?.requestId ?? "");
    if (!requestId) {
      return;
    }

    const pending = pendingByRequestId.get(requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    pendingByRequestId.delete(requestId);
    pending.resolve({ eventType, payload });
  });

  for (let index = 0; index < maxTurns; index += 1) {
    const prompt = samplePrompt(index);
    const requestId = `threejs-deepdive-${Date.now()}-${index}`;
    const turnStart = Date.now();

    const terminalPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingByRequestId.delete(requestId);
        reject(new Error("turn_timeout"));
      }, turnTimeoutMs);

      pendingByRequestId.set(requestId, {
        resolve,
        reject,
        timeout
      });
    });

    ws.send(JSON.stringify({
      type: "message.send",
      payload: {
        sessionId,
        content: prompt,
        requestId,
        clientMessageId: requestId,
        idempotencyKey: requestId,
        mode: "generate"
      }
    }));

    let terminal;
    try {
      // eslint-disable-next-line no-await-in-loop
      terminal = await terminalPromise;
    } catch (error) {
      turnResults.push({
        requestId,
        prompt,
        elapsedMs: Date.now() - turnStart,
        terminalType: "timeout",
        skill: null,
        errorCode: null,
        stage: null,
        runtimeStatus: null,
        runtimeErrorCode: null,
        runtimeWarningCode: null,
        deterministicFixApplied: false,
        deterministicFixes: [],
        constructorError: false,
        constructorSymbol: null,
        explanation: null,
        failureClass: "timeout",
        detail: error?.message ?? String(error)
      });
      continue;
    }

    const error = terminal.payload?.error ?? null;
    const errorCode = error?.code ?? null;
    const stage = error?.stage ?? error?.diagnostics?.stage ?? null;
    const technicalDetail = error?.technicalDetail ?? "";
    const diagnosticMessage = error?.diagnostics?.message ?? "";
    const turnMessage = terminal.payload?.message ?? "";
    const explanation = terminal.payload?.explanation ?? null;
    const deterministicFixes = extractDeterministicFixes(explanation);
    const constructorSymbol = extractConstructorSymbol(technicalDetail, diagnosticMessage, turnMessage);

    const turnResult = {
      requestId,
      prompt,
      elapsedMs: Date.now() - turnStart,
      terminalType: terminal.eventType,
      skill: terminal.payload?.skill ?? null,
      errorCode,
      stage,
      runtimeStatus: terminal.payload?.runtimeStatus ?? null,
      runtimeErrorCode: terminal.payload?.runtimeErrorCode ?? null,
      runtimeWarningCode: terminal.payload?.runtimeWarningCode ?? null,
      deterministicFixApplied: deterministicFixes.length > 0,
      deterministicFixes,
      constructorError: Boolean(constructorSymbol),
      constructorSymbol,
      explanation,
      detail: constructorSymbol
        ? (technicalDetail || diagnosticMessage || turnMessage || null)
        : (error?.userMessage || technicalDetail || diagnosticMessage || turnMessage || null)
    };
    turnResult.failureClass = classifyTurnFailure(turnResult);

    turnResults.push(turnResult);
  }

  try {
    ws.close();
  } catch {}

  const summary = {
    totalTurns: turnResults.length,
    completeTurns: turnResults.filter((item) => item.terminalType === "turn:complete").length,
    errorTurns: turnResults.filter((item) => item.terminalType === "turn:error").length,
    timeoutTurns: turnResults.filter((item) => item.terminalType === "timeout").length,
    nonThreeJsTurns: turnResults.filter((item) => item.skill && item.skill !== "threejs").length,
    executedTurns: turnResults.filter((item) => item.runtimeStatus === "completed").length,
    degradedTurns: turnResults.filter((item) => item.runtimeStatus === "degraded").length,
    validationSkippedTurns: turnResults.filter((item) => item.runtimeWarningCode === "RUNTIME_EXEC_SKIPPED_VALIDATION").length,
    constructorRuntimeErrorTurns: turnResults.filter((item) => item.failureClass === "constructor-runtime").length,
    maskedValidationSkips: turnResults.filter((item) => item.failureClass === "validation-skipped").length,
    deterministicFixAppliedTurns: turnResults.filter((item) => item.deterministicFixApplied).length,
    constructorErrorTurns: turnResults.filter((item) => item.constructorError).length,
    avgTurnElapsedMs: Math.round(turnResults.reduce((sum, item) => sum + item.elapsedMs, 0) / Math.max(1, turnResults.length))
  };

  const skillCounts = {};
  const errorCodeCounts = {};
  const failureClassCounts = {};
  const runtimeStatusCounts = {};
  const runtimeErrorCodeCounts = {};
  const runtimeWarningCodeCounts = {};
  const constructorSymbolCounts = {};
  const deterministicFixCounts = {};

  for (const result of turnResults) {
    if (result.skill) {
      incrementCounter(skillCounts, result.skill);
    }
    if (result.errorCode) {
      incrementCounter(errorCodeCounts, result.errorCode);
    }
    incrementCounter(failureClassCounts, result.failureClass);
    if (result.runtimeStatus) {
      incrementCounter(runtimeStatusCounts, result.runtimeStatus);
    }
    if (result.runtimeErrorCode) {
      incrementCounter(runtimeErrorCodeCounts, result.runtimeErrorCode);
    }
    if (result.runtimeWarningCode) {
      incrementCounter(runtimeWarningCodeCounts, result.runtimeWarningCode);
    }
    if (result.constructorSymbol) {
      incrementCounter(constructorSymbolCounts, result.constructorSymbol);
    }
    for (const fix of result.deterministicFixes ?? []) {
      incrementCounter(deterministicFixCounts, fix);
    }
  }

  const output = {
    ok: true,
    service: "threejs-generation",
    testType: "deep-dive",
    elapsedMs: Date.now() - startedAt,
    wsUrl,
    apiBase,
    sessionId,
    profile: testProfile,
    summary,
    eventCounts,
    skillCounts,
    errorCodeCounts,
    failureClassCounts,
    runtimeStatusCounts,
    runtimeErrorCodeCounts,
    runtimeWarningCodeCounts,
    constructorSymbolCounts,
    deterministicFixCounts,
    validationSkipSamples: turnResults.filter((item) => item.failureClass === "validation-skipped").slice(0, 12),
    constructorSamples: turnResults.filter((item) => item.constructorError).slice(0, 12),
    deterministicFixSamples: turnResults.filter((item) => item.deterministicFixApplied).slice(0, 12),
    nonConstructorErrorSamples: turnResults.filter((item) => item.terminalType === "turn:error" && !item.constructorError).slice(0, 12),
    turns: turnResults
  };

  console.log(JSON.stringify(output, null, 2));

  if (summary.timeoutTurns > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.log(JSON.stringify({
    ok: false,
    reason: "deep_dive_failed",
    message: error?.message ?? String(error)
  }, null, 2));
  process.exit(1);
});
