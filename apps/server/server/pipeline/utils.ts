import { normalizeQuery } from "./intent-classifier.js";
import { sleep, truncateDiagnostic } from "../lib/utils.js";
import { recordTokenUsage } from "../state/token-usage.js";
import { z } from "zod";

// Moonshot configuration
export const moonshotBaseUrl = process.env.MOONSHOT_BASE_URL ?? "https://api.moonshot.ai/v1";
export const moonshotApiKey = process.env.MOONSHOT_API_KEY;

export const fastModeEnabled = process.env.FAST_MODE !== "false" && process.env.FAST_MODE !== "0";

export const moonshotRetryDelaysMs = fastModeEnabled ? [150, 350] : [250, 750];
export const narrationRetryDelaysMs = fastModeEnabled ? [] : [1000, 2500, 5000];

export const selfDebugSessionTimeoutMs = fastModeEnabled ? 9_000 : 14_000;
export const selfDebugMaxIterations = 2;
export const runtimeDebugMaxIterations = 2;

// Re-export from runtime-executor for pipeline convenience
export {
  runtimeExecutionMaxFrames,
  resolveRuntimeExecutionTimeoutMs,
  getTurnDeadlineAtMs,
  computeBoundedTimeoutMs,
  shouldDegradeRuntimeFailure,
  buildDegradedRuntimeResult
} from "./runtime-executor.js";

export function shouldRequireOrbitControls(state: any) {
  if (state?.selectedSkill !== "threejs") {
    return false;
  }

  const normalizedQuery = normalizeQuery(state?.request?.query ?? "");
  if (!normalizedQuery) {
    return true;
  }

  if (/(chart|graph|diagram|mermaid|static|poster|logo|icon|infographic)/.test(normalizedQuery)) {
    return false;
  }

  return true;
}

