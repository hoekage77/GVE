/**
 * Quality Analyzer — Measures static, runtime, visual, and semantic quality signals.
 *
 * Implements the quality scoring algorithm for the agentic workflow.
 * Analyzes code and execution results to produce a composite quality score.
 */

import { parse } from "acorn";

// ─── Constants ───────────────────────────────────────────────────────

export const QUALITY_THRESHOLDS = {
  excellent: 90,   // Ship immediately
  good: 75,        // Minor polish optional
  acceptable: 60,  // One more iteration
  poor: 0          // Needs repair
};

const SCORING_WEIGHTS = {
  static: 0.15,      // Syntax, security, API compliance
  runtime: 0.25,     // FPS, memory, errors
  visual: 0.35,      // Materials, lighting, motion
  semantic: 0.25     // Prompt adherence, intent
};

// ─── Types ───────────────────────────────────────────────────────────

export interface StaticScore {
  score: number;
  syntaxValid: boolean;
  complexity: number;
  nestingDepth: number;
  securityIssues: string[];
  apiComplianceIssues: string[];
}

export interface RuntimeScore {
  score: number;
  fps: number;
  memoryMb: number;
  errorCount: number;
  warningCount: number;
  startupTimeMs: number;
  bundleSize?: number;
  gzipSize?: number;
}

export interface VisualScore {
  score: number;
  materialRichness: number;
  lightingComplexity: number;
  motionContinuity: number;
  colorHarmony: number;
  compositionScore: number;
}

export interface SemanticScore {
  score: number;
  intentFulfillment: number;
  skillAppropriate: boolean;
  missingElements: string[];
}

export interface QualitySignals {
  static: StaticScore;
  runtime: RuntimeScore;
  visual: VisualScore;
  semantic: SemanticScore;
  composite?: number;
}

export interface ExecutionResult {
  logs?: string[];
  error?: string;
  durationMs: number;
  buildArtifacts?: {
    totalBytes?: number;
    gzipBytes?: number;
  };
}

export interface PatchGoal {
  id?: string;
  category: string;
  severity: "critical" | "warning" | "suggestion";
  description: string;
  issue?: string;
  suggestion?: string;
  affectedFile?: string;
}

// ─── Static Quality ──────────────────────────────────────────────────

