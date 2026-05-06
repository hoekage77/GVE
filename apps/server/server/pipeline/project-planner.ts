import { z } from "zod";
import { getPool } from "../llm/pool.js";
import { fetchChatCompletion } from "./utils.js";
import { recordTokenUsage } from "../state/token-usage.js";
import { broadcastEvent } from "../ws/streaming.js";
import type { SkillId } from "./workspace.js";

// ────────────────────────────────────────────────
//  TYPES
// ────────────────────────────────────────────────

export interface PlannedFile {
  path: string;
  purpose: string;
  skill: SkillId | SkillId[];
  importsFromLocal: string[];
  npmDependencies: string[];
  qualityContract?: string;
}

export interface WorkPlan {
  entryPoint: string;
  files: PlannedFile[];
  summary: string;
  reasoning: string;
  suggestedDependencies: string[];
}

// ────────────────────────────────────────────────
//  ZOD SCHEMA
// ────────────────────────────────────────────────

const skillIdEnum = z.enum(["threejs", "p5js", "d3js", "animejs", "manim"]);
const multiSkillEnum = z.union([skillIdEnum, z.array(skillIdEnum).min(1).max(3)]);

const plannedFileSchema = z.object({
  path: z.string().min(1).describe("File path relative to project root"),
  purpose: z.string().min(1).describe("What this file does — single responsibility"),
  skill: multiSkillEnum.describe("Rendering skill(s) for this file. Use array for multi-skill files (e.g., [\"threejs\", \"d3js\"])"),
  importsFromLocal: z.array(z.string()).default([]).describe("Paths this file imports from locally"),
  npmDependencies: z.array(z.string()).default([]).describe("NPM packages this file needs"),
  qualityContract: z.string().optional().describe("Specific quality requirements this file must meet")
});

export const workPlanSchema = z.object({
  entryPoint: z.string().min(1).describe("Main file that orchestrates the scene"),
  files: z.array(plannedFileSchema).min(1).max(12).describe("All files in the project"),
  summary: z.string().min(1).describe("One-line summary of what this project builds"),
  reasoning: z.string().min(1).describe("Why this file structure was chosen"),
  suggestedDependencies: z.array(z.string()).default([]).describe("NPM packages needed project-wide")
});

// ────────────────────────────────────────────────
//  PROMPT
// ────────────────────────────────────────────────

