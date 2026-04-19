import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import {
  createSession as apiCreateSession,
  modifyVisual as apiModifyVisual,
  type AgentActivityEvent,
  type GveTask,
  type GveTaskAction,
  type GveTaskStatus,
  listVersions,
  listSessionMessages,
  listSessions,
  nextArtifact,
  previousArtifact,
  redoScene,
  resolveWebSocketUrl,
  selectVersion,
  sendSessionMessage,
  undoScene,
  type SessionMessage as ApiSessionMessage,
  type SessionSceneState,
  type IterationState as SharedIterationState,
  type IterationUpdateEvent,
  type QualityReport,
  type IterationStopReason
} from '@visual-runtime/shared';
import type { ActionBlock, TaskCheckpoint } from '../types/actionBlocks';

const WS_RECONNECT_DELAY_MS = 750;
const WS_OPEN_WAIT_TIMEOUT_MS = 1200;

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let lastSequence = 0;
let shouldReplayOnReconnect = false;

const MAX_ACTIVITY_ENTRIES = 120;
const MAX_STAGE_EVENT_ENTRIES = 40;

const PIPELINE_ACTION_ORDER: ReadonlyArray<GveTaskAction> = [
  'parse_intent',
  'select_skill',
  'build_prompt',
  'generate_code',
  'validate_code',
  'execute_code',
  'sync_state'
];

const DEFAULT_TASK_DEFINITIONS: ReadonlyArray<{
  id: string;
  title: string;
  description: string;
  action: GveTaskAction;
  command: string;
  dependsOn: string[];
}> = [
  {
    id: 'task-parse-intent',
    title: 'Parse Intent',
    description: 'Extract action, entities, and constraints from user prompt.',
    action: 'parse_intent',
    command: 'parse_intent',
    dependsOn: []
  },
  {
    id: 'task-select-skill',
    title: 'Select Skill',
    description: 'Rank and choose the best visual generation skill.',
    action: 'select_skill',
    command: 'select_skill',
    dependsOn: ['task-parse-intent']
  },
  {
    id: 'task-build-prompt',
    title: 'Build Prompt',
    description: 'Compose structured generation instructions for the model.',
    action: 'build_prompt',
    command: 'build_prompt',
    dependsOn: ['task-select-skill']
  },
  {
    id: 'task-generate-code',
    title: 'Generate Code',
    description: 'Generate executable scene or media source code.',
    action: 'generate_code',
    command: 'generate_code',
    dependsOn: ['task-build-prompt']
  },
  {
    id: 'task-validate-code',
    title: 'Validate Code',
    description: 'Run validation checks for syntax and safety boundaries.',
    action: 'validate_code',
    command: 'validate_code',
    dependsOn: ['task-generate-code']
  },
  {
    id: 'task-provision-sandbox',
    title: 'Provision Sandbox',
    description: 'Acquire dedicated Daytona sandbox environment for runtime execution.',
    action: 'provision_sandbox',
    command: 'provision_sandbox',
    dependsOn: ['task-validate-code']
  },
  {
    id: 'task-analyze-quality',
    title: 'Multi-Agent Review',
    description: 'Trigger autonomous agent team for static and runtime quality analysis.',
    action: 'analyze_quality',
    command: 'analyze_quality',
    dependsOn: ['task-provision-sandbox']
  },
  {
    id: 'task-autonomous-patching',
    title: 'Autonomous Patching',
    description: 'Self-correct codebase iteratively using gathered quality signals.',
    action: 'autonomous_patching',
    command: 'autonomous_patching',
    dependsOn: ['task-analyze-quality']
  },
  {
    id: 'task-execute-code',
    title: 'Execute',
    description: 'Execute runtime workload in sandboxed environment.',
    action: 'execute_code',
    command: 'execute_code',
    dependsOn: ['task-autonomous-patching']
  },
  {
    id: 'task-sync-state',
    title: 'Sync State',
    description: 'Persist runtime output and update session scene state.',
    action: 'sync_state',
    command: 'sync_state',
    dependsOn: ['task-execute-code']
  }
];

const ORCHESTRATION_STEP_TO_ACTION: Record<string, GveTaskAction> = {
  turn_started: 'parse_intent',
  parse_intent: 'parse_intent',
  intent_parsed: 'parse_intent',
  select_skill: 'select_skill',
  skill_selected: 'select_skill',
  plan_created: 'build_prompt',
  build_prompt: 'build_prompt',
  generate_code: 'generate_code',
  code_generated: 'generate_code',
  code_modified: 'generate_code',
  validate_code: 'validate_code',
  validation_failed: 'validate_code',
  provision_sandbox: 'provision_sandbox',
  'sandbox:creating': 'provision_sandbox',
  analyze_quality: 'analyze_quality',
  'sandbox:analyzing': 'analyze_quality',
  autonomous_patching: 'autonomous_patching',
  'sandbox:patching': 'autonomous_patching',
  execute_code: 'execute_code',
  executing: 'execute_code',
  'sandbox:executing': 'execute_code',
  execution_skipped: 'execute_code',
  sync_state: 'sync_state',
  turn_complete: 'sync_state',
  turn_error: 'sync_state'
};

function nowIso(): string {
  return new Date().toISOString();
}

function cloneDefaultTasks(): GveTask[] {
  return DEFAULT_TASK_DEFINITIONS.map((task) => ({
    ...task,
    dependsOn: [...task.dependsOn],
    status: 'pending'
  }));
}

function normalizeTaskStatus(value: unknown, fallback: GveTaskStatus = 'running'): GveTaskStatus {
  if (value === 'pending' || value === 'running' || value === 'completed' || value === 'failed') {
    return value;
  }
  return fallback;
}

function createEmptyStageEventMap(): StageEventMap {
  const map = {} as StageEventMap;
  for (const action of PIPELINE_ACTION_ORDER) {
    map[action] = [];
  }
  return map;
}

function normalizeStageEventMap(value: unknown): StageEventMap {
  const fallback = createEmptyStageEventMap();
  if (!value || typeof value !== 'object') {
    return fallback;
  }

  const map = value as Partial<Record<GveTaskAction, StageEventEntry[]>>;
  return {
    parse_intent: Array.isArray(map.parse_intent) ? map.parse_intent : fallback.parse_intent,
    select_skill: Array.isArray(map.select_skill) ? map.select_skill : fallback.select_skill,
    build_prompt: Array.isArray(map.build_prompt) ? map.build_prompt : fallback.build_prompt,
    generate_code: Array.isArray(map.generate_code) ? map.generate_code : fallback.generate_code,
    validate_code: Array.isArray(map.validate_code) ? map.validate_code : fallback.validate_code,
    execute_code: Array.isArray(map.execute_code) ? map.execute_code : fallback.execute_code,
    sync_state: Array.isArray(map.sync_state) ? map.sync_state : fallback.sync_state
  };
}

function appendStageEvent(
  map: StageEventMap,
  action: GveTaskAction,
  entry: StageEventEntry
): StageEventMap {
  const existing = map[action] ?? [];
  const duplicate = existing.some((item) =>
    item.source === entry.source
    && item.step === entry.step
    && item.status === entry.status
    && item.text === entry.text
    && item.detail === entry.detail
  );

  if (duplicate) {
    return map;
  }

  return {
    ...map,
    [action]: [...existing, entry].slice(-MAX_STAGE_EVENT_ENTRIES)
  };
}

function formatStepTitle(step: string | null | undefined): string {
  if (!step) {
    return 'Pipeline';
  }

  return step.replace(/_/g, ' ');
}

function formatOrchestrationEventText(step: string | null | undefined, status: GveTaskStatus): string {
  const title = formatStepTitle(step);

  if (status === 'completed') {
    return `${title} completed`;
  }
  if (status === 'failed') {
    return `${title} failed`;
  }
  if (status === 'pending') {
    return `${title} pending`;
  }

  return `${title} running`;
}

function formatPayloadValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const compact = value
      .map((item) => formatPayloadValue(item))
      .filter((item): item is string => Boolean(item))
      .slice(0, 3);
    if (compact.length === 0) {
      return null;
    }
    return compact.join(', ');
  }

  if (typeof value === 'object') {
    const serialized = JSON.stringify(value);
    return serialized.length > 140 ? `${serialized.slice(0, 137)}...` : serialized;
  }

  return null;
}

