import {
  type GveTask,
  type GveTaskAction,
  type GveTaskStatus,
  type SessionMessage as ApiSessionMessage,
} from '@visual-runtime/shared';
import {
  DEFAULT_TASK_DEFINITIONS,
  MAX_STAGE_EVENT_ENTRIES,
  ORCHESTRATION_STEP_TO_ACTION,
  PIPELINE_ACTION_ORDER,
  PANEL_WIDTH_RATIO_BY_VIEW
} from './constants';
import {
  type Session,
  type SessionMessage,
  type StageEventMap,
  type StageEventEntry,
  type WorkspacePanelView,
  type SessionTaskProgress
} from './types';
import { MEDIA_READY_TEXT, MEDIA_SYNCING_TEXT, MEDIA_UNAVAILABLE_TEXT } from './media-strings';

export function nowIso(): string {
  return new Date().toISOString();
}

export function cloneDefaultTasks(): GveTask[] {
  return DEFAULT_TASK_DEFINITIONS.map((task) => ({
    ...task,
    dependsOn: [...task.dependsOn],
    status: 'pending'
  }));
}

export function normalizeTaskStatus(value: unknown, fallback: GveTaskStatus = 'running'): GveTaskStatus {
  if (value === 'pending' || value === 'running' || value === 'completed' || value === 'failed') {
    return value;
  }
  return fallback;
}

export function createEmptyStageEventMap(): StageEventMap {
  const map = {} as StageEventMap;
  for (const action of PIPELINE_ACTION_ORDER) {
    map[action] = [];
  }
  return map;
}

export function normalizeStageEventMap(value: unknown): StageEventMap {
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
    provision_sandbox: Array.isArray(map.provision_sandbox) ? map.provision_sandbox : fallback.provision_sandbox,
    analyze_quality: Array.isArray(map.analyze_quality) ? map.analyze_quality : fallback.analyze_quality,
    autonomous_patching: Array.isArray(map.autonomous_patching) ? map.autonomous_patching : fallback.autonomous_patching,
    execute_code: Array.isArray(map.execute_code) ? map.execute_code : fallback.execute_code,
    sync_state: Array.isArray(map.sync_state) ? map.sync_state : fallback.sync_state
  };
}

