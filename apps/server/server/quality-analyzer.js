/**
 * Quality Analyzer - Measures static, runtime, visual, and semantic quality signals
 * 
 * This module implements the quality scoring algorithm for the agentic workflow.
 * It analyzes code and execution results to produce a composite quality score.
 */

import { parse } from "acorn";

// Quality thresholds
const QUALITY_THRESHOLDS = {
  excellent: 90,   // Ship immediately
  good: 75,        // Minor polish optional
  acceptable: 60,  // One more iteration
  poor: 0          // Needs repair
};

// Scoring weights
const SCORING_WEIGHTS = {
  static: 0.15,      // Syntax, security, API compliance
  runtime: 0.25,     // FPS, memory, errors
  visual: 0.35,      // Materials, lighting, motion
  semantic: 0.25     // Prompt adherence, intent
};

/**
 * @typedef {Object} StaticScore
 * @property {number} score - 0-100
 * @property {boolean} syntaxValid
 * @property {number} complexity - Lines of code
 * @property {number} nestingDepth - Max nesting level
 * @property {string[]} securityIssues
 * @property {string[]} apiComplianceIssues
 */

/**
 * @typedef {Object} RuntimeScore
 * @property {number} score - 0-100
 * @property {number} fps - Estimated/actual FPS
 * @property {number} memoryMb - Peak memory usage
 * @property {number} errorCount - Console errors
 * @property {number} warningCount - Console warnings
 * @property {number} startupTimeMs - Time to first render
 */

/**
 * @typedef {Object} VisualScore
 * @property {number} score - 0-100
 * @property {number} materialRichness - Number of material layers
 * @property {number} lightingComplexity - Light types and count
 * @property {number} motionContinuity - Smoothness score
 * @property {number} colorHarmony - Palette analysis score
 * @property {number} compositionScore - Rule of thirds, focal point
 */

/**
 * @typedef {Object} SemanticScore
 * @property {number} score - 0-100
 * @property {number} intentFulfillment - How well it matches prompt
 * @property {boolean} skillAppropriate - Right skill for the job
 * @property {string[]} missingElements - What was asked but not delivered
 */

/**
 * @typedef {Object} QualitySignals
 * @property {StaticScore} static
 * @property {RuntimeScore} runtime
 * @property {VisualScore} [visual]
 * @property {SemanticScore} [semantic]
 * @property {number} composite - Weighted composite score 0-100
 */

/**
 * Analyze code statically (without execution)
 * @param {string} code - The code to analyze
 * @param {string} skill - The skill/framework used
 * @returns {StaticScore}
 */
export function analyzeStaticQuality(code, skill) {
  const issues = {
    syntaxValid: true,
    complexity: 0,
    nestingDepth: 0,
    securityIssues: [],
    apiComplianceIssues: []
  };

  // Check for syntax errors
  try {
    const ast = parse(code, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowReturnOutsideFunction: true
    });

    // Analyze complexity with custom AST walker (no external deps)
    let lineCount = code.split("\n").length;
    let maxDepth = 0;
    let functionCount = 0;
    let importCount = 0;

    // Simple recursive AST traversal
    function walkAST(node, depth = 0) {
      if (!node || typeof node !== 'object') return;
      
      // Track max depth for control structures
      if (node.type === 'IfStatement' || node.type === 'ForStatement' || 
          node.type === 'WhileStatement' || node.type === 'DoWhileStatement') {
        maxDepth = Math.max(maxDepth, depth + 1);
      }
      
      // Count functions
      if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || 
          node.type === 'ArrowFunctionExpression') {
        functionCount++;
      }
      
      // Count imports
      if (node.type === 'ImportDeclaration') {
        importCount++;
      }
      
      // Recurse through all properties
      for (const key in node) {
        if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(item => walkAST(item, depth + 1));
        } else {
          walkAST(child, depth + 1);
        }
      }
    }

    walkAST(ast);

    issues.complexity = lineCount;
    issues.nestingDepth = maxDepth;

    // Check for security issues
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

    // Check API compliance for skill
    const apiIssues = checkSkillAPICompliance(code, skill);
    issues.apiComplianceIssues = apiIssues;

  } catch (error) {
    issues.syntaxValid = false;
    issues.securityIssues.push(`Syntax error: ${error.message}`);
  }

  // Calculate static score
  let score = 100;

  // Deduct for syntax errors
  if (!issues.syntaxValid) {
    score -= 50;
  }

  // Deduct for complexity
  if (issues.complexity > 500) {
    score -= 10;
  } else if (issues.complexity > 300) {
    score -= 5;
  }

  // Deduct for deep nesting
  if (issues.nestingDepth > 5) {
    score -= 10;
  } else if (issues.nestingDepth > 3) {
    score -= 5;
  }

  // Deduct for security issues
  score -= issues.securityIssues.length * 5;

  // Deduct for API compliance issues
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

