/**
 * Code Validator — AST-based validation with security scanning, schema checks,
 * and quality enforcement for all supported skills.
 */

import { parse } from "acorn";
import { MODEL_SUBJECT_PATTERN } from "@visual-runtime/shared";

// ─── Types ───────────────────────────────────────────────────────────

interface ValidationError {
  code: string;
  message: string;
  line?: number | null;
  column?: number | null;
  identifier?: string;
}

interface ValidationWarning {
  code: string;
  message: string;
}

interface CheckResult {
  passed: boolean;
  errors: ValidationError[];
  warnings?: ValidationWarning[];
}

export interface ValidationResult {
  valid: boolean;
  passable: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  checks: {
    syntax: CheckResult;
    security: CheckResult;
    schema: CheckResult;
    quality: CheckResult & { warnings: ValidationWarning[] };
    api?: CheckResult;
  };
}

interface SecurityRule {
  pattern: RegExp;
  code: string;
  message: string;
}

interface SkillWhitelist {
  globals: string[];
  memberRoots: string[];
}

interface ValidateOptions {
  requestedQuality?: string;
  enforceQuality?: boolean;
  sourceText?: string;
  userQuery?: string;
  parsedIntent?: {
    rawQuery?: string;
    intentType?: string;
    [key: string]: unknown;
  };
}

// ─── Security Rules ──────────────────────────────────────────────────

