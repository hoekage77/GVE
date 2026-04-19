export type SkillId = "threejs" | "p5js" | "d3js" | "animejs" | "manim";
export type SkillPreference = SkillId | "auto";

export interface GenerateRequest {
  query: string;
  sessionId?: string;
  preferences?: {
    skill?: SkillPreference;
    quality?: "draft" | "standard" | "high";
  };
}

export interface SceneAssetCandidate {
  id: string;
  url: string;
  note?: string;
}

export interface SceneAssetFallbackPolicy {
  allowInternetFallback: boolean;
  requireFallbackWarning: boolean;
  requireInlineFallbackComment: boolean;
}

export interface SceneAssetPlan {
  manifestVersion: string;
  skill: string;
  requestedQuality: "draft" | "standard" | "high";
  strategy: "runtime-native" | "hybrid" | "model-first";
  subjectNeedsModel: boolean;
  categories: string[];
  catalog: Record<string, SceneAssetCandidate[]>;
  curatedCandidates: SceneAssetCandidate[];
  fallbackPolicy: SceneAssetFallbackPolicy;
  runtimeHelpers: string[];
}

export interface SceneVersion {
  versionId: string;
  version: number;
  artifactId?: string;
  artifactVersion?: number;
  sceneId: string;
  code: string | null;
  previewUrl: string | null;
  skill: string | null;
  outputKind?: "code" | "media";
  mediaType?: string | null;
  mediaUrl?: string | null;
  mediaArtifactId?: string | null;
  mediaDurationMs?: number | null;
  mediaFps?: number | null;
  mediaResolution?: string | null;
  mediaBytes?: number | null;
  assetPlan?: SceneAssetPlan | null;
  explanation: string | null;
  messageId?: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactSummary {
  artifactId: string;
  title: string;
  revisionCount: number;
  revisionPointer: number;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
  latestSceneId: string | null;
  latestSkill: string | null;
}

export interface SessionSceneState {
  sessionId: string;
  sceneId: string | null;
  versionCount: number;
  versionPointer?: number;
  revisionCount?: number;
  revisionPointer?: number;
  artifactCount?: number;
  artifactPointer?: number;
  currentArtifactId?: string | null;
  canUndo?: boolean;
  canRedo?: boolean;
  canPreviousArtifact?: boolean;
  canNextArtifact?: boolean;
  currentScene: SceneVersion | null;
  versions: SceneVersion[];
  sceneVersions?: SceneVersion[];
  artifacts?: ArtifactSummary[];
  messages?: SessionMessage[];
  orchestrationTrace?: Array<{ id: string; step: string; payload: unknown; createdAt: string }>;
  status?: "idle" | "parsing" | "selecting" | "generating" | "executing";
  createdAt: string;
  updatedAt: string;
}

export interface SessionMessage {
  id: string;
  role: "user" | "assistant" | "system" | "thought";
  content: string;
  kind: string | null;
  meta: string[];
  error?: SessionMessageError | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMessageError {
  code: string;
  title: string;
  userMessage: string;
  retryable: boolean;
  suggestedAction?: string | null;
  technicalDetail?: string | null;
  stage?: string | null;
}

export interface SessionMessagesResponse {
  sessionId: string;
  messages: SessionMessage[];
}

export interface SessionListResponse {
  sessions: SessionSceneState[];
}

export interface CreateSessionResponse {
  sessionId: string;
  websocketUrl: string;
  sceneState: SessionSceneState;
}

export interface ChatTurnRequest {
  content?: string;
  imageUrl?: string;
  imageData?: string;
  preferences?: {
    skill?: SkillPreference;
    quality?: "draft" | "standard" | "high";
  };
}

export interface LlmProviderAttempt {
  providerId: string;
  model: string;
  status: "success" | "failed";
  reason?: string | null;
  retryable?: boolean;
}

export interface LlmSourceMetadata {
  providerId: string | null;
  model: string | null;
  fallbackUsed: boolean;
  attemptCount: number;
  attempts?: LlmProviderAttempt[];
}

export interface ChatTurnResponse {
  sessionId: string;
  mode: "chat" | "clarify" | "explain" | "generate" | "modify";
  intent: {
    rawQuery: string;
    intentType: string;
    targetDomain: string;
    entities: Array<{ kind: string; name: string }>;
    constraints: Array<{ name: string; value: string }>;
    confidence: number;
    ambiguous: boolean;
    clarificationPrompt: string | null;
  };
  userMessage: SessionMessage;
  assistantMessage: SessionMessage;
  assistantSource?: string | null;
  assistantWarning?: string | null;
  assistantLlm?: LlmSourceMetadata | null;
  sceneState: SessionSceneState;
  messages: SessionMessage[];
  result: GenerateResponse | ModifyResponse | null;
}

export interface SkillCapability {
  name: string;
  description?: string;
}

export interface SkillCatalogItem {
  id: string;
  name: string;
  version: string;
  description: string;
  domainFocus: string[];
  capabilities: string[];
  executionReliability: number;
  warmPoolAvailability: number;
  safeDefault: boolean;
}

export interface SkillCatalogResponse {
  skills: SkillCatalogItem[];
}

export type GveTaskAction =
  | "parse_intent"
  | "select_skill"
  | "build_prompt"
  | "generate_code"
  | "validate_code"
  | "provision_sandbox"
  | "analyze_quality"
  | "autonomous_patching"
  | "execute_code"
  | "sync_state";

export type GveTaskStatus = "pending" | "running" | "completed" | "failed";

export interface GveTask {
  id: string;
  title: string;
  description: string;
  action: GveTaskAction;
  command: string;
  status: GveTaskStatus;
  dependsOn: string[];
}

export interface TaskPlanResponse {
  planId: string;
  summary: string;
  tasks: GveTask[];
}

export interface TaskExecutionResponse {
  planId: string;
  taskId: string;
  status: Exclude<GveTaskStatus, "pending">;
  output: string;
  artifact?: string;
}

export interface ThoughtStreamEvent {
  sessionId: string;
  step: string;
  thought: string;
  token: string;
  isFinal: boolean;
  requestId?: string | null;
  messageId?: string | null;
}

export interface AgentActivityEvent {
  id: string;
  sessionId: string;
  messageId?: string | null;
  step: string;
  status: GveTaskStatus;
  tone?: "progress" | "success" | "error";
  text: string;
  technicalDetail?: string | null;
  createdAt: string;
}

export interface GenerateResponse {
  sceneId: string;
  previewUrl: string;
  code: string;
  skill: string;
  generationSource?: string | null;
  generationWarning?: string | null;
  llmTrace?: LlmSourceMetadata | null;
  outputKind?: "code" | "media";
  mediaType?: string | null;
  mediaUrl?: string | null;
  mediaArtifactId?: string | null;
  mediaDurationMs?: number | null;
  mediaFps?: number | null;
  mediaResolution?: string | null;
  mediaBytes?: number | null;
  assetPlan?: SceneAssetPlan | null;
  explanation: string;
  sessionId: string;
  sceneVersion: number;
  versionCount: number;
  sceneState: SessionSceneState;
  modifyOutcome?: "applied" | "applied_after_retry" | "rejected_noop";
  noopReason?: string | null;
  retriedAfterNoop?: boolean;
  runtime?: {
    success: boolean;
    status: "completed" | "timeout" | "error" | "skipped" | "degraded";
    previewUrl: string | null;
    skillId: string;
    skillName: string;
    outputKind?: "code" | "media";
    mediaType?: string | null;
    mediaUrl?: string | null;
    mediaArtifactId?: string | null;
    mediaDurationMs?: number | null;
    mediaFps?: number | null;
    mediaResolution?: string | null;
    mediaBytes?: number | null;
    dependencyCount: number;
    durationMs: number;
    renderCount: number;
    frameCount: number;
    warning?: string | null;
    error?: string | null;
    logs: Array<{ level: string; message: string; timestamp: string }>;
    summary: { childCount: number; types: string[] };
    frameBudgetReached?: boolean;
  };
  diff?: {
    instruction: string;
    currentVersion: number;
    changed: boolean;
    changeSummary: string;
    source: string;
    patch?: string;
    addedLines?: number;
    removedLines?: number;
    changedLines?: number;
  };
}

export interface ModifyRequest {
  sessionId: string;
  instruction: string;
  runMode?: "modify" | "rerun";
  codeOverride?: string;
  preferences?: {
    skill?: SkillPreference;
    quality?: "draft" | "standard" | "high";
  };
}

export interface ModifyResponse extends GenerateResponse {}

export interface UndoRedoResponse {
  success: boolean;
  sceneState: SessionSceneState;
  error?: string;
  message?: string;
}

export interface ArtifactTimelineEntry {
  artifactId: string;
  title: string;
  isCurrent: boolean;
  revisions: Array<SceneVersion & { isCurrent: boolean }>;
}

export interface VersionListResponse {
  sessionId: string;
  artifactCount?: number;
  artifactPointer?: number;
  currentArtifactId?: string | null;
  versionCount: number;
  versionPointer: number;
  revisionCount?: number;
  revisionPointer?: number;
  versions: Array<SceneVersion & { isCurrent: boolean }>;
  artifacts?: ArtifactSummary[];
  artifactTimeline?: ArtifactTimelineEntry[];
}

const USE_DEV_MOCKS = (import.meta as any).env?.DEV && (import.meta as any).env?.VITE_USE_API_MOCK === "1";
const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL ?? "";
const WS_BASE_URL = (import.meta as any).env?.VITE_WS_BASE_URL ?? "";

function inferRuntimeApiBaseUrl(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const hostname = window.location.hostname.toLowerCase();

  if (hostname === "app.dosco.live") {
    return "https://api.dosco.live";
  }

  return "";
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  const runtimeApiBaseUrl = inferRuntimeApiBaseUrl();
  const effectiveApiBaseUrl = (API_BASE_URL || runtimeApiBaseUrl).replace(/\/$/, "");

  if (!effectiveApiBaseUrl) {
    return path;
  }

  return `${effectiveApiBaseUrl}${path}`;
}

export function resolveWebSocketUrl(path = "/ws"): string {
  if (WS_BASE_URL) {
    return `${WS_BASE_URL.replace(/\/$/, "")}${path}`;
  }

  const runtimeApiBaseUrl = inferRuntimeApiBaseUrl();
  if (runtimeApiBaseUrl) {
    const apiBaseUrl = new URL(runtimeApiBaseUrl);
    const protocol = apiBaseUrl.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${apiBaseUrl.host}${path}`;
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${path}`;
  }

  return `ws://127.0.0.1:8000${path}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function readApiError(response: Response, fallbackMessage: string): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { message?: string; error?: string };
      return payload.message ?? payload.error ?? fallbackMessage;
    }

    const text = await response.text();
    return text.trim() || fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  fallbackMessage: string,
  retryCount = 2
): Promise<T> {
  let lastError: unknown = null;
  const requestUrl = resolveApiUrl(url);

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      const response = await fetch(requestUrl, init);

      if (response.ok) {
        return (await response.json()) as T;
      }

      const retriable = response.status >= 500 && response.status < 600 && attempt < retryCount;
      if (!retriable) {
        throw new Error(await readApiError(response, fallbackMessage));
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      lastError = error;
      if (attempt >= retryCount) {
        break;
      }

      await sleep(120 * (attempt + 1));
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error(fallbackMessage);
}

export async function listSkills(): Promise<SkillCatalogResponse> {
  try {
    return await requestJson<SkillCatalogResponse>("/api/v1/skills", { method: "GET" }, "Skill catalog request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return {
        skills: [
          {
            id: "threejs",
            name: "Three.js Renderer",
            version: "0.160.0",
            description: "3D scene generation with lighting, materials, and camera controls.",
            domainFocus: ["3d", "animation"],
            capabilities: ["primitive", "material", "lighting", "animation", "camera"],
            executionReliability: 0.94,
            warmPoolAvailability: 0.82,
            safeDefault: true
          },
          {
            id: "p5js",
            name: "p5.js Sketcher",
            version: "1.9.0",
            description: "Expressive 2D motion, sketches, particles, and interactive visuals.",
            domainFocus: ["2d", "animation"],
            capabilities: ["canvas", "drawing", "interaction", "animation", "particles"],
            executionReliability: 0.91,
            warmPoolAvailability: 0.76,
            safeDefault: true
          },
          {
            id: "d3js",
            name: "D3.js Visualizer",
            version: "7.9.0",
            description: "Data-driven charts, diagrams, and structured visual layouts.",
            domainFocus: ["data-viz", "diagram"],
            capabilities: ["scales", "axes", "layout", "binding", "transition"],
            executionReliability: 0.89,
            warmPoolAvailability: 0.72,
            safeDefault: true
          },
          {
            id: "animejs",
            name: "Anime.js Animator",
            version: "3.2.2",
            description: "High-fidelity DOM/SVG motion graphics using timeline-based animation.",
            domainFocus: ["animation", "2d", "motion-graphics"],
            capabilities: ["timeline", "easing", "stagger", "svg", "interaction"],
            executionReliability: 0.9,
            warmPoolAvailability: 0.74,
            safeDefault: true
          },
          {
            id: "manim",
            name: "Manim Video Composer",
            version: "0.18.1",
            description: "Python-based cinematic animation rendering for rich educational and narrative videos.",
            domainFocus: ["animation", "2d", "motion-graphics"],
            capabilities: ["video", "timeline", "easing", "typography", "camera"],
            executionReliability: 0.86,
            warmPoolAvailability: 0.62,
            safeDefault: false
          }
        ]
      };
    }

    throw error;
  }
}

function buildDevSession(sessionId?: string): CreateSessionResponse {
  const resolvedSessionId = sessionId ?? `session-${Date.now()}`;
  const now = new Date().toISOString();

  return {
    sessionId: resolvedSessionId,
    websocketUrl: resolveWebSocketUrl("/ws"),
    sceneState: {
      sessionId: resolvedSessionId,
      sceneId: null,
      versionCount: 0,
      versionPointer: -1,
      revisionCount: 0,
      revisionPointer: -1,
      artifactCount: 0,
      artifactPointer: -1,
      currentArtifactId: null,
      canUndo: false,
      canRedo: false,
      canPreviousArtifact: false,
      canNextArtifact: false,
      currentScene: null,
      versions: [],
      artifacts: [],
      createdAt: now,
      updatedAt: now
    }
  };
}

export async function createSession(sessionId?: string): Promise<CreateSessionResponse> {
  try {
    return await requestJson<CreateSessionResponse>("/api/v1/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sessionId ? { sessionId } : {})
    }, "Session creation request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return buildDevSession(sessionId);
    }

    throw error;
  }
}

export async function listSessions(): Promise<SessionListResponse> {
  try {
    return await requestJson<SessionListResponse>("/api/v1/sessions", { method: "GET" }, "Session list request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return { sessions: [] };
    }

    throw error;
  }
}

export async function listSessionMessages(sessionId: string): Promise<SessionMessagesResponse> {
  try {
    return await requestJson<SessionMessagesResponse>(`/api/v1/sessions/${sessionId}/messages`, {
      method: "GET"
    }, "Session messages request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return { sessionId, messages: [] };
    }

    throw error;
  }
}

function buildDevMock(input: GenerateRequest): GenerateResponse {
  const sessionId = input.sessionId ?? `session-${Date.now()}`;
  const sceneId = `scene-${Date.now()}`;
  const selectedSkill = input.preferences?.skill && input.preferences.skill !== "auto"
    ? input.preferences.skill
    : "threejs";
  const isManim = selectedSkill === "manim";
  const previewUrl = isManim
    ? "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
    : "about:blank";
  const outputKind: "code" | "media" = isManim ? "media" : "code";

  const codeBySkill: Record<string, string> = {
    threejs: [
      "// Dev fallback generated code",
      "const geometry = new THREE.BoxGeometry(1, 1, 1);",
      "const material = new THREE.MeshStandardMaterial({ color: 0x1d8cf8, metalness: 0.8, roughness: 0.2 });",
      "const cube = new THREE.Mesh(geometry, material);",
      "scene.add(cube);",
      "function animate() {",
      "  requestAnimationFrame(animate);",
      "  cube.rotation.x += 0.01;",
      "  cube.rotation.y += 0.01;",
      "  renderer.render(scene, camera);",
      "}",
      "animate();"
    ].join("\n"),
    p5js: [
      "// Dev fallback generated code",
      "function setup() {",
      "  createCanvas(800, 500);",
      "}",
      "function draw() {",
      "  background(244);",
      "  fill(64, 120, 255);",
      "  ellipse(width * 0.5, height * 0.5, 120, 120);",
      "}"
    ].join("\n"),
    d3js: [
      "// Dev fallback generated code",
      "const svg = d3.select(document.body).append('svg').attr('width', 640).attr('height', 360);",
      "svg.append('circle').attr('cx', 320).attr('cy', 180).attr('r', 72).attr('fill', '#4f8cf8');"
    ].join("\n"),
    animejs: [
      "// Dev fallback generated code",
      "const stage = document.getElementById('stage') || document.body;",
      "const dot = document.createElement('div');",
      "dot.style.width = '72px';",
      "dot.style.height = '72px';",
      "dot.style.borderRadius = '999px';",
      "dot.style.background = 'linear-gradient(135deg, #60a5fa, #34d399)';",
      "dot.style.margin = '120px auto';",
      "stage.appendChild(dot);",
      "anime({ targets: dot, scale: [0.9, 1.12], duration: 1400, direction: 'alternate', loop: true, easing: 'easeInOutSine' });"
    ].join("\n"),
    manim: [
      "from manim import *",
      "",
      "class GVERichScene(Scene):",
      "    def construct(self):",
      "        title = Text(\"Terranet Rich Video\", weight=BOLD).scale(0.9)",
      "        subtitle = Text(\"Manim animation preview\", font_size=32).next_to(title, DOWN)",
      "        ring = Circle(radius=1.6, stroke_color=BLUE_E, stroke_width=10)",
      "        core = Dot(radius=0.22, color=TEAL_A)",
      "        pulse = always_redraw(lambda: Circle(radius=1.6 + 0.08 * np.sin(self.time * 2), stroke_color=BLUE_C, stroke_opacity=0.4))",
      "",
      "        self.play(FadeIn(title, shift=UP * 0.3), FadeIn(subtitle, shift=DOWN * 0.2), run_time=1.1)",
      "        self.play(Create(ring), FadeIn(core), run_time=1.2)",
      "        self.add(pulse)",
      "        self.play(Rotate(ring, angle=TAU, run_time=2.4, rate_func=smooth), core.animate.scale(1.4), run_time=2.4)",
      "        self.wait(0.6)"
    ].join("\n")
  };
  const selectedCode = codeBySkill[selectedSkill] ?? codeBySkill.threejs;

  return {
    sceneId,
    previewUrl,
    skill: selectedSkill,
    outputKind,
    mediaType: isManim ? "video/mp4" : null,
    mediaUrl: isManim ? previewUrl : null,
    explanation: "Dev fallback response: connect a backend endpoint to replace this mock output.",
    sessionId,
    sceneVersion: 1,
    versionCount: 1,
    sceneState: {
      sessionId,
      sceneId,
      versionCount: 1,
      versionPointer: 0,
      revisionCount: 1,
      revisionPointer: 0,
      artifactCount: 1,
      artifactPointer: 0,
      currentArtifactId: "artifact-1",
      canUndo: false,
      canRedo: false,
      canPreviousArtifact: false,
      canNextArtifact: false,
      currentScene: {
        versionId: "version-1",
        version: 1,
        artifactId: "artifact-1",
        artifactVersion: 1,
        sceneId,
        code: selectedCode,
        previewUrl,
        skill: selectedSkill,
        outputKind,
        mediaType: isManim ? "video/mp4" : null,
        mediaUrl: isManim ? previewUrl : null,
        explanation: "Dev fallback response: connect a backend endpoint to replace this mock output.",
        source: "fallback",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      versions: [
        {
          versionId: "version-1",
          version: 1,
          artifactId: "artifact-1",
          artifactVersion: 1,
          sceneId,
          code: selectedCode,
          previewUrl,
          skill: selectedSkill,
          outputKind,
          mediaType: isManim ? "video/mp4" : null,
          mediaUrl: isManim ? previewUrl : null,
          explanation: "Dev fallback response: connect a backend endpoint to replace this mock output.",
          source: "fallback",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      artifacts: [
        {
          artifactId: "artifact-1",
          title: sceneId,
          revisionCount: 1,
          revisionPointer: 0,
          isCurrent: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          latestSceneId: sceneId,
          latestSkill: selectedSkill
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    code: `${selectedCode}\n${isManim ? "#" : "//"} Original prompt: ${input.query}`
  };
}

  function isConversationOnlyQuery(query: string): boolean {
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
      return false;
    }

    if (/^(hi|hey|hello|yo|sup|hiya|good\s+(morning|afternoon|evening))\b/.test(normalized)) {
      return true;
    }

    if (/(what can (you|u) do|what do you do|how can you help|help me|what can i do here|what should i ask)/.test(normalized)) {
      return true;
    }

    if (/(thanks|thank you|cool|nice|okay|ok|got it|sounds good|hey there|hello there|how are you|who are you|what is your name|tell me a joke|can we chat|let's chat|lets chat)/.test(normalized)) {
      return true;
    }

    return !/\b(create|make|build|generate|design|draw|sketch|render|animate|modify|change|update|edit|explain|describe|walkthrough|scene|visual|image|3d|2d|canvas|diagram|chart|graph|data|cube|sphere|particle|color|rotation|spin|orbit|layout|lighting|material|shader|threejs|p5js|d3js|animejs|anime|manim|video|timeline|tween|easing|mermaid)\b/.test(
      normalized
    );
  }

  function buildDevChatMock(sessionId: string, content: string): ChatTurnResponse {
    const now = new Date().toISOString();
    const userMessage: SessionMessage = {
      id: `message-user-${Date.now()}`,
      role: "user",
      content,
      kind: "input",
      meta: [],
      createdAt: now,
      updatedAt: now
    };

    const assistantMessage: SessionMessage = {
      id: `message-assistant-${Date.now()}`,
      role: "assistant",
      content:
        "Yes. You can talk to me directly, and I can still switch into scene generation or editing when you ask.",
      kind: "chat",
      meta: [],
      createdAt: now,
      updatedAt: now
    };

    return {
      sessionId,
      mode: "chat",
      intent: {
        rawQuery: content,
        intentType: "chat",
        targetDomain: "conversation",
        entities: [],
        constraints: [],
        confidence: 0.96,
        ambiguous: false,
        clarificationPrompt: null
      },
      userMessage,
      assistantMessage,
      sceneState: {
        sessionId,
        sceneId: null,
        versionCount: 0,
        versionPointer: -1,
        revisionCount: 0,
        revisionPointer: -1,
        artifactCount: 0,
        artifactPointer: -1,
        currentArtifactId: null,
        canUndo: false,
        canRedo: false,
        canPreviousArtifact: false,
        canNextArtifact: false,
        currentScene: null,
        versions: [],
        artifacts: [],
        createdAt: now,
        updatedAt: now,
        messages: [userMessage, assistantMessage],
        orchestrationTrace: [],
        status: "idle"
      },
      messages: [userMessage, assistantMessage],
      result: null
    };
  }

function buildDevTaskPlan(input: GenerateRequest): TaskPlanResponse {
  const selectedSkill = input.preferences?.skill && input.preferences.skill !== "auto"
    ? input.preferences.skill
    : "threejs";
  const planId = `plan-${Date.now()}`;

  return {
    planId,
    summary: `7 executable tasks queued for ${selectedSkill} using ${input.preferences?.quality ?? "standard"} quality.`,
    tasks: [
      {
        id: "t1",
        title: "Parse Intent",
        description: "Extract action, entities, and constraints from natural language request.",
        action: "parse_intent",
        command: "router.intentParser.parse(request.query)",
        status: "pending",
        dependsOn: []
      },
      {
        id: "t2",
        title: "Select Skill",
        description: "Score available skills and choose best-fit runtime.",
        action: "select_skill",
        command: "router.skillSelector.rank(parsedIntent, capabilityIndex)",
        status: "pending",
        dependsOn: ["t1"]
      },
      {
        id: "t3",
        title: "Build Prompt Context",
        description: "Assemble skill capabilities, examples, and generation constraints.",
        action: "build_prompt",
        command: "agent.promptBuilder.create(parsedIntent, selectedSkill, sceneContext)",
        status: "pending",
        dependsOn: ["t1", "t2"]
      },
      {
        id: "t4",
        title: "Generate Code",
        description: "Invoke model with deterministic generation parameters.",
        action: "generate_code",
        command: "agent.codeGenerator.generate(prompt, { temperature: 0.2 })",
        status: "pending",
        dependsOn: ["t3"]
      },
      {
        id: "t5",
        title: "Validate Safety",
        description: "Run syntax, API, and security policy checks before execution.",
        action: "validate_code",
        command: "orchestrator.validator.runAll(generatedCode)",
        status: "pending",
        dependsOn: ["t4"]
      },
      {
        id: "t6",
        title: "Execute in Sandbox",
        description: "Execute validated code inside isolated Daytona sandbox.",
        action: "execute_code",
        command: "skillRuntime.execute(generatedCode, { timeout: 30000 })",
        status: "pending",
        dependsOn: ["t5"]
      },
      {
        id: "t7",
        title: "Sync Scene State",
        description: "Persist new version and broadcast update to connected clients.",
        action: "sync_state",
        command: "stateSync.broadcast(sceneStateDiff, sessionId)",
        status: "pending",
        dependsOn: ["t6"]
      }
    ]
  };
}

function buildDevTaskExecution(planId: string, task: GveTask): TaskExecutionResponse {
  const outputs: Record<GveTaskAction, string> = {
    parse_intent: "Intent parsed with confidence 0.94 and 4 entities extracted.",
    select_skill: "Skill selector scored threejs=0.97, animejs=0.88, p5js=0.62, d3js=0.18. Selected threejs.",
    build_prompt: "Prompt context assembled with templates, examples, and runtime constraints.",
    generate_code: "Code generation completed with 126 lines of JavaScript.",
    validate_code: "Validation passed: syntax, API whitelist, and security policy checks all green.",
    execute_code: "Sandbox execution succeeded. Preview artifact generated.",
    sync_state: "Scene state version committed and websocket broadcast dispatched."
  };

  const artifact = task.action === "execute_code" ? "preview://dev/mock-scene" : undefined;

  return {
    planId,
    taskId: task.id,
    status: "completed",
    output: outputs[task.action],
    artifact
  };
}

export async function generateVisual(input: GenerateRequest): Promise<GenerateResponse> {
  try {
    return await requestJson<GenerateResponse>("/api/v1/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }, "Generation request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return buildDevMock(input);
    }

    throw error;
  }
}

export async function modifyVisual(input: ModifyRequest): Promise<ModifyResponse> {
  try {
    return await requestJson<ModifyResponse>(`/api/v1/sessions/${input.sessionId}/modify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instruction: input.instruction,
        runMode: input.runMode,
        codeOverride: input.codeOverride,
        preferences: input.preferences
      })
    }, "Scene modification request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return buildDevMock({
        query: input.instruction,
        sessionId: input.sessionId,
        preferences: input.preferences
      }) as ModifyResponse;
    }

    throw error;
  }
}

