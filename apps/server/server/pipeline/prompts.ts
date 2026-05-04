import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAssetPlan, buildAssetPolicyText, buildAssetCatalogText, buildQualityContractText, AssetPlan } from "./assets.js";

const defaultPromptConfig = {
  version: "prompt-config.v1",
  conversation: {
    system: [
      "You are the conversational front door for a visual generation engine.",
      "Respond naturally and specifically to the user message.",
      "Answer general questions directly instead of forcing everything into a visual workflow.",
      "If the user is just chatting, answer in a normal conversational tone.",
      "Only steer toward visual generation when the user clearly wants that.",
      "Do not mention internal orchestration steps unless asked.",
      "Keep replies concise, helpful, and grounded in the session context.",
      "If the user greets the assistant, respond with a short friendly explanation of what you can do.",
      "If the user asks what you can do, answer with the actual capabilities relevant to this session.",
      "If the user intent is unclear, ask a concise clarifying question with concrete options.",
      "If there is an active scene, reference it explicitly when relevant."
    ],
    user: [
      "Mode: {mode}",
      "User message: {query}",
      "Parsed intent: {parsedIntent}",
      "Session summary: {sessionSummary}",
      "Write the assistant reply in plain language only."
    ]
  },
  generation: {
    system: [
      "You are a senior JavaScript visual generation agent.",
      "Generate runnable JavaScript scene code only.",
      "Use the selected skill runtime assumptions provided in the user prompt.",
      "If the selected skill is Three.js, prioritize premium visual quality: layered composition, detailed geometry, rich PBR materials, cinematic lighting, and smooth motion. Always instantiate OrbitControls with damping enabled and call controls.update() in the animation loop.",
      "If a Three.js quality contract and asset catalog are provided, follow them strictly.",
      "If the selected skill is Anime.js, prioritize premium motion design: timeline composition, staggered choreography, expressive easing, and layered DOM/SVG animation.",
      "Respect requested quality level: draft = minimal, standard = polished, high = maximum detail and fidelity.",
      "Default to light or neutral backgrounds with strong readability; only use dark or black backgrounds when the user explicitly asks for a dark look.",
      "Do not include markdown fences or prose.",
      "Avoid eval, Function constructors, network calls, and unsafe APIs."
    ],
    user: [
      "User query: {query}",
      "Selected skill: {selectedSkill}",
      "Runtime assumptions: {skillRuntimeAssumption}",
      "Requested quality: {requestedQuality}",
      "Background policy: {backgroundPolicy}",
      "Three.js quality profile: {threejsQualityProfile}",
      "Three.js quality contract: {threejsQualityContract}",
      "Asset policy: {assetPolicy}",
      "Three.js asset catalog: {threejsAssetCatalog}",
      "Three.js reference template: {threejsReferenceTemplate}",
      "Intent: {parsedIntent}",
      "Return complete JavaScript that creates and renders the requested scene."
    ]
  },
  modification: {
    system: [
      "You are a senior JavaScript visual editing agent.",
      "Revise the provided scene code to satisfy the edit instruction.",
      "Return runnable JavaScript code only.",
      "Preserve the current scene structure unless the edit requires a change.",
      "Maintain or improve visual fidelity, especially for Three.js scenes.",
      "If a Three.js quality contract and asset catalog are provided, follow them strictly.",
      "For Anime.js scenes, maintain timeline coherence, easing quality, and smooth sequencing.",
      "Use light or neutral backgrounds unless the edit instruction explicitly asks for dark styling.",
      "Do not include markdown fences or prose.",
      "Avoid eval, Function constructors, network calls, and unsafe APIs."
    ],
    user: [
      "Edit instruction: {instruction}",
      "Selected skill: {selectedSkill}",
      "Runtime assumptions: {skillRuntimeAssumption}",
      "Requested quality: {requestedQuality}",
      "Background policy: {backgroundPolicy}",
      "Three.js quality profile: {threejsQualityProfile}",
      "Three.js quality contract: {threejsQualityContract}",
      "Asset policy: {assetPolicy}",
      "Three.js asset catalog: {threejsAssetCatalog}",
      "Three.js reference template: {threejsReferenceTemplate}",
      "Current code:",
      "{currentCode}",
      "Return the full revised JavaScript scene code only."
    ]
  }
};

