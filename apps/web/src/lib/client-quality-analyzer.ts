/**
 * Client Quality Analyzer — Lightweight quality scoring for browser execution.
 *
 * Ports the essential quality analysis from the server to run client-side.
 * Uses lightweight regex and telemetry data instead of heavy AST parsing.
 */

export interface ClientQualitySignals {
  static: { score: number; syntaxValid: boolean; complexity: number; issues: string[] };
  runtime: { score: number; fps: number; errorCount: number; warningCount: number; durationMs: number };
  visual: { score: number; materialRichness: number; lightingComplexity: number; motionElements: number };
  semantic: { score: number; intentFulfillment: number; missingElements: string[] };
  composite: number;
  deviceInfo?: { gpuRenderer: string; gpuVendor?: string };
}

export interface PatchGoal {
  id: string;
  category: string;
  severity: "critical" | "warning" | "suggestion";
  description: string;
}

const SCORING_WEIGHTS = {
  static: 0.15,
  runtime: 0.25,
  visual: 0.35,
  semantic: 0.25
};

function getGpuTier(gpuRenderer: string): { tier: number; targetFps: number; label: string } {
  const r = (gpuRenderer || "").toLowerCase();
  if (/swiftshader|llvmpipe|soft|microsoft basic render|software|virtual|null/.test(r)) {
    return { tier: 0, targetFps: 15, label: "software" };
  }
  if (/intel|apple m(1|2)\b|apple m(1|2),|adreno 5|adreno 6|mali/.test(r)) {
    return { tier: 1, targetFps: 30, label: "integrated" };
  }
  if (/nvidia gtx|nvidia mx|amd rx 5|amd rx 6|apple m(3|4| pro| max)/.test(r)) {
    return { tier: 2, targetFps: 45, label: "mid" };
  }
  return { tier: 3, targetFps: 60, label: "high" };
}

export function analyzeClientQuality(
  code: string,
  skill: string,
  prompt: string,
  telemetry: {
    renderCount: number;
    frameCount: number;
    errorCount: number;
    warningCount: number;
    durationMs: number;
    logs: { level: string; message: string }[];
    deviceInfo?: { gpuRenderer: string; gpuVendor?: string };
  }
): ClientQualitySignals {
  const staticScore = analyzeStaticQuality(code, skill);
  const runtimeScore = analyzeRuntimeQuality(telemetry, telemetry.deviceInfo?.gpuRenderer);
  const visualScore = analyzeVisualQuality(code, skill);
  const semanticScore = analyzeSemanticQuality(code, prompt, skill);

  const composite = Math.round(
    staticScore.score * SCORING_WEIGHTS.static +
    runtimeScore.score * SCORING_WEIGHTS.runtime +
    visualScore.score * SCORING_WEIGHTS.visual +
    semanticScore.score * SCORING_WEIGHTS.semantic
  );

  return {
    static: staticScore,
    runtime: runtimeScore,
    visual: visualScore,
    semantic: semanticScore,
    composite: Math.min(100, Math.max(0, composite)),
    deviceInfo: telemetry.deviceInfo
  };
}

