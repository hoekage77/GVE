import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
      "If the selected skill is Three.js, prioritize premium visual quality: layered composition, detailed geometry, rich materials, cinematic lighting, and smooth motion.",
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
      "Three.js reference template: {threejsReferenceTemplate}",
      "Current code:",
      "{currentCode}",
      "Return the full revised JavaScript scene code only."
    ]
  }
};

function loadPromptConfig() {
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

function buildConversationSessionSummary(sessionState) {
  const scene = sessionState?.currentScene;
  const recentMessages = Array.isArray(sessionState?.messages) ? sessionState.messages.slice(-4) : [];

  return {
    hasScene: Boolean(scene?.sceneId),
    sceneId: scene?.sceneId ?? null,
    sceneExplanation: scene?.explanation ?? null,
    sceneSkill: scene?.skill ?? null,
    versionCount: sessionState?.versionCount ?? 0,
    recentMessages: recentMessages.map((message) => ({
      role: message.role,
      content: message.content,
      kind: message.kind ?? null
    }))
  };
}

function formatTemplate(value, variables) {
  return String(value).replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    const replacement = variables[key];
    return replacement === undefined || replacement === null ? "" : String(replacement);
  });
}

function buildPromptText(lines, variables, separator) {
  return lines.map((line) => formatTemplate(line, variables)).join(separator);
}

function buildPromptBundle(section, variables) {
  return {
    systemPrompt: buildPromptText(section.system, variables, " "),
    userPrompt: buildPromptText(section.user, variables, "\n")
  };
}

function resolveRequestedQuality(request, selectedSkill) {
  const requested = request?.preferences?.quality;
  if (requested) {
    return requested;
  }

  return selectedSkill === "threejs" || selectedSkill === "animejs" ? "high" : "standard";
}

function buildSkillRuntimeAssumption(selectedSkill) {
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

  return "Use only globals provided by the selected skill runtime.";
}

function buildBackgroundPolicy(sourceText) {
  const normalized = String(sourceText ?? "").toLowerCase();
  const darkRequested = /(dark|night|midnight|space|outer space|black background|noir|deep space)/.test(normalized);

  if (darkRequested) {
    return "Dark look requested; allow darker tones while preserving subject readability and contrast.";
  }

  return "Prefer light or neutral backgrounds with strong contrast. Avoid pure black backgrounds by default.";
}