function loadPromptConfig(): any {
  const configPath = process.env.PROMPT_CONFIG_PATH;

  if (configPath && existsSync(configPath)) {
    return JSON.parse(readFileSync(configPath, "utf8"));
  }

  const currentDir = dirname(fileURLToPath(import.meta.url));
  const localConfigPath = join(currentDir, "prompt-config.json");

  if (existsSync(localConfigPath)) {
    return JSON.parse(readFileSync(localConfigPath, "utf8"));
  }

  return defaultPromptConfig;
}

const promptConfig = loadPromptConfig();

function buildConversationSessionSummary(sessionState: any): any {
  const scene = sessionState?.currentScene;
  const recentMessages = Array.isArray(sessionState?.messages) ? sessionState.messages.slice(-4) : [];

  return {
    hasScene: Boolean(scene?.sceneId),
    sceneId: scene?.sceneId ?? null,
    sceneExplanation: scene?.explanation ?? null,
    sceneSkill: scene?.skill ?? null,
    versionCount: sessionState?.versionCount ?? 0,
    recentMessages: recentMessages.map((message: any) => ({
      role: message.role,
      content: message.content,
      kind: message.kind ?? null
    }))
  };
}

function formatTemplate(value: string, variables: Record<string, any>): string {
  return String(value).replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    const replacement = variables[key];
    return replacement === undefined || replacement === null ? "" : String(replacement);
  });
}

function buildPromptText(lines: string[], variables: Record<string, any>, separator: string): string {
  return lines.map((line) => formatTemplate(line, variables)).join(separator);
}

function buildPromptBundle(section: any, variables: Record<string, any>): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: buildPromptText(section.system, variables, " "),
    userPrompt: buildPromptText(section.user, variables, "\n")
  };
}

function resolveRequestedQuality(request: any, selectedSkill: string): string {
  const requested = request?.preferences?.quality;
  if (requested) {
    return requested;
  }

  return selectedSkill === "threejs" || selectedSkill === "animejs" || selectedSkill === "manim"
    ? "high"
    : "standard";
}

function resolvePromptAssetPlan({
  selectedSkill,
  requestedQuality,
  sourceText,
  parsedIntent,
  assetPlan
}: {
  selectedSkill: string;
  requestedQuality: string;
  sourceText: string;
  parsedIntent: any;
  assetPlan?: any;
}): AssetPlan {
  if (assetPlan && typeof assetPlan === "object") {
    return assetPlan as AssetPlan;
  }

  return resolveAssetPlan({
    selectedSkill,
    requestedQuality,
    sourceText,
    parsedIntent,
    allowInternetFallback: true
  });
}

function buildSkillRuntimeAssumption(selectedSkill: string): string {
  if (selectedSkill === "threejs") {
    return "THREE, scene, camera, renderer, and OrbitControls are available globals. Use requestAnimationFrame for animation.";
  }

  if (selectedSkill === "p5js") {
    return "Use p5.js globals. Define setup()/draw() or call createCanvas() and render in frame-based loops.";
  }

  if (selectedSkill === "d3js") {
    return "Use the d3 global for DOM/SVG data-binding and transitions.";
  }

  if (selectedSkill === "animejs") {
    return "Use the anime global API. Build DOM or SVG targets first, then animate with anime() or anime.timeline().";
  }

  if (selectedSkill === "manim") {
    return "Return Python Manim code only. Always include from manim import * near the top. Define one Scene subclass named GVERichScene (use MovingCameraScene only when manipulating self.camera.frame) with construct(self). If NumPy is used, include import numpy as np. Use modern Manim APIs (Axes/NumberPlane with x_range and y_range, not x_min/x_max/y_min/y_max), avoid deprecated camera helpers such as set_camera(), avoid filesystem/network/system calls, and optimize for cinematic output.";
  }

  return "Use only globals provided by the selected skill runtime.";
}