export function analyzeStaticQuality(code: string, skill: string): StaticScore {
  const issues = {
    syntaxValid: true,
    complexity: 0,
    nestingDepth: 0,
    securityIssues: [] as string[],
    apiComplianceIssues: [] as string[]
  };

  try {
    let lineCount = code.split("\n").length;
    let maxDepth = 0;
    let functionCount = 0;
    let importCount = 0;

    if (skill !== "manim") {
      const ast = parse(code, {
        ecmaVersion: "latest",
        sourceType: "module",
        allowReturnOutsideFunction: true
      });

      function walkAST(node: any, depth = 0) {
        if (!node || typeof node !== "object") return;

        if (
          node.type === "IfStatement" ||
          node.type === "ForStatement" ||
          node.type === "WhileStatement" ||
          node.type === "DoWhileStatement"
        ) {
          maxDepth = Math.max(maxDepth, depth + 1);
        }

        if (
          node.type === "FunctionDeclaration" ||
          node.type === "FunctionExpression" ||
          node.type === "ArrowFunctionExpression"
        ) {
          functionCount++;
        }

        if (node.type === "ImportDeclaration") {
          importCount++;
        }

        for (const key in node) {
          if (key === "loc" || key === "range" || key === "start" || key === "end") continue;
          const child = node[key];
          if (Array.isArray(child)) {
            child.forEach((item) => walkAST(item, depth + 1));
          } else {
            walkAST(child, depth + 1);
          }
        }
      }

      walkAST(ast);
    } else {
      // Basic metrics for Python
      maxDepth = (code.match(/^[ \t]+/gm) || []).reduce((max, indent) => Math.max(max, indent.length / 4), 0);
    }

    issues.complexity = lineCount;
    issues.nestingDepth = maxDepth;



    const securityPatterns = [
      { pattern: /eval\s*\(/, issue: "Use of eval() is unsafe" },
      { pattern: /Function\s*\(\s*["']/, issue: "Dynamic code construction with Function()" },
      { pattern: /document\.write/, issue: "document.write can be unsafe" },
      { pattern: /innerHTML\s*=/, issue: "innerHTML assignment (ensure no XSS)" },
      { pattern: /fetch\s*\(\s*['"`]https?:\/\/[^'"`]*['"`\s]*\)/, issue: "External fetch detected (review URL)" }
    ];

    for (const { pattern, issue } of securityPatterns) {
      if (pattern.test(code)) {
        issues.securityIssues.push(issue);
      }
    }

    issues.apiComplianceIssues = checkSkillAPICompliance(code, skill);
  } catch (error: any) {
    issues.syntaxValid = false;
    issues.securityIssues.push(`Syntax error: ${error.message}`);
  }

  let score = 100;
  if (!issues.syntaxValid) score -= 50;

  if (issues.complexity > 500) score -= 10;
  else if (issues.complexity > 300) score -= 5;

  if (issues.nestingDepth > 5) score -= 10;
  else if (issues.nestingDepth > 3) score -= 5;

  score -= issues.securityIssues.length * 5;
  score -= issues.apiComplianceIssues.length * 3;

  return {
    score: Math.max(0, score),
    syntaxValid: issues.syntaxValid,
    complexity: issues.complexity,
    nestingDepth: issues.nestingDepth,
    securityIssues: issues.securityIssues,
    apiComplianceIssues: issues.apiComplianceIssues
  };
}

function checkSkillAPICompliance(code: string, skill: string): string[] {
  const issues: string[] = [];
  const skillPatterns: Record<string, { required: string[]; forbidden: string[]; patterns: { regex: RegExp; good: boolean; msg: string }[] }> = {
    threejs: {
      required: ["THREE", "Scene", "Camera", "Renderer"],
      forbidden: ["alert", "confirm", "prompt"],
      patterns: [{ regex: /new\s+THREE\.WebGLRenderer/, good: true, msg: "Uses WebGLRenderer" }]
    },
    p5js: {
      required: ["setup", "draw"],
      forbidden: ["alert"],
      patterns: [
        { regex: /function\s+setup\s*\(/, good: true, msg: "Has setup() function" },
        { regex: /function\s+draw\s*\(/, good: true, msg: "Has draw() function" }
      ]
    },
    d3js: { required: ["d3"], forbidden: ["alert"], patterns: [] },
    animejs: { required: ["anime"], forbidden: ["alert"], patterns: [] }
  };

  const patterns = skillPatterns[skill];
  if (!patterns) return issues;

  for (const req of patterns.required) {
    const regex = new RegExp(req.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!regex.test(code)) issues.push(`Missing required ${skill} element: ${req}`);
  }

  for (const forbid of patterns.forbidden) {
    const regex = new RegExp(`\\b${forbid}\\s*\\(`);
    if (regex.test(code)) issues.push(`Uses forbidden API: ${forbid}()`);
  }

  return issues;
}

// ─── Runtime Quality ─────────────────────────────────────────────────

export function analyzeRuntimeQuality(executionResult: ExecutionResult): RuntimeScore {
  const { logs = [], error, durationMs, buildArtifacts } = executionResult;

  let score = 100;
  let errorCount = 0;
  let warningCount = 0;
  let fps = 60;
  let bundleSize = 0;
  let gzipSize = 0;

  for (const log of logs) {
    const logLower = log.toLowerCase();
    if (logLower.includes("error") || logLower.includes("exception") || logLower.includes("fail")) errorCount++;
    if (logLower.includes("warning") || logLower.includes("warn") || logLower.includes("deprecated")) warningCount++;

    const fpsMatch = log.match(/fps[:\s]+(\d+(?:\.\d+)?)/i);
    if (fpsMatch) fps = Math.min(fps, parseFloat(fpsMatch[1]!));
  }

  if (error) {
    score -= 40;
    errorCount++;
  }

  score -= errorCount * 10;
  score -= warningCount * 3;

  if (fps < 30) score -= 20;
  else if (fps < 45) score -= 10;
  else if (fps < 60) score -= 5;

  if (durationMs > 5000) score -= 10;
  else if (durationMs > 2000) score -= 5;

  if (buildArtifacts?.totalBytes) {
    bundleSize = buildArtifacts.totalBytes;
    gzipSize = buildArtifacts.gzipBytes || bundleSize * 0.25;

    if (bundleSize > 500 * 1024) score -= 30;
    else if (bundleSize > 250 * 1024) score -= 20;
    else if (bundleSize > 100 * 1024) score -= 10;
    else if (bundleSize > 50 * 1024) score -= 5;
  }

  return {
    score: Math.max(0, score),
    fps,
    memoryMb: 0,
    errorCount,
    warningCount,
    startupTimeMs: durationMs,
    bundleSize,
    gzipSize
  };
}

// ─── Visual Quality ──────────────────────────────────────────────────

export function analyzeVisualQuality(code: string, skill: string): VisualScore {
  let score = 75;
  let materialRichness = 0;
  let lightingComplexity = 0;
  let motionElements = 0;

  if (skill === "threejs") {
    const materialMatches = code.match(/new\s+THREE\.[\w]*Material/g);
    materialRichness = materialMatches ? materialMatches.length : 0;

    const lightMatches = code.match(/new\s+THREE\.[\w]*Light/g);
    lightingComplexity = lightMatches ? lightMatches.length : 0;

    const animationMatches = code.match(/requestAnimationFrame|\.position\.|\.rotation\.|\.scale\./g);
    motionElements = animationMatches ? animationMatches.length : 0;

    if (code.includes("MeshPhysicalMaterial") || code.includes("MeshStandardMaterial")) score += 5;
    if (code.includes("EffectComposer") || code.includes("RenderPass") || code.includes("bloom")) score += 5;
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
    motionContinuity: motionElements > 0 ? 70 : 40,
    colorHarmony: 70,
    compositionScore: 70
  };
}

// ─── Semantic Quality ────────────────────────────────────────────────

export function analyzeSemanticQuality(code: string, prompt: string, skill: string): SemanticScore {
  let score = 80;
  const missingElements: string[] = [];

  const promptKeywords = extractPromptKeywords(prompt);
  const codeLower = code.toLowerCase();

  for (const keyword of promptKeywords) {
    if (!codeLower.includes(keyword.toLowerCase())) missingElements.push(keyword);
  }

  score -= missingElements.length * 5;

  const skillAppropriate = checkSkillAppropriateness(prompt, skill);
  if (!skillAppropriate) score -= 10;

  return {
    score: Math.max(0, score),
    intentFulfillment: score,
    skillAppropriate,
    missingElements
  };
}

function extractPromptKeywords(prompt: string): string[] {
  const keywords: string[] = [];
  const words = prompt.toLowerCase().split(/\s+/);
  const visualKeywords = [
    "3d", "cube", "sphere", "animation", "rotate", "color", "light",
    "particle", "effect", "glow", "shadow", "texture", "material",
    "camera", "perspective", "orbit", "grid", "axis", "wave", "loop"
  ];

  for (const word of words) {
    const cleanWord = word.replace(/[^a-z0-9]/g, "");
    if (visualKeywords.includes(cleanWord)) keywords.push(cleanWord);
  }

  return [...new Set(keywords)];
}

function checkSkillAppropriateness(prompt: string, skill: string): boolean {
  const promptLower = prompt.toLowerCase();
  const skillIndicators: Record<string, string[]> = {
    threejs: ["3d", "three.js", "threejs", "webgl", "geometry", "mesh", "shader"],
    p5js: ["p5", "p5.js", "processing", "creative coding", "generative art"],
    d3js: ["d3", "d3.js", "data visualization", "chart", "graph", "svg"],
    animejs: ["anime", "anime.js", "animation", "timeline", "sequence"]
  };

  const indicators = skillIndicators[skill];
  if (!indicators) return true;
  return indicators.some((indicator) => promptLower.includes(indicator));
}

// ─── Orchestration ───────────────────────────────────────────────────

export function calculateCompositeScore(signals: QualitySignals): number {
  const weights = SCORING_WEIGHTS;
  const scores = {
    static: signals.static?.score ?? 50,
    runtime: signals.runtime?.score ?? 50,
    visual: signals.visual?.score ?? 50,
    semantic: signals.semantic?.score ?? 50
  };

  const composite = Math.round(
    scores.static * weights.static +
    scores.runtime * weights.runtime +
    scores.visual * weights.visual +
    scores.semantic * weights.semantic
  );

  return Math.min(100, Math.max(0, composite));
}

export function generatePatchGoals(signals: QualitySignals, _threshold = 75): PatchGoal[] {
  const goals: PatchGoal[] = [];

  if (!signals.static.syntaxValid) {
    goals.push({ id: "syntax-fix", category: "Static", severity: "critical", description: "Fix syntax errors in the code" });
  }

  for (const issue of signals.static.securityIssues || []) {
    goals.push({ id: `security-${goals.length}`, category: "Security", severity: "critical", description: issue });
  }

  if (signals.static.complexity > 500) {
    goals.push({ id: "complexity-reduce", category: "Maintainability", severity: "warning", description: "Reduce code complexity: extract functions and simplify nesting" });
  }

  if (signals.runtime.fps < 30) {
    goals.push({ id: "fps-optimize", category: "Performance", severity: "warning", description: `Optimize render loop: current FPS ${signals.runtime.fps} is below 30` });
  }

  if (signals.runtime.errorCount > 0) {
    goals.push({ id: "runtime-errors", category: "Runtime", severity: "critical", description: `Fix ${signals.runtime.errorCount} runtime error(s)` });
  }

  if (signals.visual.materialRichness < 3) {
    goals.push({ id: "materials-enhance", category: "Visual", severity: "suggestion", description: "Add material layers: normal maps, roughness, metalness for richer visuals" });
  }

  if (signals.visual.lightingComplexity < 2) {
    goals.push({ id: "lighting-enhance", category: "Visual", severity: "suggestion", description: "Enhance lighting: add multiple light types for depth" });
  }

  for (const missing of signals.semantic?.missingElements || []) {
    goals.push({ id: `missing-${missing}`, category: "Intent", severity: "warning", description: `Add missing element from prompt: "${missing}"` });
  }

  return goals;
}

export function shouldStopIteration(compositeScore: number, iterationNumber: number, maxIterations: number, threshold = 75): { shouldStop: boolean; reason: string | null } {
  if (compositeScore >= threshold) return { shouldStop: true, reason: "threshold_met" };
  if (iterationNumber >= maxIterations) return { shouldStop: true, reason: "budget_exhausted" };
  return { shouldStop: false, reason: null };
}

export function analyzeQuality(params: { code: string; skill: string; prompt: string; executionResult?: ExecutionResult | null }): QualitySignals {
  const { code, skill, prompt, executionResult = null } = params;

  const staticScore = analyzeStaticQuality(code, skill);
  const runtimeScore = executionResult
    ? analyzeRuntimeQuality(executionResult)
    : { score: 0, fps: 0, memoryMb: 0, errorCount: 0, warningCount: 0, startupTimeMs: 0 };
  const visualScore = analyzeVisualQuality(code, skill);
  const semanticScore = analyzeSemanticQuality(code, prompt, skill);

  const signals: QualitySignals = {
    static: staticScore,
    runtime: runtimeScore,
    visual: visualScore,
    semantic: semanticScore
  };

  signals.composite = calculateCompositeScore(signals);
  return signals;
}

export function getQualityLabel(score: number): string {
  if (score >= QUALITY_THRESHOLDS.excellent) return "Excellent";
  if (score >= QUALITY_THRESHOLDS.good) return "Good";
  if (score >= QUALITY_THRESHOLDS.acceptable) return "Fair";
  return "Poor";
}