const SECURITY_BLOCKED_PATTERNS: SecurityRule[] = [
  { pattern: /\beval\s*\(/, code: "SECURITY_EVAL", message: "eval() calls are forbidden." },
  { pattern: /new\s+Function\s*\(/, code: "SECURITY_FUNCTION_CONSTRUCTOR", message: "Function constructor is forbidden." },
  { pattern: /\bfetch\s*\(/, code: "SECURITY_NETWORK", message: "fetch() network calls are forbidden." },
  { pattern: /\bXMLHttpRequest\b/, code: "SECURITY_NETWORK", message: "XMLHttpRequest is forbidden." },
  { pattern: /\bimport\s*\(/, code: "SECURITY_DYNAMIC_IMPORT", message: "Dynamic import() is forbidden." },
  { pattern: /\brequire\s*\(/, code: "SECURITY_REQUIRE", message: "require() is forbidden." },
  { pattern: /process\s*\.\s*(env|exit|kill)/, code: "SECURITY_PROCESS", message: "process access is forbidden." },
  { pattern: /child_process/, code: "SECURITY_CHILD_PROCESS", message: "child_process is forbidden." },
  { pattern: /\bfs\b\s*\.\s*(read|write|unlink|mkdir|rmdir)/, code: "SECURITY_FILESYSTEM", message: "Direct filesystem access is forbidden." }
];

const MANIM_SECURITY_BLOCKED_PATTERNS: SecurityRule[] = [
  { pattern: /\bimport\s+os\b|\bfrom\s+os\s+import\b/, code: "SECURITY_OS", message: "os module access is forbidden." },
  { pattern: /\bimport\s+subprocess\b|\bfrom\s+subprocess\s+import\b/, code: "SECURITY_SUBPROCESS", message: "subprocess usage is forbidden." },
  { pattern: /\bimport\s+socket\b|\bfrom\s+socket\s+import\b/, code: "SECURITY_SOCKET", message: "Socket networking is forbidden." },
  { pattern: /\bimport\s+requests\b|\bfrom\s+requests\s+import\b/, code: "SECURITY_NETWORK", message: "Network requests are forbidden." },
  { pattern: /\bimport\s+urllib\b|\bfrom\s+urllib\s+import\b/, code: "SECURITY_NETWORK", message: "Network requests are forbidden." },
  { pattern: /\b(open|exec|eval|compile)\s*\(/, code: "SECURITY_UNSAFE_CALL", message: "Unsafe runtime calls are forbidden." },
  { pattern: /\bimport\s+pathlib\b|\bfrom\s+pathlib\s+import\b/, code: "SECURITY_FILESYSTEM", message: "Filesystem path operations are forbidden." },
  { pattern: /\bimport\s+shutil\b|\bfrom\s+shutil\s+import\b/, code: "SECURITY_FILESYSTEM", message: "Filesystem copy/move operations are forbidden." }
];

// ─── Skill API Whitelists ────────────────────────────────────────────

const SKILL_API_WHITELIST: Record<string, SkillWhitelist> = {
  threejs: {
    globals: ["THREE", "scene", "camera", "renderer", "OrbitControls", "requestAnimationFrame", "cancelAnimationFrame", "console", "Math", "Date", "JSON", "Array", "Object", "String", "Number", "Boolean", "parseInt", "parseFloat", "isNaN", "isFinite", "undefined", "null", "NaN", "Infinity", "window", "document", "performance"],
    memberRoots: ["THREE", "scene", "camera", "renderer", "console", "Math", "JSON", "OrbitControls", "document", "performance"]
  },
  p5js: {
    globals: ["createCanvas", "background", "fill", "stroke", "noStroke", "noFill", "ellipse", "rect", "line", "triangle", "quad", "arc", "point", "beginShape", "endShape", "vertex", "translate", "rotate", "scale", "push", "pop", "frameRate", "noLoop", "loop", "random", "noise", "millis", "width", "height", "mouseX", "mouseY", "setup", "draw", "keyPressed", "mousePressed", "requestAnimationFrame", "cancelAnimationFrame", "console", "Math", "Date", "JSON", "Array", "Object", "String", "Number", "Boolean", "parseInt", "parseFloat", "isNaN", "isFinite", "undefined", "null", "NaN", "Infinity", "window", "document", "performance", "color", "lerpColor", "red", "green", "blue", "alpha", "brightness", "hue", "saturation", "colorMode", "strokeWeight", "textSize", "text", "textAlign", "textFont", "map", "constrain", "lerp", "dist", "sin", "cos", "tan", "atan2", "radians", "degrees", "PI", "TWO_PI", "HALF_PI", "QUARTER_PI"],
    memberRoots: ["console", "Math", "JSON", "document", "performance"]
  },
  d3js: {
    globals: ["d3", "document", "requestAnimationFrame", "cancelAnimationFrame", "console", "Math", "Date", "JSON", "Array", "Object", "String", "Number", "Boolean", "parseInt", "parseFloat", "isNaN", "isFinite", "undefined", "null", "NaN", "Infinity", "window", "performance", "SVGElement"],
    memberRoots: ["d3", "console", "Math", "JSON", "document", "performance"]
  },
  animejs: {
    globals: ["anime", "document", "window", "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "console", "Math", "Date", "JSON", "Array", "Object", "String", "Number", "Boolean", "parseInt", "parseFloat", "isNaN", "isFinite", "undefined", "null", "NaN", "Infinity", "performance", "SVGElement", "Element"],
    memberRoots: ["anime", "console", "Math", "JSON", "document", "performance", "window"]
  }
};

// ─── Patterns ────────────────────────────────────────────────────────

const DYNAMIC_SCENE_PATTERN = /\b(animate|animation|motion|move|moving|fly|flying|spin|spinning|rotate|rotation|orbit|dance|walk|run|loop|timeline)\b/i;
const STATIC_SCENE_PATTERN = /\b(static|still|poster|logo|icon|infographic|chart|graph|diagram)\b/i;

// ─── Helpers ─────────────────────────────────────────────────────────

function normalizeRequestedQuality(value: unknown): string {
  if (!value) return "standard";
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "draft" || normalized === "standard" || normalized === "high") return normalized;
  return "standard";
}

function countRegexMatches(input: string | null | undefined, regex: RegExp): number {
  if (!input) return 0;
  const matches = String(input).match(regex);
  return matches ? matches.length : 0;
}

function extractValidationSourceText(options: ValidateOptions = {}): string {
  const parts: string[] = [];
  if (typeof options.sourceText === "string" && options.sourceText.trim()) parts.push(options.sourceText);
  if (typeof options.userQuery === "string" && options.userQuery.trim()) parts.push(options.userQuery);
  if (typeof options.parsedIntent?.rawQuery === "string" && options.parsedIntent.rawQuery.trim()) parts.push(options.parsedIntent.rawQuery);
  return parts.join(" ").toLowerCase();
}

// ─── Check Functions ─────────────────────────────────────────────────

function checkThreejsQuality(code: string, options: ValidateOptions = {}): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const quality = normalizeRequestedQuality(options.requestedQuality);
  const enforceQuality = options.enforceQuality !== false;

  if (!enforceQuality || quality === "draft") return { errors: [], warnings: [] };

  const normalizedCode = String(code ?? "");
  const sourceText = extractValidationSourceText(options);
  const parsedIntentType = String(options.parsedIntent?.intentType ?? "").toLowerCase();
  const expectsModelSubject = MODEL_SUBJECT_PATTERN.test(sourceText);
  const expectsDynamicMotion = STATIC_SCENE_PATTERN.test(sourceText) ? false : DYNAMIC_SCENE_PATTERN.test(sourceText) || parsedIntentType === "animate";

  const hasModelLoader = /\b(GLTFLoader|createGveGltfLoader|resolveGveModelCandidates|DRACOLoader)\b/.test(normalizedCode);
  const hasModelUrl = /\.(?:glb|gltf)(?:[?#][^\s"'`)]*)?/i.test(normalizedCode);
  const boxGeometryCount = countRegexMatches(normalizedCode, /\bBoxGeometry\b/g);
  const cylinderGeometryCount = countRegexMatches(normalizedCode, /\bCylinderGeometry\b/g);
  const hasEnvMap = /\b(RGBELoader|HDRLoader|scene\s*\.\s*environment\b|__GVE_ENV_MAP_URL)/.test(normalizedCode);
  const hasOrbitControls = /\b(OrbitControls|controls\s*\.\s*(?:update|enableDamping))\b/.test(normalizedCode);
  const primitiveCount = boxGeometryCount + cylinderGeometryCount;
  const hasHighQualityMaterial = /\bMesh(?:Standard|Physical)Material\b/.test(normalizedCode);
  const ambientLightCount = countRegexMatches(normalizedCode, /\bAmbientLight\b/g);
  const keyLightCount = countRegexMatches(normalizedCode, /\b(?:DirectionalLight|SpotLight|PointLight|HemisphereLight|RectAreaLight)\b/g);
  const hasAnimationLoop = /\brequestAnimationFrame\b|\bsetAnimationLoop\b|\bTHREE\.Clock\b|\.getElapsedTime\s*\(/.test(normalizedCode);
  const hasRendererQualityPipeline = /\b(?:renderer|__renderer)\s*\.\s*(?:toneMapping|toneMappingExposure|outputEncoding|outputColorSpace)\b/.test(normalizedCode);

  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (expectsModelSubject && !hasModelLoader && !hasModelUrl) {
    errors.push({ code: "QUALITY_MODEL_SUBJECT_MISSING", message: "High-fidelity Three.js scenes for humans/animals/birds/vehicles must load at least one GLTF/GLB model via GLTFLoader or createGveGltfLoader()." });
  }

  if (expectsModelSubject && primitiveCount >= 2 && !hasModelLoader && !hasModelUrl) {
    errors.push({ code: "QUALITY_PRIMITIVE_SUBJECT_FALLBACK", message: "Detected primitive-heavy subject construction. Avoid BoxGeometry/CylinderGeometry stand-ins when the subject requires model fidelity." });
  }

  if (expectsModelSubject && !hasOrbitControls) {
    warnings.push({ code: "QUALITY_ORBITCONTROLS_RECOMMENDED", message: "Interactive 3D scenes should include OrbitControls for camera navigation." });
  }

  const hasLayeredLighting = ambientLightCount >= 1 && keyLightCount >= 1;

  if (quality === "high") {
    if (!hasHighQualityMaterial) errors.push({ code: "QUALITY_MATERIAL_FIDELITY_LOW", message: "High quality Three.js scenes should use MeshStandardMaterial or MeshPhysicalMaterial for hero assets." });
    if (!hasLayeredLighting) errors.push({ code: "QUALITY_LIGHTING_INSUFFICIENT", message: "High quality Three.js scenes require layered lighting (ambient + key/fill/rim-capable light)." });
    if (expectsDynamicMotion && !hasAnimationLoop) errors.push({ code: "QUALITY_MOTION_MISSING", message: "Dynamic/animated requests should include an explicit animation loop." });
    if (!hasRendererQualityPipeline) warnings.push({ code: "QUALITY_RENDERER_PIPELINE_HINT", message: "Consider explicit renderer tone mapping/exposure settings for cinematic contrast." });
    if (!hasEnvMap) warnings.push({ code: "QUALITY_ENV_MAP_RECOMMENDED", message: "High quality scenes benefit from an HDR environment map for realistic PBR reflections. Use RGBELoader to load an equirectangular HDR." });
  }

  if (quality === "standard") {
    if (!hasHighQualityMaterial && !hasModelLoader && !hasModelUrl) warnings.push({ code: "QUALITY_MATERIAL_RECOMMENDED", message: "Use MeshStandardMaterial or MeshPhysicalMaterial for better visual fidelity." });
    if (!hasLayeredLighting) warnings.push({ code: "QUALITY_LIGHTING_RECOMMENDED", message: "Add layered lighting (ambient plus key/fill/rim style light) for stronger depth." });
    if (expectsDynamicMotion && !hasAnimationLoop) warnings.push({ code: "QUALITY_MOTION_RECOMMENDED", message: "Animated prompts should include requestAnimationFrame/setAnimationLoop for motion continuity." });
  }

  return { errors, warnings };
}

function checkSyntax(code: string): ValidationError[] {
  const errors: ValidationError[] = [];
  try {
    parse(code, { ecmaVersion: 2022, sourceType: "script", allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
  } catch (syntaxError: any) {
    errors.push({ code: "SYNTAX_ERROR", message: syntaxError.message, line: syntaxError.loc?.line ?? null, column: syntaxError.loc?.column ?? null });
  }
  return errors;
}

function checkSecurity(code: string): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const rule of SECURITY_BLOCKED_PATTERNS) {
    if (rule.pattern.test(code)) errors.push({ code: rule.code, message: rule.message });
  }
  return errors;
}

function checkManimSecurity(code: string): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const rule of MANIM_SECURITY_BLOCKED_PATTERNS) {
    if (rule.pattern.test(code)) errors.push({ code: rule.code, message: rule.message });
  }
  return errors;
}

function checkBracketBalance(code: string): boolean {
  const stack: string[] = [];
  const opens: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const closes = new Set(Object.values(opens));

  for (const char of String(code ?? "")) {
    if (opens[char]) { stack.push(char); continue; }
    if (closes.has(char)) {
      const last = stack.pop();
      if (!last || opens[last] !== char) return false;
    }
  }
  return stack.length === 0;
}

function checkManimSyntax(code: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const normalized = String(code ?? "");
  if (!normalized.trim()) { errors.push({ code: "SYNTAX_EMPTY_CODE", message: "Code output is empty." }); return errors; }
  if (/```/.test(normalized)) errors.push({ code: "SYNTAX_MARKDOWN_FENCE", message: "Markdown fences are not allowed; return raw Python code only." });
  if (!checkBracketBalance(normalized)) errors.push({ code: "SYNTAX_BRACKET_MISMATCH", message: "Code appears to have mismatched brackets or parentheses." });
  return errors;
}

function checkManimSchema(code: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const normalized = String(code ?? "");
  if (!/(from\s+manim\s+import\s+\*|import\s+manim)/.test(normalized)) errors.push({ code: "SCHEMA_MISSING_MANIM_IMPORT", message: "Manim code should import the Manim API." });
  if (!/class\s+[A-Za-z_][A-Za-z0-9_]*\s*\(\s*[^)]*Scene[^)]*\)\s*:/.test(normalized)) errors.push({ code: "SCHEMA_MISSING_SCENE_CLASS", message: "Manim code should define a Scene subclass." });
  if (!/def\s+construct\s*\(\s*self\s*\)\s*:/.test(normalized)) errors.push({ code: "SCHEMA_MISSING_CONSTRUCT", message: "Manim Scene should define construct(self)." });
  return errors;
}

function checkApiUsage(code: string, skillId: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const whitelist = SKILL_API_WHITELIST[skillId];
  if (!whitelist) return errors;

  let ast: any;
  try {
    ast = parse(code, { ecmaVersion: 2022, sourceType: "script", allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
  } catch { return errors; }

  const declaredIdentifiers = new Set<string>();

  function collectDeclarations(node: any): void {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier") declaredIdentifiers.add(node.id.name);
    if (node.type === "FunctionDeclaration" && node.id?.type === "Identifier") declaredIdentifiers.add(node.id.name);
    if (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
      if (Array.isArray(node.params)) {
        for (const param of node.params) {
          if (param.type === "Identifier") declaredIdentifiers.add(param.name);
        }
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "type") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) { if (item && typeof item === "object" && item.type) collectDeclarations(item); }
      } else if (child && typeof child === "object" && child.type) {
        collectDeclarations(child);
      }
    }
  }

  collectDeclarations(ast);
  return errors;
}

function hasTopLevelCode(code: string): boolean {
  try {
    const ast = parse(code, { ecmaVersion: 2022, sourceType: "script" });
    for (const node of ast.body) {
      if (node.type === "FunctionDeclaration") continue;
      if (node.type === "ExpressionStatement" && node.expression.type === "FunctionExpression") continue;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function checkSchema(code: string, skillId: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (skillId === "threejs") {
    const createsScene = /new\s+THREE\.Scene\s*\(/.test(code);
    const usesScene = /scene\s*\.\s*(add|background|children|fog|traverse|environment)/.test(code);
    const usesCamera = /camera\.(position|lookAt|rotation|quaternion|fov|aspect)|new\s+THREE\.(Perspective|Orthographic|Array)Camera/.test(code);
    const usesRenderer = /renderer\s*\./.test(code) || /new\s+THREE\.(WebGL|WebGPU)Renderer/.test(code);
    const hasTopLevel = hasTopLevelCode(code);

    if (!hasTopLevel && !createsScene && !usesScene && !usesCamera && !usesRenderer) {
      errors.push({ code: "SCHEMA_PURE_HELPER", message: "Generated code contains only helper function(s) with no Three.js scene setup. The code must include scene construction, camera setup, a renderer, and an animation loop, or use the provided globals (scene, camera, renderer)." });
    } else if (!createsScene && !usesScene) {
      errors.push({ code: "SCHEMA_MISSING_SCENE", message: "Three.js code must reference 'scene' (e.g. scene.add()) or create one with new THREE.Scene()." });
    }

    if (!createsScene && !usesCamera) {
      errors.push({ code: "SCHEMA_MISSING_CAMERA", message: "Three.js code must set up a camera (new THREE.PerspectiveCamera, camera.position, etc.)." });
    }

    if (!createsScene && !usesRenderer) {
      errors.push({ code: "SCHEMA_MISSING_RENDERER", message: "Three.js code must set up a renderer (new THREE.WebGLRenderer, renderer.setSize, etc.)." });
    }
  }
  if (skillId === "p5js") {
    if (!/function\s+setup\b/.test(code) && !/function\s+draw\b/.test(code) && !/createCanvas\s*\(/.test(code)) errors.push({ code: "SCHEMA_MISSING_LIFECYCLE", message: "p5.js code should define setup()/draw() or call createCanvas()." });
  }
  if (skillId === "d3js") {
    if (!/d3\s*\./.test(code)) errors.push({ code: "SCHEMA_MISSING_D3", message: "D3.js code should reference the d3 namespace." });
  }
  if (skillId === "animejs") {
    if (!/\banime\s*(\(|\.)/.test(code)) errors.push({ code: "SCHEMA_MISSING_ANIME", message: "Anime.js code should reference the anime() API or anime.timeline()." });
  }

  return errors;
}

// ─── Public API ──────────────────────────────────────────────────────

export function validateCode(code: string, skillId = "threejs", options: ValidateOptions = {}): ValidationResult {
  if (skillId === "manim") {
    const syntaxErrors = checkManimSyntax(code);
    const securityErrors = checkManimSecurity(code);
    const schemaErrors = checkManimSchema(code);
    const allErrors = [...syntaxErrors, ...securityErrors, ...schemaErrors];
    const hasCritical = syntaxErrors.length > 0 || securityErrors.length > 0;

    return {
      valid: allErrors.length === 0,
      passable: !hasCritical,
      errors: allErrors,
      warnings: [],
      checks: {
        syntax: { passed: syntaxErrors.length === 0, errors: syntaxErrors },
        security: { passed: securityErrors.length === 0, errors: securityErrors },
        schema: { passed: schemaErrors.length === 0, errors: schemaErrors },
        quality: { passed: true, errors: [], warnings: [] }
      }
    };
  }

  const syntaxErrors = checkSyntax(code);
  const securityErrors = checkSecurity(code);
  const schemaErrors = checkSchema(code, skillId);
  const qualityResult = skillId === "threejs" ? checkThreejsQuality(code, options) : { errors: [] as ValidationError[], warnings: [] as ValidationWarning[] };

  const allErrors = [...syntaxErrors, ...securityErrors, ...schemaErrors, ...qualityResult.errors];
  const hasCritical = syntaxErrors.length > 0 || securityErrors.length > 0 || schemaErrors.length > 0 || qualityResult.errors.length > 0;

  return {
    valid: allErrors.length === 0,
    passable: !hasCritical,
    errors: allErrors,
    warnings: qualityResult.warnings,
    checks: {
      syntax: { passed: syntaxErrors.length === 0, errors: syntaxErrors },
      security: { passed: securityErrors.length === 0, errors: securityErrors },
      schema: { passed: schemaErrors.length === 0, errors: schemaErrors },
      quality: { passed: qualityResult.errors.length === 0, errors: qualityResult.errors, warnings: qualityResult.warnings }
    }
  };
}

export function validateCodeStrict(code: string, skillId = "threejs", options: ValidateOptions = {}): ValidationResult {
  if (skillId === "manim") return validateCode(code, skillId, options);

  const base = validateCode(code, skillId, options);
  const apiErrors = checkApiUsage(code, skillId);
  const allErrors = [...base.errors, ...apiErrors];

  return {
    valid: allErrors.length === 0,
    passable: base.passable,
    errors: allErrors,
    warnings: base.warnings,
    checks: {
      ...base.checks,
      api: { passed: apiErrors.length === 0, errors: apiErrors }
    }
  };
}