function analyzeStaticQuality(code: string, skill: string): ClientQualitySignals["static"] {
  let score = 100;
  const issues: string[] = [];
  let syntaxValid = true;
  let complexity = code.split("\n").length;

  // Basic syntax check (lightweight regex, not full AST)
  const openBraces = (code.match(/{/g) || []).length;
  const closeBraces = (code.match(/}/g) || []).length;
  if (openBraces !== closeBraces) {
    syntaxValid = false;
    score -= 50;
    issues.push("Brace mismatch detected");
  }

  // Security patterns
  if (/eval\s*\(/.test(code)) {
    score -= 5;
    issues.push("Use of eval() detected");
  }
  if (/document\.write/.test(code)) {
    score -= 5;
    issues.push("document.write detected");
  }

  // Complexity
  if (complexity > 500) score -= 10;
  else if (complexity > 300) score -= 5;

  return {
    score: Math.max(0, score),
    syntaxValid,
    complexity,
    issues
  };
}

function analyzeRuntimeQuality(
  telemetry: {
    renderCount: number;
    frameCount: number;
    errorCount: number;
    warningCount: number;
    durationMs: number;
  },
  gpuRenderer?: string
): ClientQualitySignals["runtime"] {
  let score = 100;
  const tier = getGpuTier(gpuRenderer || "");
  const targetFps = tier.targetFps;

  // Errors
  score -= telemetry.errorCount * 15;
  score -= telemetry.warningCount * 3;

  // Render check
  if (telemetry.renderCount === 0 && telemetry.frameCount === 0) {
    score -= 30;
  }

  // Performance
  if (telemetry.durationMs > 5000) score -= 10;
  else if (telemetry.durationMs > 2000) score -= 5;

  // Estimate FPS from frame count and duration
  const fps = telemetry.durationMs > 0
    ? Math.round((telemetry.frameCount / telemetry.durationMs) * 1000)
    : targetFps;

  // Normalize penalties by GPU tier to avoid low-end GPU false negatives
  if (fps < targetFps * 0.5) score -= 20;
  else if (fps < targetFps * 0.75) score -= 10;
  else if (fps < targetFps) score -= 5;

  return {
    score: Math.max(0, score),
    fps: Math.min(60, fps),
    errorCount: telemetry.errorCount,
    warningCount: telemetry.warningCount,
    durationMs: telemetry.durationMs
  };
}

function analyzeVisualQuality(code: string, skill: string): ClientQualitySignals["visual"] {
  let score = 75;
  let materialRichness = 0;
  let lightingComplexity = 0;
  let motionElements = 0;

  if (skill === "threejs") {
    const materialMatches = code.match(/new\s+THREE\.\w*Material/g);
    materialRichness = materialMatches ? materialMatches.length : 0;

    const lightMatches = code.match(/new\s+THREE\.\w*Light/g);
    lightingComplexity = lightMatches ? lightMatches.length : 0;

    const animationMatches = code.match(/requestAnimationFrame|\.position\.|\.rotation\.|\.scale\./g);
    motionElements = animationMatches ? animationMatches.length : 0;

    if (code.includes("MeshPhysicalMaterial") || code.includes("MeshStandardMaterial")) score += 5;
  } else if (skill === "p5js") {
    const drawOps = code.match(/ellipse|rect|circle|line|triangle|quad/g);
    materialRichness = drawOps ? drawOps.length : 0;

    const animOps = code.match(/frameCount|millis\(\)|lerp|map\s*\(/g);
    motionElements = animOps ? animOps.length : 0;
  }

  if (materialRichness >= 5) score += 10;
  else if (materialRichness >= 3) score += 5;
  else if (materialRichness === 0) score -= 10;

  if (lightingComplexity >= 3) score += 10;
  else if (lightingComplexity >= 1) score += 5;

  if (motionElements >= 5) score += 5;

  return {
    score: Math.min(100, score),
    materialRichness,
    lightingComplexity,
    motionElements
  };
}

function analyzeSemanticQuality(code: string, prompt: string, skill: string): ClientQualitySignals["semantic"] {
  let score = 80;
  const missingElements: string[] = [];
  const codeLower = code.toLowerCase();

  // Extract visual keywords from prompt
  const visualKeywords = [
    "3d", "cube", "sphere", "animation", "rotate", "color", "light",
    "particle", "effect", "glow", "shadow", "texture", "material",
    "camera", "perspective", "orbit", "grid", "axis", "wave", "loop"
  ];

  const words = prompt.toLowerCase().split(/\s+/);
  const keywords = words.filter(w => visualKeywords.includes(w.replace(/[^a-z0-9]/g, "")));
  const uniqueKeywords = [...new Set(keywords)];

  for (const keyword of uniqueKeywords) {
    if (!codeLower.includes(keyword)) {
      missingElements.push(keyword);
      score -= 5;
    }
  }

  return {
    score: Math.max(0, score),
    intentFulfillment: score,
    missingElements
  };
}

export function generatePatchGoals(quality: ClientQualitySignals): PatchGoal[] {
  const goals: PatchGoal[] = [];

  if (!quality.static.syntaxValid) {
    goals.push({ id: "syntax-fix", category: "Static", severity: "critical", description: "Fix syntax errors in the code" });
  }

  if (quality.runtime.errorCount > 0) {
    goals.push({ id: "runtime-errors", category: "Runtime", severity: "critical", description: `Fix ${quality.runtime.errorCount} runtime error(s)` });
  }

  const tier = getGpuTier(quality.deviceInfo?.gpuRenderer || "");
  if (quality.runtime.fps < tier.targetFps * 0.75) {
    goals.push({ id: "fps-optimize", category: "Performance", severity: "warning", description: `Optimize render loop: current FPS ${quality.runtime.fps} is below ${Math.round(tier.targetFps * 0.75)} (${tier.label} GPU)` });
  }

  if (quality.visual.materialRichness < 3) {
    goals.push({ id: "materials-enhance", category: "Visual", severity: "suggestion", description: "Add material layers for richer visuals" });
  }

  if (quality.visual.lightingComplexity < 2) {
    goals.push({ id: "lighting-enhance", category: "Visual", severity: "suggestion", description: "Enhance lighting: add multiple light types for depth" });
  }

  for (const missing of quality.semantic.missingElements) {
    goals.push({ id: `missing-${missing}`, category: "Intent", severity: "warning", description: `Add missing element from prompt: "${missing}"` });
  }

  return goals;
}

export function shouldStopIteration(compositeScore: number, iterationNumber: number, maxIterations: number, threshold = 75): { shouldStop: boolean; reason: string | null } {
  if (compositeScore >= threshold) return { shouldStop: true, reason: "threshold_met" };
  if (iterationNumber >= maxIterations) return { shouldStop: true, reason: "budget_exhausted" };
  return { shouldStop: false, reason: null };
}