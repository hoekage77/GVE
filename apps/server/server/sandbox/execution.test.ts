// ── ALL vi.mock() calls MUST be at the TOP before any imports ──

vi.mock("./manager", () => ({
  createSandbox: vi.fn(),
  executeInSandbox: vi.fn(),
  buildScenePreview: vi.fn(),
  cleanupSessionSandbox: vi.fn(),
  getSandboxMetrics: vi.fn(),
  getSandboxFile: vi.fn(),
  listSandboxFiles: vi.fn(),
}));

vi.mock("../agents/tool-registry", () => ({
  installToolsInSandbox: vi.fn(),
  getRecommendedTools: vi.fn(),
  getInstallTimeEstimate: vi.fn(),
  validateToolCombination: vi.fn(),
}));

vi.mock("../quality/analyzer", () => ({
  analyzeQuality: vi.fn(),
  generatePatchGoals: vi.fn(),
  getQualityLabel: vi.fn(),
}));

vi.mock("../quality/validator", () => ({
  validateCode: vi.fn(),
}));

vi.mock("../quality/mode-engine", () => ({
  shouldIterationStop: vi.fn(),
  determineModeFromQuality: vi.fn(),
}));

vi.mock("../pipeline/runtime-executor", () => ({
  resolveIterationConfig: vi.fn(),
}));

vi.mock("@visual-runtime/sandbox-pool", () => ({
  SandboxPoolManager: vi.fn(),
  createArtifactStorage: vi.fn(),
}));

vi.mock("../quality/patcher", () => ({
  PatchGenerator: vi.fn(),
  applyPatches: vi.fn(),
  summarizePatches: vi.fn(),
}));

vi.mock("../agents/memory", () => ({
  AgentMemory: vi.fn(),
  createMemoryContext: vi.fn(),
}));

vi.mock("../llm/fetch", () => ({
  getPoolBasedProvider: vi.fn(),
}));

vi.mock("../ws/streaming", () => ({
  broadcastEvent: vi.fn(),
}));

// ── Imports (after all mocks) ──

import { describe, expect, it, vi, beforeEach } from "vitest";

import { executeWithQualityLoop } from "./execution.js";
import { createWorkspace, addFile, type Workspace } from "../pipeline/workspace.js";
import { createSandbox, executeInSandbox, cleanupSessionSandbox } from "./manager.js";
import { getRecommendedTools } from "../agents/tool-registry.js";
import { analyzeQuality, generatePatchGoals } from "../quality/analyzer.js";
import { validateCode } from "../quality/validator.js";
import { shouldIterationStop, determineModeFromQuality } from "../quality/mode-engine.js";
import { resolveIterationConfig } from "../pipeline/runtime-executor.js";
import { createArtifactStorage } from "@visual-runtime/sandbox-pool";
import { PatchGenerator } from "../quality/patcher.js";
import { AgentMemory } from "../agents/memory.js";
import { getPoolBasedProvider } from "../llm/fetch.js";
import { broadcastEvent } from "../ws/streaming.js";

// ── Helpers ──

