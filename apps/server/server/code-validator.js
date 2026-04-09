import { parse } from "acorn";

const SECURITY_BLOCKED_PATTERNS = [
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

const MANIM_SECURITY_BLOCKED_PATTERNS = [
  { pattern: /\bimport\s+os\b|\bfrom\s+os\s+import\b/, code: "SECURITY_OS", message: "os module access is forbidden." },
  { pattern: /\bimport\s+subprocess\b|\bfrom\s+subprocess\s+import\b/, code: "SECURITY_SUBPROCESS", message: "subprocess usage is forbidden." },
  { pattern: /\bimport\s+socket\b|\bfrom\s+socket\s+import\b/, code: "SECURITY_SOCKET", message: "Socket networking is forbidden." },
  { pattern: /\bimport\s+requests\b|\bfrom\s+requests\s+import\b/, code: "SECURITY_NETWORK", message: "Network requests are forbidden." },
  { pattern: /\bimport\s+urllib\b|\bfrom\s+urllib\s+import\b/, code: "SECURITY_NETWORK", message: "Network requests are forbidden." },
  { pattern: /\b(open|exec|eval|compile)\s*\(/, code: "SECURITY_UNSAFE_CALL", message: "Unsafe runtime calls are forbidden." },
  { pattern: /\bimport\s+pathlib\b|\bfrom\s+pathlib\s+import\b/, code: "SECURITY_FILESYSTEM", message: "Filesystem path operations are forbidden." },
  { pattern: /\bimport\s+shutil\b|\bfrom\s+shutil\s+import\b/, code: "SECURITY_FILESYSTEM", message: "Filesystem copy/move operations are forbidden." }
];

const SKILL_API_WHITELIST = {
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

function checkSyntax(code) {
  const errors = [];

  try {
    parse(code, {
      ecmaVersion: 2022,
      sourceType: "script",
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true
    });
  } catch (syntaxError) {
    errors.push({
      code: "SYNTAX_ERROR",
      message: syntaxError.message,
      line: syntaxError.loc?.line ?? null,
      column: syntaxError.loc?.column ?? null
    });
  }

  return errors;
}

function checkSecurity(code) {
  const errors = [];

  for (const rule of SECURITY_BLOCKED_PATTERNS) {
    if (rule.pattern.test(code)) {
      errors.push({
        code: rule.code,
        message: rule.message
      });
    }
  }

  return errors;
}

function checkManimSecurity(code) {
  const errors = [];

  for (const rule of MANIM_SECURITY_BLOCKED_PATTERNS) {
    if (rule.pattern.test(code)) {
      errors.push({
        code: rule.code,
        message: rule.message
      });
    }
  }

  return errors;
}

function checkBracketBalance(code) {
  const stack = [];
  const opens = { "(": ")", "[": "]", "{": "}" };
  const closes = new Set(Object.values(opens));

  for (const char of String(code ?? "")) {
    if (opens[char]) {
      stack.push(char);
      continue;
    }

    if (closes.has(char)) {
      const last = stack.pop();
      if (!last || opens[last] !== char) {
        return false;
      }
    }
  }

  return stack.length === 0;
}

function checkManimSyntax(code) {
  const errors = [];
  const normalized = String(code ?? "");

  if (!normalized.trim()) {
    errors.push({
      code: "SYNTAX_EMPTY_CODE",
      message: "Code output is empty."
    });
    return errors;
  }

  if (/```/.test(normalized)) {
    errors.push({
      code: "SYNTAX_MARKDOWN_FENCE",
      message: "Markdown fences are not allowed; return raw Python code only."
    });
  }

  if (!checkBracketBalance(normalized)) {
    errors.push({
      code: "SYNTAX_BRACKET_MISMATCH",
      message: "Code appears to have mismatched brackets or parentheses."
    });
  }

  return errors;
}

function checkManimSchema(code) {
  const errors = [];
  const normalized = String(code ?? "");

  if (!/(from\s+manim\s+import\s+\*|import\s+manim)/.test(normalized)) {
    errors.push({
      code: "SCHEMA_MISSING_MANIM_IMPORT",
      message: "Manim code should import the Manim API."
    });
  }

  if (!/class\s+[A-Za-z_][A-Za-z0-9_]*\s*\(\s*[^)]*Scene[^)]*\)\s*:/.test(normalized)) {
    errors.push({
      code: "SCHEMA_MISSING_SCENE_CLASS",
      message: "Manim code should define a Scene subclass."
    });
  }

  if (!/def\s+construct\s*\(\s*self\s*\)\s*:/.test(normalized)) {
    errors.push({
      code: "SCHEMA_MISSING_CONSTRUCT",
      message: "Manim Scene should define construct(self)."
    });
  }

  return errors;
}

function checkApiUsage(code, skillId) {
  const errors = [];
  const whitelist = SKILL_API_WHITELIST[skillId];

  if (!whitelist) {
    return errors;
  }

  let ast;
  try {
    ast = parse(code, {
      ecmaVersion: 2022,
      sourceType: "script",
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true
    });
  } catch {
    return errors;
  }

  const declaredIdentifiers = new Set();

  function collectDeclarations(node) {
    if (!node || typeof node !== "object") {
      return;
    }

    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier") {
      declaredIdentifiers.add(node.id.name);
    }

    if (node.type === "FunctionDeclaration" && node.id?.type === "Identifier") {
      declaredIdentifiers.add(node.id.name);
    }

    if (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
      if (Array.isArray(node.params)) {
        for (const param of node.params) {
          if (param.type === "Identifier") {
            declaredIdentifiers.add(param.name);
          }
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === "type") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && item.type) {
            collectDeclarations(item);
          }
        }
      } else if (child && typeof child === "object" && child.type) {
        collectDeclarations(child);
      }
    }
  }

  collectDeclarations(ast);

  function walkForGlobalAccess(node) {
    if (!node || typeof node !== "object") {
      return;
    }

    if (node.type === "Identifier" && !declaredIdentifiers.has(node.name) && !whitelist.globals.includes(node.name)) {
      if (!["arguments", "this", "globalThis", "self"].includes(node.name)) {
        errors.push({
          code: "API_UNKNOWN_GLOBAL",
          message: `Access to undeclared global "${node.name}" is not in the ${skillId} API whitelist.`,
          identifier: node.name
        });
      }
    }

    for (const key of Object.keys(node)) {
      if (key === "type") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && item.type) {
            walkForGlobalAccess(item);
          }
        }
      } else if (child && typeof child === "object" && child.type) {
        walkForGlobalAccess(child);
      }
    }
  }

  return errors;
}

function checkSchema(code, skillId) {
  const errors = [];

  if (skillId === "threejs") {
    if (!/scene\s*\./.test(code) && !/new\s+THREE\./.test(code)) {
      errors.push({
        code: "SCHEMA_MISSING_SCENE",
        message: "Three.js code should reference 'scene' or create THREE objects."
      });
    }
  }

  if (skillId === "p5js") {
    if (!/function\s+setup\b/.test(code) && !/function\s+draw\b/.test(code) && !/createCanvas\s*\(/.test(code)) {
      errors.push({
        code: "SCHEMA_MISSING_LIFECYCLE",
        message: "p5.js code should define setup()/draw() or call createCanvas()."
      });
    }
  }

  if (skillId === "d3js") {
    if (!/d3\s*\./.test(code)) {
      errors.push({
        code: "SCHEMA_MISSING_D3",
        message: "D3.js code should reference the d3 namespace."
      });
    }
  }

  if (skillId === "animejs") {
    if (!/\banime\s*(\(|\.)/.test(code)) {
      errors.push({
        code: "SCHEMA_MISSING_ANIME",
        message: "Anime.js code should reference the anime() API or anime.timeline()."
      });
    }
  }

  return errors;
}

export function validateCode(code, skillId = "threejs") {
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
      checks: {
        syntax: { passed: syntaxErrors.length === 0, errors: syntaxErrors },
        security: { passed: securityErrors.length === 0, errors: securityErrors },
        schema: { passed: schemaErrors.length === 0, errors: schemaErrors }
      }
    };
  }

  const syntaxErrors = checkSyntax(code);
  const securityErrors = checkSecurity(code);
  const schemaErrors = checkSchema(code, skillId);

  const allErrors = [...syntaxErrors, ...securityErrors, ...schemaErrors];

  const hasCritical = syntaxErrors.length > 0 || securityErrors.length > 0;

  return {
    valid: allErrors.length === 0,
    passable: !hasCritical,
    errors: allErrors,
    checks: {
      syntax: { passed: syntaxErrors.length === 0, errors: syntaxErrors },
      security: { passed: securityErrors.length === 0, errors: securityErrors },
      schema: { passed: schemaErrors.length === 0, errors: schemaErrors }
    }
  };
}

export function validateCodeStrict(code, skillId = "threejs") {
  if (skillId === "manim") {
    return validateCode(code, skillId);
  }

  const base = validateCode(code, skillId);
  const apiErrors = checkApiUsage(code, skillId);

  const allErrors = [...base.errors, ...apiErrors];

  return {
    valid: allErrors.length === 0,
    passable: base.passable,
    errors: allErrors,
    checks: {
      ...base.checks,
      api: { passed: apiErrors.length === 0, errors: apiErrors }
    }
  };
}