export function hasOrbitControlsInCode(code: string | null | undefined) {
  const normalizedCode = String(code ?? "");
  if (!normalizedCode.trim()) {
    return false;
  }

  const hasCtor = /new\s+OrbitControls\s*\(/.test(normalizedCode) || /OrbitControls\s*\(/.test(normalizedCode);
  const hasControlUsage = /controls\s*\./.test(normalizedCode);
  return hasCtor && hasControlUsage;
}

export function buildThreeJsFallbackCode() {
  return [
    "// Terranet Engine Cinematic Fallback",
    "scene.background = new THREE.Color('#020617');",
    "scene.fog = new THREE.FogExp2(0x020617, 0.04);",
    "scene.add(new THREE.AmbientLight(0x0f172a, 1.5));",
    "const mainLight = new THREE.PointLight(0x3b82f6, 120, 30);",
    "mainLight.position.set(5, 8, 5);",
    "scene.add(mainLight);",
    "const accentLight = new THREE.PointLight(0x8b5cf6, 100, 30);",
    "accentLight.position.set(-6, -4, -5);",
    "scene.add(accentLight);",
    "const engineGroup = new THREE.Group();",
    "scene.add(engineGroup);",
    "const coreGeo = new THREE.IcosahedronGeometry(1.5, 2);",
    "const coreMat = new THREE.MeshPhysicalMaterial({",
    "  color: 0x1e293b, emissive: 0x0f172a, roughness: 0.1, metalness: 0.9, clearcoat: 1.0, wireframe: true",
    "});",
    "const core = new THREE.Mesh(coreGeo, coreMat);",
    "engineGroup.add(core);",
    "const inner = new THREE.Mesh(new THREE.OctahedronGeometry(1.2, 0), new THREE.MeshStandardMaterial({",
    "  color: 0xffffff, emissive: 0x3b82f6, emissiveIntensity: 2, transparent: true, opacity: 0.9",
    "}));",
    "engineGroup.add(inner);",
    "const canvas = document.createElement('canvas');",
    "canvas.width = 1024; canvas.height = 256;",
    "const ctx = canvas.getContext('2d');",
    "ctx.fillStyle = '#000000';",
    "ctx.fillRect(0, 0, canvas.width, canvas.height);",
    "ctx.textAlign = 'center';",
    "ctx.textBaseline = 'middle';",
    "ctx.font = 'bold 72px \"Inter\", \"SF Pro Display\", sans-serif';",
    "ctx.fillStyle = '#60a5fa';",
    "ctx.shadowColor = '#3b82f6';",
    "ctx.shadowBlur = 25;",
    "ctx.fillText('TERRANET ENGINE', canvas.width / 2, canvas.height / 2);",
    "const textTexture = new THREE.CanvasTexture(canvas);",
    "const textMat = new THREE.MeshBasicMaterial({ map: textTexture, transparent: true, blending: THREE.AdditiveBlending });",
    "const textMesh = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 1, 64, 1, true, -Math.PI / 3, Math.PI / 1.5), textMat);",
    "engineGroup.add(textMesh);",
    "const rings = [];",
    "for (let i = 0; i < 3; i++) {",
    "  const ring = new THREE.Mesh(",
    "    new THREE.TorusGeometry(2.5 + i * 0.8, 0.02, 16, 100),",
    "    new THREE.MeshBasicMaterial({ color: i === 1 ? 0x8b5cf6 : 0x3b82f6, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending })",
    "  );",
    "  ring.rotation.x = Math.random() * Math.PI;",
    "  const pivot = new THREE.Group();",
    "  pivot.add(ring);",
    "  rings.push({ mesh: pivot, speed: 0.005 + Math.random() * 0.01 });",
    "  engineGroup.add(pivot);",
    "}",
    "camera.position.set(0, 2, 8);",
    "camera.lookAt(0, 0, 0);",
    "const clock = new THREE.Clock();",
    "function animate() {",
    "  requestAnimationFrame(animate);",
    "  const t = clock.getElapsedTime();",
    "  core.rotation.y += 0.005; core.rotation.x += 0.003;",
    "  inner.rotation.y -= 0.01; inner.rotation.z += 0.005;",
    "  inner.material.emissiveIntensity = 1.5 + Math.sin(t * 3) * 0.5;",
    "  textMesh.rotation.y = Math.sin(t * 0.5) * 0.2;",
    "  rings.forEach(r => { r.mesh.rotation.y += r.speed; r.mesh.rotation.x += r.speed * 0.3; });",
    "  engineGroup.position.y = Math.sin(t) * 0.3;",
    "  renderer.render(scene, camera);",
    "}",
    "animate();"
  ].join("\n");
}

export function buildP5FallbackCode() {
  return [
    "// Local fallback output",
    "let theta = 0;",
    "function setup() {",
    "  createCanvas(800, 450);",
    "  noStroke();",
    "}",
    "function draw() {",
    "  background(10, 14, 24);",
    "  fill(29, 140, 248);",
    "  const x = width * 0.5 + Math.cos(theta) * 140;",
    "  const y = height * 0.5 + Math.sin(theta * 1.3) * 90;",
    "  ellipse(x, y, 120, 120);",
    "  theta += 0.02;",
    "}"
  ].join("\n");
}

export function buildD3FallbackCode() {
  return [
    "// Local fallback output",
    "const width = 640;",
    "const height = 360;",
    "const root = d3.select(document.body);",
    "root.selectAll(\"*\").remove();",
    "const svg = root.append(\"svg\")",
    "  .attr(\"width\", width)",
    "  .attr(\"height\", height)",
    "  .attr(\"viewBox\", `0 0 ${width} ${height}`);",
    "svg.append(\"rect\")",
    "  .attr(\"x\", 0)",
    "  .attr(\"y\", 0)",
    "  .attr(\"width\", width)",
    "  .attr(\"height\", height)",
    "  .attr(\"fill\", \"#0b1220\");",
    "const pulse = svg.append(\"circle\")",
    "  .attr(\"cx\", width * 0.5)",
    "  .attr(\"cy\", height * 0.5)",
    "  .attr(\"r\", 56)",
    "  .attr(\"fill\", \"#1d8cf8\");",
    "let t = 0;",
    "function animate() {",
    "  t += 0.03;",
    "  pulse.attr(\"cx\", width * 0.5 + Math.cos(t) * 140);",
    "  requestAnimationFrame(animate);",
    "}",
    "animate();"
  ].join("\n");
}

export function buildAnimeFallbackCode() {
  return [
    "// Local fallback output",
    "const node = document.createElement(\"div\");",
    "node.style.width = \"96px\";",
    "node.style.height = \"96px\";",
    "node.style.borderRadius = \"16px\";",
    "node.style.background = \"#1d8cf8\";",
    "node.style.margin = \"120px auto\";",
    "document.body.appendChild(node);",
    "anime({",
    "  targets: node,",
    "  translateX: [-120, 120],",
    "  translateY: [-24, 24],",
    "  rotate: \"1turn\",",
    "  duration: 2400,",
    "  direction: \"alternate\",",
    "  loop: true,",
    "  easing: \"easeInOutSine\"",
    "});"
  ].join("\n");
}

export function buildManimFallbackCode() {
  return [
    "from manim import *",
    "",
    "class GVERichScene(Scene):",
    "    def construct(self):",
    "        title = Text('Terranet Rich Video', weight=BOLD).scale(0.86)",
    "        subtitle = Text('Manim fallback composition', font_size=30).next_to(title, DOWN, buff=0.25)",
    "        halo = Circle(radius=2.15, stroke_color=BLUE_D, stroke_width=10)",
    "        orbit = Dot(color=TEAL_A)",
    "",
    "        self.play(FadeIn(title, shift=UP * 0.2), FadeIn(subtitle, shift=DOWN * 0.2), run_time=1.0)",
    "        self.play(Create(halo), FadeIn(orbit), run_time=1.2)",
    "        self.play(MoveAlongPath(orbit, halo), run_time=2.2, rate_func=smooth)",
    "        self.play(Rotate(halo, angle=TAU, run_time=1.8, rate_func=linear), orbit.animate.scale(1.5), run_time=1.8)",
    "        self.wait(0.4)"
  ].join("\n");
}

export function buildFallbackGeneratedCode(selectedSkill = "threejs") {
  const skillId = String(selectedSkill ?? "threejs").toLowerCase();
  if (skillId === "p5js") {
    return buildP5FallbackCode();
  }

  if (skillId === "d3js") {
    return buildD3FallbackCode();
  }

  if (skillId === "animejs") {
    return buildAnimeFallbackCode();
  }

  if (skillId === "manim") {
    return buildManimFallbackCode();
  }

  return buildThreeJsFallbackCode();
}

export const moonshotModel = process.env.MOONSHOT_MODEL ?? "kimi-k2.5";

export const moonshotModeProfiles = Object.freeze({
  instant: Object.freeze({
    temperature: 1.0,
    thinking: false
  }),
  thinking: Object.freeze({
    temperature: 1.0
  })
});

export function resolveMoonshotTemperature(model: string, requestedTemperature: number) {
  if (/kimi/i.test(model)) {
    return 1;
  }
  return requestedTemperature;
}

export function resolveRequestedQuality(request: any, selectedSkill: string) {
  const explicitQuality = request?.preferences?.quality;
  if (explicitQuality) {
    return explicitQuality;
  }
  return selectedSkill === "threejs" || selectedSkill === "animejs" || selectedSkill === "manim"
    ? "high"
    : "standard";
}

export function buildValidationOptions({
  skillId,
  request = null,
  requestedQuality = null,
  userQuery = "",
  parsedIntent = null
}: any) {
  const resolvedSkill = skillId ?? "threejs";
  const queryFromRequest = request?.query;
  const resolvedQuery = typeof userQuery === "string" && userQuery.trim()
    ? userQuery
    : typeof queryFromRequest === "string"
      ? queryFromRequest
      : "";
  const quality = requestedQuality ?? resolveRequestedQuality(request ?? {}, resolvedSkill);

  return {
    requestedQuality: quality,
    userQuery: resolvedQuery,
    parsedIntent,
    enforceQuality: resolvedSkill === "threejs" && quality !== "draft"
  };
}

// Zod schemas for request validation
export const requestSchema = z.object({
  query: z.string().min(3),
  sessionId: z.string().optional(),
  preferences: z.object({
    quality: z.enum(["draft", "standard", "high"]).optional(),
    skill: z.enum(["threejs", "p5js", "d3js", "animejs", "manim", "auto"]).optional(),
    mode: z.enum(["generate", "modify"]).optional(),
    provider: z.string().optional()
  }).optional()
}).passthrough();

export const modifyRequestSchema = z.object({
  sessionId: z.string().min(3),
  instruction: z.string().min(3),
  preferences: z.object({
    quality: z.enum(["draft", "standard", "high"]).optional(),
    skill: z.enum(["threejs", "p5js", "d3js", "animejs", "manim", "auto"]).optional(),
    mode: z.enum(["generate", "modify", "rerun"]).optional(),
    provider: z.string().optional()
  }).optional(),
  sceneState: z.object({
    currentScene: z.object({
      code: z.string(),
      skill: z.string().optional(),
      version: z.number().optional(),
      sceneId: z.string(),
      previewUrl: z.string().nullable().optional(),
      outputKind: z.string().nullable().optional(),
      mediaType: z.string().nullable().optional(),
      mediaUrl: z.string().nullable().optional(),
      mediaArtifactId: z.string().nullable().optional(),
      mediaDurationMs: z.number().nullable().optional(),
      mediaFps: z.number().nullable().optional(),
      mediaResolution: z.string().nullable().optional(),
      mediaBytes: z.number().nullable().optional()
    })
  }),
  codeOverride: z.string().optional(),
  runMode: z.enum(["modify", "rerun"]).optional()
}).passthrough();

// Helper functions
export function extractCodeContent(rawContent: unknown): string {
  if (!rawContent || typeof rawContent !== "string") {
    return "";
  }

  const fencedBlock = rawContent.match(/```(?:[a-z0-9_-]+)?\s*([\s\S]*?)```/i);
  const output = fencedBlock ? fencedBlock[1] : rawContent;
  return (output ?? "").trim();
}

export function extractChoiceContent(rawContent: unknown): string {
  if (typeof rawContent === "string") {
    return rawContent;
  }

  if (Array.isArray(rawContent)) {
    return rawContent
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (!part || typeof part !== "object") {
          return "";
        }

        const obj = part as Record<string, unknown>;
        if (typeof obj.text === "string") {
          return obj.text;
        }

        if (typeof obj.content === "string") {
          return obj.content;
        }

        if (typeof obj.value === "string") {
          return obj.value;
        }

        return "";
      })
      .join("");
  }

  if (rawContent && typeof rawContent === "object") {
    const obj = rawContent as Record<string, unknown>;
    if (typeof obj.text === "string") {
      return obj.text;
    }

    if (typeof obj.content === "string") {
      return obj.content;
    }
  }

  return "";
}