/**
 * Check API compliance for specific skill
 * @param {string} code
 * @param {string} skill
 * @returns {string[]}
 */
function checkSkillAPICompliance(code, skill) {
  const issues = [];

  const skillPatterns = {
    threejs: {
      required: ["THREE", "Scene", "Camera", "Renderer"],
      forbidden: ["alert", "confirm", "prompt"],
      patterns: [
        { regex: /new\s+THREE\.WebGLRenderer/, good: true, msg: "Uses WebGLRenderer" }
      ]
    },
    p5js: {
      required: ["setup", "draw"],
      forbidden: ["alert"],
      patterns: [
        { regex: /function\s+setup\s*\(/, good: true, msg: "Has setup() function" },
        { regex: /function\s+draw\s*\(/, good: true, msg: "Has draw() function" }
      ]
    },
    d3js: {
      required: ["d3"],
      forbidden: ["alert"],
      patterns: []
    },
    animejs: {
      required: ["anime"],
      forbidden: ["alert"],
      patterns: []
    }
  };

  const patterns = skillPatterns[skill];
  if (!patterns) return issues;

  // Check required patterns
  for (const req of patterns.required) {
    const regex = new RegExp(req.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!regex.test(code)) {
      issues.push(`Missing required ${skill} element: ${req}`);
    }
  }

  // Check forbidden patterns
  for (const forbid of patterns.forbidden) {
    const regex = new RegExp(`\\b${forbid}\\s*\\(`);
    if (regex.test(code)) {
      issues.push(`Uses forbidden API: ${forbid}()`);
    }
  }

  return issues;
}

/**
 * Analyze runtime quality from execution logs
 * @param {Object} executionResult
 * @param {string[]} executionResult.logs - Console output
 * @param {string} [executionResult.error] - Error message
 * @param {number} executionResult.durationMs - Execution time
 * @returns {RuntimeScore}
 */
export function analyzeRuntimeQuality(executionResult) {
  const { logs = [], error, durationMs, buildArtifacts } = executionResult;

  let score = 100;
  let errorCount = 0;
  let warningCount = 0;
  let fps = 60; // Assume good FPS unless proven otherwise
  let bundleSize = 0;
  let gzipSize = 0;

  // Analyze logs for errors and warnings
  for (const log of logs) {
    const logLower = log.toLowerCase();

    if (logLower.includes("error") || logLower.includes("exception") || logLower.includes("fail")) {
      errorCount++;
    }

    if (logLower.includes("warning") || logLower.includes("warn") || logLower.includes("deprecated")) {
      warningCount++;
    }

    // Extract FPS if reported
    const fpsMatch = log.match(/fps[:\s]+(\d+(?:\.\d+)?)/i);
    if (fpsMatch) {
      fps = Math.min(fps, parseFloat(fpsMatch[1]));
    }
  }

  // Deduct for errors
  if (error) {
    score -= 40;
    errorCount++;
  }

  score -= errorCount * 10;
  score -= warningCount * 3;

  // Deduct for poor FPS
  if (fps < 30) {
    score -= 20;
  } else if (fps < 45) {
    score -= 10;
  } else if (fps < 60) {
    score -= 5;
  }

  // Deduct for slow startup
  if (durationMs > 5000) {
    score -= 10;
  } else if (durationMs > 2000) {
    score -= 5;
  }

  // Score bundle size if available (smaller is better)
  if (buildArtifacts && buildArtifacts.totalBytes) {
    bundleSize = buildArtifacts.totalBytes;
    gzipSize = buildArtifacts.gzipBytes || bundleSize * 0.25;

    if (bundleSize > 500 * 1024) {
      score -= 30; // Very large bundle
    } else if (bundleSize > 250 * 1024) {
      score -= 20; // Large bundle
    } else if (bundleSize > 100 * 1024) {
      score -= 10; // Medium bundle
    } else if (bundleSize > 50 * 1024) {
      score -= 5; // Reasonable bundle
    }
    // Under 50KB gets no deduction (excellent)
  }

  return {
    score: Math.max(0, score),
    fps,
    memoryMb: 0, // Would need actual runtime measurement
    errorCount,
    warningCount,
    startupTimeMs: durationMs,
    bundleSize,
    gzipSize
  };
}

/**
 * Analyze visual quality from code structure
 * @param {string} code
 * @param {string} skill
 * @returns {VisualScore}
 */
export function analyzeVisualQuality(code, skill) {
  let score = 75; // Start with a baseline assumption

  // Count visual elements by skill
  let materialRichness = 0;
  let lightingComplexity = 0;
  let motionElements = 0;

  if (skill === "threejs") {
    // Count materials
    const materialMatches = code.match(/new\s+THREE\.[\w]*Material/g);
    materialRichness = materialMatches ? materialMatches.length : 0;

    // Count lights
    const lightMatches = code.match(/new\s+THREE\.[\w]*Light/g);
    lightingComplexity = lightMatches ? lightMatches.length : 0;

    // Count animations/motions
    const animationMatches = code.match(/requestAnimationFrame|\.position\.|\.rotation\.|\.scale\./g);
    motionElements = animationMatches ? animationMatches.length : 0;

    // Bonus for advanced materials
    if (code.includes("MeshPhysicalMaterial") || code.includes("MeshStandardMaterial")) {
      score += 5;
    }

    // Bonus for post-processing
    if (code.includes("EffectComposer") || code.includes("RenderPass") || code.includes("bloom")) {
      score += 5;
    }
  } else if (skill === "p5js") {
    // Count drawing operations
    const drawOps = code.match(/ellipse|rect|circle|line|triangle|quad/g);
    materialRichness = drawOps ? drawOps.length : 0;

    // Count animations
    const animOps = code.match(/frameCount|millis\(\)|lerp|map\s*\(/g);
    motionElements = animOps ? animOps.length : 0;
  }

  // Score based on richness
  if (materialRichness >= 5) {
    score += 10;
  } else if (materialRichness >= 3) {
    score += 5;
  } else if (materialRichness === 0) {
    score -= 10;
  }

  if (lightingComplexity >= 3) {
    score += 10;
  } else if (lightingComplexity >= 1) {
    score += 5;
  }

  if (motionElements >= 5) {
    score += 5;
  }

  return {
    score: Math.min(100, score),
    materialRichness,
    lightingComplexity,
    motionContinuity: motionElements > 0 ? 70 : 40,
    colorHarmony: 70, // Would need actual color analysis
    compositionScore: 70 // Would need spatial analysis
  };
}

/**
 * Analyze semantic quality (prompt adherence)
 * @param {string} code
 * @param {string} prompt
 * @param {string} skill
 * @returns {SemanticScore}
 */
export function analyzeSemanticQuality(code, prompt, skill) {
  let score = 80;
  const missingElements = [];

  // Extract keywords from prompt
  const promptKeywords = extractPromptKeywords(prompt);

  // Check if code addresses keywords
  const codeLower = code.toLowerCase();
  for (const keyword of promptKeywords) {
    if (!codeLower.includes(keyword.toLowerCase())) {
      missingElements.push(keyword);
    }
  }

  // Deduct for missing elements
  score -= missingElements.length * 5;

  // Check skill appropriateness
  const skillAppropriate = checkSkillAppropriateness(prompt, skill);
  if (!skillAppropriate) {
    score -= 10;
  }

  return {
    score: Math.max(0, score),
    intentFulfillment: score,
    skillAppropriate,
    missingElements
  };
}

/**
 * Extract keywords from user prompt
 * @param {string} prompt
 * @returns {string[]}
 */
function extractPromptKeywords(prompt) {
  const keywords = [];
  const words = prompt.toLowerCase().split(/\s+/);

  // Visual element keywords
  const visualKeywords = [
    "3d", "cube", "sphere", "animation", "rotate", "color", "light",
    "particle", "effect", "glow", "shadow", "texture", "material",
    "camera", "perspective", "orbit", "grid", "axis", "wave", "loop"
  ];

  for (const word of words) {
    const cleanWord = word.replace(/[^a-z0-9]/g, "");
    if (visualKeywords.includes(cleanWord)) {
      keywords.push(cleanWord);
    }
  }

  return [...new Set(keywords)]; // Deduplicate
}

/**
 * Check if skill is appropriate for the prompt
 * @param {string} prompt
 * @param {string} skill
 * @returns {boolean}
 */
function checkSkillAppropriateness(prompt, skill) {
  const promptLower = prompt.toLowerCase();

  const skillIndicators = {
    threejs: ["3d", "three.js", "threejs", "webgl", "geometry", "mesh", "shader"],
    p5js: ["p5", "p5.js", "processing", "creative coding", "generative art"],
    d3js: ["d3", "d3.js", "data visualization", "chart", "graph", "svg"],
    animejs: ["anime", "anime.js", "animation", "timeline", "sequence"]
  };

  const indicators = skillIndicators[skill];
  if (!indicators) return true;

  return indicators.some(indicator => promptLower.includes(indicator));
}

/**
 * Calculate composite quality score
 * @param {QualitySignals} signals
 * @returns {number} 0-100 composite score
 */
export function calculateCompositeScore(signals) {
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

/**
 * Generate patch goals based on quality analysis
 * @param {QualitySignals} signals
 * @param {number} threshold
 * @returns {Array<{id: string, category: string, severity: 'critical'|'warning'|'suggestion', description: string}>}
 */
export function generatePatchGoals(signals, threshold = 75) {
  const goals = [];

  // Static issues
  if (!signals.static.syntaxValid) {
    goals.push({
      id: "syntax-fix",
      category: "Static",
      severity: "critical",
      description: "Fix syntax errors in the code"
    });
  }

  for (const issue of signals.static.securityIssues || []) {
    goals.push({
      id: `security-${goals.length}`,
      category: "Security",
      severity: "critical",
      description: issue
    });
  }

  if (signals.static.complexity > 500) {
    goals.push({
      id: "complexity-reduce",
      category: "Maintainability",
      severity: "warning",
      description: "Reduce code complexity: extract functions and simplify nesting"
    });
  }

  // Runtime issues
  if (signals.runtime.fps < 30) {
    goals.push({
      id: "fps-optimize",
      category: "Performance",
      severity: "warning",
      description: `Optimize render loop: current FPS ${signals.runtime.fps} is below 30`
    });
  }

  if (signals.runtime.errorCount > 0) {
    goals.push({
      id: "runtime-errors",
      category: "Runtime",
      severity: "critical",
      description: `Fix ${signals.runtime.errorCount} runtime error(s)`
    });
  }

  // Visual issues
  if (signals.visual.materialRichness < 3) {
    goals.push({
      id: "materials-enhance",
      category: "Visual",
      severity: "suggestion",
      description: "Add material layers: normal maps, roughness, metalness for richer visuals"
    });
  }

  if (signals.visual.lightingComplexity < 2) {
    goals.push({
      id: "lighting-enhance",
      category: "Visual",
      severity: "suggestion",
      description: "Enhance lighting: add multiple light types for depth"
    });
  }

  // Semantic issues
  for (const missing of signals.semantic?.missingElements || []) {
    goals.push({
      id: `missing-${missing}`,
      category: "Intent",
      severity: "warning",
      description: `Add missing element from prompt: "${missing}"`
    });
  }

  return goals;
}

/**
 * Determine if iteration should stop
 * @param {number} compositeScore
 * @param {number} iterationNumber
 * @param {number} maxIterations
 * @param {number} threshold
 * @returns {{shouldStop: boolean, reason: string}}
 */
export function shouldStopIteration(compositeScore, iterationNumber, maxIterations, threshold = 75) {
  if (compositeScore >= threshold) {
    return { shouldStop: true, reason: "threshold_met" };
  }

  if (iterationNumber >= maxIterations) {
    return { shouldStop: true, reason: "budget_exhausted" };
  }

  return { shouldStop: false, reason: null };
}

/**
 * Full quality analysis
 * @param {Object} params
 * @param {string} params.code
 * @param {string} params.skill
 * @param {string} params.prompt
 * @param {Object} [params.executionResult]
 * @returns {QualitySignals}
 */
export function analyzeQuality({ code, skill, prompt, executionResult = null }) {
  const staticScore = analyzeStaticQuality(code, skill);
  const runtimeScore = executionResult
    ? analyzeRuntimeQuality(executionResult)
    : { score: 0, fps: 0, memoryMb: 0, errorCount: 0, warningCount: 0, startupTimeMs: 0 };
  const visualScore = analyzeVisualQuality(code, skill);
  const semanticScore = analyzeSemanticQuality(code, prompt, skill);

  const signals = {
    static: staticScore,
    runtime: runtimeScore,
    visual: visualScore,
    semantic: semanticScore
  };

  signals.composite = calculateCompositeScore(signals);

  return signals;
}

/**
 * Get quality label for a score
 * @param {number} score
 * @returns {string}
 */
export function getQualityLabel(score) {
  if (score >= QUALITY_THRESHOLDS.excellent) return "Excellent";
  if (score >= QUALITY_THRESHOLDS.good) return "Good";
  if (score >= QUALITY_THRESHOLDS.acceptable) return "Fair";
  return "Poor";
}