function buildPlanPrompt(query: string, preferredSkill: SkillId, history: string): string {
  return [
    "You are a world-class creative technologist and software architect.",
    "Your job: design a rich, multi-file visual project from a single user prompt.",
    "",
    "─────────────────────────────────────────────",
    " RENDERING ENGINES",
    "─────────────────────────────────────────────",
    "- threejs: WebGL 3D scenes. Globals: scene, camera, renderer, THREE, OrbitControls.",
    "  Do not create new scene/camera/renderer instances in non-entry files.",
    "- p5js: Creative 2D canvas. Define setup()/draw(). createCanvas() available.",
    "- d3js: Data-driven SVG/DOM. d3 namespace available. Manipulate DOM/SVG.",
    "- animejs: Motion design. anime() and anime.timeline() target DOM/SVG nodes.",
    "- manim: Python math animation. One Scene subclass named GVERichScene.",
    "",
    "─────────────────────────────────────────────",
    " AVAILABLE NPM PACKAGES (prefer these over reinventing)",
    "─────────────────────────────────────────────",
    "3D/post: postprocessing three/examples/jsm/postprocessing",
    "  import { EffectComposer, UnrealBloomPass, ShaderPass, AfterimagePass }",
    "Animation: gsap",
    "Noise: simplex-noise",
    "Color: chroma-js d3-scale-chromatic",
    "Audio: tone",
    "Utilities: three-mesh-bvh",
    "",
    "─────────────────────────────────────────────",
    " ARCHITECTURAL PATTERNS — match scene type to structure",
    "─────────────────────────────────────────────",
    "",
    "PATTERN A :: CINEMATIC 3D (landscapes, product viz, space, architecture)",
    "  src/scene-core.js — scene bg, fog, renderer config, resize handler, clock",
    "  src/camera-rig.js — Camera, DampingOrbitControls, cinematic rail paths, DOF",
    "  src/lighting-rig.js — HemisphereLight, directional + shadows, point lights, HDR env map",
    "  src/materials.js — PBR material factory, texture loading, color palette exports",
    "  src/geometry.js — all meshes, groups, hierarchies, InstancedMesh where >20 copies",
    "  src/postfx.js — EffectComposer, UnrealBloomPass, SMAAPass, tone mapping, vignette",
    "  src/anim-sequencer.js — GSAP timeline orchestration, entrance/loop/exit choreography",
    "",
    "PATTERN B :: INTERACTIVE EXPERIENCE (configurators, games, explorables)",
    "  src/scene-core.js — renderer, clock, stats panel, resize handler",
    "  src/interaction.js — raycaster, drag handlers, hover effects, event bus",
    "  src/state-machine.js — scene states, transitions, loading/error/idle screens",
    "  src/geometry.js — interactive meshes, collision geometry, click targets",
    "  src/ui-overlay.js — HTML/CSS panels animated with anime.js, HUD elements",
    "  src/lighting.js — adaptive lighting that responds to interaction",
    "",
    "PATTERN C :: PARTICLE / GENERATIVE (fire, fluid, starfields, noise fields)",
    "  src/scene-core.js — scene setup, fog, clock",
    "  src/emitter.js — particle pool, spawn rates, lifecycle management",
    "  src/physics.js — velocity, acceleration, turbulence fields, noise sampling",
    "  src/color-grading.js — palette cycling, gradient ramps, HSL modulation",
    "  src/trail-renderer.js — BufferGeometry ribbons, line materials, opacity fading",
    "  src/input-modulator.js — mouse/touch → simulation parameters via mapped curves",
    "",
    "PATTERN D :: DATA VISUALIZATION (charts, graphs, infographics)",
    "  src/data-layer.js — data fetch/parse, scale fitting, binning, derived metrics",
    "  src/axes.js — D3 axis generation, grid lines, tick formatting, label placement",
    "  src/marks.js — bar/point/line/area renderer, enter/update/exit transitions",
    "  src/tooltip.js — hover detection via Voronoi, anchored popover, rich tooltips",
    "  src/legend.js — color scale legend, size legend, interactive filtering",
    "",
    "PATTERN E :: MIXED-MEDIA (3D + 2D overlay, data dashboard, music visualizer)",
    "  src/scene-3d.js — Three.js core scene with camera and lighting",
    "  src/overlay-dom.js — anime.js animated DOM overlay with CSS",
    "  src/data-bridge.js — shared state, reactive data store, event dispatch",
    "  src/audio-analyzer.js — Web Audio API or tone.js, FFT, beat detection",
    "",
    "─────────────────────────────────────────────",
    " FILE COUNT RULES",
    "─────────────────────────────────────────────",
    "- draft quality:  2-3 files (minimal viable scene)",
    "- standard quality: 4-7 files (separated concerns, some polish)",
    "- high quality:    5-10 files (full composition, dedicated postfx/interaction)",
    "- Trivial prompts ('show a spinning cube'): 1-2 files",
    "- Complex prompts ('interactive solar system with audio-reactive auroras'): 7-10 files",
    "",
    "─────────────────────────────────────────────",
    " QUALITY CONTRACTS — per-file directives",
    "─────────────────────────────────────────────",
    "Each file should carry a 'qualityContract' string with specific requirements.",
    "",
    "For geometry files:",
    '  "USE MeshPhysicalMaterial with roughness < 0.4 and metalness > 0.7 for mechanical objects"',
    '  "USE InstancedMesh with count > 10 if creating repeated geometry"',
    '  "USE BufferGeometry with computed vertex normals, not legacy Geometry"',
    "",
    "For lighting files:",
    '  "INCLUDE at least 3 light sources: ambient, directional with shadows, point/spot accent"',
    '  "ENABLE shadow maps with resolution >= 2048x2048"',
    '  "CONSIDER using a PMREMGenerator for environment-based lighting"',
    "",
    "For material files:",
    '  "DEFINE a cohesive color palette of 4-8 colors — no flat white/gray materials"',
    '  "USE MeshStandardMaterial or MeshPhysicalMaterial only, never MeshBasicMaterial for main objects"',
    '  "ADD environment map reflections where appropriate"',
    "",
    "For postfx files:",
    '  "USE EffectComposer with at least 3 passes including UnrealBloomPass"',
    '  "ADD SMAAPass for anti-aliasing"',
    '  "CONSIDER vignette, film grain, or color grading pass"',
    "",
    "For animation files:",
    '  "CHOREOGRAPH at least 3 distinct animation phases: entrance, sustain, and exit or loop"',
    '  "USE staggered timing with delays for visual rhythm"',
    '  "PREFER GSAP timelines over setInterval/requestAnimationFrame for choreography"',
    "",
    "For interaction files:",
    '  "IMPLEMENT raycasting for clickable objects with visual feedback (highlight, scale pulse)"',
    '  "SUPPORT both mouse and touch input"',
    '  "ADD smooth lerp following, not hard snapping"',
    "",
    "─────────────────────────────────────────────",
    " PROGRESSIVE ENHANCEMENT LAYERS",
    "─────────────────────────────────────────────",
    "Organize files so the scene builds up in quality layers:",
    "  Layer 1 — CORE:    geometry, basic materials, scene setup, render",
    "  Layer 2 — LIGHT:   lighting rig, shadows, environment maps",
    "  Layer 3 — POLISH:  rich materials, post-processing, color grading",
    "  Layer 4 — MOTION:  animation, camera choreography, transitions",
    "  Layer 5 — INTERACT: raycasting, UI overlay, responsive behavior",
    "Each layer is a separate file or set of files.",
    "",
    "─────────────────────────────────────────────",
    " EXAMPLE PLANS",
    "─────────────────────────────────────────────",
    "",
    'Prompt: "a neon cyberpunk city street with rain and flying cars"',
    "→ PATTERN A (Cinematic), 7 files:",
    '  scene-core.js   — fog, dark sky, renderer tone mapping',
    '  camera-rig.js   — low-angle cinemascope, slow forward dolly',
    '  lighting-rig.js — neon tube lights, emissive billboards, volumetric fog hint',
    '  materials.js   — wet asphalt PBR, neon emissive, metallic cars',
    '  geometry.js    — building blocks, street plane, flying car meshes',
    '  postfx.js      — Bloom, FilmPass, CRT scanlines, chromatic aberration',
    '  rain.js        — particle rain system with splash logic',
    '  npm: postprocessing, simplex-noise',
    "",
    'Prompt: "an interactive periodic table with 3d electron orbits"',
    "→ PATTERN B (Interactive), 6 files:",
    '  scene-core.js  — renderer, clock',
    '  geometry.js    — element spheres, orbit rings via TorusGeometry',
    '  interaction.js — raycaster click → element detail card',
    '  electrons.js   — orbital particle animation per element',
    '  ui-overlay.js  — anime.js detail panel, legend, search bar',
    '  color-legend.js — category-based color mapping',
    '  npm: gsap',
    "",
    "─────────────────────────────────────────────",
    " INPUT",
    "─────────────────────────────────────────────",
    `User query: ${query}`,
    `Preferred engine: ${preferredSkill}`,
    history ? `Session context: ${history}` : "",
    "",
    "─────────────────────────────────────────────",
    " OUTPUT FORMAT",
    "─────────────────────────────────────────────",
    "Return ONLY valid JSON — no markdown, no prose, no code fences:",
    "{",
    '  "entryPoint": "src/scene-core.js",',
    '  "files": [',
    '    {',
    '      "path": "src/scene-core.js",',
    '      "purpose": "Initializes scene, renderer, fog, clock, and resize handler. Imports all other modules and orchestrates.",',
    '      "skill": "threejs",',
    '      "importsFromLocal": ["./camera-rig", "./lighting-rig", "./geometry", "./postfx"],',
    '      "npmDependencies": [],',
    '      "qualityContract": "USE ACESFilmicToneMapping. SET renderer pixelRatio to min(2, devicePixelRatio)."',
    '    },',
    '    {',
    '      "path": "src/camera-rig.js",',
    '      "purpose": "Creates PerspectiveCamera with cinematic FOV. Sets up DampedOrbitControls with min/max polar angles.",',
    '      "skill": "threejs",',
    '      "importsFromLocal": [],',
    '      "npmDependencies": [],',
    '      "qualityContract": "ADD smooth damping (dampingFactor=0.08). SET minPolarAngle > 0.1 to avoid gimbal lock."',
    '    }',
    "  ],",
    '  "summary": "One-sentence summary of what this project builds.",',
    '  "reasoning": "2-4 sentences explaining why this structure — which pattern, why this file count, what each layer contributes.",',
    '  "suggestedDependencies": ["postprocessing", "gsap"]',
    "}",
    "",
    "Return the JSON now."
  ].filter(Boolean).join("\n");
}