export function appendStageEvent(
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

export function formatStepTitle(step: string | null | undefined): string {
  if (!step) {
    return 'Pipeline';
  }

  return step.replace(/_/g, ' ');
}

export function formatOrchestrationEventText(step: string | null | undefined, status: GveTaskStatus): string {
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

export function formatPayloadValue(value: unknown): string | null {
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

export function formatOrchestrationEventDetail(payload: Record<string, unknown> | null): string | null {
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

export function findRunningStageAction(tasks: GveTask[]): GveTaskAction | null {
  const runningTask = tasks.find((task) => task.status === 'running');
  return runningTask?.action ?? null;
}

export function resolveActiveStageAction(
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

export function mapStepToAction(step: string | null | undefined): GveTaskAction | null {
  if (!step) {
    return null;
  }
  return ORCHESTRATION_STEP_TO_ACTION[step] ?? null;
}

export function applyStepStatusToTasks(tasks: GveTask[], step: string | null | undefined, status: GveTaskStatus): GveTask[] {
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

export function statusToStep(status: Session['status'] | undefined): string | null {
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

export function isMediaScene(scene: Session['currentScene'] | null | undefined): boolean {
  if (!scene) {
    return false;
  }

  return scene.outputKind === 'media'
    || (typeof scene.mediaType === 'string' && scene.mediaType.startsWith('video/'))
    || scene.skill === 'manim';
}

export function hasMediaUrl(scene: Session['currentScene'] | null | undefined): boolean {
  const mediaUrl = typeof scene?.mediaUrl === 'string' ? scene.mediaUrl.trim() : '';
  return mediaUrl.length > 0 && mediaUrl !== 'about:blank';
}

export function normalizeTaskList(tasks: unknown): GveTask[] {
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

export function getPanelWidthPreset(view: WorkspacePanelView): number {
  const fallbackByView: Record<WorkspacePanelView, number> = {
    preview: 840,
    code: 840,
    files: 620,
    workspace: 840,
    diff: 840,
  };

  if (typeof window === 'undefined') {
    return fallbackByView[view];
  }

  const viewportWidth = window.innerWidth;
  const minimumWidthByView: Record<WorkspacePanelView, number> = {
    preview: 360,
    code: 360,
    files: 360,
    workspace: 360,
    diff: 360,
  };
  const minimumWidth = minimumWidthByView[view] ?? 360;
  const preservedChatWidth = viewportWidth < 980 ? 280 : 360;
  // was view tasks
  const maxWidth = Math.max(minimumWidth, viewportWidth - preservedChatWidth);
  const ratio = PANEL_WIDTH_RATIO_BY_VIEW[view] ?? 0.42;
  const proposed = Math.round(viewportWidth * ratio);

  return Math.max(minimumWidth, Math.min(proposed, maxWidth));
}

export function createDefaultTaskProgress(sessionId: string): SessionTaskProgress {
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

export function updateTaskProgressMap(
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

export function patchTaskProgressFromScene(
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
      next.mediaStatusText = MEDIA_READY_TEXT;
    } else if (next.turnStatus === 'running') {
      next.mediaStage = next.mediaStage === 'idle' ? 'syncing' : next.mediaStage;
      if (!next.mediaStatusText) {
        next.mediaStatusText = MEDIA_SYNCING_TEXT;
      }
    } else {
      next.mediaStage = 'error';
      next.mediaStatusText = MEDIA_UNAVAILABLE_TEXT;
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

export function reconcileTaskProgressMap(
  existing: Record<string, SessionTaskProgress>,
  sessions: Session[]
): Record<string, SessionTaskProgress> {
  const next: Record<string, SessionTaskProgress> = {};

  for (const session of sessions) {
    if (!session?.sessionId) continue;
    const baseline = existing[session.sessionId] ?? createDefaultTaskProgress(session.sessionId);
    next[session.sessionId] = patchTaskProgressFromScene(baseline, session);
  }

  return next;
}

export function sortSessionsByUpdatedAt(sessions: Session[]): Session[] {
  return [...sessions].filter(Boolean).sort((left, right) => {
    const leftTimestamp = new Date(left.updatedAt ?? 0).getTime();
    const rightTimestamp = new Date(right.updatedAt ?? 0).getTime();
    return rightTimestamp - leftTimestamp;
  });
}

export function normalizeMessage(message: ApiSessionMessage): SessionMessage {
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

export function upsertMessage(messages: SessionMessage[], message: SessionMessage): SessionMessage[] {
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

export function mergeMessages(existing: SessionMessage[], incoming: SessionMessage[]): SessionMessage[] {
  return incoming.reduce((messages, message) => upsertMessage(messages, message), existing);
}

export function upsertSession(sessions: Session[], session: Session): Session[] {
  if (!session) return sessions;
  const existingIndex = sessions.findIndex((item) => item?.sessionId === session.sessionId);
  if (existingIndex === -1) {
    return sortSessionsByUpdatedAt([session, ...sessions]);
  }

  const nextSessions = [...sessions];
  nextSessions[existingIndex] = session;
  return sortSessionsByUpdatedAt(nextSessions);
}

export function createClientMessageId(prefix: string): string {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  return `${prefix}-${randomId}`;
}

export function buildClientSession(raw: any): Session | null {
  if (!raw || typeof raw !== "object") return null;

  const sessionId =
    typeof raw.sessionId === "string" && raw.sessionId.trim()
      ? raw.sessionId.trim()
      : raw.id?.trim() ?? null;
  if (!sessionId) return null;

  return {
    sessionId,
    sceneId: raw.sceneId ?? null,
    versionCount: Number.isFinite(raw.versionCount) ? raw.versionCount : 0,
    versionPointer: Number.isFinite(raw.versionPointer) ? raw.versionPointer : undefined,
    revisionCount: Number.isFinite(raw.revisionCount) ? raw.revisionCount : undefined,
    revisionPointer: Number.isFinite(raw.revisionPointer) ? raw.revisionPointer : undefined,
    artifactCount: Number.isFinite(raw.artifactCount) ? raw.artifactCount : undefined,
    artifactPointer: Number.isFinite(raw.artifactPointer) ? raw.artifactPointer : undefined,
    currentArtifactId: raw.currentArtifactId ?? null,
    canUndo: raw.canUndo ?? false,
    canRedo: raw.canRedo ?? false,
    canPreviousArtifact: raw.canPreviousArtifact ?? false,
    canNextArtifact: raw.canNextArtifact ?? false,
    currentScene: raw.currentScene ?? null,
    versions: Array.isArray(raw.versions) ? raw.versions : [],
    sceneVersions: Array.isArray(raw.sceneVersions) ? raw.sceneVersions : undefined,
    artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : undefined,
    messages: Array.isArray(raw.messages) ? raw.messages : undefined,
    orchestrationTrace: Array.isArray(raw.orchestrationTrace) ? raw.orchestrationTrace : undefined,
    status: raw.status ?? undefined,
    createdAt: raw.createdAt ?? nowIso(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? nowIso(),
  } satisfies Session;
}

export function isThoughtMessage(message: SessionMessage): boolean {
  return message.role === 'thought' || message.kind === 'thought';
}