function makeFixtureWorkspace(entryPoint = "src/index.js"): Workspace {
  let ws = createWorkspace(entryPoint);
  ws = addFile(
    ws,
    "src/index.js",
    [
      "import * as THREE from 'three';",
      "import { createRenderer } from './renderer.js';",
      "import { setupAnimations } from './animations.js';",
      "const scene = new THREE.Scene();",
      "const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);",
      "const renderer = createRenderer();",
      "const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xff6600 }));",
      "scene.add(cube);",
      "setupAnimations(cube);",
      "",
      "camera.position.z = 5;",
      "",
      "const ambientLight = new THREE.AmbientLight(0x404040, 0.5);",
      "scene.add(ambientLight);",
      "const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);",
      "dirLight.position.set(5, 10, 7);",
      "scene.add(dirLight);",
      "",
      "function animate() {",
      "  requestAnimationFrame(animate);",
      "  renderer.render(scene, camera);",
      "}",
      "animate();",
    ].join("\n"),
    "Main entry point"
  );
  ws = addFile(
    ws,
    "src/renderer.js",
    [
      "import * as THREE from 'three';",
      "",
      "export function createRenderer() {",
      "  const renderer = new THREE.WebGLRenderer({ antialias: true });",
      "  renderer.setSize(window.innerWidth, window.innerHeight);",
      "  renderer.setPixelRatio(window.devicePixelRatio);",
      "  renderer.shadowMap.enabled = true;",
      "  renderer.toneMapping = THREE.ACESFilmicToneMapping;",
      "  renderer.toneMappingExposure = 1.2;",
      "  document.body.appendChild(renderer.domElement);",
      "  return renderer;",
      "}",
    ].join("\n"),
    "Renderer setup"
  );
  ws = addFile(
    ws,
    "src/animations.js",
    [
      "import * as THREE from 'three';",
      "",
      "export function setupAnimations(mesh) {",
      "  const clock = new THREE.Clock();",
      "  function spin() {",
      "    requestAnimationFrame(spin);",
      "    const delta = clock.getDelta();",
      "    mesh.rotation.x += 0.005;",
      "    mesh.rotation.y += 0.01;",
      "  }",
      "  spin();",
      "}",
    ].join("\n"),
    "Animation helpers"
  );
  return ws;
}

const defaultQualitySignals = {
  static: {
    score: 75,
    syntaxValid: true,
    complexity: 200,
    nestingDepth: 2,
    securityIssues: [],
    apiComplianceIssues: [],
  },
  runtime: {
    score: 80,
    fps: 60,
    memoryMb: 0,
    errorCount: 0,
    warningCount: 0,
    startupTimeMs: 500,
  },
  visual: {
    score: 70,
    materialRichness: 3,
    lightingComplexity: 2,
    motionContinuity: 65,
    colorHarmony: 70,
    compositionScore: 70,
  },
  semantic: {
    score: 80,
    intentFulfillment: 80,
    skillAppropriate: true,
    missingElements: [],
  },
  composite: 76,
};

const defaultContainerInfo = {
  containerId: "abc123def456",
  sessionId: "test-session-1",
  workspacePath: "/tmp/terranet-sandboxes/test-session-1",
  createdAt: Date.now(),
  status: "running" as const,
  installedTools: ["three", "postprocessing"],
};

const defaultExecutionResult = {
  success: true,
  containerId: "abc123def456",
  logs: [],
  durationMs: 1200,
};

const singleFileCode = `
import * as THREE from 'three';
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x00ff00 }));
scene.add(cube);
camera.position.z = 5;
const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
scene.add(ambientLight);
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();
`.trim();

// ── Tests ──