function buildManimQualityProfile(quality: string): string {
  if (quality === "draft") {
    return "Draft: keep composition simple but still clean, with short transitions and minimal objects.";
  }

  if (quality === "high") {
    return "High: deliver rich cinematic output with 1080p, 60fps pacing, layered composition, expressive camera movement, strong typography hierarchy, nuanced easing, and polished transitions.";
  }

  return "Standard: polished composition, smooth pacing, readable typography, and stable camera choreography.";
}

function buildManimGenerationPromptBundle(state: any) {
  const requestedQuality = resolveRequestedQuality(state.request, state.selectedSkill);
  const systemPrompt = [
    "You are a senior Manim animation director and Python engineer.",
    "Generate runnable Python Manim code only.",
    "Return raw code with no markdown fences and no prose.",
    "Always include `from manim import *` near the top of the file.",
    "If NumPy is used, include `import numpy as np`.",
    "Produce one subclass named GVERichScene (subclass MovingCameraScene instead of Scene if you need to manipulate self.camera.frame) with a construct(self) method.",
    "Use modern Manim APIs only: for Axes/NumberPlane use x_range and y_range (never x_min/x_max/y_min/y_max).",
    "Do not use deprecated camera helpers such as set_camera(); use self.camera.frame methods for camera motion.",
    "Do not perform filesystem, network, subprocess, or shell operations.",
    "Keep code deterministic and self-contained."
  ].join(" ");

  const userPrompt = [
    `User query: ${state.request.query}`,
    `Selected skill: ${state.selectedSkill}`,
    `Runtime assumptions: ${buildSkillRuntimeAssumption(state.selectedSkill)}`,
    `Requested quality: ${requestedQuality}`,
    `Manim quality profile: ${buildManimQualityProfile(requestedQuality)}`,
    "Render target: video/mp4 at 1920x1080 and 60fps.",
    "Art direction: keep visuals rich, cinematic, and highly readable.",
    `Intent: ${JSON.stringify(state.parsedIntent)}`,
    "Return complete Python code only."
  ].join("\n");

  return {
    systemPrompt,
    userPrompt
  };
}

function buildManimModificationPromptBundle(state: any) {
  const requestedQuality = state.quality ?? "high";

  const systemPrompt = [
    "You are a senior Manim animation editor.",
    "Revise the supplied Python Manim code to satisfy the edit instruction.",
    "Return raw Python code only with no markdown fences.",
    "Keep `from manim import *` near the top of the file.",
    "If NumPy helpers are used, include `import numpy as np`.",
    "Keep one Scene subclass named GVERichScene (subclass MovingCameraScene if using self.camera.frame) and preserve compatibility.",
    "Use modern Manim APIs only: for Axes/NumberPlane use x_range and y_range (never x_min/x_max/y_min/y_max).",
    "Do not use deprecated camera helpers such as set_camera(); use self.camera.frame methods for camera motion.",
    "Do not perform filesystem, network, subprocess, or shell operations."
  ].join(" ");

  const userPrompt = [
    `Edit instruction: ${state.instruction}`,
    `Selected skill: ${state.selectedSkill}`,
    `Runtime assumptions: ${buildSkillRuntimeAssumption(state.selectedSkill)}`,
    `Requested quality: ${requestedQuality}`,
    `Manim quality profile: ${buildManimQualityProfile(requestedQuality)}`,
    "Render target: video/mp4 at 1920x1080 and 60fps.",
    "Current code:",
    state.currentCode,
    "Return complete revised Python code only."
  ].join("\n");

  return {
    systemPrompt,
    userPrompt
  };
}

function buildBackgroundPolicy(sourceText: string): string {
  const normalized = String(sourceText ?? "").toLowerCase();
  const darkRequested = /(dark|night|midnight|space|outer space|black background|noir|deep space)/.test(normalized);

  if (darkRequested) {
    return "Dark look requested; allow darker tones while preserving subject readability and contrast.";
  }

  return "Prefer light or neutral backgrounds with strong contrast. Avoid pure black backgrounds by default.";
}

function buildThreejsQualityProfile(quality: string, selectedSkill: string): string {
  if (selectedSkill !== "threejs") {
    return "N/A for non-Three.js skills.";
  }

  if (quality === "draft") {
    return "Draft: keep geometry and lighting simple while preserving clean composition and readable motion.";
  }

  if (quality === "high") {
    return "High: maximize detail with layered geometry, nuanced material parameters, multi-light setup, depth cues, atmospheric accents, and refined animation timing.";
  }

  return "Standard: polished composition with clear lighting hierarchy, quality materials, and smooth motion.";
}