export async function sendSessionMessage(
  sessionId: string,
  input: ChatTurnRequest,
  signal?: AbortSignal
): Promise<ChatTurnResponse> {
  try {
    return await requestJson<ChatTurnResponse>(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal
    }, "Chat turn request failed", 0);
  } catch (error) {
    if (USE_DEV_MOCKS) {
      const normalizedPrompt = String(input.content ?? "").trim();
      const fallbackPrompt = normalizedPrompt || "Generate a scene from the attached image.";
      const userContent = normalizedPrompt || "Attached an image.";

      if (normalizedPrompt && isConversationOnlyQuery(normalizedPrompt)) {
        return buildDevChatMock(sessionId, normalizedPrompt);
      }

      const now = new Date().toISOString();
      const sessionResponse = buildDevMock({ query: fallbackPrompt, sessionId, preferences: input.preferences });

      return {
        sessionId,
        mode: "generate",
        intent: {
          rawQuery: fallbackPrompt,
          intentType: "create",
          targetDomain: "3d",
          entities: [],
          constraints: [],
          confidence: 0.94,
          ambiguous: false,
          clarificationPrompt: null
        },
        userMessage: {
          id: `message-user-${Date.now()}`,
          role: "user",
          content: userContent,
          kind: "input",
          meta: [],
          createdAt: now,
          updatedAt: now
        },
        assistantMessage: {
          id: `message-assistant-${Date.now()}`,
          role: "assistant",
          content: sessionResponse.explanation,
          kind: "generate",
          meta: [],
          createdAt: now,
          updatedAt: now
        },
        sceneState: sessionResponse.sceneState,
        messages: [],
        result: sessionResponse
      };
    }

    throw error;
  }
}