export function extractAssistantText(rawContent: unknown): string {
  if (!rawContent || typeof rawContent !== "string") {
    return "";
  }

  // Strip markdown formatting if present
  let text = rawContent;
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1"); // bold
  text = text.replace(/\*([^*]+)\*/g, "$1"); // italic
  text = text.replace(/```[\s\S]*?```/g, ""); // code blocks
  text = text.replace(/`([^`]+)`/g, "$1"); // inline code

  return text.trim();
}

export function emitPipelineProgress(progress: any, step: string, status = "running", payload = {}) {
  if (typeof progress !== "function") {
    return;
  }

  try {
    progress({ step, status, payload });
  } catch {
    // Progress callbacks are best-effort
  }
}

export function describeGenerationSource(source: unknown): string {
  const normalized = String(source ?? "").trim().toLowerCase();

  if (!normalized) {
    return "Generated via default LLM provider.";
  }

  if (normalized === "fallback") {
    return "Used fallback generator when LLM providers were unavailable.";
  }

  if (normalized.includes("debug")) {
    return "Generated after self-debug session.";
  }

  return `Generated via ${source}.`;
}

export function buildLocalPostTurnNarration(turnResult: any, query: string): string {
  const skill = turnResult?.result?.skill ?? "unknown";
  const runtimeStatus = turnResult?.result?.runtime?.status ?? "unknown";
  const renderCount = turnResult?.result?.runtime?.renderCount ?? 0;
  const success = turnResult?.result?.runtime?.success ?? false;

  const parts = [
    `Built a ${skill} scene for "${query}".`,
    success ? `Rendered ${renderCount} element(s).` : "Runtime execution encountered issues.",
    runtimeStatus === "skipped" ? "Execution was skipped." : null
  ].filter(Boolean);

  return parts.join(" ");
}

export function serializeErrorForDiagnostics(error: unknown, context = {}): any {
  const diagnostics: any = {
    stage: (context as any).stage ?? null,
    message: error instanceof Error ? error.message : String(error),
    timestamp: new Date().toISOString()
  };

  if (error instanceof Error && error.stack) {
    diagnostics.stack = error.stack.split("\n").slice(0, 3).join("\n");
  }

  return { ...diagnostics, ...context };
}

export async function withTimeout(promise: Promise<any>, timeoutMs: number, timeoutMessage: string): Promise<any> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error(timeoutMessage);
  let timeoutHandle: any;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export function createMoonshotOverloadedError(): Error {
  const error = new Error("Moonshot temporarily overloaded; used local fallback.");
  error.name = "MoonshotOverloadedError";
  return error;
}

export function isMoonshotOverloaded(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /(overloaded|engine_overloaded|temporarily)/i.test(message);
}

export async function generateConversationReplyWithMoonshot(options: any): Promise<any> {
  const { sessionState, request, parsedIntent, mode, onChunk } = options;
  
  // Import dependencies dynamically to avoid circular imports
  const { buildConversationPromptBundle } = await import("./prompts.js");
  const { executeWithProviderFailover, createRetryableProviderError } = await import("./failover.js");
  const { buildConversationHelpText } = await import("./intent-classifier.js");
  
  const { systemPrompt, userPrompt } = buildConversationPromptBundle({
    sessionState,
    request,
    parsedIntent,
    mode
  });

  try {
    const completion = await executeWithProviderFailover({
      operationName: "ConversationReply",
      filter: { 
        requireThinking: true,
        preferredProviderId: request?.preferences?.provider
      },
      mode: "thinking",
      retryDelays: moonshotRetryDelaysMs,
      executeProvider: async ({ provider, mode: providerMode, retryDelays }: any) => {
        const response = await fetchChatCompletion(
          provider,
          {
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ]
          },
          { mode: providerMode, retryDelays }
        );

        const payload = await response.json();
        const message = payload?.choices?.[0]?.message ?? {};
        const content = message.content ?? "";
        const reasoningContent = (message as any).reasoning_content ?? null;
        const replyText = typeof content === "string" ? content : "";

        // Record token usage from conversation reply.
        if (payload?.usage) {
          recordTokenUsage(
            { providerId: provider.id, model: payload.model ?? provider.model ?? null },
            payload.usage
          );
        }

        if (!replyText) {
          throw createRetryableProviderError(`${provider.id} returned empty conversational output.`, "PROVIDER_EMPTY_OUTPUT");
        }

        return { replyText, reasoningContent };
      }
    });

    const replyText = completion?.value?.replyText ?? "";
    const reasoningContent = completion?.value?.reasoningContent ?? null;

    // Emit reasoning chain as thought events (DeepSeek V4 Pro, etc.)
    if (reasoningContent && request?.sessionId) {
      const { broadcastEvent } = await import("../ws/streaming.js");
      const reasoningSteps = reasoningContent
        .split(/\n{2,}/)
        .map((s: string) => s.trim())
        .filter(Boolean);

      for (const step of reasoningSteps) {
        try {
          broadcastEvent("thought:stream", {
            sessionId: request.sessionId,
            step: "reasoning",
            text: step,
            timestamp: Date.now(),
          });
        } catch {
          // Best-effort broadcast
        }
      }
    }

    // Simple text emission - onChunk is best-effort
    if (typeof onChunk === "function" && replyText) {
      try {
        await onChunk(replyText, replyText);
      } catch {
        // Chunk emission is best-effort
      }
    }

    return {
      replyText,
      replySource: completion.provider.id,
      replyWarning: completion.llm.fallbackUsed
        ? `Primary conversation model unavailable; replied via ${completion.provider.id}.`
        : null,
      replyLlm: completion.llm
    };
  } catch (error) {
    const replyText = buildConversationHelpText(sessionState, request.query, parsedIntent);
    const replyTextStr = Array.isArray(replyText) ? replyText.join(" ") : replyText;
    
    if (typeof onChunk === "function" && replyTextStr) {
      try {
        await onChunk(replyTextStr, replyTextStr);
      } catch {
        // Chunk emission is best-effort
      }
    }

    return {
      replyText: replyTextStr,
      replySource: "local-fallback",
      replyWarning: "Conversation model unavailable; using local response.",
      replyLlm: null
    };
  }
}

export async function applyFallbackSceneEdit(currentCode: string, instruction: string): Promise<any> {
  // Stub - will be implemented from orchestrator extraction
  return {
    generatedCode: currentCode,
    changeSummary: `Fallback edit: ${instruction}`
  };
}

export async function fetchChatCompletion(provider: any, payload: any, options: any = {}) {
  const mode = options.mode ?? "instant";
  const retryDelays = options.retryDelays ?? [150, 350];
  let lastError = null;
  let attempt = 0;

  const resolvedModel = payload.model ?? provider.model;
  const resolvedPayload = { max_tokens: 8192, ...payload, model: resolvedModel };

  while (attempt <= retryDelays.length) {
    const enrichedPayload = typeof provider.payloadTransform === "function"
      ? provider.payloadTransform.call(provider, resolvedPayload, { mode })
      : resolvedPayload;

    const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;

    try {
      const fetchStartMs = Date.now();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(enrichedPayload),
      });
      const fetchDurationMs = Date.now() - fetchStartMs;

      if (response.ok) {
        return response;
      }

      const bodyText = await response.text();
      const error: any = new Error(`${provider.id} request failed (${response.status}): ${bodyText.slice(0, 220)}`);
      error.status = response.status;

      if (response.status === 429) {
        error.code = "PROVIDER_RATE_LIMITED";
        throw error;
      }

      if (attempt >= retryDelays.length) {
        throw error;
      }

      lastError = error;
      await sleep(retryDelays[attempt]);
      attempt += 1;
    } catch (error: any) {
      if (error?.code === "PROVIDER_RATE_LIMITED" || error?.status === 429) {
        throw error;
      }

      lastError = error;

      if (attempt >= retryDelays.length) {
        throw error;
      }

      await sleep(retryDelays[attempt]);
      attempt += 1;
    }
  }

  throw lastError ?? new Error(`${provider.id} request failed.`);
}
