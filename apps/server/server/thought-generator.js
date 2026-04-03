/**
 * Thought Generator
 *
 * Produces first-person internal monologue strings for each orchestration step.
 * Uses randomized template pools for natural-feeling variety with zero LLM cost.
 */

const thoughtTemplates = {
  turn_started: [
    "Let me think about this... I need to understand what you're asking for.",
    "Alright, I'm reading through your request now. Let me break this down.",
    "Interesting — let me process what you're looking for here.",
    "I'm on it. First, I need to parse your intent and figure out the best approach.",
    "Okay, let me dive into this. I'll start by understanding what kind of visual you want."
  ],

  intent_parsed: {
    create: [
      "I see — you want me to create a {domain} visualization. Let me figure out the best tool for this.",
      "Got it. You're looking for a {domain} scene. I'm selecting the right rendering engine now.",
      "I understand — this is a {domain} creation task. Let me pick the most suitable skill.",
      "Clear — I need to build a {domain} visual from scratch. Checking available engines..."
    ],
    modify: [
      "You want me to modify the current scene. Let me analyze what changes are needed.",
      "I see — this is an edit to the existing visual. Let me figure out the best way to apply this.",
      "Got it, you want changes to what's already there. Let me plan the modifications."
    ],
    explain: [
      "You'd like an explanation. Let me gather the context and break this down for you.",
      "Sure — I'll walk you through this. Let me organize my thoughts.",
      "I'll explain this step by step. Give me a moment to form a clear picture."
    ],
    chat: [
      "This is more of a conversation than a visual task. Let me respond naturally.",
      "I see — you're just talking to me. Let me think about the best way to respond."
    ],
    animate: [
      "You want animation! Let me figure out the motion parameters for this.",
      "Alright, this needs movement. I'm planning the animation pipeline now."
    ]
  },

  skill_selected: {
    threejs: [
      "I'm going with Three.js for this — it's the best fit for 3D rendering.",
      "Three.js is my choice here. It handles {domain} scenes beautifully.",
      "I'll use the Three.js renderer. It gives me the best control for what you need."
    ],
    p5js: [
      "p5.js is the right call here — perfect for 2D sketches and particles.",
      "I'll use p5.js for this. It's excellent for interactive 2D visuals.",
      "Going with p5.js — it's lightweight and great for this kind of creative work."
    ],
    d3js: [
      "D3.js is the way to go for this data visualization.",
      "I'm picking D3.js — it handles charts and data-driven layouts really well.",
      "D3.js will give us the best result for this structured visualization."
    ],
    animejs: [
      "I'll use Anime.js here — it is ideal for high-fidelity timeline-based motion design.",
      "Anime.js is the best fit for this animation-focused request.",
      "Going with Anime.js so I can choreograph clean DOM/SVG motion and easing."
    ]
  },

  plan_created: [
    "I've mapped out {taskCount} steps to build this. Starting the generation pipeline now.",
    "My plan has {taskCount} stages. Let me run through them systematically.",
    "Alright, {taskCount} tasks queued. I'm moving through the pipeline now.",
    "I've outlined {taskCount} steps. Kicking off code generation..."
  ],

  code_generated: [
    "I've written the code. Let me validate it before running...",
    "Code generation complete. Now I need to check it for safety and correctness.",
    "The code is ready. Running validation checks before execution...",
    "I've composed the scene code. Time to verify it passes all safety checks."
  ],

  validate_code: [
    "Checking syntax, security, and API compliance...",
    "Running the validator — syntax, safety, and schema checks in progress...",
    "Validating the generated code against security policies and API constraints...",
    "Let me make sure this code is safe and correct before I run it."
  ],

  validation_failed: [
    "The validation caught an issue. Let me try a recovery path...",
    "Hmm, the code didn't pass validation. I'll attempt a safe fallback...",
    "Something failed in validation. I'm generating corrected code now."
  ],

  executing: [
    "Code looks good! Spinning up the sandbox to render your scene...",
    "Validation passed. Executing in an isolated sandbox environment now...",
    "All checks green. Running the code in a secure container...",
    "Everything checks out — launching the sandbox runtime."
  ],

  execution_skipped: [
    "I had to skip execution because the code didn't pass validation. Let me show you what happened.",
    "Execution was skipped due to validation issues. I'll surface the error details."
  ],

  sync_state: [
    "Execution complete. Syncing the result to your session now.",
    "The render is done. I'm saving the scene state and preparing the preview.",
    "Success! Committing the scene version and updating your workspace.",
    "Render finished. Pushing the result to your session."
  ],

  turn_complete: [
    "All done! Your visual is ready.",
    "Everything's finished. Take a look at the result!",
    "Complete. The scene has been generated and synced.",
    "That's a wrap — your visualization should be live now."
  ],

  turn_error: [
    "Something went wrong during execution. Let me show you what happened.",
    "I hit an error in the pipeline. Here are the details...",
    "Unfortunately this didn't work as expected. Let me surface the issue."
  ],

  code_modified: [
    "I've applied the modifications to your scene code.",
    "The changes look good. Let me validate and execute the updated code.",
    "Scene code modified. Running the changes through the pipeline now."
  ],

  // ── Agent Self-Debug Templates ──

  agent_debug_started: [
    "The code didn't pass validation. Let me analyze the errors and fix it...",
    "Hmm, validation found some issues. Switching to debug mode — I'll fix this.",
    "I see some problems with the generated code. Let me reason through the errors and correct them.",
    "Validation failed, but I can fix this. Analyzing the errors now..."
  ],

  agent_tool_called: [
    "Running {toolName} to check the code...",
    "Calling {toolName} — let me see if the fix works...",
    "Using {toolName} to verify my changes..."
  ],

  agent_debug_fixed: [
    "Found the issue and fixed it. The code now passes validation.",
    "Got it — {changesMade}. Code is clean now.",
    "Fixed! The corrected code passes all checks. Moving to execution.",
    "Debugging successful — the code is valid and ready to run."
  ],

  agent_debug_failed: [
    "I couldn't fix it after {iterations} attempt(s). Using a safe fallback instead.",
    "The errors were too complex to auto-fix in {iterations} round(s). Falling back to a safe scene.",
    "Debug loop exhausted. I'll generate a simpler scene as a fallback."
  ],

  // ── Image-to-Code Templates ──

  image_analyzing: [
    "Analyzing your reference image... Let me identify the visual elements.",
    "Processing the image — I can see the shapes, colors, and layout. Translating now.",
    "Looking at your image closely... I'll recreate this as a live scene.",
    "Interesting image! Let me extract the key visual features and build a matching scene."
  ],

  image_generating: [
    "I've analyzed the image. Now writing the scene code to match it...",
    "Translating the visual elements into {skill} code...",
    "Building the scene based on what I see in the image. This will match the colors and layout.",
    "Converting the reference image into executable scene code using {skill}..."
  ]
};