export async function planEngineTasks(input: GenerateRequest): Promise<TaskPlanResponse> {
  try {
    return await requestJson<TaskPlanResponse>("/api/v1/tasks/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }, "Task planning request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return buildDevTaskPlan(input);
    }

    throw error;
  }
}

export async function executeEngineTask(planId: string, task: GveTask): Promise<TaskExecutionResponse> {
  try {
    return await requestJson<TaskExecutionResponse>("/api/v1/tasks/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId, task })
    }, "Task execution request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 450);
      });
      return buildDevTaskExecution(planId, task);
    }

    throw error;
  }
}

export async function undoScene(sessionId: string): Promise<UndoRedoResponse> {
  return requestJson<UndoRedoResponse>(`/api/v1/sessions/${sessionId}/undo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, "Undo request failed", 0);
}

export async function redoScene(sessionId: string): Promise<UndoRedoResponse> {
  return requestJson<UndoRedoResponse>(`/api/v1/sessions/${sessionId}/redo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, "Redo request failed", 0);
}

export async function previousArtifact(sessionId: string): Promise<UndoRedoResponse> {
  return requestJson<UndoRedoResponse>(`/api/v1/sessions/${sessionId}/artifacts/previous`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, "Previous artifact request failed", 0);
}

export async function nextArtifact(sessionId: string): Promise<UndoRedoResponse> {
  return requestJson<UndoRedoResponse>(`/api/v1/sessions/${sessionId}/artifacts/next`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, "Next artifact request failed", 0);
}