function buildThreejsReferenceTemplate(selectedSkill: string, quality: string): string {
  if (selectedSkill !== "threejs") {
    return "N/A for non-Three.js skills.";
  }

  const detailHint = quality === "draft"
    ? "Draft profile: simplify geometry, reduce light count to 2, remove particles, keep OrbitControls."
    : quality === "high"
      ? "High profile: full cinematic treatment — layered lights, PBR materials, particles, camera animation, OrbitControls, shadow detail, volumetric fog."
      : "Standard profile: balanced composition with 3+ lights, quality materials, OrbitControls, and smooth animation.";

  return [
    "Use the following as a quality reference template and adapt it to the user prompt (do not copy verbatim):",
    detailHint,
    "",
    "const clock = new THREE.Clock();",
    "scene.background = new THREE.Color(0x0a0a12);",
    "scene.fog = new THREE.FogExp2(0x0a0a12, 0.018);",
    "",
    "renderer.toneMapping = THREE.ACESFilmicToneMapping;",
    "renderer.toneMappingExposure = 1.2;",
    "renderer.shadowMap.enabled = true;",
    "renderer.shadowMap.type = THREE.PCFSoftShadowMap;",
    "",
    "// Cinematic three-point lighting",
    "const keyLight = new THREE.DirectionalLight(0xfff5e8, 2.2);",
    "keyLight.position.set(6, 10, 8);",
    "keyLight.castShadow = true;",
    "keyLight.shadow.mapSize.set(2048, 2048);",
    "keyLight.shadow.camera.near = 0.5;",
    "keyLight.shadow.camera.far = 30;",
    "keyLight.shadow.camera.left = -8;",
    "keyLight.shadow.camera.right = 8;",
    "keyLight.shadow.bias = -0.0005;",
    "",
    "const fillLight = new THREE.DirectionalLight(0xbfd7ff, 0.65);",
    "fillLight.position.set(-7, 4, 5);",
    "",
    "const rimLight = new THREE.PointLight(0xaad6ff, 0.55, 28);",
    "rimLight.position.set(-4, 3, -6);",
    "",
    "const ambientLight = new THREE.AmbientLight(0x1a1a2e, 0.45);",
    "scene.add(ambientLight, keyLight, fillLight, rimLight);",
    "",
    "// Reflective floor plane",
    "const floorGeo = new THREE.CircleGeometry(14, 128);",
    "const floorMat = new THREE.MeshStandardMaterial({",
    "  color: 0x111122,",
    "  roughness: 0.35,",
    "  metalness: 0.85,",
    "});",
    "const floor = new THREE.Mesh(floorGeo, floorMat);",
    "floor.rotation.x = -Math.PI / 2;",
    "floor.position.y = -1.6;",
    "floor.receiveShadow = true;",
    "scene.add(floor);",
    "",
    "const heroGroup = new THREE.Group();",
    "scene.add(heroGroup);",
    "// Build detailed subject meshes with rich PBR materials here based on user intent.",
    "// Use MeshStandardMaterial or MeshPhysicalMaterial with metalness, roughness, clearcoat, etc.",
    "",
    "// Ambient particles for atmosphere",
    "const particleCount = 600;",
    "const particleGeo = new THREE.BufferGeometry();",
    "const particlePositions = new Float32Array(particleCount * 3);",
    "for (let i = 0; i < particleCount; i++) {",
    "  particlePositions[i * 3] = (Math.random() - 0.5) * 24;",
    "  particlePositions[i * 3 + 1] = Math.random() * 12 - 2;",
    "  particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 24;",
    "}",
    "particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));",
    "const particleMat = new THREE.PointsMaterial({",
    "  color: 0x6688cc,",
    "  size: 0.04,",
    "  transparent: true,",
    "  opacity: 0.45,",
    "  sizeAttenuation: true,",
    "});",
    "const particles = new THREE.Points(particleGeo, particleMat);",
    "scene.add(particles);",
    "",
    "camera.position.set(5, 3, 7);",
    "camera.lookAt(0, 0.5, 0);",
    "",
    "// Interactive camera controls — always include these",
    "const controls = new OrbitControls(camera, renderer.domElement);",
    "controls.enableDamping = true;",
    "controls.dampingFactor = 0.06;",
    "controls.target.set(0, 0.5, 0);",
    "controls.minDistance = 2;",
    "controls.maxDistance = 20;",
    "controls.maxPolarAngle = Math.PI / 2 + 0.15;",
    "controls.update();",
    "",
    "function animate() {",
    "  requestAnimationFrame(animate);",
    "  const t = clock.getElapsedTime();",
    "  heroGroup.rotation.y = t * 0.12;",
    "  rimLight.intensity = 0.45 + Math.sin(t * 1.4) * 0.1;",
    "  const positions = particles.geometry.attributes.position.array;",
    "  for (let i = 0; i < particleCount; i++) {",
    "    positions[i * 3 + 1] += Math.sin(t + i * 0.3) * 0.001;",
    "  }",
    "  particles.geometry.attributes.position.needsUpdate = true;",
    "  particles.rotation.y = t * 0.02;",
    "  controls.update();",
    "  renderer.render(scene, camera);",
    "}",
    "animate();"
  ].join("\n");
}

