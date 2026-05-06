/**
 * Intent Detector — Classifies user prompts for routing to single-file or multi-file agent loop.
 */

import { z } from "zod";
import { getPool } from "../llm/pool.js";
import { recordTokenUsage } from "../state/token-usage.js";

const MAX_HISTORY = 3;

export interface IntentResult {
  projectType: "single-file" | "multi-file" | "modification";
  complexity: "simple" | "medium" | "complex";
  domain: "3d-scene" | "2d-canvas" | "particles" | "ui-animation" | "data-viz" | "generic";
  requiredSkills: string[];
  confidence: number;
  reasoning: string;
}

const intentSchema = z.object({
  projectType: z.enum(["single-file", "multi-file", "modification"]),
  complexity: z.enum(["simple", "medium", "complex"]),
  domain: z.enum(["3d-scene", "2d-canvas", "particles", "ui-animation", "data-viz", "generic"]),
  requiredSkills: z.array(z.string()).min(1),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1)
});

const INTENT_SYSTEM_PROMPT = `You are an intent classifier for a visual code generation engine.
Your job is to analyze the user's request and classify it into structured dimensions.

Respond ONLY with a JSON object matching this schema:
{
  "projectType": "single-file" | "multi-file" | "modification",
  "complexity": "simple" | "medium" | "complex",
  "domain": "3d-scene" | "2d-canvas" | "particles" | "ui-animation" | "data-viz" | "generic",
  "requiredSkills": ["threejs" | "p5js" | "d3js" | "animejs" | "manim"],
  "confidence": 0.0 to 1.0,
  "reasoning": "brief explanation"
}

Classification rules:
- projectType:
  - "single-file" for simple standalone scenes (one visual, basic animation)
  - "multi-file" for projects that benefit from separation (shaders, utilities, multiple objects, complex systems)
  - "modification" when user references existing scene or asks to change/update/fix
- complexity:
  - "simple" < 50 lines, basic shapes, single animation
  - "medium" 50-200 lines, multiple objects, interactions, custom shaders
  - "complex" > 200 lines, physics, multiple systems, post-processing, asset loading
- domain: best fit for the visual domain
- requiredSkills: ["threejs"] for 3D, ["p5js"] for creative coding, ["d3js"] for data viz, ["animejs"] for UI motion, ["manim"] for math animation
- confidence: 0.9+ for obvious cases, 0.5-0.8 for ambiguous, < 0.5 for truly unclear

Examples:
"make a red cube" → single-file, simple, 3d-scene, [threejs], 0.95
"build a solar system with orbiting planets, asteroid belt, and interactive camera" → multi-file, complex, 3d-scene, [threejs], 0.95
"add bloom post-processing to my existing scene" → modification, medium, 3d-scene, [threejs], 0.90
"animate a bar chart showing sales data" → single-file, medium, data-viz, [d3js], 0.88`;