export async function listVersions(sessionId: string): Promise<VersionListResponse> {
  return requestJson<VersionListResponse>(`/api/v1/sessions/${sessionId}/versions`, {
    method: "GET"
  }, "Version list request failed");
}

export async function selectVersion(sessionId: string, versionId: string): Promise<UndoRedoResponse> {
  return requestJson<UndoRedoResponse>(`/api/v1/sessions/${sessionId}/versions/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ versionId })
  }, "Version selection request failed", 0);
}

// ═══════════════════════════════════════════════════════════════
// AGENTIC ITERATION & QUALITY SCORING (Phase 1)
// ═══════════════════════════════════════════════════════════════

export type GenerationMode = "one-shot" | "polish" | "agentic";
export type IterationStopReason = "threshold_met" | "budget_exhausted" | "unrecoverable" | "user_abort";

export interface StaticScore {
  syntaxValid: boolean;
  apiCompliant: boolean;
  securityPass: boolean;
  complexity: number; // lines of code
  score: number; // 0-100
}

export interface RuntimeScore {
  fps: number;
  frameStability: number; // variance of FPS
  memoryGrowthRate: number; // MB per second
  errorCount: number;
  warningCount: number;
  startupTimeMs: number;
  score: number; // 0-100
}

export interface VisualScore {
  materialRichness: number; // 0-10 (layers: diffuse, normal, roughness, etc)
  lightingLayers: number; // count of light types
  motionContinuity: number; // 0-10 (smoothness of animation)
  colorHarmony: number; // 0-10
  compositionScore: number; // 0-10
  score: number; // 0-100 weighted composite
}

export interface SemanticScore {
  intentFulfillment: number; // 0-100
  skillAppropriateness: number; // 0-100
  promptAdherence: number; // 0-100
  score: number; // 0-100
}

export interface QualitySignals {
  static: StaticScore;
  runtime: RuntimeScore;
  visual?: VisualScore;
  semantic?: SemanticScore;
  composite: number; // weighted total 0-100
}

export interface PatchGoal {
  id: string;
  category: "static" | "runtime" | "visual" | "semantic";
  severity: "critical" | "warning" | "suggestion";
  description: string;
  suggestedFix?: string;
}

export interface IterationState {
  iterationNumber: number;
  candidateCode: string;
  candidateSceneId: string;
  staticScore: StaticScore;
  runtimeScore: RuntimeScore;
  visualScore?: VisualScore;
  semanticScore?: SemanticScore;
  qualitySignals: QualitySignals;
  patchGoals?: PatchGoal[];
  generationDurationMs: number;
  validationDurationMs: number;
  stopReason?: IterationStopReason;
  isFinal: boolean;
  createdAt: string;
}

export interface QualityReport {
  finalScore: number;
  threshold: number;
  totalIterations: number;
  budgetUsed: number;
  budgetTotal: number;
  stopReason: IterationStopReason;
  scoreBreakdown: {
    static: number;
    runtime: number;
    visual: number;
    semantic: number;
  };
  improvements: Array<{
    iteration: number;
    scoreBefore: number;
    scoreAfter: number;
    changes: string[];
  }>;
}

export interface IterationPreferences {
  mode: GenerationMode;
  maxIterations: number; // default 3 for polish, 5 for agentic
  qualityThreshold: number; // default 85
  autoRepair: boolean; // whether to auto-apply patches
  showIterations: boolean; // show intermediate drafts
}

// Enhanced GenerateRequest with iteration support
export interface GenerateRequestV2 extends GenerateRequest {
  preferences?: {
    skill?: SkillPreference;
    quality?: "draft" | "standard" | "high";
    mode?: GenerationMode;
    maxIterations?: number;
    qualityThreshold?: number;
  };
}

// WebSocket Events for Iteration Progress
export interface IterationUpdateEvent {
  type: "iteration:update";
  payload: {
    sessionId: string;
    iteration: IterationState;
    progress: {
      current: number;
      total: number;
      phase: "generating" | "validating" | "scoring" | "patching";
    };
  };
}

// ═══════════════════════════════════════════════════════════════
// LINUX SANDBOX & TOOL REGISTRY (Phase 2)
// ═══════════════════════════════════════════════════════════════

export interface ToolDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  installCommand: string; // npm install command
  cdnUrl?: string; // fallback CDN if sandbox unavailable
  category: "core" | "utility" | "visual" | "audio" | "community";
  reputation: "official" | "verified" | "community";
  dependencies?: string[];
  sizeEstimateMb: number;
}

export interface ToolRegistryResponse {
  tools: ToolDefinition[];
  categories: string[];
}

export interface SandboxExecutionRequest {
  sessionId: string;
  code: string;
  skill: string;
  tools?: string[]; // Tool IDs to install
  budget: {
    maxDurationMs: number;
    maxMemoryMb: number;
    maxCpuPercent: number;
  };
  assets?: string[]; // URLs or artifact IDs to preload
  executionMode: "probe" | "full"; // probe = low budget test, full = final render
}

export interface SandboxMetrics {
  durationMs: number;
  memoryPeakMb: number;
  cpuAvgPercent: number;
  fpsAvg: number;
  fpsMin: number;
  fpsMax: number;
  frameCount: number;
  errorCount: number;
  warningCount: number;
  renderTimeMs: number;
}

export interface SandboxArtifact {
  type: "code" | "preview" | "log" | "metric" | "asset";
  name: string;
  path: string;
  sizeBytes: number;
  contentType: string;
  url: string; // signed URL for access
}

export interface SandboxExecutionResponse {
  success: boolean;
  executionId: string;
  previewUrl: string | null;
  artifacts: SandboxArtifact[];
  metrics: SandboxMetrics;
  logs: Array<{
    level: "debug" | "info" | "warn" | "error";
    message: string;
    timestamp: string;
    source?: string;
  }>;
  error?: string | null;
  errorDetails?: string | null;
}

export interface SandboxStatus {
  status: "pending" | "provisioning" | "running" | "completed" | "failed" | "cleaned_up";
  containerId?: string;
  resources: {
    cpuPercent: number;
    memoryUsedMb: number;
    diskUsedMb: number;
  };
  toolsInstalled: string[];
  uptimeSeconds: number;
}

// ═══════════════════════════════════════════════════════════════
// AUTONOMOUS AGENT & MULTI-AGENT (Phase 3 & 4)
// ═══════════════════════════════════════════════════════════════

export type AgentRole =
  | "orchestrator"
  | "scene_architect"
  | "material_designer"
  | "animator"
  | "optimizer"
  | "tester";

export interface AgentTask {
  id: string;
  role: AgentRole;
  taskType: "generate" | "validate" | "optimize" | "repair" | "review";
  description: string;
  inputArtifacts: string[]; // artifact IDs
  outputArtifacts: string[]; // artifact IDs
  dependencies: string[]; // task IDs that must complete first
  status: "pending" | "running" | "completed" | "failed";
  budget: {
    maxIterations: number;
    maxDurationMs: number;
  };
  result?: {
    success: boolean;
    score: number;
    notes: string[];
  };
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface MultiAgentWorkflow {
  workflowId: string;
  sessionId: string;
  intent: string;
  agents: AgentTask[];
  currentAgent?: AgentRole;
  overallProgress: number; // 0-100
  status: "planning" | "executing" | "reviewing" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
}

export interface AutonomousDecision {
  decisionType: "continue" | "patch" | "escalate" | "abort" | "request_clarification";
  reasoning: string;
  confidence: number; // 0-1
  action?: {
    type: string;
    parameters: Record<string, unknown>;
  };
  requiresApproval: boolean;
}

// API Functions for Agentic Features
export async function installTool(toolId: string): Promise<{ success: boolean; message: string }> {
  // Implementation would call backend to install tool in sandbox
  return { success: true, message: `Tool ${toolId} installed` };
}

export async function executeInSandbox(request: SandboxExecutionRequest): Promise<SandboxExecutionResponse> {
  // Implementation would call sandbox execution endpoint
  return requestJson<SandboxExecutionResponse>("/api/v1/sandbox/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  }, "Sandbox execution failed");
}

export async function getSandboxStatus(sessionId: string): Promise<SandboxStatus> {
  return requestJson<SandboxStatus>(`/api/v1/sessions/${sessionId}/sandbox/status`, {
    method: "GET"
  }, "Sandbox status request failed");
}

export async function listTools(): Promise<ToolRegistryResponse> {
  return requestJson<ToolRegistryResponse>("/api/v1/tools", {
    method: "GET"
  }, "Tool registry request failed");
}