/**
 * Mapping from orchestration step names to LLM thinking analysis keys.
 * Used by the hybrid approach: if a pre-generated LLM thought exists for
 * the given step, it takes priority over the template pool.
 */
const stepToLlmKey = {
  turn_started: "intent",
  intent_parsed: "intent",
  skill_selected: "skill",
  plan_created: "plan",
  code_generated: "generating",
  code_modified: "generating",
  validate_code: "validating",
  validation_failed: "validating",
  executing: "executing",
  execution_skipped: "executing",
  sync_state: "complete",
  turn_complete: "complete",
  turn_error: null,   // always use template for errors
  // Agent mode steps — always use templates (no pre-generated LLM key)
  agent_debug_started: null,
  agent_tool_called: null,
  agent_debug_fixed: null,
  agent_debug_failed: null,
  image_analyzing: null,
  image_generating: null
};

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function interpolate(template, context) {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return context[key] !== undefined ? String(context[key]) : match;
  });
}

/**
 * Generate a first-person thought string for the given orchestration step.
 *
 * When `context.llmThoughts` is provided (an object from generateThinkingAnalysis),
 * the LLM-generated thought for the step is used if available. Otherwise, falls
 * back to the template pool (zero LLM cost, zero latency).
 *
 * @param {string} step - The orchestration step identifier
 * @param {object} context - Context object with optional fields:
 *   - query: the user's original query
 *   - domain: target domain (3d, 2d, data-viz, diagram)
 *   - skill: selected skill id (threejs, p5js, d3js)
 *   - intentType: parsed intent type (create, modify, explain, chat, animate)
 *   - taskCount: number of tasks in the plan
 *   - error: error message if applicable
 *   - llmThoughts: pre-generated LLM thoughts object (from generateThinkingAnalysis)
 * @returns {string} First-person thought string
 */
export function generateThought(step, context = {}) {
  const ctx = {
    domain: context.domain ?? "3D",
    skill: context.skill ?? "threejs",
    intentType: context.intentType ?? "create",
    taskCount: context.taskCount ?? 7,
    query: context.query ?? "",
    error: context.error ?? "",
    ...context
  };

  // ── Priority 1: LLM-generated thoughts (context-aware, unique) ──
  if (ctx.llmThoughts && typeof ctx.llmThoughts === "object") {
    const llmKey = stepToLlmKey[step];
    if (llmKey && ctx.llmThoughts[llmKey]) {
      return String(ctx.llmThoughts[llmKey]);
    }
  }

  // ── Priority 2: Template pool (fast, zero cost) ──

  // Step-specific with sub-variants
  if (step === "intent_parsed" && thoughtTemplates.intent_parsed[ctx.intentType]) {
    return interpolate(pickRandom(thoughtTemplates.intent_parsed[ctx.intentType]), ctx);
  }

  if (step === "skill_selected" && thoughtTemplates.skill_selected[ctx.skill]) {
    return interpolate(pickRandom(thoughtTemplates.skill_selected[ctx.skill]), ctx);
  }

  // Direct step match
  if (thoughtTemplates[step]) {
    const pool = Array.isArray(thoughtTemplates[step])
      ? thoughtTemplates[step]
      : Object.values(thoughtTemplates[step]).flat();
    return interpolate(pickRandom(pool), ctx);
  }

  // Fallback
  return `Processing step: ${step.replace(/_/g, " ")}...`;
}

/**
 * Generate a sequence of thought tokens to simulate streaming.
 * Splits the thought into word-level chunks for typewriter streaming.
 *
 * @param {string} thought - The full thought string
 * @returns {string[]} Array of word chunks
 */
export function tokenizeThought(thought) {
  return thought.match(/\S+\s*/g) ?? [thought];
}