// Fast heuristic fallback when LLM is unavailable or slow
function heuristicDetect(content: string): IntentResult {
  const lower = content.toLowerCase();

  // Modification keywords
  const modKeywords = ["add", "fix", "change", "update", "modify", "remove", "tweak", "adjust", "refactor"];
  const isModification = modKeywords.some(kw => lower.startsWith(kw) || lower.includes(` ${kw} `));

  // Multi-file indicators
  const multiIndicators = [
    "files", "components", "modules", "shaders", "utilities", "helpers",
    "system", "engine", "library", "framework", "scene graph",
    "post-processing", "physics", "multiple objects",
    "solar system", "game", "world", "environment",
    "classes", "objects", "entities"
  ];
  const multiScore = multiIndicators.reduce((score, ind) => score + (lower.includes(ind) ? 1 : 0), 0);

  // Complexity indicators
  const complexIndicators = [
    "bloom", "ssao", "raytracing", "shadow", "lighting", "pbr",
    "physics", "collision", "gravity", "orbit", "particles", "instancing",
    "shader", "vertex", "fragment", "webgl", "post-process",
    "animation loop", "timeline", "sequence", "interactive",
    "loading", "assets", "textures", "models"
  ];
  const complexScore = complexIndicators.reduce((score, ind) => score + (lower.includes(ind) ? 1 : 0), 0);

  // Domain detection
  let domain: IntentResult["domain"] = "generic";
  if (lower.includes("chart") || lower.includes("graph") || lower.includes("data") || lower.includes("plot")) domain = "data-viz";
  else if (lower.includes("ui") || lower.includes("button") || lower.includes("menu") || lower.includes("transition")) domain = "ui-animation";
  else if (lower.includes("particle") || lower.includes("firework") || lower.includes("spark") || lower.includes("fog")) domain = "particles";
  else if (lower.includes("2d") || lower.includes("canvas") || lower.includes("drawing")) domain = "2d-canvas";
  else if (lower.includes("3d") || lower.includes("scene") || lower.includes("model") || lower.includes("mesh")) domain = "3d-scene";

  // Skill detection
  const skills: string[] = [];
  if (lower.includes("manim") || lower.includes("python")) skills.push("manim");
  if (lower.includes("d3") || lower.includes("d3.js")) skills.push("d3js");
  if (lower.includes("p5") || lower.includes("p5.js") || lower.includes("processing")) skills.push("p5js");
  if (lower.includes("anime") || lower.includes("anime.js")) skills.push("animejs");
  // Default to threejs for 3D if no other skill matched
  if (skills.length === 0 && (domain === "3d-scene" || domain === "particles")) skills.push("threejs");
  if (skills.length === 0) skills.push("threejs"); // ultimate default

  const projectType: IntentResult["projectType"] =
    isModification ? "modification" :
    multiScore >= 2 ? "multi-file" :
    "single-file";

  const complexity: IntentResult["complexity"] =
    complexScore >= 4 ? "complex" :
    complexScore >= 1 ? "medium" :
    "simple";

  return {
    projectType,
    complexity,
    domain,
    requiredSkills: skills,
    confidence: Math.min(0.6 + (multiScore + complexScore) * 0.05, 0.85),
    reasoning: `Heuristic: ${multiScore} multi-file indicators, ${complexScore} complexity indicators, modification=${isModification}`
  };
}

export async function detectIntent(content: string, timeoutMs = 500): Promise<IntentResult> {
  const pool = getPool();
  const acquired = pool.acquire({ requireCodeGeneration: false });
  if (!acquired) {
    console.warn("[IntentDetector] No LLM providers available, using heuristic fallback.");
    return heuristicDetect(content);
  }

  const { provider, waitMs } = acquired;
  if (waitMs > 0) {
    await new Promise(r => setTimeout(r, waitMs));
  }

  const messages = [
    { role: "system", content: INTENT_SYSTEM_PROMPT },
    { role: "user", content: `Classify this request: "${content.slice(0, 500)}"` }
  ];

  const payload = {
    model: provider.model,
    temperature: 0.0,
    messages,
    response_format: { type: "json_object" }
  };

  let llmResult: IntentResult | null = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const startMs = Date.now();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const json = await response.json();
    pool.recordRequest(provider.id, Date.now() - startMs);
    pool.markHealthy(provider.id);

    if (json?.usage) {
      recordTokenUsage(
        { providerId: provider.id, model: json.model ?? provider.model ?? null },
        json.usage
      );
    }

    const raw = json?.choices?.[0]?.message?.content;
    if (raw) {
      const parsed = JSON.parse(raw);
      const validated = intentSchema.safeParse(parsed);
      if (validated.success) {
        llmResult = validated.data;
      }
    }
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.warn("[IntentDetector] LLM call timed out, using heuristic fallback.");
    } else {
      console.warn("[IntentDetector] LLM call failed:", err.message);
    }
    pool.markExhausted(provider.id, err.message || "intent-detection-error");
  }

  if (!llmResult) {
    return heuristicDetect(content);
  }

  return llmResult;
}

export { heuristicDetect };