function buildThreejsQualityProfile(quality, selectedSkill) {
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

function buildThreejsReferenceTemplate(selectedSkill, quality) {
  if (selectedSkill !== "threejs") {
    return "N/A for non-Three.js skills.";
  }

  const detailHint = quality === "draft"
    ? "Draft profile: keep object count modest and remove expensive extras while preserving this structure."
    : quality === "high"
      ? "High profile: keep this full structure with strong materials, layered lights, depth cues, and nuanced animation timing."
      : "Standard profile: keep core composition and balanced light/material quality.";

  return [
    "Use the following as a quality reference template and adapt it to the user prompt (do not copy verbatim):",
    detailHint,
    "const clock = new THREE.Clock();",
    "scene.background = new THREE.Color(0xf4f7fb);",
    "renderer.toneMapping = THREE.ACESFilmicToneMapping;",
    "renderer.toneMappingExposure = 1.08;",
    "renderer.shadowMap.enabled = true;",
    "",
    "const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);",
    "keyLight.position.set(6, 10, 8);",
    "const fillLight = new THREE.DirectionalLight(0xbfd7ff, 0.55);",
    "fillLight.position.set(-7, 4, 5);",
    "const rimLight = new THREE.PointLight(0xaad6ff, 0.45, 22);",
    "rimLight.position.set(-4, 3, -5);",
    "scene.add(new THREE.AmbientLight(0x7f8aa6, 0.32), keyLight, fillLight, rimLight);",
    "",
    "const floor = new THREE.Mesh(",
    "  new THREE.CircleGeometry(10, 96),",
    "  new THREE.MeshStandardMaterial({ color: 0xe6ecf5, roughness: 0.92, metalness: 0.02 })",
    ");",
    "floor.rotation.x = -Math.PI / 2;",
    "floor.position.y = -1.2;",
    "scene.add(floor);",
    "",
    "const heroGroup = new THREE.Group();",
    "scene.add(heroGroup);",
    "// Build detailed subject meshes/materials here based on user intent.",
    "",
    "camera.position.set(4.4, 2.4, 5.2);",
    "camera.lookAt(0, 0, 0);",
    "",
    "function animate() {",
    "  requestAnimationFrame(animate);",
    "  const t = clock.getElapsedTime();",
    "  heroGroup.rotation.y = t * 0.18;",
    "  rimLight.intensity = 0.35 + Math.sin(t * 1.2) * 0.08;",
    "  renderer.render(scene, camera);",
    "}",
    "animate();"
  ].join("\n");
}

export function getPromptConfig() {
  return promptConfig;
}

export function buildConversationPromptBundle({ sessionState, request, parsedIntent, mode }) {
  return buildPromptBundle(promptConfig.conversation, {
    mode,
    query: request.query,
    parsedIntent: JSON.stringify(parsedIntent),
    sessionSummary: JSON.stringify(buildConversationSessionSummary(sessionState))
  });
}

export function buildGenerationPromptBundle(state) {
  const requestedQuality = resolveRequestedQuality(state.request, state.selectedSkill);

  return buildPromptBundle(promptConfig.generation, {
    query: state.request.query,
    selectedSkill: state.selectedSkill,
    skillRuntimeAssumption: buildSkillRuntimeAssumption(state.selectedSkill),
    requestedQuality,
    backgroundPolicy: buildBackgroundPolicy(state.request.query),
    threejsQualityProfile: buildThreejsQualityProfile(requestedQuality, state.selectedSkill),
    threejsReferenceTemplate: buildThreejsReferenceTemplate(state.selectedSkill, requestedQuality),
    parsedIntent: JSON.stringify(state.parsedIntent)
  });
}

export function buildModificationPromptBundle(state) {
  const requestedQuality = state.quality ?? (state.selectedSkill === "threejs" ? "high" : "standard");

  return buildPromptBundle(promptConfig.modification, {
    instruction: state.instruction,
    selectedSkill: state.selectedSkill,
    skillRuntimeAssumption: buildSkillRuntimeAssumption(state.selectedSkill),
    requestedQuality,
    backgroundPolicy: buildBackgroundPolicy(state.instruction),
    threejsQualityProfile: buildThreejsQualityProfile(requestedQuality, state.selectedSkill),
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
 *
 * @param {object} options
 * @param {string} options.imageUrl - URL or base64 data URI of the reference image
 * @param {string} [options.query] - Optional text instruction alongside the image
 * @param {string} options.selectedSkill - Target skill (threejs, p5js, d3js)
 * @param {object} [options.parsedIntent] - Optional parsed intent object
 * @returns {{ systemPrompt: string, userContent: Array }}
 */
export function buildImageToCodePromptBundle({ imageUrl, query, selectedSkill, parsedIntent }) {
  const systemPrompt = [
    "You are a senior JavaScript visual generation agent with vision capabilities.",
    "The user has provided a reference image. Analyze the visual elements carefully:",
    "- Identify colors, gradients, and palettes",
    "- Identify shapes, objects, and their spatial arrangement",
    "- Identify any motion, animation, or dynamic elements",
    "- Identify lighting, shadows, and depth cues",
    "",
    `Generate runnable ${
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
          : "Use the d3 namespace for DOM manipulation. SVG container is available.",
    "",
    "Rules:",
    "- Output runnable JavaScript code ONLY. No markdown fences, no prose.",
    "- Do NOT use eval(), Function constructor, fetch(), require(), or import().",
    "- Match the reference image's visual style as closely as possible.",
    "- Prefer light or neutral backgrounds unless the reference clearly indicates a dark/night scene.",
    "- Add animation/motion if the image suggests movement or dynamics.",
    "- Use realistic colors extracted from the image."
  ].join("\n");

  const userContent = [
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
