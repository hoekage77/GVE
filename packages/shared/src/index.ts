export interface GenerateRequest {
  query: string;
  sessionId?: string;
  preferences?: {
    skill?: "threejs" | "p5js" | "d3js" | "animejs" | "auto";
    quality?: "draft" | "standard" | "high";
  };
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
  content: string;
  preferences?: {
    skill?: "threejs" | "p5js" | "d3js" | "animejs" | "auto";
    quality?: "draft" | "standard" | "high";
  };
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
    status: "completed" | "timeout" | "error" | "skipped";
    previewUrl: string | null;
    skillId: string;
    skillName: string;
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
  preferences?: {
    skill?: "threejs" | "p5js" | "d3js" | "animejs" | "auto";
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
}

const USE_DEV_MOCKS = import.meta.env.DEV && import.meta.env.VITE_USE_API_MOCK === "1";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? "http://localhost:8000" : "");
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL ?? (import.meta.env.DEV ? "ws://localhost:8000" : "");

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  if (!API_BASE_URL) {
    return path;
  }

  return `${API_BASE_URL.replace(/\/$/, "")}${path}`;
}

export function resolveWebSocketUrl(path = "/ws"): string {
  if (WS_BASE_URL) {
    return `${WS_BASE_URL.replace(/\/$/, "")}${path}`;
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${path}`;
  }

  return `ws://localhost:8000${path}`;
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
    websocketUrl: "ws://localhost:8000/ws",
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
    ].join("\n")
  };

  return {
    sceneId,
    previewUrl: "about:blank",
    skill: selectedSkill,
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
        code: "// Dev fallback generated code",
        previewUrl: "about:blank",
        skill: selectedSkill,
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
          code: "// Dev fallback generated code",
          previewUrl: "about:blank",
          skill: selectedSkill,
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
    code: `${codeBySkill[selectedSkill] ?? codeBySkill.threejs}\n// Original prompt: ${input.query}`
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

    return !/\b(create|make|build|generate|design|draw|sketch|render|animate|modify|change|update|edit|explain|describe|walkthrough|scene|visual|image|3d|2d|canvas|diagram|chart|graph|data|cube|sphere|particle|color|rotation|spin|orbit|layout|lighting|material|shader|threejs|p5js|d3js|animejs|anime|timeline|tween|easing|mermaid)\b/.test(
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
      if (isConversationOnlyQuery(input.content)) {
        return buildDevChatMock(sessionId, input.content);
      }

      const now = new Date().toISOString();
      const sessionResponse = buildDevMock({ query: input.content, sessionId, preferences: input.preferences });

      return {
        sessionId,
        mode: "generate",
        intent: {
          rawQuery: input.content,
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
          content: input.content,
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