function formatOrchestrationEventDetail(payload: Record<string, unknown> | null): string | null {
  if (!payload) {
    return null;
  }

  const detailKeys: ReadonlyArray<[string, string]> = [
    ['selectedSkill', 'skill'],
    ['source', 'source'],
    ['mode', 'mode'],
    ['status', 'status'],
    ['stageDurationMs', 'duration'],
    ['runtimeRecoveryUsed', 'recovery'],
    ['retriedAfterNoop', 'retry'],
    ['noopReason', 'noop'],
    ['valid', 'valid'],
    ['passable', 'passable'],
    ['runtimeId', 'runtime'],
    ['error', 'error'],
    ['errors', 'errors']
  ];

  const parts: string[] = [];
  for (const [key, label] of detailKeys) {
    const raw = payload[key];
    const formatted = formatPayloadValue(raw);
    if (!formatted) {
      continue;
    }

    if (label === 'duration' && /^\d+$/.test(formatted)) {
      parts.push(`${label}:${formatted}ms`);
      continue;
    }

    parts.push(`${label}:${formatted}`);
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.slice(0, 4).join(' • ');
}

function findRunningStageAction(tasks: GveTask[]): GveTaskAction | null {
  const runningTask = tasks.find((task) => task.status === 'running');
  return runningTask?.action ?? null;
}

function resolveActiveStageAction(
  currentAction: GveTaskAction | null,
  updatedTasks: GveTask[],
  action: GveTaskAction | null,
  status: GveTaskStatus
): GveTaskAction | null {
  if (!action) {
    return findRunningStageAction(updatedTasks) ?? currentAction;
  }

  if (status === 'running' || status === 'failed') {
    return action;
  }

  if (status === 'completed') {
    return findRunningStageAction(updatedTasks);
  }

  return currentAction;
}

function mapStepToAction(step: string | null | undefined): GveTaskAction | null {
  if (!step) {
    return null;
  }
  return ORCHESTRATION_STEP_TO_ACTION[step] ?? null;
}

function applyStepStatusToTasks(tasks: GveTask[], step: string | null | undefined, status: GveTaskStatus): GveTask[] {
  const action = mapStepToAction(step);
  if (!action) {
    return tasks;
  }

  const targetIndex = tasks.findIndex((task) => task.action === action);
  if (targetIndex === -1) {
    return tasks;
  }

  return tasks.map((task, index) => {
    if (index < targetIndex && (task.status === 'pending' || task.status === 'running')) {
      return { ...task, status: 'completed' };
    }

    if (index === targetIndex) {
      return { ...task, status };
    }

    return task;
  });
}

function statusToStep(status: Session['status'] | undefined): string | null {
  switch (status) {
    case 'parsing':
      return 'parse_intent';
    case 'selecting':
      return 'select_skill';
    case 'generating':
      return 'generate_code';
    case 'executing':
      return 'execute_code';
    default:
      return null;
  }
}

function isMediaScene(scene: Session['currentScene'] | null | undefined): boolean {
  if (!scene) {
    return false;
  }

  return scene.outputKind === 'media'
    || (typeof scene.mediaType === 'string' && scene.mediaType.startsWith('video/'))
    || scene.skill === 'manim';
}

function hasMediaUrl(scene: Session['currentScene'] | null | undefined): boolean {
  const mediaUrl = typeof scene?.mediaUrl === 'string' ? scene.mediaUrl.trim() : '';
  return mediaUrl.length > 0 && mediaUrl !== 'about:blank';
}

function normalizeTaskList(tasks: unknown): GveTask[] {
  if (!Array.isArray(tasks)) {
    return cloneDefaultTasks();
  }

  const normalized = tasks
    .filter((task): task is GveTask => Boolean(task && typeof task === 'object'))
    .map((task) => ({
      ...task,
      status: normalizeTaskStatus(task.status, 'pending')
    }));

  return normalized.length > 0 ? normalized : cloneDefaultTasks();
}

export type Session = SessionSceneState;
export type LiveConnectionState = 'connecting' | 'open' | 'closed' | 'error';
export type SceneHistoryCommand = 'undo' | 'redo' | 'artifact.previous' | 'artifact.next' | 'version.previous' | 'version.next';
export type WorkspacePanelView = 'preview' | 'code' | 'files';
export type TurnLifecycleStatus = 'idle' | 'running' | 'completed' | 'failed';
export type MediaLifecycleStage = 'idle' | 'queued' | 'generating' | 'executing' | 'syncing' | 'ready' | 'error';

const PANEL_WIDTH_RATIO_BY_VIEW: Record<WorkspacePanelView, number> = {
  preview: 0.6,
  code: 0.6,
  files: 0.44,
};

function getPanelWidthPreset(view: WorkspacePanelView): number {
  const fallbackByView: Record<WorkspacePanelView, number> = {
    preview: 840,
    code: 840,
    files: 620,
  };

  if (typeof window === 'undefined') {
    return fallbackByView[view];
  }

  const viewportWidth = window.innerWidth;
  const minimumWidthByView: Record<WorkspacePanelView, number> = {
    preview: 360,
    code: 360,
    files: 360,
  };
  const minimumWidth = minimumWidthByView[view] ?? 360;
  const preservedChatWidth = viewportWidth < 980 ? 280 : 360;
  // was view tasks
  const maxWidth = Math.max(minimumWidth, viewportWidth - preservedChatWidth);
  const ratio = PANEL_WIDTH_RATIO_BY_VIEW[view] ?? 0.42;
  const proposed = Math.round(viewportWidth * ratio);

  return Math.max(minimumWidth, Math.min(proposed, maxWidth));
}

export interface LiveThoughtState {
  text: string;
  step: string;
  updatedAt: string;
  requestId?: string | null;
  messageId?: string | null;
}

export interface StageEventEntry {
  id: string;
  source: 'orchestration' | 'activity' | 'task' | 'error';
  step: string;
  status: GveTaskStatus;
  text: string;
  detail: string | null;
  createdAt: string;
}

export type StageEventMap = Record<GveTaskAction, StageEventEntry[]>;

export interface SessionTaskProgress {
  sessionId: string;
  planId: string | null;
  tasks: GveTask[];
  activities: AgentActivityEvent[];
  stageEventsByAction: StageEventMap;
  activeStageAction: GveTaskAction | null;
  currentStep: string | null;
  currentStepStatus: GveTaskStatus | null;
  liveThought: LiveThoughtState | null;
  turnStatus: TurnLifecycleStatus;
  activeRequestId: string | null;
  mediaStage: MediaLifecycleStage;
  mediaStatusText: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
  lastUpdatedAt: string;
  lastTerminalAt: string | null;
}

function createDefaultTaskProgress(sessionId: string): SessionTaskProgress {
  const timestamp = nowIso();
  return {
    sessionId,
    planId: null,
    tasks: cloneDefaultTasks(),
    activities: [],
    stageEventsByAction: createEmptyStageEventMap(),
    activeStageAction: null,
    currentStep: null,
    currentStepStatus: null,
    liveThought: null,
    turnStatus: 'idle',
    activeRequestId: null,
    mediaStage: 'idle',
    mediaStatusText: null,
    mediaType: null,
    mediaUrl: null,
    lastUpdatedAt: timestamp,
    lastTerminalAt: null
  };
}

function updateTaskProgressMap(
  map: Record<string, SessionTaskProgress>,
  sessionId: string,
  updater: (current: SessionTaskProgress) => SessionTaskProgress
): Record<string, SessionTaskProgress> {
  const fallback = createDefaultTaskProgress(sessionId);
  const currentRaw = map[sessionId];
  const current = currentRaw
    ? {
        ...fallback,
        ...currentRaw,
        tasks: Array.isArray(currentRaw.tasks) ? currentRaw.tasks : fallback.tasks,
        activities: Array.isArray(currentRaw.activities) ? currentRaw.activities : fallback.activities,
        stageEventsByAction: normalizeStageEventMap(currentRaw.stageEventsByAction)
      }
    : fallback;
  const next = updater(current);

  return {
    ...map,
    [sessionId]: {
      ...next,
      sessionId,
      lastUpdatedAt: nowIso()
    }
  };
}

function patchTaskProgressFromScene(
  current: SessionTaskProgress,
  session: Session
): SessionTaskProgress {
  const next = {
    ...current,
    stageEventsByAction: normalizeStageEventMap(current.stageEventsByAction)
  };
  const scene = session.currentScene;

  if (isMediaScene(scene)) {
    next.mediaType = scene?.mediaType ?? next.mediaType;
    next.mediaUrl = hasMediaUrl(scene) ? scene?.mediaUrl ?? null : null;
    if (hasMediaUrl(scene)) {
      next.mediaStage = 'ready';
      next.mediaStatusText = 'Video artifact is ready to preview.';
    } else if (next.turnStatus === 'running') {
      next.mediaStage = next.mediaStage === 'idle' ? 'syncing' : next.mediaStage;
      if (!next.mediaStatusText) {
        next.mediaStatusText = 'Runtime output is syncing.';
      }
    } else {
      next.mediaStage = 'error';
      next.mediaStatusText = 'Video artifact is unavailable for this run.';
    }
  } else if (next.turnStatus === 'idle') {
    next.mediaStage = 'idle';
    next.mediaStatusText = null;
    next.mediaType = null;
    next.mediaUrl = null;
  }

  if (session.status && session.status !== 'idle' && next.turnStatus === 'idle') {
    const derivedStep = statusToStep(session.status);
    next.turnStatus = 'running';
    next.currentStep = derivedStep ?? next.currentStep;
    next.currentStepStatus = next.currentStepStatus ?? 'running';
    if (derivedStep) {
      next.tasks = applyStepStatusToTasks(next.tasks, derivedStep, 'running');
      next.activeStageAction = mapStepToAction(derivedStep);
    }
  }

  if (Array.isArray(session.orchestrationTrace) && session.orchestrationTrace.length > 0) {
    for (const trace of session.orchestrationTrace) {
      const step = typeof trace.step === 'string' ? trace.step : null;
      const tracePayload = trace.payload && typeof trace.payload === 'object'
        ? (trace.payload as { status?: unknown })
        : null;
      const status = normalizeTaskStatus(tracePayload?.status, 'running');

      next.tasks = applyStepStatusToTasks(next.tasks, step, status);
      if (step) {
        next.currentStep = step;
        next.currentStepStatus = status;
      }

      if (step === 'turn_error') {
        next.turnStatus = 'failed';
      } else if (step === 'turn_complete') {
        next.turnStatus = 'completed';
      }
    }
  }

  if (next.turnStatus === 'running') {
    next.activeStageAction = mapStepToAction(next.currentStep) ?? findRunningStageAction(next.tasks);
  } else if (next.turnStatus === 'failed') {
    next.activeStageAction = mapStepToAction(next.currentStep) ?? next.activeStageAction;
  } else {
    next.activeStageAction = null;
  }

  return next;
}

function reconcileTaskProgressMap(
  existing: Record<string, SessionTaskProgress>,
  sessions: Session[]
): Record<string, SessionTaskProgress> {
  const next: Record<string, SessionTaskProgress> = {};

  for (const session of sessions) {
    const baseline = existing[session.sessionId] ?? createDefaultTaskProgress(session.sessionId);
    next[session.sessionId] = patchTaskProgressFromScene(baseline, session);
  }

  return next;
}

function sortSessionsByUpdatedAt(sessions: Session[]): Session[] {
  return [...sessions].sort((left, right) => {
    const leftTimestamp = new Date(left.updatedAt ?? 0).getTime();
    const rightTimestamp = new Date(right.updatedAt ?? 0).getTime();
    return rightTimestamp - leftTimestamp;
  });
}

function normalizeMessage(message: ApiSessionMessage): SessionMessage {
  const now = new Date().toISOString();
  return {
    id: message.id,
    role: message.role,
    content: message.content ?? '',
    kind: message.kind,
    meta: Array.isArray(message.meta) ? message.meta : [],
    error: message.error ?? null,
    createdAt: message.createdAt ?? now,
    updatedAt: message.updatedAt ?? message.createdAt ?? now
  };
}

function upsertMessage(messages: SessionMessage[], message: SessionMessage): SessionMessage[] {
  const existingIndex = messages.findIndex((item) => item.id === message.id);
  if (existingIndex === -1) {
    return [...messages, message];
  }

  const nextMessages = [...messages];
  nextMessages[existingIndex] = {
    ...nextMessages[existingIndex],
    ...message,
    meta: message.meta ?? nextMessages[existingIndex].meta
  };
  return nextMessages;
}

function mergeMessages(existing: SessionMessage[], incoming: SessionMessage[]): SessionMessage[] {
  return incoming.reduce((messages, message) => upsertMessage(messages, message), existing);
}

function upsertSession(sessions: Session[], session: Session): Session[] {
  const existingIndex = sessions.findIndex((item) => item.sessionId === session.sessionId);
  if (existingIndex === -1) {
    return sortSessionsByUpdatedAt([session, ...sessions]);
  }

  const nextSessions = [...sessions];
  nextSessions[existingIndex] = session;
  return sortSessionsByUpdatedAt(nextSessions);
}

function createClientMessageId(prefix: string): string {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  return `${prefix}-${randomId}`;
}

function isThoughtMessage(message: SessionMessage): boolean {
  return message.role === 'thought' || message.kind === 'thought';
}

export type SessionMessage = ApiSessionMessage;

export interface ComposerImageAttachment {
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
  previewUrl: string;
}

// UI Iteration State - wrapper for displaying iteration progress
export interface UIIterationState {
  isIterating: boolean;
  currentIteration: number;
  maxIterations: number;
  currentScore: number;
  threshold: number;
  phase: "generating" | "validating" | "scoring" | "patching" | "finalizing";
  iterations: SharedIterationState[];
  qualityReport: QualityReport | null;
  stopReason: IterationStopReason | null;
  sessionId: string;
}

// Agent Analysis State
export interface AgentResult {
  id: string;
  name: string;
  score: number; // 0-100 confidence
  findings: string[]; // Top 2-3 key findings
  recommendations: Array<{
    action: string;
    impact: number; // 0-20 (potential score improvement)
    confidence: number; // 0-100
    category: 'structure' | 'performance' | 'visual' | 'api' | 'safety';
  }>;
}

export interface UIAgentState {
  isAnalyzing: boolean;
  results: Record<string, AgentResult>; // architect, materialDesigner, animator, optimizer, tester
  consensus: number; // 0-100 (% agents agreeing)
  shouldAutoApply: boolean; // true if consensus >= 80
  recommendations: Array<{
    agentId: string;
    action: string;
    impact: number;
    confidence: number;
    category: string;
    priority: number;
  }>;
  memory: Array<{
    iteration: number;
    pattern: string;
    frequency: number;
    resolved: boolean;
  }>;
  lastAnalyzedAt: string | null;
}

interface ChatState {
  // Sessions
  sessions: Session[];
  activeSessionId: string | null;
  hasInitialized: boolean;
  isBootstrapping: boolean;
  sessionsError: string | null;
  
  // Messages by session
  messages: Record<string, SessionMessage[]>;

  // Session task progress
  taskProgressBySession: Record<string, SessionTaskProgress>;
  
  // Action Blocks (per message, keyed by messageId)
  actionBlocksByMessage: Record<string, ActionBlock[]>;
  currentTurnCheckpoints: TaskCheckpoint[];
  currentMessageId: string | null;
  
  // UI State
  connectionState: LiveConnectionState;
  isSending: boolean;
  activeRequestId: string | null;
  thinkingText: string | null;
  thinkingStep: string;
  showScrollToLatest: boolean;
  iterationState: UIIterationState | null;
  agentState: UIAgentState | null;
  
  // Workspace Panel State (new simplified system)
  panelOpen: boolean;
  panelView: WorkspacePanelView | null;
  panelWidth: number;
  
  // Composer
  composerValue: string;
  composerImage: ComposerImageAttachment | null;
  isSlashMenuOpen: boolean;
  
  // Actions
  initialize: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  createNewSession: () => Promise<Session | null>;
  selectSession: (sessionId: string) => Promise<void>;
  loadSessionMessages: (sessionId: string) => Promise<void>;
  sendMessage: (content?: string, options?: { mode?: 'modify' | 'generate' }) => Promise<void>;
  sendSceneCommand: (command: SceneHistoryCommand) => Promise<void>;
  selectSceneVersion: (versionId: string) => Promise<boolean>;
  rerunScene: (options?: { codeOverride?: string | null }) => Promise<boolean>;
  stopTurn: () => void;
  connectWebSocket: () => void;
  startDraftSession: () => void;
  setActiveSession: (sessionId: string | null) => void;
  addSession: (session: Session) => void;
  addMessage: (sessionId: string, message: SessionMessage) => void;
  setIsSending: (value: boolean) => void;
  setThinking: (text: string | null, step?: string) => void;
  setComposerValue: (value: string) => void;
  setComposerImage: (image: ComposerImageAttachment | null) => void;
  clearComposerImage: () => void;
  
  // Panel Actions (new)
  openPanel: (view: WorkspacePanelView) => void;
  closePanel: () => void;
  togglePanel: (view: WorkspacePanelView) => void;
  setPanelWidth: (width: number) => void;
  
  // Iteration Actions
  updateIterationState: (state: UIIterationState | null) => void;
  abortIteration: () => void;
  
  // Agent Actions
  updateAgentState: (state: UIAgentState | null) => void;
  setAgentAnalyzing: (isAnalyzing: boolean) => void;
  clearAgentState: () => void;
  
  // Action Block Actions
  setActionBlocks: (messageId: string, blocks: ActionBlock[]) => void;
  updateActionBlock: (messageId: string, blockId: string, updates: Partial<ActionBlock>) => void;
  setCurrentTurnCheckpoints: (checkpoints: TaskCheckpoint[]) => void;
  setCurrentMessageId: (messageId: string | null) => void;
  clearActionBlocks: (messageId: string) => void;
  
  clearSession: (sessionId: string) => void;
}

export const useChatStore = create<ChatState>()(
  devtools(
    persist(
      (set, get) => ({
        initialize: async () => {
          if (get().isBootstrapping) {
            return;
          }

          if (get().hasInitialized) {
            get().connectWebSocket();
            return;
          }

          set({ isBootstrapping: true, sessionsError: null });

          try {
            await get().refreshSessions();
            set({ hasInitialized: true });
          } catch {
            // refreshSessions records the user-facing error.
          } finally {
            set({ isBootstrapping: false });
            get().connectWebSocket();
          }
        },

        refreshSessions: async () => {
          try {
            const response = await listSessions();
            const sessions = sortSessionsByUpdatedAt(response.sessions ?? []);
            const currentActiveSessionId = get().activeSessionId;
            const nextActiveSessionId = currentActiveSessionId && sessions.some((session) => session.sessionId === currentActiveSessionId)
              ? currentActiveSessionId
              : sessions[0]?.sessionId ?? null;

            set((state) => ({
              sessions,
              activeSessionId: nextActiveSessionId,
              sessionsError: null,
              taskProgressBySession: reconcileTaskProgressMap(state.taskProgressBySession, sessions)
            }));

            if (nextActiveSessionId) {
              const hasMessages = (get().messages[nextActiveSessionId] ?? []).length > 0;
              if (!hasMessages) {
                await get().loadSessionMessages(nextActiveSessionId);
              }
            }
          } catch (error) {
            set({
              sessionsError: error instanceof Error ? error.message : 'Unable to load sessions.'
            });
            throw error;
          }
        },

        createNewSession: async () => {
          try {
            const response = await apiCreateSession();
            const session = response.sceneState;

            set((state) => ({
              sessions: upsertSession(state.sessions, session),
              activeSessionId: response.sessionId,
              sessionsError: null,
              taskProgressBySession: {
                ...state.taskProgressBySession,
                [response.sessionId]: createDefaultTaskProgress(response.sessionId)
              },
              messages: {
                ...state.messages,
                [response.sessionId]: state.messages[response.sessionId] ?? []
              }
            }));

            get().connectWebSocket();
            return session;
          } catch (error) {
            set({
              sessionsError: error instanceof Error ? error.message : 'Unable to create a new session.'
            });
            return null;
          }
        },

        selectSession: async (sessionId) => {
          const nextProgress = get().taskProgressBySession[sessionId] ?? null;

          set({
            activeSessionId: sessionId,
            sessionsError: null,
            isSending: nextProgress?.turnStatus === 'running',
            activeRequestId: nextProgress?.activeRequestId ?? null,
            thinkingText: nextProgress?.liveThought?.text ?? null,
            thinkingStep: nextProgress?.liveThought?.step ?? nextProgress?.currentStep ?? 'turn_started',
            composerImage: null
          });

          const hasMessages = (get().messages[sessionId] ?? []).length > 0;
          if (!hasMessages) {
            await get().loadSessionMessages(sessionId);
          }
        },

        loadSessionMessages: async (sessionId) => {
          try {
            const response = await listSessionMessages(sessionId);
            const normalizedMessages = (response.messages ?? []).map(normalizeMessage);
            set((state) => ({
              messages: {
                ...state.messages,
                [sessionId]: normalizedMessages
              },
              taskProgressBySession: state.taskProgressBySession[sessionId]
                ? state.taskProgressBySession
                : {
                    ...state.taskProgressBySession,
                    [sessionId]: createDefaultTaskProgress(sessionId)
                  }
            }));
          } catch (error) {
            set({
              sessionsError: error instanceof Error ? error.message : 'Unable to load session messages.'
            });
          }
        },

        sendMessage: async (content, options) => {
          const currentState = get();
          const input = (content ?? currentState.composerValue).trim();
          const attachedImage = currentState.composerImage;
          const imageData = attachedImage?.dataBase64 ?? null;
          const hasImage = Boolean(imageData);

          if ((!input && !hasImage) || currentState.isSending) {
            return;
          }
          const requestedMode = options?.mode;

          let sessionId = get().activeSessionId;
          if (!sessionId) {
            const createdSession = await get().createNewSession();
            sessionId = createdSession?.sessionId ?? null;
          }

          if (!sessionId) {
            set({ sessionsError: 'Unable to create a chat session.' });
            return;
          }

          const requestId = createClientMessageId('client');
          const now = new Date().toISOString();
          const optimisticUserMessage: SessionMessage = {
            id: requestId,
            role: 'user',
            content: input || 'Attached an image.',
            kind: 'input',
            meta: [
              `clientMessageId:${requestId}`,
              `requestId:${requestId}`,
              ...(hasImage ? ['attachment:image'] : [])
            ],
            error: null,
            createdAt: now,
            updatedAt: now
          };

          const initialMediaStatusText = hasImage
            ? 'Preparing image analysis pipeline...'
            : 'Preparing runtime pipeline...';

          set((state) => ({
            composerValue: '',
            composerImage: null,
            isSending: true,
            activeRequestId: requestId,
            thinkingText: 'Analyzing your request...',
            thinkingStep: 'parse_intent',
            sessionsError: null,
            messages: {
              ...state.messages,
              [sessionId!]: upsertMessage(state.messages[sessionId!] ?? [], optimisticUserMessage)
            },
            taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId!, (current) => ({
              ...current,
              planId: null,
              tasks: applyStepStatusToTasks(cloneDefaultTasks(), 'parse_intent', 'running'),
              activities: [],
              stageEventsByAction: appendStageEvent(
                createEmptyStageEventMap(),
                'parse_intent',
                {
                  id: createClientMessageId('stage-parse'),
                  source: 'activity',
                  step: 'parse_intent',
                  status: 'running',
                  text: 'Analyzing your request...',
                  detail: hasImage ? 'mode:image-input' : 'mode:text-input',
                  createdAt: now
                }
              ),
              activeStageAction: 'parse_intent',
              currentStep: 'parse_intent',
              currentStepStatus: 'running',
              liveThought: {
                text: 'Analyzing your request...',
                step: 'parse_intent',
                updatedAt: now,
                requestId
              },
              turnStatus: 'running',
              activeRequestId: requestId,
              mediaStage: 'queued',
              mediaStatusText: initialMediaStatusText,
              mediaType: null,
              mediaUrl: null,
              lastTerminalAt: null
            }))
          }));

          const ensureSocketOpen = async (): Promise<WebSocket | null> => {
            if (typeof window === 'undefined') {
              return null;
            }

            const currentSocket = socket;
            if (currentSocket && currentSocket.readyState === WebSocket.OPEN) {
              return currentSocket;
            }

            get().connectWebSocket();

            const candidateSocket = socket;
            if (!candidateSocket) {
              return null;
            }

            if (candidateSocket.readyState === WebSocket.OPEN) {
              return candidateSocket;
            }

            if (candidateSocket.readyState !== WebSocket.CONNECTING) {
              return null;
            }

            return await new Promise<WebSocket | null>((resolve) => {
              let settled = false;

              const finish = (value: WebSocket | null) => {
                if (settled) {
                  return;
                }
                settled = true;
                candidateSocket.removeEventListener('open', handleOpen);
                candidateSocket.removeEventListener('error', handleCloseOrError);
                candidateSocket.removeEventListener('close', handleCloseOrError);
                resolve(value);
              };

              const handleOpen = () => finish(candidateSocket);
              const handleCloseOrError = () => finish(null);

              candidateSocket.addEventListener('open', handleOpen);
              candidateSocket.addEventListener('error', handleCloseOrError);
              candidateSocket.addEventListener('close', handleCloseOrError);

              window.setTimeout(() => {
                finish(candidateSocket.readyState === WebSocket.OPEN ? candidateSocket : null);
              }, WS_OPEN_WAIT_TIMEOUT_MS);
            });
          };

          const activeSocket = await ensureSocketOpen();
          if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
            const payload: Record<string, unknown> = {
              sessionId,
              content: input,
              clientMessageId: requestId,
              requestId,
              idempotencyKey: requestId
            };

            if (requestedMode) {
              payload.mode = requestedMode;
            }

            if (imageData) {
              payload.imageData = imageData;
            }

            activeSocket.send(
              JSON.stringify({
                type: 'message.send',
                payload
              })
            );
            return;
          }

          try {
            const response = await sendSessionMessage(sessionId, {
              content: input,
              imageData: imageData ?? undefined
            });
            const incomingMessages = (response.messages ?? []).map(normalizeMessage);
            const mediaReady = isMediaScene(response.sceneState.currentScene) && hasMediaUrl(response.sceneState.currentScene);
            const mediaPending = isMediaScene(response.sceneState.currentScene) && !mediaReady;
            const completionTimestamp = nowIso();

            set((state) => ({
              sessions: upsertSession(state.sessions, response.sceneState),
              messages: {
                ...state.messages,
                [sessionId!]: mergeMessages(state.messages[sessionId!] ?? [], incomingMessages)
              },
              isSending: false,
              activeRequestId: null,
              thinkingText: null,
              thinkingStep: 'turn_complete',
              taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId!, (current) => ({
                ...patchTaskProgressFromScene(current, response.sceneState),
                tasks: applyStepStatusToTasks(current.tasks, 'turn_complete', 'completed'),
                activeStageAction: null,
                currentStep: 'turn_complete',
                currentStepStatus: 'completed',
                turnStatus: 'completed',
                activeRequestId: null,
                liveThought: null,
                mediaStage: mediaReady ? 'ready' : mediaPending ? 'syncing' : 'idle',
                mediaStatusText: mediaReady
                  ? 'Video artifact is ready to preview.'
                  : mediaPending
                    ? 'Runtime output is syncing.'
                    : null,
                lastTerminalAt: completionTimestamp
              }))
            }));
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unable to send message.';
            const errorTimestamp = new Date().toISOString();
            const assistantError: SessionMessage = {
              id: createClientMessageId('error'),
              role: 'assistant',
              content: errorMessage,
              kind: 'error',
              meta: [`error:${errorMessage}`],
              error: null,
              createdAt: errorTimestamp,
              updatedAt: errorTimestamp
            };

            set((state) => ({
              sessionsError: errorMessage,
              isSending: false,
              activeRequestId: null,
              thinkingText: null,
              thinkingStep: 'turn_error',
              messages: {
                ...state.messages,
                [sessionId!]: upsertMessage(state.messages[sessionId!] ?? [], assistantError)
              },
              taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId!, (current) => ({
                ...current,
                tasks: applyStepStatusToTasks(current.tasks, 'turn_error', 'failed'),
                activeStageAction: mapStepToAction(current.currentStep) ?? mapStepToAction('turn_error'),
                currentStep: 'turn_error',
                currentStepStatus: 'failed',
                turnStatus: 'failed',
                activeRequestId: null,
                liveThought: {
                  text: errorMessage,
                  step: 'turn_error',
                  updatedAt: errorTimestamp
                },
                mediaStage: current.mediaStage === 'ready' ? 'ready' : 'error',
                mediaStatusText: errorMessage,
                lastTerminalAt: errorTimestamp
              }))
            }));
          }
        },

        sendSceneCommand: async (command) => {
          const sessionId = get().activeSessionId;
          if (!sessionId) {
            return;
          }

          try {
            let response: { sceneState: Session } | null = null;

            if (command === 'undo') {
              response = await undoScene(sessionId);
            } else if (command === 'redo') {
              response = await redoScene(sessionId);
            } else if (command === 'artifact.previous') {
              response = await previousArtifact(sessionId);
            } else if (command === 'artifact.next') {
              response = await nextArtifact(sessionId);
            } else if (command === 'version.previous' || command === 'version.next') {
              const selectedSession = get().sessions.find((session) => session.sessionId === sessionId) ?? null;

              if (!selectedSession) {
                return;
              }

              let versions = Array.isArray(selectedSession.versions) ? selectedSession.versions : [];
              let versionPointer = typeof selectedSession.versionPointer === 'number' ? selectedSession.versionPointer : -1;

              if (versions.length === 0) {
                const versionList = await listVersions(sessionId);
                const currentVersionId = selectedSession.currentScene?.versionId ?? null;
                const listedCurrentIndex = versionList.versions.findIndex((version) =>
                  version.isCurrent
                  || (currentVersionId ? version.versionId === currentVersionId : false)
                );

                const mergedSession: Session = {
                  ...selectedSession,
                  versionCount: versionList.versionCount,
                  versionPointer: versionList.versionPointer,
                  revisionCount: versionList.revisionCount,
                  revisionPointer: versionList.revisionPointer,
                  artifactCount: versionList.artifactCount,
                  artifactPointer: versionList.artifactPointer,
                  currentArtifactId: versionList.currentArtifactId,
                  versions: versionList.versions,
                  sceneVersions: versionList.versions,
                  artifacts: versionList.artifacts ?? selectedSession.artifacts,
                  currentScene: listedCurrentIndex >= 0
                    ? versionList.versions[listedCurrentIndex]
                    : selectedSession.currentScene
                };

                set((state) => ({
                  sessions: upsertSession(state.sessions, mergedSession),
                  sessionsError: null,
                  taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, mergedSession.sessionId, (current) =>
                    patchTaskProgressFromScene(current, mergedSession)
                  )
                }));

                versions = versionList.versions;
                versionPointer = versionList.versionPointer;
              }

              if (versions.length <= 1) {
                return;
              }

              if (versionPointer < 0 || versionPointer >= versions.length) {
                const selectedSessionLatest = get().sessions.find((session) => session.sessionId === sessionId) ?? selectedSession;
                const currentVersionId = selectedSessionLatest.currentScene?.versionId ?? null;
                versionPointer = versions.findIndex((version) =>
                  currentVersionId
                    ? version.versionId === currentVersionId
                    : (version as { isCurrent?: boolean }).isCurrent === true
                );
              }

              if (versionPointer < 0) {
                return;
              }

              const nextPointer = command === 'version.previous' ? versionPointer - 1 : versionPointer + 1;
              if (nextPointer < 0 || nextPointer >= versions.length) {
                return;
              }

              const targetVersion = versions[nextPointer];
              response = await selectVersion(sessionId, targetVersion.versionId);
            }

            const nextSceneState = response?.sceneState;
            if (!nextSceneState) {
              return;
            }

            set((state) => ({
              sessions: upsertSession(state.sessions, nextSceneState),
              sessionsError: null,
              taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, nextSceneState.sessionId, (current) =>
                patchTaskProgressFromScene(current, nextSceneState)
              )
            }));
          } catch (error) {
            set({
              sessionsError: error instanceof Error ? error.message : 'Scene history command failed.'
            });
          }
        },

        selectSceneVersion: async (versionId) => {
          const sessionId = get().activeSessionId;
          const normalizedVersionId = String(versionId ?? '').trim();

          if (!sessionId || !normalizedVersionId) {
            return false;
          }

          try {
            const response = await selectVersion(sessionId, normalizedVersionId);
            const nextSceneState = response?.sceneState;
            if (!nextSceneState) {
              return false;
            }

            set((state) => ({
              sessions: upsertSession(state.sessions, nextSceneState),
              sessionsError: null,
              taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, nextSceneState.sessionId, (current) =>
                patchTaskProgressFromScene(current, nextSceneState)
              )
            }));

            return true;
          } catch (error) {
            set({
              sessionsError: error instanceof Error ? error.message : 'Version selection failed.'
            });

            return false;
          }
        },

        rerunScene: async (options) => {
          const sessionId = get().activeSessionId;
          if (!sessionId) {
            return false;
          }

          const selectedSession = get().sessions.find((session) => session.sessionId === sessionId) ?? null;
          const selectedScene = selectedSession?.currentScene ?? null;
          const overriddenCode = typeof options?.codeOverride === 'string' ? options.codeOverride : null;
          const rerunCode = overriddenCode ?? selectedScene?.code ?? null;

          if (!rerunCode || !rerunCode.trim()) {
            set({ sessionsError: 'No scene code is available to rerun.' });
            return false;
          }

          try {
            const response = await apiModifyVisual({
              sessionId,
              instruction: 'Rerun current scene.',
              runMode: 'rerun',
              codeOverride: rerunCode
            });

            const nextSceneState = response?.sceneState;
            if (!nextSceneState) {
              return false;
            }

            set((state) => ({
              sessions: upsertSession(state.sessions, nextSceneState),
              sessionsError: null,
              taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, nextSceneState.sessionId, (current) =>
                patchTaskProgressFromScene(current, nextSceneState)
              )
            }));

            return true;
          } catch (error) {
            set({
              sessionsError: error instanceof Error ? error.message : 'Scene rerun failed.'
            });

            return false;
          }
        },

        stopTurn: () => {
          const requestId = get().activeRequestId;
          const sessionId = get().activeSessionId;
          const activeSocket = socket;
          const abortedAt = nowIso();

          if (requestId && sessionId && activeSocket && activeSocket.readyState === WebSocket.OPEN) {
            activeSocket.send(
              JSON.stringify({
                type: 'turn.abort',
                payload: {
                  sessionId,
                  requestId
                }
              })
            );
          }

          set((state) => ({
            isSending: false,
            activeRequestId: null,
            thinkingText: null,
            thinkingStep: 'turn_aborted',
            taskProgressBySession: sessionId
              ? updateTaskProgressMap(state.taskProgressBySession, sessionId, (current) => ({
                  ...current,
                  tasks: applyStepStatusToTasks(current.tasks, current.currentStep ?? 'sync_state', 'failed'),
                  activeStageAction: mapStepToAction(current.currentStep) ?? mapStepToAction('turn_error'),
                  currentStep: 'turn_error',
                  currentStepStatus: 'failed',
                  turnStatus: 'failed',
                  activeRequestId: null,
                  liveThought: {
                    text: 'Turn was stopped by user.',
                    step: 'turn_error',
                    updatedAt: abortedAt
                  },
                  mediaStage: current.mediaStage === 'ready' ? 'ready' : 'error',
                  mediaStatusText: 'Turn was stopped by user.',
                  lastTerminalAt: abortedAt
                }))
              : state.taskProgressBySession
          }));
        },

        connectWebSocket: () => {
          if (typeof window === 'undefined') {
            return;
          }

          if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
            return;
          }

          const websocketUrl = resolveWebSocketUrl();
          set({ connectionState: 'connecting' });

          const nextSocket = new WebSocket(websocketUrl);
          socket = nextSocket;
          let resumeRequestedOnOpen = false;

          nextSocket.addEventListener('open', () => {
            set({ connectionState: 'open' });

            const activeSessionId = get().activeSessionId;
            resumeRequestedOnOpen = shouldReplayOnReconnect && Boolean(activeSessionId) && lastSequence > 0;

            if (resumeRequestedOnOpen) {
              nextSocket.send(
                JSON.stringify({
                  type: 'session.resume',
                  payload: {
                    sessionId: activeSessionId,
                    lastSeq: lastSequence
                  }
                })
              );
            }

            shouldReplayOnReconnect = false;
          });

          nextSocket.addEventListener('message', (event) => {
            try {
              const parsed = JSON.parse(event.data) as {
                type?: string;
                seq?: number;
                payload?: Record<string, unknown>;
              };

              if (!parsed.type) {
                return;
              }

              if (typeof parsed.seq === 'number') {
                if (parsed.seq <= lastSequence) {
                  return;
                }
                lastSequence = parsed.seq;
              }

              const payload = parsed.payload ?? {};
              const nestedPayload = payload.payload && typeof payload.payload === 'object'
                ? payload.payload as Record<string, unknown>
                : null;
              const sessionId = typeof payload.sessionId === 'string'
                ? payload.sessionId
                : (typeof nestedPayload?.sessionId === 'string' ? nestedPayload.sessionId : null);
              const activeSessionId = get().activeSessionId;
              const eventTargetsActiveSession = !sessionId || !activeSessionId || activeSessionId === sessionId;
              const payloadRequestId = typeof payload.requestId === 'string' && payload.requestId.trim()
                ? payload.requestId.trim()
                : null;
              const activeRequestId = get().activeRequestId;
              const eventTargetsActiveRequest = Boolean(
                payloadRequestId && activeRequestId && payloadRequestId === activeRequestId
              );

              if (parsed.type === 'connection:ready') {
                const latestSeq = typeof payload.latestSeq === 'number' ? payload.latestSeq : null;
                if (!resumeRequestedOnOpen && latestSeq !== null) {
                  lastSequence = Math.max(lastSequence, latestSeq);
                }
                set({ connectionState: 'open' });
                return;
              }

              if (parsed.type === 'session:resumed') {
                set({ connectionState: 'open' });
                return;
              }

              if (parsed.type === 'message:created' || parsed.type === 'message:update' || parsed.type === 'message.append') {
                const incoming = payload.message;
                if (!sessionId || !incoming || typeof incoming !== 'object') {
                  return;
                }

                const normalizedMessage = normalizeMessage(incoming as ApiSessionMessage);

                set((state) => ({
                  messages: {
                    ...state.messages,
                    [sessionId]: upsertMessage(state.messages[sessionId] ?? [], normalizedMessage)
                  },
                  sessions: sortSessionsByUpdatedAt(
                    state.sessions.map((session) =>
                      session.sessionId === sessionId
                        ? {
                            ...session,
                            updatedAt: normalizedMessage.updatedAt ?? session.updatedAt
                          }
                        : session
                    )
                  )
                }));

                return;
              }

              if (parsed.type === 'message:ack') {
                const status = typeof payload.status === 'string' ? payload.status : null;

                // Fallback completion signal for websocket turns when terminal turn events are delayed or dropped.
                if ((status === 'accepted' || status === 'duplicate') && (eventTargetsActiveSession || eventTargetsActiveRequest)) {
                  const ackSessionId = sessionId ?? activeSessionId;
                  const completedAt = nowIso();

                  set((state) => {
                    const ackProgress = ackSessionId ? state.taskProgressBySession[ackSessionId] ?? null : null;
                    const shouldFinalizeFallback = Boolean(ackProgress && ackProgress.turnStatus === 'running');

                    return {
                      isSending: shouldFinalizeFallback ? false : state.isSending,
                      activeRequestId: shouldFinalizeFallback ? null : state.activeRequestId,
                      thinkingText: shouldFinalizeFallback ? null : state.thinkingText,
                      thinkingStep: shouldFinalizeFallback ? 'turn_complete' : state.thinkingStep,
                      taskProgressBySession: shouldFinalizeFallback && ackSessionId
                        ? updateTaskProgressMap(state.taskProgressBySession, ackSessionId, (current) => ({
                            ...current,
                            tasks: applyStepStatusToTasks(current.tasks, 'turn_complete', 'completed'),
                            activeStageAction: null,
                            currentStep: 'turn_complete',
                            currentStepStatus: 'completed',
                            turnStatus: 'completed',
                            activeRequestId: null,
                            liveThought: null,
                            mediaStage: current.mediaStage === 'ready'
                              ? 'ready'
                              : current.mediaStage === 'error'
                                ? 'error'
                                : current.mediaStage === 'idle'
                                  ? 'idle'
                                  : 'syncing',
                            mediaStatusText: current.mediaStage === 'ready' || current.mediaStage === 'error'
                              ? current.mediaStatusText
                              : current.mediaStage === 'idle'
                                ? null
                                : 'Runtime output is syncing.',
                            lastTerminalAt: completedAt
                          }))
                        : state.taskProgressBySession
                    };
                  });
                }

                return;
              }

              if (parsed.type === 'message:accepted') {
                if (!eventTargetsActiveSession && !eventTargetsActiveRequest) {
                  return;
                }

                const acceptedAt = nowIso();
                const acceptedSessionId = sessionId ?? activeSessionId;

                set((state) => {
                  const acceptedProgress = acceptedSessionId ? state.taskProgressBySession[acceptedSessionId] ?? null : null;
                  const shouldFinalizeFallback = Boolean(acceptedProgress && acceptedProgress.turnStatus === 'running');

                  return {
                    isSending: shouldFinalizeFallback ? false : state.isSending,
                    activeRequestId: shouldFinalizeFallback ? null : state.activeRequestId,
                    thinkingText: shouldFinalizeFallback ? null : state.thinkingText,
                    thinkingStep: shouldFinalizeFallback ? 'turn_complete' : state.thinkingStep,
                    taskProgressBySession: shouldFinalizeFallback && acceptedSessionId
                      ? updateTaskProgressMap(state.taskProgressBySession, acceptedSessionId, (current) => ({
                          ...current,
                          tasks: applyStepStatusToTasks(current.tasks, 'turn_complete', 'completed'),
                          activeStageAction: null,
                          currentStep: 'turn_complete',
                          currentStepStatus: 'completed',
                          turnStatus: 'completed',
                          activeRequestId: null,
                          liveThought: null,
                          mediaStage: current.mediaStage === 'ready'
                            ? 'ready'
                            : current.mediaStage === 'error'
                              ? 'error'
                              : current.mediaStage === 'idle'
                                ? 'idle'
                                : 'syncing',
                          mediaStatusText: current.mediaStage === 'ready' || current.mediaStage === 'error'
                            ? current.mediaStatusText
                            : current.mediaStage === 'idle'
                              ? null
                              : 'Runtime output is syncing.',
                          lastTerminalAt: acceptedAt
                        }))
                      : state.taskProgressBySession
                  };
                });
                return;
              }

              if (parsed.type === 'orchestration:plan') {
                if (!sessionId) {
                  return;
                }

                const planId = typeof payload.planId === 'string' ? payload.planId : null;
                const tasks = normalizeTaskList(payload.tasks);

                set((state) => ({
                  taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId, (current) => ({
                    ...current,
                    planId,
                    tasks,
                    turnStatus: current.turnStatus === 'idle' ? 'running' : current.turnStatus,
                    activeStageAction: current.activeStageAction ?? findRunningStageAction(tasks)
                  }))
                }));
                return;
              }

              if (parsed.type === 'orchestration:step') {
                if (!sessionId) {
                  return;
                }

                const step = typeof payload.step === 'string' ? payload.step : null;
                const stepStatus = normalizeTaskStatus(payload.status, 'running');
                const stepText = typeof nestedPayload?.message === 'string'
                  ? nestedPayload.message
                  : null;
                const stepAction = mapStepToAction(step);
                const stepDetail = formatOrchestrationEventDetail(nestedPayload);
                const stepCreatedAt = nowIso();

                set((state) => {
                  let nextThinkingStep = state.thinkingStep;
                  let nextIsSending = state.isSending;

                  const nextTaskProgress = updateTaskProgressMap(state.taskProgressBySession, sessionId, (current) => {
                    const nextTasks = applyStepStatusToTasks(current.tasks, step, stepStatus);
                    const next = {
                      ...current,
                      tasks: nextTasks,
                      currentStep: step,
                      currentStepStatus: stepStatus,
                      turnStatus: current.turnStatus,
                      mediaStage: current.mediaStage,
                      mediaStatusText: current.mediaStatusText,
                      stageEventsByAction: current.stageEventsByAction,
                      activeStageAction: current.activeStageAction
                    };

                    if (stepAction && step) {
                      next.stageEventsByAction = appendStageEvent(
                        next.stageEventsByAction,
                        stepAction,
                        {
                          id: createClientMessageId(`stage-${stepAction}`),
                          source: 'orchestration',
                          step,
                          status: stepStatus,
                          text: stepText ?? formatOrchestrationEventText(step, stepStatus),
                          detail: stepDetail,
                          createdAt: stepCreatedAt
                        }
                      );
                    }

                    if (step === 'turn_error' || stepStatus === 'failed') {
                      next.turnStatus = 'failed';
                      if (next.mediaStage !== 'ready') {
                        next.mediaStage = 'error';
                        next.mediaStatusText = stepText ?? 'Turn failed while processing runtime output.';
                      }
                    } else if (step === 'turn_complete') {
                      next.turnStatus = 'completed';
                    } else {
                      if (next.turnStatus !== 'completed' && next.turnStatus !== 'failed') {
                        next.turnStatus = 'running';
                      }
                    }

                    if (next.turnStatus === 'running' && (step === 'generate_code' || step === 'code_generated' || step === 'code_modified')) {
                      next.mediaStage = 'generating';
                      next.mediaStatusText = 'Generating runtime output...';
                    }

                    if (next.turnStatus === 'running' && (step === 'execute_code' || step === 'executing')) {
                      next.mediaStage = 'executing';
                      next.mediaStatusText = 'Executing runtime workload...';
                    }

                    if (next.turnStatus === 'running' && step === 'sync_state') {
                      next.mediaStage = 'syncing';
                      next.mediaStatusText = 'Syncing runtime output...';
                    }

                    next.activeStageAction = resolveActiveStageAction(
                      current.activeStageAction,
                      nextTasks,
                      stepAction,
                      stepStatus
                    );

                    return next;
                  });

                  if (eventTargetsActiveSession && step) {
                    nextThinkingStep = step;
                    nextIsSending = step !== 'turn_complete' && step !== 'turn_error';
                  }

                  return {
                    taskProgressBySession: nextTaskProgress,
                    thinkingStep: nextThinkingStep,
                    isSending: nextIsSending
                  };
                });
                return;
              }

              if (parsed.type === 'agent:activity') {
                if (!sessionId) {
                  return;
                }

                const incomingStatus = normalizeTaskStatus(payload.status, 'running');
                const step = typeof payload.step === 'string' ? payload.step : 'turn_started';
                const createdAt = typeof payload.createdAt === 'string' ? payload.createdAt : nowIso();
                const activityAction = mapStepToAction(step);
                const activity: AgentActivityEvent = {
                  id: typeof payload.id === 'string' ? payload.id : createClientMessageId('activity'),
                  sessionId,
                  messageId: typeof payload.messageId === 'string' ? payload.messageId : null,
                  step,
                  status: incomingStatus,
                  tone: payload.tone === 'progress' || payload.tone === 'success' || payload.tone === 'error'
                    ? payload.tone
                    : undefined,
                  text: typeof payload.text === 'string' && payload.text.trim()
                    ? payload.text
                    : 'Processing step...',
                  technicalDetail: typeof payload.technicalDetail === 'string' ? payload.technicalDetail : null,
                  createdAt
                };

                set((state) => {
                  let nextThinkingText = state.thinkingText;
                  let nextThinkingStep = state.thinkingStep;
                  let nextIsSending = state.isSending;

                  const nextTaskProgress = updateTaskProgressMap(state.taskProgressBySession, sessionId, (current) => {
                    const existingActivities = current.activities;
                    const duplicate = existingActivities.some((entry) => entry.id === activity.id);
                    const activities = duplicate
                      ? existingActivities
                      : [...existingActivities, activity].slice(-MAX_ACTIVITY_ENTRIES);
                    const nextTasks = applyStepStatusToTasks(current.tasks, step, incomingStatus);

                    const next = {
                      ...current,
                      activities,
                      tasks: nextTasks,
                      currentStep: step,
                      currentStepStatus: incomingStatus,
                      turnStatus: current.turnStatus,
                      mediaStage: current.mediaStage,
                      mediaStatusText: current.mediaStatusText,
                      stageEventsByAction: current.stageEventsByAction,
                      activeStageAction: current.activeStageAction
                    };

                    if (activityAction) {
                      next.stageEventsByAction = appendStageEvent(
                        next.stageEventsByAction,
                        activityAction,
                        {
                          id: activity.id,
                          source: 'activity',
                          step,
                          status: incomingStatus,
                          text: activity.text,
                          detail: activity.technicalDetail ?? null,
                          createdAt
                        }
                      );
                    }

                    if (incomingStatus === 'failed' || step === 'turn_error' || activity.tone === 'error') {
                      next.turnStatus = 'failed';
                      if (next.mediaStage !== 'ready') {
                        next.mediaStage = 'error';
                        next.mediaStatusText = activity.text;
                      }
                    } else if (step === 'turn_complete') {
                      next.turnStatus = 'completed';
                    } else if (next.turnStatus !== 'completed' && next.turnStatus !== 'failed') {
                      next.turnStatus = 'running';
                    }

                    if (next.turnStatus === 'running' && (step === 'generate_code' || step === 'code_generated' || step === 'code_modified')) {
                      next.mediaStage = 'generating';
                      next.mediaStatusText = activity.text;
                    } else if (next.turnStatus === 'running' && (step === 'execute_code' || step === 'executing')) {
                      next.mediaStage = 'executing';
                      next.mediaStatusText = activity.text;
                    } else if (next.turnStatus === 'running' && step === 'sync_state') {
                      next.mediaStage = 'syncing';
                      next.mediaStatusText = activity.text;
                    }

                    next.activeStageAction = resolveActiveStageAction(
                      current.activeStageAction,
                      nextTasks,
                      activityAction,
                      incomingStatus
                    );

                    return next;
                  });

                  if (eventTargetsActiveSession) {
                    nextThinkingText = activity.text;
                    nextThinkingStep = step;
                    nextIsSending = incomingStatus === 'running' || step === 'turn_started';
                  }

                  return {
                    taskProgressBySession: nextTaskProgress,
                    thinkingText: nextThinkingText,
                    thinkingStep: nextThinkingStep,
                    isSending: nextIsSending
                  };
                });
                return;
              }

              if (parsed.type === 'generation:started' || parsed.type === 'code:started') {
                if (!sessionId) {
                  return;
                }

                set((state) => ({
                  taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId, (current) => ({
                    ...current,
                    mediaStage: current.turnStatus === 'running' ? 'generating' : current.mediaStage,
                    mediaStatusText: current.turnStatus === 'running' ? 'Generating runtime output...' : current.mediaStatusText
                  }))
                }));
                return;
              }

              if (parsed.type === 'generation:progress' || parsed.type === 'code:stream') {
                if (!sessionId) {
                  return;
                }

                const progressPercent = typeof payload.progress === 'number' ? payload.progress : null;
                const currentTokens = typeof payload.tokens === 'number' ? payload.tokens : null;
                const totalTokens = typeof payload.estimatedTotal === 'number' ? payload.estimatedTotal : null;
                const statusMessage = typeof payload.message === 'string' ? payload.message : null;
                const isFinal = payload.isFinal === true;

                set((state) => ({
                  taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId, (current) => ({
                    ...current,
                    mediaStage: current.turnStatus === 'running' ? 'generating' : current.mediaStage,
                    mediaStatusText: statusMessage ?? (
                      progressPercent !== null
                        ? `Generating... ${progressPercent}%`
                        : currentTokens !== null && totalTokens !== null
                          ? `Generating... ${currentTokens} / ${totalTokens} tokens`
                          : 'Generating runtime output...'
                    )
                  }))
                }));
                return;
              }

              if (parsed.type === 'generation:complete' || parsed.type === 'code:update') {
                if (!sessionId) {
                  return;
                }

                const outputKind = typeof payload.outputKind === 'string' ? payload.outputKind : null;
                const mediaType = typeof payload.mediaType === 'string' ? payload.mediaType : null;
                const mediaUrl = typeof payload.mediaUrl === 'string' ? payload.mediaUrl : null;
                const runtimeStatus = typeof payload.runtimeStatus === 'string' ? payload.runtimeStatus : null;
                const runtimeWarning = typeof payload.runtimeWarning === 'string' ? payload.runtimeWarning.trim() : '';
                const generationWarning = typeof payload.generationWarning === 'string' ? payload.generationWarning.trim() : '';
                const mediaExpected = outputKind === 'media' || (typeof mediaType === 'string' && mediaType.startsWith('video/'));
                const mediaReady = Boolean(mediaUrl && mediaUrl !== 'about:blank');
                const mediaUnavailable = mediaExpected && !mediaReady && (
                  runtimeStatus === 'degraded'
                  || runtimeStatus === 'skipped'
                  || runtimeStatus === 'error'
                  || runtimeWarning.length > 0
                  || generationWarning.length > 0
                );

                set((state) => ({
                  taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId, (current) => ({
                    ...current,
                    mediaStage: mediaExpected
                      ? (mediaReady
                        ? 'ready'
                        : mediaUnavailable
                          ? 'error'
                          : current.turnStatus === 'running'
                            ? 'syncing'
                            : 'error')
                      : current.mediaStage,
                    mediaStatusText: mediaExpected
                      ? (mediaReady
                        ? 'Video artifact is ready to preview.'
                        : mediaUnavailable
                          ? runtimeWarning || generationWarning || 'Video artifact is unavailable for this run.'
                          : current.turnStatus === 'running'
                            ? 'Video artifact is still syncing.'
                            : 'Video artifact is unavailable for this run.')
                      : current.mediaStatusText,
                    mediaType: mediaType ?? current.mediaType,
                    mediaUrl: mediaReady ? mediaUrl : current.mediaUrl
                  }))
                }));
                return;
              }

              if (parsed.type === 'thought:stream') {
                if (!sessionId) {
                  return;
                }

                const thought = typeof payload.thought === 'string' ? payload.thought : null;
                const thoughtStep = typeof payload.step === 'string' ? payload.step : 'thought';
                const isFinal = payload.isFinal === true;
                const thoughtRequestId = typeof payload.requestId === 'string' && payload.requestId.trim()
                  ? payload.requestId.trim()
                  : null;
                const thoughtMessageId = typeof payload.messageId === 'string' && payload.messageId.trim()
                  ? payload.messageId.trim()
                  : null;

                if (thought) {
                  const thoughtUpdatedAt = nowIso();
                  set((state) => ({
                    thinkingText: eventTargetsActiveSession ? thought : state.thinkingText,
                    thinkingStep: eventTargetsActiveSession ? thoughtStep : state.thinkingStep,
                    taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId, (current) => ({
                      ...current,
                      currentStep: thoughtStep,
                      currentStepStatus: current.currentStepStatus ?? 'running',
                      liveThought: {
                        text: thought,
                        step: thoughtStep,
                        updatedAt: thoughtUpdatedAt,
                        requestId: thoughtRequestId,
                        messageId: thoughtMessageId
                      },
                      turnStatus: current.turnStatus === 'idle' ? 'running' : current.turnStatus,
                      tasks: applyStepStatusToTasks(current.tasks, thoughtStep, 'running')
                    }))
                  }));
                }

                if (sessionId && thought && isFinal) {
                  const now = new Date().toISOString();
                  const requestMeta = thoughtRequestId ? `requestId:${thoughtRequestId}` : null;
                  const messageMeta = thoughtMessageId ? `messageId:${thoughtMessageId}` : null;
                  const thoughtMessage: SessionMessage = {
                    id: createClientMessageId(`thought-${thoughtStep}`),
                    role: 'thought',
                    content: thought,
                    kind: 'thought',
                    meta: [thoughtStep, requestMeta, messageMeta].filter(Boolean) as string[],
                    error: null,
                    createdAt: now,
                    updatedAt: now
                  };

                  set((state) => {
                    const existingMessages = state.messages[sessionId] ?? [];
                    const duplicate = existingMessages.some(
                      (message) => {
                        if (!isThoughtMessage(message)) {
                          return false;
                        }

                        if (message.content.trim() !== thought.trim() || message.meta?.[0] !== thoughtStep) {
                          return false;
                        }

                        if (requestMeta && !message.meta?.includes(requestMeta)) {
                          return false;
                        }

                        if (messageMeta && !message.meta?.includes(messageMeta)) {
                          return false;
                        }

                        return true;
                      }
                    );

                    if (duplicate) {
                      return state;
                    }

                    return {
                      messages: {
                        ...state.messages,
                        [sessionId]: upsertMessage(existingMessages, thoughtMessage)
                      }
                    };
                  });
                }

                return;
              }

              if (parsed.type === 'scene:update') {
                const sceneState = payload.sceneState as Session | undefined;
                if (!sceneState?.sessionId) {
                  return;
                }

                set((state) => ({
                  sessions: upsertSession(state.sessions, sceneState),
                  taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sceneState.sessionId, (current) =>
                    patchTaskProgressFromScene(current, sceneState)
                  )
                }));
                return;
              }

              if (parsed.type === 'turn:started') {
                if (!eventTargetsActiveSession) {
                  return;
                }

                const startedAt = nowIso();
                set((state) => ({
                  isSending: true,
                  taskProgressBySession: sessionId
                    ? updateTaskProgressMap(state.taskProgressBySession, sessionId, (current) => ({
                        ...current,
                        tasks: applyStepStatusToTasks(current.tasks, 'turn_started', 'running'),
                        activeStageAction: 'parse_intent',
                        currentStep: 'turn_started',
                        currentStepStatus: 'running',
                        turnStatus: 'running',
                        activeRequestId: payloadRequestId ?? current.activeRequestId,
                        lastTerminalAt: null,
                        mediaStage: current.mediaStage === 'ready' ? 'ready' : 'queued',
                        mediaStatusText: current.mediaStage === 'ready'
                          ? current.mediaStatusText
                          : 'Preparing runtime pipeline...',
                        liveThought: current.liveThought ?? {
                          text: 'Analyzing your request...',
                          step: 'turn_started',
                          updatedAt: startedAt,
                          requestId: payloadRequestId
                        }
                      }))
                    : state.taskProgressBySession
                }));
                return;
              }

              if (parsed.type === 'turn:complete') {
                if (!eventTargetsActiveSession && !eventTargetsActiveRequest) {
                  return;
                }

                const completedAt = nowIso();
                const completedSessionId = sessionId ?? activeSessionId;
                const runtimeStatus = typeof payload.runtimeStatus === 'string' ? payload.runtimeStatus : null;
                const runtimeWarning = typeof payload.runtimeWarning === 'string' ? payload.runtimeWarning : null;
                const generationWarning = typeof payload.generationWarning === 'string' ? payload.generationWarning : null;
                const outputKind = typeof payload.outputKind === 'string' ? payload.outputKind : null;
                const mediaType = typeof payload.mediaType === 'string' ? payload.mediaType : null;
                const mediaUrl = typeof payload.mediaUrl === 'string' ? payload.mediaUrl : null;
                const mediaExpected = outputKind === 'media' || (typeof mediaType === 'string' && mediaType.startsWith('video/'));
                const mediaReady = Boolean(mediaUrl && mediaUrl !== 'about:blank');
                const runtimeWarningText = typeof runtimeWarning === 'string' ? runtimeWarning.trim() : '';
                const generationWarningText = typeof generationWarning === 'string' ? generationWarning.trim() : '';
                const mediaUnavailable = mediaExpected && !mediaReady && (
                  runtimeStatus === 'degraded'
                  || runtimeStatus === 'skipped'
                  || runtimeStatus === 'error'
                  || runtimeWarningText.length > 0
                  || generationWarningText.length > 0
                );

                set((state) => ({
                  isSending: false,
                  activeRequestId: null,
                  thinkingText: null,
                  thinkingStep: 'turn_complete',
                  taskProgressBySession: completedSessionId
                    ? updateTaskProgressMap(state.taskProgressBySession, completedSessionId, (current) => ({
                        ...current,
                        tasks: applyStepStatusToTasks(current.tasks, 'turn_complete', 'completed'),
                        activeStageAction: null,
                        currentStep: 'turn_complete',
                        currentStepStatus: 'completed',
                        turnStatus: 'completed',
                        activeRequestId: null,
                        liveThought: null,
                        mediaStage: mediaExpected
                          ? (mediaReady ? 'ready' : 'error')
                          : current.mediaStage === 'ready'
                            ? 'ready'
                            : current.mediaStage === 'error'
                              ? 'error'
                              : 'idle',
                        mediaStatusText: mediaExpected
                          ? (mediaReady
                            ? 'Video artifact is ready to preview.'
                            : mediaUnavailable
                              ? runtimeWarningText || generationWarningText || 'Video artifact is unavailable for this run.'
                              : 'Video artifact is unavailable for this run.')
                          : null,
                        mediaType: mediaType ?? current.mediaType,
                        mediaUrl: mediaReady ? mediaUrl : null,
                        lastTerminalAt: completedAt
                      }))
                    : state.taskProgressBySession
                }));
                return;
              }

              if (parsed.type === 'generation:error' || parsed.type === 'code:error') {
                if (!sessionId) {
                  return;
                }

                const errorMessage = typeof payload.message === 'string' ? payload.message : 'Generation failed';
                const errorCode = typeof payload.code === 'string' ? payload.code : 'GENERATION_ERROR';
                const failedAt = nowIso();

                set((state) => ({
                  taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId, (current) => ({
                    ...current,
                    mediaStage: 'error',
                    mediaStatusText: errorMessage,
                    stageEventsByAction: appendStageEvent(
                      current.stageEventsByAction,
                      current.activeStageAction ?? 'generate_code',
                      {
                        id: createClientMessageId(`generation-error-${errorCode}`),
                        source: 'error',
                        step: current.currentStep ?? 'generate_code',
                        status: 'failed',
                        text: errorMessage,
                        detail: errorCode,
                        createdAt: failedAt
                      }
                    )
                  }))
                }));
                return;
              }

              if (parsed.type === 'thinking:analysis_failed') {
                if (!sessionId) {
                  return;
                }

                const errorMessage = typeof payload.message === 'string' ? payload.message : 'Analysis failed';
                const failedAt = nowIso();

                set((state) => ({
                  thinkingText: eventTargetsActiveSession ? errorMessage : state.thinkingText,
                  thinkingStep: eventTargetsActiveSession ? 'turn_error' : state.thinkingStep,
                  taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId, (current) => ({
                    ...current,
                    liveThought: {
                      text: errorMessage,
                      step: 'turn_error',
                      updatedAt: failedAt
                    },
                    stageEventsByAction: appendStageEvent(
                      current.stageEventsByAction,
                      'parse_intent',
                      {
                        id: createClientMessageId('thinking-analysis-failed'),
                        source: 'error',
                        step: 'parse_intent',
                        status: 'failed',
                        text: 'Analysis failed',
                        detail: errorMessage,
                        createdAt: failedAt
                      }
                    )
                  }))
                }));
                return;
              }

              if (parsed.type === 'turn:error') {
                if (!eventTargetsActiveSession && !eventTargetsActiveRequest) {
                  return;
                }

                const errorMessage =
                  (typeof payload.message === 'string' && payload.message.trim()) ||
                  (payload.error && typeof payload.error === 'object' && typeof (payload.error as { userMessage?: string }).userMessage === 'string'
                    ? (payload.error as { userMessage: string }).userMessage
                    : 'Turn failed');
                const errorCode =
                  payload.error
                  && typeof payload.error === 'object'
                  && typeof (payload.error as { code?: string }).code === 'string'
                    ? (payload.error as { code: string }).code
                    : null;

                if (sessionId) {
                  const timestamp = new Date().toISOString();
                  set((state) => ({
                    messages: (() => {
                      const existingMessages = state.messages[sessionId] ?? [];
                      const requestMeta = payloadRequestId ? `requestId:${payloadRequestId}` : null;
                      const hasRequestLinkedAssistant = Boolean(
                        requestMeta
                        && existingMessages.some((message) =>
                          message.role === 'assistant'
                          && Array.isArray(message.meta)
                          && message.meta.includes(requestMeta)
                        )
                      );
                      const hasEquivalentAssistantError = existingMessages.some((message) => {
                        if (message.role !== 'assistant') {
                          return false;
                        }

                        const normalizedContent = String(message.content ?? '').trim();
                        if (normalizedContent !== errorMessage) {
                          return false;
                        }

                        const hasErrorMeta = Array.isArray(message.meta)
                          && message.meta.some((entry) => entry.startsWith('error:'));

                        return message.kind === 'error' || Boolean(message.error) || hasErrorMeta;
                      });

                      if (hasRequestLinkedAssistant || hasEquivalentAssistantError) {
                        return state.messages;
                      }

                      const assistantError: SessionMessage = {
                        id: createClientMessageId('turn-error'),
                        role: 'assistant',
                        content: errorMessage,
                        kind: 'error',
                        meta: [
                          `error:${errorCode ?? errorMessage}`,
                          requestMeta
                        ].filter(Boolean) as string[],
                        error: (payload.error as SessionMessage['error']) ?? null,
                        createdAt: timestamp,
                        updatedAt: timestamp
                      };

                      return {
                        ...state.messages,
                        [sessionId]: upsertMessage(existingMessages, assistantError)
                      };
                    })()
                  }));
                }

                const failedAt = nowIso();
                const failedSessionId = sessionId ?? activeSessionId;

                set((state) => ({
                  isSending: false,
                  activeRequestId: null,
                  thinkingText: null,
                  thinkingStep: 'turn_error',
                  taskProgressBySession: failedSessionId
                    ? updateTaskProgressMap(state.taskProgressBySession, failedSessionId, (current) => ({
                        ...current,
                        tasks: applyStepStatusToTasks(current.tasks, 'turn_error', 'failed'),
                        activeStageAction: mapStepToAction(current.currentStep) ?? mapStepToAction('turn_error'),
                        currentStep: 'turn_error',
                        currentStepStatus: 'failed',
                        turnStatus: 'failed',
                        activeRequestId: null,
                        liveThought: {
                          text: errorMessage,
                          step: 'turn_error',
                          updatedAt: failedAt
                        },
                        mediaStage: current.mediaStage === 'ready' ? 'ready' : 'error',
                        mediaStatusText: errorMessage,
                        lastTerminalAt: failedAt
                      }))
                    : state.taskProgressBySession
                }));
                return;
              }

              if (parsed.type === 'iteration:update') {
                if (!sessionId) {
                  return;
                }

                const iterationData = payload.iteration as SharedIterationState;
                const progress = payload.progress as {
                  current: number;
                  total: number;
                  phase: "generating" | "validating" | "scoring" | "patching" | "finalizing";
                };

                if (!iterationData || !progress) {
                  return;
                }

                const {
                  iterationNumber,
                  qualitySignals,
                  isFinal,
                  generationDurationMs,
                  validationDurationMs,
                  patchGoals
                } = iterationData;

                set((state) => {
                  const currentIterations = state.iterationState?.iterations ?? [];
                  const isFirstIteration = iterationNumber === 1;
                  
                  // Update or add the iteration
                  const updatedIterations = isFirstIteration 
                    ? [iterationData]
                    : [...currentIterations.filter(it => it.iterationNumber < iterationNumber), iterationData];

                  const finalScore = qualitySignals?.composite ?? state.iterationState?.currentScore ?? 0;
                  const isIterating = progress.phase !== 'finalizing' && !isFinal;

                  return {
                    iterationState: {
                      isIterating,
                      currentIteration: progress.current,
                      maxIterations: progress.total,
                      currentScore: finalScore,
                      threshold: state.iterationState?.threshold ?? 75,
                      phase: progress.phase as UIIterationState['phase'],
                      iterations: updatedIterations,
                      qualityReport: state.iterationState?.qualityReport ?? null,
                      stopReason: state.iterationState?.stopReason ?? null,
                      sessionId
                    }
                  };
                });
                return;
              }

              if (parsed.type === 'agent:analysis_complete') {
                // Handle multi-agent analysis completion
                const agentResults = payload.results as Record<string, any> ?? {};
                const consensus = typeof payload.consensus === 'number' ? payload.consensus : 0;
                const recommendations = (payload.recommendations ?? []) as Array<any>;
                const shouldAutoApply = consensus >= 80;

                // Convert agent results to our UI format
                const formattedResults: Record<string, any> = {};
                Object.entries(agentResults).forEach(([agentId, result]: [string, any]) => {
                  formattedResults[agentId] = {
                    id: agentId,
                    name: result.name || agentId,
                    score: result.score || 0,
                    findings: result.findings || [],
                    recommendations: result.recommendations || []
                  };
                });

                set((state) => ({
                  agentState: {
                    isAnalyzing: false,
                    results: formattedResults,
                    consensus,
                    shouldAutoApply,
                    recommendations: recommendations.map((rec: any, idx: number) => ({
                      ...rec,
                      priority: idx + 1
                    })),
                    memory: state.agentState?.memory ?? [],
                    lastAnalyzedAt: new Date().toISOString()
                  }
                }));
                return;
              }

              if (parsed.type === 'tasks:planned') {
                if (!sessionId) {
                  return;
                }

                const planId = typeof payload.planId === 'string' ? payload.planId : null;
                const taskCount = typeof payload.taskCount === 'number' ? payload.taskCount : 0;
                const summary = typeof payload.summary === 'string' ? payload.summary : null;

                set((state) => ({
                  taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId, (current) => ({
                    ...current,
                    planId,
                    turnStatus: current.turnStatus === 'idle' ? 'running' : current.turnStatus
                  }))
                }));
                return;
              }

              if (parsed.type === 'task:started') {
                if (!sessionId) {
                  return;
                }

                const planId = typeof payload.planId === 'string' ? payload.planId : null;
                const taskId = typeof payload.taskId === 'string' ? payload.taskId : null;
                const action = typeof payload.action === 'string' ? payload.action : null;
                const createdAt = nowIso();

                set((state) => ({
                  taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId, (current) => {
                    const nextTasks = applyStepStatusToTasks(current.tasks, action, 'running');

                    const nextStageEvents = action && (action as GveTaskAction in ORCHESTRATION_STEP_TO_ACTION)
                      ? appendStageEvent(current.stageEventsByAction, action as GveTaskAction, {
                          id: createClientMessageId(`task-started-${taskId}`),
                          source: 'task',
                          step: action,
                          status: 'running',
                          text: `Task ${action} started`,
                          detail: `Plan: ${planId ?? 'unknown'}, Task: ${taskId ?? 'unknown'}`,
                          createdAt
                        })
                      : current.stageEventsByAction;

                    return {
                      ...current,
                      tasks: nextTasks,
                      stageEventsByAction: nextStageEvents,
                      currentStep: action ?? current.currentStep,
                      currentStepStatus: 'running',
                      turnStatus: current.turnStatus === 'idle' ? 'running' : current.turnStatus,
                      activeStageAction: (action as GveTaskAction) ?? current.activeStageAction
                    };
                  })
                }));
                return;
              }

              if (parsed.type === 'task:completed') {
                if (!sessionId) {
                  return;
                }

                const planId = typeof payload.planId === 'string' ? payload.planId : null;
                const taskId = typeof payload.taskId === 'string' ? payload.taskId : null;
                const status = normalizeTaskStatus(payload.status, 'completed');
                const durationMs = typeof payload.durationMs === 'number' ? payload.durationMs : 0;
                const createdAt = nowIso();

                set((state) => ({
                  taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId, (current) => {
                    const taskForEvent = current.tasks.find((t) => t.id === taskId);
                    const action = taskForEvent?.action ?? current.currentStep;

                    const nextTasks = applyStepStatusToTasks(current.tasks, action, status);

                    const nextStageEvents = action && (action as GveTaskAction in ORCHESTRATION_STEP_TO_ACTION)
                      ? appendStageEvent(current.stageEventsByAction, action as GveTaskAction, {
                          id: createClientMessageId(`task-completed-${taskId}`),
                          source: 'task',
                          step: action,
                          status,
                          text: `Task ${action} completed`,
                          detail: `Duration: ${(durationMs / 1000).toFixed(2)}s`,
                          createdAt
                        })
                      : current.stageEventsByAction;

                    return {
                      ...current,
                      tasks: nextTasks,
                      stageEventsByAction: nextStageEvents,
                      currentStep: action,
                      currentStepStatus: status,
                      turnStatus: current.turnStatus === 'idle' ? 'running' : current.turnStatus
                    };
                  })
                }));
                return;
              }

              if (parsed.type === 'task:failed') {
                if (!sessionId) {
                  return;
                }

                const planId = typeof payload.planId === 'string' ? payload.planId : null;
                const taskId = typeof payload.taskId === 'string' ? payload.taskId : null;
                const message = typeof payload.message === 'string' ? payload.message : 'Task failed';
                const createdAt = nowIso();

                set((state) => ({
                  taskProgressBySession: updateTaskProgressMap(state.taskProgressBySession, sessionId, (current) => {
                    const taskForEvent = current.tasks.find((t) => t.id === taskId);
                    const action = taskForEvent?.action ?? current.currentStep;

                    const nextTasks = applyStepStatusToTasks(current.tasks, action, 'failed');

                    const nextStageEvents = action && (action as GveTaskAction in ORCHESTRATION_STEP_TO_ACTION)
                      ? appendStageEvent(current.stageEventsByAction, action as GveTaskAction, {
                          id: createClientMessageId(`task-failed-${taskId}`),
                          source: 'task',
                          step: action,
                          status: 'failed',
                          text: `Task ${action} failed`,
                          detail: message,
                          createdAt
                        })
                      : current.stageEventsByAction;

                    return {
                      ...current,
                      tasks: nextTasks,
                      stageEventsByAction: nextStageEvents,
                      currentStep: action,
                      currentStepStatus: 'failed',
                      turnStatus: current.turnStatus === 'failed' ? 'failed' : current.turnStatus,
                      mediaStage: current.mediaStage === 'ready' ? 'ready' : 'error',
                      mediaStatusText: message
                    };
                  })
                }));
                return;
              }

              if (parsed.type === 'message:error') {
                const messageError = typeof payload.message === 'string' && payload.message.trim()
                  ? payload.message
                  : 'Turn failed';
                const failedAt = nowIso();
                const erroredSessionId = sessionId ?? activeSessionId;

                set((state) => ({
                  isSending: false,
                  activeRequestId: null,
                  thinkingText: null,
                  thinkingStep: 'turn_error',
                  taskProgressBySession: erroredSessionId
                    ? updateTaskProgressMap(state.taskProgressBySession, erroredSessionId, (current) => ({
                        ...current,
                        tasks: applyStepStatusToTasks(current.tasks, 'turn_error', 'failed'),
                        activeStageAction: mapStepToAction(current.currentStep) ?? mapStepToAction('turn_error'),
                        currentStep: 'turn_error',
                        currentStepStatus: 'failed',
                        turnStatus: 'failed',
                        activeRequestId: null,
                        liveThought: {
                          text: messageError,
                          step: 'turn_error',
                          updatedAt: failedAt
                        },
                        mediaStage: current.mediaStage === 'ready' ? 'ready' : 'error',
                        mediaStatusText: messageError,
                        lastTerminalAt: failedAt
                      }))
                    : state.taskProgressBySession
                }));
              }

              if (parsed.type === 'action:block_update') {
                const messageId = typeof payload.messageId === 'string' ? payload.messageId : null;
                const blockId = typeof payload.blockId === 'string' ? payload.blockId : null;
                const updates = payload.updates ?? null;

                if (!messageId || !blockId || !updates || typeof updates !== 'object') {
                  return;
                }

                get().updateActionBlock(messageId, blockId, updates as Partial<ActionBlock>);
              }
            } catch {
              // Ignore malformed websocket payloads.
            }
          });

          nextSocket.addEventListener('error', () => {
            set({ connectionState: 'error' });
          });

          nextSocket.addEventListener('close', () => {
            if (socket === nextSocket) {
              socket = null;
            }

            if (lastSequence > 0) {
              shouldReplayOnReconnect = true;
            }

            set({ connectionState: 'closed' });

            if (reconnectTimer !== null) {
              window.clearTimeout(reconnectTimer);
            }

            reconnectTimer = window.setTimeout(() => {
              reconnectTimer = null;
              get().connectWebSocket();
            }, WS_RECONNECT_DELAY_MS);
          });
        },

        // Initial state
        sessions: [],
        activeSessionId: null,
        hasInitialized: false,
        isBootstrapping: false,
        sessionsError: null,
        messages: {},
        taskProgressBySession: {},
        actionBlocksByMessage: {},
        currentTurnCheckpoints: [],
        currentMessageId: null,
        connectionState: 'connecting',
        isSending: false,
        activeRequestId: null,
        thinkingText: null,
        thinkingStep: 'turn_started',
        showScrollToLatest: false,
        iterationState: null,
        agentState: null,
        panelOpen: false,
        panelView: null,
        panelWidth: 600,
        composerValue: '',
        composerImage: null,
        isSlashMenuOpen: false,
        
        // Actions
        startDraftSession: () => {
          set({
            activeSessionId: null,
            sessionsError: null,
            isSending: false,
            activeRequestId: null,
            thinkingText: null,
            thinkingStep: 'turn_started',
            composerValue: '',
            composerImage: null,
            panelOpen: false,
            panelView: null
          });
        },

        setActiveSession: (sessionId) => {
          if (!sessionId) {
            get().startDraftSession();
            return;
          }

          void get().selectSession(sessionId);
        },
        
        addSession: (session) => {
          set((state) => ({
            sessions: upsertSession(state.sessions, session),
            activeSessionId: session.sessionId,
            taskProgressBySession: {
              ...state.taskProgressBySession,
              [session.sessionId]: state.taskProgressBySession[session.sessionId] ?? createDefaultTaskProgress(session.sessionId)
            }
          }));
        },
        
        addMessage: (sessionId, message) => {
          set((state) => ({
            messages: {
              ...state.messages,
              [sessionId]: upsertMessage(state.messages[sessionId] || [], message),
            },
          }));
        },
        
        setIsSending: (value) => {
          set({ isSending: value });
        },
        
        setThinking: (text, step = 'turn_started') => {
          const activeSessionId = get().activeSessionId;

          set((state) => ({
            thinkingText: text,
            thinkingStep: step,
            taskProgressBySession: activeSessionId
              ? updateTaskProgressMap(state.taskProgressBySession, activeSessionId, (current) => ({
                  ...current,
                  currentStep: step,
                  currentStepStatus: current.currentStepStatus ?? 'running',
                  liveThought: text
                    ? {
                        text,
                        step,
                        updatedAt: nowIso()
                      }
                    : current.liveThought
                }))
              : state.taskProgressBySession
          }));
        },
        
        setComposerValue: (value: string) => {
          set({ composerValue: value });
        },

        setComposerImage: (image: ComposerImageAttachment | null) => {
          set({ composerImage: image });
        },

        clearComposerImage: () => {
          set({ composerImage: null });
        },
        
        // Panel Actions (new)
        openPanel: (view: WorkspacePanelView) => {
          set({
            panelOpen: true,
            panelView: view,
            panelWidth: getPanelWidthPreset(view)
          });
        },
        
        closePanel: () => {
          set({ panelOpen: false });
        },
        
        togglePanel: (view: WorkspacePanelView) => {
          const state = get();
          if (state.panelOpen && state.panelView === view) {
            set({ panelOpen: false });
          } else {
            set({
              panelOpen: true,
              panelView: view,
              panelWidth: getPanelWidthPreset(view)
            });
          }
        },
        
        setPanelWidth: (width: number) => {
          set({ panelWidth: width });
        },
        
        // Iteration Actions
        updateIterationState: (state: UIIterationState | null) => {
          set({ iterationState: state });
        },

        abortIteration: () => {
          const sessionId = get().iterationState?.sessionId;
          if (sessionId && socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
              type: 'iteration:abort',
              sessionId
            }));
          }
          set({ iterationState: null });
        },
        
        clearSession: (sessionId: string) => {
          const { [sessionId]: _, ...remainingMessages } = get().messages;
          const { [sessionId]: __, ...remainingTaskProgress } = get().taskProgressBySession;
          set((state) => ({
            sessions: state.sessions.filter(s => s.sessionId !== sessionId),
            messages: remainingMessages,
            taskProgressBySession: remainingTaskProgress,
            activeSessionId: state.activeSessionId === sessionId 
              ? null 
              : state.activeSessionId,
          }));
        },

        // Agent Actions
        updateAgentState: (state: UIAgentState | null) => {
          set({ agentState: state });
        },

        setAgentAnalyzing: (isAnalyzing: boolean) => {
          const currentState = get().agentState;
          if (currentState) {
            set({
              agentState: {
                ...currentState,
                isAnalyzing
              }
            });
          }
        },

        clearAgentState: () => {
          set({ agentState: null });
        },

        // Action Block Actions
        setActionBlocks: (messageId: string, blocks: ActionBlock[]) => {
          set((state) => ({
            actionBlocksByMessage: {
              ...state.actionBlocksByMessage,
              [messageId]: blocks,
            },
          }));
        },

        updateActionBlock: (messageId: string, blockId: string, updates: Partial<ActionBlock>) => {
          set((state) => {
            const messageBlocks = state.actionBlocksByMessage[messageId] ?? [];
            const updatedBlocks = messageBlocks.map((block) =>
              block.id === blockId ? { ...block, ...updates } : block
            );
            return {
              actionBlocksByMessage: {
                ...state.actionBlocksByMessage,
                [messageId]: updatedBlocks,
              },
            };
          });
        },

        setCurrentTurnCheckpoints: (checkpoints: TaskCheckpoint[]) => {
          set({ currentTurnCheckpoints: checkpoints });
        },

        setCurrentMessageId: (messageId: string | null) => {
          set({ currentMessageId: messageId });
        },

        clearActionBlocks: (messageId: string) => {
          set((state) => {
            const { [messageId]: _, ...remaining } = state.actionBlocksByMessage;
            return {
              actionBlocksByMessage: remaining,
            };
          });
        },
      }),
      {
        name: 'terranet-chat-storage',
        partialize: (state) => ({
          sessions: state.sessions,
          messages: state.messages,
          activeSessionId: state.activeSessionId,
          taskProgressBySession: state.taskProgressBySession,
          actionBlocksByMessage: state.actionBlocksByMessage,
        }),
      }
    ),
    { name: 'chatStore' }
  )
);