// ────────────────────────────────────────────────
//  EXECUTION
// ────────────────────────────────────────────────

export interface PlanOptions {
  query: string;
  preferredSkill?: SkillId;
  sessionId?: string;
  existingFiles?: Array<{ path: string; purpose: string }>;
  history?: string;
}

export async function planProject(options: PlanOptions): Promise<WorkPlan> {
  const {
    query,
    preferredSkill = "threejs",
    sessionId,
    existingFiles = [],
    history = ""
  } = options;

  const pool = getPool();
  const acquired = pool.acquire({ requireCodeGeneration: true });
  if (!acquired) throw new Error("No LLM providers available for project planning.");

  const { provider } = acquired;
  const prompt = buildPlanPrompt(query, preferredSkill, history);

  broadcastEvent("plan:started", {
    sessionId,
    query,
    preferredSkill,
    existingFileCount: existingFiles.length
  });

  try {
    const response = await fetchChatCompletion(provider, {
      model: provider.model,
      temperature: 0.3,
      messages: [
        { role: "system", content: "You output only valid JSON, never markdown fences, never prose." },
        { role: "user", content: prompt }
      ]
    }, { mode: "instant" });

    const payload = await response.json();
    recordTokenUsage(
      { sessionId: sessionId ?? null, providerId: provider.id, model: provider.model },
      payload.usage ?? {}
    );

    const raw = (payload.choices?.[0]?.message?.content ?? "").trim();
    const clean = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    const parsed = JSON.parse(clean);
    const result = workPlanSchema.parse(parsed);

    broadcastEvent("plan:complete", {
      sessionId,
      plan: result,
      fileCount: result.files.length
    });

    return result;
  } catch (error) {
    broadcastEvent("plan:error", {
      sessionId,
      error: String(error)
    });
    throw error;
  }
}