export function buildConversationPromptBundle({ sessionState, request, parsedIntent, mode }: any): { systemPrompt: string; userPrompt: string } {
  return buildPromptBundle(promptConfig.conversation, {
    mode,
    query: request.query,
    parsedIntent: JSON.stringify(parsedIntent),
    sessionSummary: JSON.stringify(buildConversationSessionSummary(sessionState))
  });
}

export function buildGenerationPromptBundle(state: any): { systemPrompt: string; userPrompt: string } {
  if (state.selectedSkill === "manim") {
    return buildManimGenerationPromptBundle(state);
  }

  const requestedQuality = resolveRequestedQuality(state.request, state.selectedSkill);
  const promptSourceText = [state.request.query, JSON.stringify(state.parsedIntent)].join(" ");
  const assetPlan = resolvePromptAssetPlan({
    selectedSkill: state.selectedSkill,
    requestedQuality,
    sourceText: promptSourceText,
    parsedIntent: state.parsedIntent,
    assetPlan: state.assetPlan
  });

  return buildPromptBundle(promptConfig.generation, {
    query: state.request.query,
    selectedSkill: state.selectedSkill,
    skillRuntimeAssumption: buildSkillRuntimeAssumption(state.selectedSkill),
    requestedQuality,
    backgroundPolicy: buildBackgroundPolicy(state.request.query),
    threejsQualityProfile: buildThreejsQualityProfile(requestedQuality, state.selectedSkill),
    threejsQualityContract: buildQualityContractText(assetPlan),
    assetPolicy: buildAssetPolicyText(assetPlan),
    threejsAssetCatalog: buildAssetCatalogText(assetPlan),
    threejsReferenceTemplate: buildThreejsReferenceTemplate(state.selectedSkill, requestedQuality),
    parsedIntent: JSON.stringify(state.parsedIntent)
  });
}

export function buildModificationPromptBundle(state: any): { systemPrompt: string; userPrompt: string } {
  if (state.selectedSkill === "manim") {
    return buildManimModificationPromptBundle(state);
  }

  const requestedQuality = state.quality ?? (state.selectedSkill === "threejs" ? "high" : "standard");
  const promptSourceText = state.instruction;
  const assetPlan = resolvePromptAssetPlan({
    selectedSkill: state.selectedSkill,
    requestedQuality,
    sourceText: promptSourceText,
    parsedIntent: state.parsedIntent ?? null,
    assetPlan: state.assetPlan
  });

  return buildPromptBundle(promptConfig.modification, {
    instruction: state.instruction,
    selectedSkill: state.selectedSkill,
    skillRuntimeAssumption: buildSkillRuntimeAssumption(state.selectedSkill),
    requestedQuality,
    backgroundPolicy: buildBackgroundPolicy(state.instruction),
    threejsQualityProfile: buildThreejsQualityProfile(requestedQuality, state.selectedSkill),
    threejsQualityContract: buildQualityContractText(assetPlan),
    assetPolicy: buildAssetPolicyText(assetPlan),
    threejsAssetCatalog: buildAssetCatalogText(assetPlan),
    threejsReferenceTemplate: buildThreejsReferenceTemplate(state.selectedSkill, requestedQuality),
    currentCode: state.currentCode
  });
}