describe("executeWithQualityLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: sandbox succeeds
    (createSandbox as any).mockResolvedValue(defaultContainerInfo);
    (executeInSandbox as any).mockResolvedValue(defaultExecutionResult);
    (cleanupSessionSandbox as any).mockResolvedValue(undefined);
    (getRecommendedTools as any).mockReturnValue(["three", "postprocessing"]);

    // Default: validation passes
    (validateCode as any).mockResolvedValue({ valid: true });

    // Default: quality signals
    (analyzeQuality as any).mockReturnValue({ ...defaultQualitySignals, composite: 76 });
    (generatePatchGoals as any).mockReturnValue([]);


    // Default: should stop with quality-threshold-met on first call
    (shouldIterationStop as any).mockReturnValue({
      shouldStop: true,
      reason: "quality-threshold-met",
      action: "finalize",
      message: "Quality threshold met",
    });

    (determineModeFromQuality as any).mockReturnValue("assisted");
    (resolveIterationConfig as any).mockReturnValue({
      maxIterations: 2,
      threshold: 75,
      autoPatch: true,
    });

    // Artifact storage
    const mockStorage = { initialize: vi.fn().mockResolvedValue(undefined) };
    (createArtifactStorage as any).mockReturnValue(mockStorage);

    // PatchGenerator class
    (PatchGenerator as any).mockImplementation(() => ({
      generatePatches: vi.fn().mockResolvedValue([]),
      clearCache: vi.fn(),
    }));

    // AgentMemory class
    (AgentMemory as any).mockImplementation(() => ({
      sessionId: "",
      skill: "",
      recordIteration: vi.fn(),
      recordPatchOutcome: vi.fn(),
      getScoreProgression: vi.fn().mockReturnValue([]),
      getBestScore: vi.fn().mockReturnValue(0),
      getAveragePatchEffectiveness: vi.fn().mockReturnValue(0),
      getContextForNextIteration: vi.fn().mockReturnValue({}),
      toJSON: vi.fn().mockReturnValue({}),
      clear: vi.fn(),
    }));

    // LLM provider
    (getPoolBasedProvider as any).mockReturnValue({ generate: vi.fn() });

    // broadcastEvent — simple spy
    (broadcastEvent as any).mockImplementation(() => {});
  });

  // ────────────────────────────────────────────────────────────────────
  //  TEST 1: Derives currentCode from workspace.entryPoint
  // ────────────────────────────────────────────────────────────────────
  it("derives currentCode from workspace.entryPoint when workspace is provided", async () => {
    const ws = makeFixtureWorkspace("src/index.js");
    const result = await executeWithQualityLoop({
      sessionId: "test-session-1",
      code: "ignored-initial-code",
      skill: "threejs",
      prompt: "Create a spinning cube",
      workspace: ws,
    });

    expect(result.success).toBe(true);
    // executeInSandbox must be called with code from the entry point file
    const executeCall = (executeInSandbox as any).mock.calls[0][0];
    expect(executeCall.code).toContain("import * as THREE from 'three'");
    expect(executeCall.code).toContain("createRenderer");
    expect(executeCall.code).toContain("setupAnimations");
    expect(executeCall.code).not.toContain("ignored-initial-code");
  });

  // ────────────────────────────────────────────────────────────────────
  //  TEST 2: Passes workspace files to executeInSandbox via `files`
  // ────────────────────────────────────────────────────────────────────
  it("passes workspace files to executeInSandbox via the `files` parameter", async () => {
    const ws = makeFixtureWorkspace("src/index.js");

    await executeWithQualityLoop({
      sessionId: "test-session-2",
      code: "plain code",
      skill: "threejs",
      prompt: "Create a spinning cube",
      workspace: ws,
    });

    const executeCall = (executeInSandbox as any).mock.calls[0][0];
    expect(executeCall.files).toBeDefined();
    expect(typeof executeCall.files).toBe("object");

    const fileKeys = Object.keys(executeCall.files!);
    expect(fileKeys).toContain("src/index.js");
    expect(fileKeys).toContain("src/renderer.js");
    expect(fileKeys).toContain("src/animations.js");

    expect(executeCall.files!["src/index.js"]).toContain("createRenderer");
    expect(executeCall.files!["src/renderer.js"]).toContain("WebGLRenderer");
    expect(executeCall.files!["src/animations.js"]).toContain("Clock");
  });

  // ────────────────────────────────────────────────────────────────────
  //  TEST 3: computeProjectQuality blends score (60/40 split)
  // ────────────────────────────────────────────────────────────────────
  it("calls computeProjectQuality during iteration and blends score with cohesion (60/40 split)", async () => {
    const ws = makeFixtureWorkspace("src/index.js");

    await executeWithQualityLoop({
      sessionId: "test-session-3",
      code: "some code",
      skill: "threejs",
      prompt: "Create a spinning cube",
      workspace: ws,
    });

    // broadcastEvent should have been called with "workspace:analysis"
    const analysisCalls = (broadcastEvent as any).mock.calls.filter(
      (call: [string, any]) => call[0] === "workspace:analysis"
    );
    expect(analysisCalls.length).toBe(1);

    const analysisPayload = analysisCalls[0][1];
    expect(analysisPayload.sessionId).toBe("test-session-3");
    expect(analysisPayload.iteration).toBe(1);
    // compositeScore in the event should be different from raw mock composite (76)
    // because it was blended with project cohesion
    expect(typeof analysisPayload.compositeScore).toBe("number");
    // the blended score incorporates the cohesion factor, so it deviates from 76
    expect(analysisPayload.compositeScore).not.toBe(76);
    expect(analysisPayload.weakestFiles).toBeDefined();
    expect(Array.isArray(analysisPayload.weakestFiles)).toBe(true);
    expect(analysisPayload.recommendations).toBeDefined();
    expect(Array.isArray(analysisPayload.recommendations)).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────
  //  TEST 4: Broadcasts "workspace:analysis" event with all fields
  // ────────────────────────────────────────────────────────────────────
  it('broadcasts "workspace:analysis" event with cohesion score, weakest files, recommendations', async () => {
    const ws = makeFixtureWorkspace("src/index.js");

    await executeWithQualityLoop({
      sessionId: "test-session-4",
      code: "some code",
      skill: "threejs",
      prompt: "Create a spinning cube",
      workspace: ws,
    });

    const analysisCalls = (broadcastEvent as any).mock.calls.filter(
      (call: [string, any]) => call[0] === "workspace:analysis"
    );
    expect(analysisCalls.length).toBe(1);

    const payload = analysisCalls[0][1];
    expect(payload.sessionId).toBe("test-session-4");
    expect(payload.iteration).toBe(1);
    expect(typeof payload.cohesionScore).toBe("number");
    expect(payload.cohesionScore).toBeGreaterThanOrEqual(0);
    expect(payload.cohesionScore).toBeLessThanOrEqual(100);
    expect(typeof payload.compositeScore).toBe("number");
    expect(Array.isArray(payload.weakestFiles)).toBe(true);
    expect(Array.isArray(payload.recommendations)).toBe(true);
    expect(payload.recommendations.length).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────────────
  //  TEST 5: Uses MultiFilePatchGenerator when workspace is present
  // ────────────────────────────────────────────────────────────────────
  it("uses MultiFilePatchGenerator when workspace is present instead of single-file PatchGenerator", async () => {
    const ws = makeFixtureWorkspace("src/index.js");

    // Setup: first iteration says "continue" so patching happens
    (shouldIterationStop as any)
      .mockReturnValueOnce({
        shouldStop: false,
        reason: "autonomous_improvement",
        action: "continue",
        message: "continuing",
      })
      .mockReturnValueOnce({
        shouldStop: true,
        reason: "quality-threshold-met",
        action: "finalize",
        message: "Quality threshold met",
      });

    (generatePatchGoals as any).mockReturnValue([
      {
        id: "vis-1",
        category: "visual",
        severity: "warning",
        description: "Add more materials",
        affectedFile: "src/index.js",
      },
    ]);

    // Make PatchGenerator.generatePatches return a patch so MultiFilePatchGenerator has
    // data to work with
    const mockGenPatches = vi.fn().mockResolvedValue([
      {
        filePath: "src/index.js",
        originalCode: ws.files["src/index.js"]!.content,
        patchedCode: ws.files["src/index.js"]!.content + "\n// patched",
        explanation: "Enhanced materials",
        expectedScoreImpact: 12,
        riskLevel: 0.25,
      },
    ]);
    (PatchGenerator as any).mockImplementation(() => ({
      generatePatches: mockGenPatches,
      clearCache: vi.fn(),
    }));

    await executeWithQualityLoop({
      sessionId: "test-session-5",
      code: "some code",
      skill: "threejs",
      prompt: "Create a spinning cube",
      workspace: ws,
    });

    // The PatchGenerator.generatePatches call should be invoked (MultiFilePatchGenerator
    // delegates to it). This confirms the multi-file pipeline was used.
    expect(mockGenPatches).toHaveBeenCalled();
    const patchCall = mockGenPatches.mock.calls[0];
    expect(patchCall).toBeDefined();
    const patchCallArgs = patchCall!;
    expect(patchCallArgs[0]).toContain("THREE");
    expect(patchCallArgs[1]).toBeDefined();
    expect(patchCallArgs[1].files.length).toBeGreaterThan(1);

    // Broadcast should include workspace:update
    const updateCalls = (broadcastEvent as any).mock.calls.filter(
      (call: [string, any]) => call[0] === "workspace:update"
    );
    expect(updateCalls.length).toBe(1);
  });

  // ────────────────────────────────────────────────────────────────────
  //  TEST 6: Broadcasts "workspace:update" and "file:patched" after multi-file patching
  // ────────────────────────────────────────────────────────────────────
  it('broadcasts "workspace:update" and "file:patched" events after successful multi-file patching', async () => {
    const ws = makeFixtureWorkspace("src/index.js");

    (shouldIterationStop as any)
      .mockReturnValueOnce({
        shouldStop: false,
        reason: "autonomous_improvement",
        action: "continue",
        message: "continuing",
      })
      .mockReturnValueOnce({
        shouldStop: true,
        reason: "quality-threshold-met",
        action: "finalize",
        message: "Quality threshold met",
      });

    (generatePatchGoals as any).mockReturnValue([
      {
        id: "vis-2",
        category: "visual",
        severity: "critical",
        description: "Improve scene lighting",
        affectedFile: "src/index.js",
      },
      {
        id: "perf-1",
        category: "performance",
        severity: "warning",
        description: "Optimize render loop",
        affectedFile: "src/renderer.js",
      },
    ]);

    (PatchGenerator as any).mockImplementation(() => ({
      generatePatches: vi.fn().mockResolvedValue([
        {
          filePath: "src/index.js",
          originalCode: ws.files["src/index.js"]!.content,
          patchedCode: ws.files["src/index.js"]!.content + "\nconst pointLight = new THREE.PointLight(0xffaa00, 1, 20);\nscene.add(pointLight);",
          explanation: "Added point light for richer shadows",
          expectedScoreImpact: 15,
          riskLevel: 0.2,
        },
      ]),
      clearCache: vi.fn(),
    }));

    await executeWithQualityLoop({
      sessionId: "test-session-6",
      code: "some code",
      skill: "threejs",
      prompt: "Create a spinning cube",
      workspace: ws,
    });

    const updateCalls = (broadcastEvent as any).mock.calls.filter(
      (call: [string, any]) => call[0] === "workspace:update"
    );
    expect(updateCalls.length).toBe(1);

    const updatePayload = updateCalls[0][1];
    expect(updatePayload.sessionId).toBe("test-session-6");
    expect(updatePayload.iteration).toBe(1);
    expect(updatePayload.patchCount).toBe(1);
    expect(updatePayload.fileList).toContain("src/index.js");

    const filePatchedCalls = (broadcastEvent as any).mock.calls.filter(
      (call: [string, any]) => call[0] === "file:patched"
    );
    expect(filePatchedCalls.length).toBe(1);

    const filePatchedPayload = filePatchedCalls[0][1];
    expect(filePatchedPayload.sessionId).toBe("test-session-6");
    expect(filePatchedPayload.path).toBe("src/index.js");
    expect(filePatchedPayload.kind).toBe("modify");
    expect(typeof filePatchedPayload.explanation).toBe("string");
  });

  // ────────────────────────────────────────────────────────────────────
  //  TEST 7: Returns workspace in the final response object
  // ────────────────────────────────────────────────────────────────────
  it("returns workspace in the final response object after iterations complete", async () => {
    const ws = makeFixtureWorkspace("src/index.js");

    const result = await executeWithQualityLoop({
      sessionId: "test-session-7",
      code: "some code",
      skill: "threejs",
      prompt: "Create a spinning cube",
      workspace: ws,
    });

    expect(result.success).toBe(true);
    expect(result.workspace).toBeDefined();
    expect(result.workspace.entryPoint).toBe("src/index.js");
    expect(Object.keys(result.workspace.files)).toHaveLength(3);
    expect(result.workspace.files["src/index.js"]).toBeDefined();
    expect(result.workspace.files["src/renderer.js"]).toBeDefined();
    expect(result.workspace.files["src/animations.js"]).toBeDefined();
  });

  // ────────────────────────────────────────────────────────────────────
  //  TEST 8: Handles static validation failure
  // ────────────────────────────────────────────────────────────────────
  it("returns unrecoverable error when validateCode returns { valid: false }", async () => {
    (validateCode as any).mockResolvedValue({
      valid: false,
      passable: false,
      errors: [{ code: "SYNTAX_ERROR", message: "Unexpected token" }],
      warnings: [],
      checks: {
        syntax: { passed: false, errors: [{ code: "SYNTAX_ERROR", message: "Unexpected token" }] },
        security: { passed: true, errors: [] },
        schema: { passed: true, errors: [] },
        quality: { passed: true, errors: [], warnings: [] },
      },
    });

    const ws = makeFixtureWorkspace("src/index.js");
    const result = await executeWithQualityLoop({
      sessionId: "test-session-8",
      code: "broken code",
      skill: "threejs",
      prompt: "Create a spinning cube",
      workspace: ws,
    });

    expect(result.success).toBe(false);
    expect(result.stopReason).toBe("unrecoverable");
    expect(result.error).toBe("Static validation failed");
    expect(result.finalIteration).toBe(1);
  });

  // ────────────────────────────────────────────────────────────────────
  //  TEST 9: Stops iteration and returns success when quality-threshold-met
  // ────────────────────────────────────────────────────────────────────
  it("stops iteration and returns success when shouldIterationStop says quality-threshold-met", async () => {
    (shouldIterationStop as any).mockReturnValue({
      shouldStop: true,
      reason: "quality-threshold-met",
      action: "finalize",
      message: "Quality threshold reached (92 >= 85)",
    });

    const result = await executeWithQualityLoop({
      sessionId: "test-session-9",
      code: singleFileCode,
      skill: "threejs",
      prompt: "Create a green spinning cube",
    });

    expect(result.success).toBe(true);
    expect(result.stopReason).toBe("quality-threshold-met");
    expect(result.finalIteration).toBe(1);
    expect(result.error).toBeUndefined();
  });

  // ────────────────────────────────────────────────────────────────────
  //  TEST 10: Handles sandbox creation failure gracefully
  // ────────────────────────────────────────────────────────────────────
  it("handles sandbox creation failure gracefully (returns error, doesn't crash)", async () => {
    (createSandbox as any).mockRejectedValue(new Error("docker container create failed"));

    const result = await executeWithQualityLoop({
      sessionId: "test-session-10",
      code: singleFileCode,
      skill: "threejs",
      prompt: "Create a green spinning cube",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.iterations).toEqual([]);
    // cleanupSessionSandbox should NOT have been called (sandbox was never created)
    expect(cleanupSessionSandbox).not.toHaveBeenCalledWith("test-session-10");
  });

  // ────────────────────────────────────────────────────────────────────
  //  TEST 11: Does NOT broadcast workspace events when no workspace is provided
  // ────────────────────────────────────────────────────────────────────
  it("does NOT broadcast workspace events when no workspace is provided", async () => {
    (shouldIterationStop as any).mockReturnValue({
      shouldStop: true,
      reason: "quality-threshold-met",
      action: "finalize",
      message: "Quality threshold met",
    });

    await executeWithQualityLoop({
      sessionId: "test-session-11",
      code: singleFileCode,
      skill: "threejs",
      prompt: "Create a green spinning cube",
    });

    const allEventTypes = (broadcastEvent as any).mock.calls.map((call: [string, any]) => call[0]);
    expect(allEventTypes).not.toContain("workspace:analysis");
    expect(allEventTypes).not.toContain("workspace:update");
    expect(allEventTypes).not.toContain("file:patched");

    // Should still broadcast non-workspace events (analysis, iteration)
    expect(allEventTypes).toContain("agent:analysis_complete");
    expect(allEventTypes).toContain("iteration:update");

    // Result should NOT contain workspace
    const result = await executeWithQualityLoop({
      sessionId: "test-session-11b",
      code: singleFileCode,
      skill: "threejs",
      prompt: "Create a green spinning cube",
    });
    expect(result.workspace).toBeUndefined();
  });

  // ────────────────────────────────────────────────────────────────────
  //  ADDITIONAL TEST: Max iterations exhausted without quality met
  // ────────────────────────────────────────────────────────────────────
  it("returns max-iterations-reached when max iterations hit without meeting quality threshold", async () => {
    (shouldIterationStop as any).mockReturnValue({
      shouldStop: true,
      reason: "budget_exhausted",
      action: "finalize",
      message: "Max iterations reached (2/2)",
    });

    const result = await executeWithQualityLoop({
      sessionId: "test-session-max-iter",
      code: singleFileCode,
      skill: "threejs",
      prompt: "Create a green spinning cube",
    });

    expect(result.success).toBe(false);
    expect(result.stopReason).toBe("max-iterations-reached");
    expect(result.error).toContain("Quality threshold not met");
  });
});