/**
 * Build an image-to-code prompt bundle for vision-based generation.
 *
 * Returns { systemPrompt, userContent } where userContent is an array
 * formatted for OpenAI-compatible multimodal messages:
 *   [{ type: "image_url", image_url: { url } }, { type: "text", text }]
 */
export function buildImageToCodePromptBundle({ imageUrl, query, selectedSkill, parsedIntent, assetPlan = null }: any): { systemPrompt: string; userContent: any[] } {
  const isManim = selectedSkill === "manim";
  const resolvedAssetPlan = resolvePromptAssetPlan({
    selectedSkill,
    requestedQuality: "high",
    sourceText: query,
    parsedIntent,
    assetPlan
  });

  const systemPrompt = [
    isManim
      ? "You are a senior Manim animation director with vision capabilities."
      : "You are a senior JavaScript visual generation agent with vision capabilities.",
    "The user has provided a reference image. Analyze the visual elements carefully:",
    "- Identify colors, gradients, and palettes",
    "- Identify shapes, objects, and their spatial arrangement",
    "- Identify any motion, animation, or dynamic elements",
    "- Identify lighting, shadows, and depth cues",
    "",
    isManim
      ? "Generate runnable Python Manim code that recreates or closely matches the visual."
      : `Generate runnable ${
          selectedSkill === "threejs"
            ? "Three.js"
            : selectedSkill === "p5js"
              ? "p5.js"
              : selectedSkill === "animejs"
                ? "Anime.js"
                : "D3.js"
        } JavaScript code that recreates or closely matches the visual.`,
    selectedSkill === "threejs"
      ? "Assume scene, camera, renderer, THREE, and OrbitControls are pre-initialized globals."
      : selectedSkill === "p5js"
        ? "Define setup() and draw() functions. createCanvas() is available."
        : selectedSkill === "animejs"
          ? "Use anime() and anime.timeline() on DOM/SVG targets. Build targets before starting animations."
      : selectedSkill === "manim"
        ? "Define one Scene subclass named GVERichScene (subclass MovingCameraScene if you need to use self.camera.frame). Target 1080p/60fps rich motion quality."
          : "Use the d3 namespace for DOM manipulation. SVG container is available.",
        selectedSkill === "threejs"
          ? `Asset policy: ${buildAssetPolicyText(resolvedAssetPlan)}`
          : "",
        selectedSkill === "threejs"
          ? `Curated asset manifest: ${buildAssetCatalogText(resolvedAssetPlan)}`
          : "",
    "",
    "Rules:",
    isManim
      ? "- Output runnable Python code ONLY. No markdown fences, no prose."
      : "- Output runnable JavaScript code ONLY. No markdown fences, no prose.",
    isManim
      ? "- Do NOT use filesystem, subprocess, shell, or network APIs."
      : "- Do NOT use eval(), Function constructor, fetch(), require(), or import().",
    "- Match the reference image's visual style as closely as possible.",
    "- Prefer light or neutral backgrounds unless the reference clearly indicates a dark/night scene.",
    "- Add animation/motion if the image suggests movement or dynamics.",
    "- Use realistic colors extracted from the image."
  ].join("\n");

  const userContent: any[] = [
    {
      type: "image_url",
      image_url: {
        url: imageUrl,
        detail: "high"
      }
    }
  ];

  const textParts = [];
  if (query) {
    textParts.push(`User instruction: "${query}"`);
  }
  textParts.push(`Target skill: ${selectedSkill}`);
  if (parsedIntent) {
    textParts.push(`Parsed intent: ${JSON.stringify(parsedIntent)}`);
  }
  textParts.push("Generate the scene code that matches this reference image.");

  userContent.push({
    type: "text",
    text: textParts.join("\n")
  });

  return { systemPrompt, userContent };
}
