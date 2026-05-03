import { randomUUID } from "node:crypto";
import { loadAllSessions, saveSession, saveSessionSync, flushAll } from "./file-store.js";
import type { 
  InternalSessionState, 
  SessionState, 
  Artifact, 
  SceneVersion, 
  SessionMessage, 
  TraceEntry,
  SessionStatus
} from "../types/session.js";

const sessions = new Map<string, InternalSessionState>();
let initialized = false;

/**
 * Initialize sessions from disk. Call once on server startup.
 */
export function initializeSessions(): void {
  if (initialized) return;

  const persisted = loadAllSessions();
  for (const [id, state] of persisted) {
    const internalState = migrateToInternalState(state);
    sessions.set(id, internalState);
  }

  initialized = true;
  console.log(`[SessionState] Initialized with ${sessions.size} session(s).`);
}

export function shutdownSessions(): void {
  flushAll();
}

function persistSession(session: InternalSessionState): void {
  saveSession(session.sessionId, session as any);
}

function isoNow(): string {
  return new Date().toISOString();
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(Math.max(value, minimum), maximum);
}

function cloneSceneVersion(version: SceneVersion | null): SceneVersion | null {
  if (!version) return null;
  return { ...version };
}

function normalizeSceneVersion(
  version: any, 
  artifactId: string, 
  artifactVersion: number, 
  globalVersion: number, 
  fallbackTime: string
): SceneVersion {
  const updatedAt = version.updatedAt ?? fallbackTime;
  const createdAt = version.createdAt ?? updatedAt;

  return {
    ...version,
    versionId: version.versionId ?? `version-${globalVersion}`,
    version: globalVersion,
    artifactId,
    artifactVersion,
    source: version.source ?? "generate",
    sceneId: version.sceneId ?? `scene-${artifactId}`,
    createdAt,
    updatedAt
  };
}

function deriveArtifactTitle(artifact: Artifact, index: number): string {
  if (artifact.title?.trim()) {
    return artifact.title.trim();
  }

  const firstRevision = artifact.revisions?.[0];
  if (firstRevision?.sceneId) {
    return firstRevision.sceneId;
  }

  return `Artifact ${index + 1}`;
}

function flattenArtifactRevisions(artifacts: Artifact[]): SceneVersion[] {
  const all: SceneVersion[] = [];
  for (const artifact of artifacts) {
    for (const revision of artifact.revisions) {
      all.push(revision);
    }
  }
  return all;
}

function buildRevisionLocations(session: InternalSessionState): any[] {
  const locations: any[] = [];
  for (let artifactIndex = 0; artifactIndex < session.artifacts.length; artifactIndex += 1) {
    const artifact = session.artifacts[artifactIndex];
    if (!artifact) continue;
    for (let revisionIndex = 0; revisionIndex < artifact.revisions.length; revisionIndex += 1) {
      const revision = artifact.revisions[revisionIndex] as SceneVersion;
      locations.push({
        artifactIndex,
        revisionIndex,
        versionId: revision.versionId,
        sceneId: revision.sceneId
      });
    }
  }
  return locations;
}

function resolveCurrentLocationIndex(session: InternalSessionState, locations: any[]): number {
  if (!locations.length) return -1;

  const activeArtifact = session.artifacts[session.artifactPointer];
  const activeRevisionPointer = activeArtifact?.revisionPointer ?? -1;

  const directIndex = locations.findIndex(
    (location) =>
      location.artifactIndex === session.artifactPointer &&
      location.revisionIndex === activeRevisionPointer
  );

  if (directIndex >= 0) return directIndex;

  if (session.currentScene?.versionId) {
    const byVersionId = locations.findIndex((location) => location.versionId === session.currentScene!.versionId);
    if (byVersionId >= 0) return byVersionId;
  }

  if (session.currentScene?.sceneId) {
    const bySceneId = locations.findIndex((location) => location.sceneId === session.currentScene!.sceneId);
    if (bySceneId >= 0) return bySceneId;
  }

  return locations.length - 1;
}

function syncDerivedSessionFields(session: InternalSessionState): void {
  if (!Array.isArray(session.artifacts)) {
    session.artifacts = [];
  }

  if (session.artifacts.length === 0) {
    session.artifactPointer = -1;
    session.currentScene = null;
    return;
  }

  session.artifactPointer = clamp(session.artifactPointer ?? session.artifacts.length - 1, 0, session.artifacts.length - 1);
  const activeArtifact = session.artifacts[session.artifactPointer] as Artifact;

  if (!Array.isArray(activeArtifact.revisions)) {
    activeArtifact.revisions = [];
  }

  if (activeArtifact.revisions.length === 0) {
    activeArtifact.revisionPointer = -1;
    session.currentScene = null;
    return;
  }

  activeArtifact.revisionPointer = clamp(activeArtifact.revisionPointer ?? activeArtifact.revisions.length - 1, 0, activeArtifact.revisions.length - 1);
  session.currentScene = activeArtifact.revisions[activeArtifact.revisionPointer] as SceneVersion;
}

function migrateToInternalState(rawSession: any): InternalSessionState {
  const now = isoNow();
  let artifacts: any[] = rawSession.artifacts ?? [];
  let artifactPointer = rawSession.artifactPointer ?? -1;

  // Legacy Hydration
  if (artifacts.length === 0) {
    const legacyRevisions =
      Array.isArray(rawSession.sceneVersions) && rawSession.sceneVersions.length > 0
        ? rawSession.sceneVersions
        : Array.isArray(rawSession.versions) && rawSession.versions.length > 0
          ? rawSession.versions
          : rawSession.currentScene
            ? [rawSession.currentScene]
            : [];

    if (legacyRevisions.length > 0) {
      let activeArtifact: any = null;
      let globalVersion = 0;

      for (const revision of legacyRevisions) {
        if (!revision) continue;
        const source = revision.source ?? "generate";
        const sceneChanged =
          Boolean(activeArtifact?.revisions?.[0]?.sceneId) &&
          Boolean(revision.sceneId) &&
          activeArtifact.revisions[0].sceneId !== revision.sceneId;

        const startsNewArtifact = !activeArtifact || source === "generate" || source === "image-to-code" || source === "fallback" || sceneChanged;

        if (startsNewArtifact) {
          activeArtifact = {
            artifactId: revision.artifactId ?? `artifact-${Date.now()}-${artifacts.length + 1}`,
            title: revision.sceneId ?? `Artifact ${artifacts.length + 1}`,
            createdAt: revision.createdAt ?? now,
            updatedAt: revision.updatedAt ?? revision.createdAt ?? now,
            revisions: [],
            revisionPointer: -1
          };
          artifacts.push(activeArtifact);
        }

        globalVersion += 1;
        const artifactVersion = activeArtifact.revisions.length + 1;
        const normalizedRevision = normalizeSceneVersion(
          { ...revision, source },
          activeArtifact.artifactId,
          artifactVersion,
          globalVersion,
          now
        );

        activeArtifact.revisions.push(normalizedRevision);
        activeArtifact.revisionPointer = activeArtifact.revisions.length - 1;
        activeArtifact.updatedAt = normalizedRevision.updatedAt;
      }

      artifactPointer = artifacts.length - 1;
      
      if (rawSession.currentScene?.versionId) {
        const idx = artifacts.findIndex(a => a.revisions.some((r: any) => r.versionId === rawSession.currentScene.versionId));
        if (idx >= 0) {
          artifactPointer = idx;
          artifacts[idx].revisionPointer = artifacts[idx].revisions.findIndex((r: any) => r.versionId === rawSession.currentScene.versionId);
        }
      }
    }
  }

  // Normalization
  let globalVersion = 0;
  const typedArtifacts: Artifact[] = artifacts.map((artifact: any, artifactIndex: number) => {
    const artifactId = artifact.artifactId ?? `artifact-${rawSession.sessionId}-${artifactIndex + 1}`;
    const revisions = Array.isArray(artifact.revisions) ? artifact.revisions : [];

    const normalizedRevisions = revisions.map((revision: any, revisionIndex: number) => {
      globalVersion += 1;
      return normalizeSceneVersion(
        revision,
        revision.artifactId ?? artifactId,
        revision.artifactVersion ?? revisionIndex + 1,
        globalVersion,
        now
      );
    });

    const revisionPointer = normalizedRevisions.length === 0
      ? -1
      : clamp(artifact.revisionPointer ?? normalizedRevisions.length - 1, 0, normalizedRevisions.length - 1);

    const createdAt = artifact.createdAt ?? normalizedRevisions[0]?.createdAt ?? now;
    const updatedAt = artifact.updatedAt ?? normalizedRevisions[normalizedRevisions.length - 1]?.updatedAt ?? createdAt;

    return {
      artifactId,
      title: artifact.title ?? deriveArtifactTitle({ ...artifact, revisions: normalizedRevisions } as any, artifactIndex),
      createdAt,
      updatedAt,
      revisions: normalizedRevisions,
      revisionPointer
    };
  });

  const internalState: InternalSessionState = {
    sessionId: rawSession.sessionId,
    status: rawSession.status ?? "idle",
    artifacts: typedArtifacts,
    artifactPointer: clamp(artifactPointer, -1, typedArtifacts.length - 1),
    currentScene: null, // synced below
    workspace: rawSession.workspace ?? null,
    messages: Array.isArray(rawSession.messages) ? rawSession.messages.map((m: any) => ({...m})) : [],
    orchestrationTrace: Array.isArray(rawSession.orchestrationTrace) ? rawSession.orchestrationTrace.map((t: any) => ({...t})) : [],
    createdAt: rawSession.createdAt ?? now,
    updatedAt: rawSession.updatedAt ?? now
  };

  syncDerivedSessionFields(internalState);
  return internalState;
}

function cloneSessionState(session: InternalSessionState): SessionState {
  const activeArtifact = session.artifacts[session.artifactPointer];
  const currentVersions = activeArtifact?.revisions ?? [];
  const revisionPointer = activeArtifact?.revisionPointer ?? -1;
  const allSceneVersions = flattenArtifactRevisions(session.artifacts);

  return {
    sessionId: session.sessionId,
    ownerId: session.ownerId,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    
    // Core state
    artifacts: session.artifacts.map(a => ({
      ...a,
      revisions: a.revisions.map(r => ({ ...r }))
    })),
    artifactPointer: session.artifactPointer,
    currentScene: cloneSceneVersion(session.currentScene),
    workspace: session.workspace ? { ...session.workspace, files: {...session.workspace.files} } : null,
    messages: session.messages.map(m => ({ ...m })),
    orchestrationTrace: session.orchestrationTrace.map(t => ({ ...t })),

    // API backward-compatibility getters
    versionCount: currentVersions.length,
    versionPointer: revisionPointer,
    revisionCount: currentVersions.length,
    revisionPointer,
    artifactCount: session.artifacts.length,
    currentArtifactId: activeArtifact?.artifactId ?? null,
    canUndo: revisionPointer > 0,
    canRedo: revisionPointer < currentVersions.length - 1,
    canPreviousArtifact: session.artifactPointer > 0,
    canNextArtifact: session.artifactPointer < session.artifacts.length - 1,
    versions: currentVersions.map(v => ({ ...v })),
    sceneVersions: allSceneVersions.map(v => ({ ...v })),
    sceneId: session.currentScene?.sceneId ?? null
  };
}

function createInternalSession(sessionId: string, ownerId: string | null = null): InternalSessionState {
  const now = isoNow();
  return {
    sessionId,
    ownerId,
    createdAt: now,
    updatedAt: now,
    status: "idle",
    currentScene: null,
    workspace: null,
    artifacts: [],
    artifactPointer: -1,
    messages: [],
    orchestrationTrace: []
  };
}

export function getOrCreateInternalSession(sessionId: string, ownerId: string | null = null): InternalSessionState {
  const resolvedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!resolvedSessionId) {
    throw new Error("Session ID is required.");
  }

  const existing = sessions.get(resolvedSessionId);
  if (existing) {
    return existing;
  }

  const session = createInternalSession(resolvedSessionId, ownerId);
  sessions.set(resolvedSessionId, session);
  return session;
}

export function createSession(sessionId?: string, ownerId: string | null = null): SessionState {
  const resolvedSessionId = sessionId?.trim() || randomUUID();
  const existing = sessions.get(resolvedSessionId);

  if (existing) {
    return cloneSessionState(existing);
  }

  const session = createInternalSession(resolvedSessionId, ownerId);
  sessions.set(resolvedSessionId, session);
  saveSessionSync(resolvedSessionId, session as any);
  return cloneSessionState(session);
}

export function isSessionOwner(session: SessionState | InternalSessionState, userId: string | null): boolean {
  if (!session.ownerId) return true; // Public or unowned session
  return session.ownerId === userId;
}

export function listSessions(userId: string | null = null): SessionState[] {
  return Array.from(sessions.values())
    .filter(s => isSessionOwner(s, userId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(cloneSessionState);
}

export function ensureSession(sessionId: string): SessionState {
  return createSession(sessionId);
}

export function recordSceneVersion(sessionId: string, sceneSnapshot: any): SessionState {
  const session = getOrCreateInternalSession(sessionId);
  const now = isoNow();

  const source = sceneSnapshot.source ?? "generate";
  const createsNewArtifact = source !== "modify" || session.artifacts.length === 0 || sceneSnapshot.forceNewArtifact === true;

  if (createsNewArtifact && session.artifactPointer >= 0 && session.artifactPointer < session.artifacts.length - 1) {
    session.artifacts = session.artifacts.slice(0, session.artifactPointer + 1);
  }

  let activeArtifact = session.artifacts[session.artifactPointer];

  if (createsNewArtifact || !activeArtifact) {
    const artifactId = sceneSnapshot.artifactId ?? `artifact-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    activeArtifact = {
      artifactId,
      title: sceneSnapshot.artifactTitle ?? sceneSnapshot.sceneId ?? `Artifact ${session.artifacts.length + 1}`,
      createdAt: now,
      updatedAt: now,
      revisions: [],
      revisionPointer: -1
    };
    session.artifacts.push(activeArtifact);
    session.artifactPointer = session.artifacts.length - 1;
  } else if (activeArtifact.revisionPointer >= 0 && activeArtifact.revisionPointer < activeArtifact.revisions.length - 1) {
    activeArtifact.revisions = activeArtifact.revisions.slice(0, activeArtifact.revisionPointer + 1);
  }

  const globalVersion = flattenArtifactRevisions(session.artifacts).length + 1;
  const artifactVersion = activeArtifact.revisions.length + 1;
  const sceneId = sceneSnapshot.sceneId ?? activeArtifact.revisions[activeArtifact.revisionPointer]?.sceneId ?? session.currentScene?.sceneId ?? `scene-${sessionId}`;

  const currentScene = normalizeSceneVersion(
    {
      sessionId,
      sceneId,
      code: sceneSnapshot.code ?? null,
      previewUrl: sceneSnapshot.previewUrl ?? null,
      skill: sceneSnapshot.skill ?? null,
      outputKind: sceneSnapshot.outputKind ?? null,
      mediaType: sceneSnapshot.mediaType ?? null,
      mediaUrl: sceneSnapshot.mediaUrl ?? null,
      mediaArtifactId: sceneSnapshot.mediaArtifactId ?? null,
      mediaDurationMs: Number.isFinite(sceneSnapshot.mediaDurationMs) ? sceneSnapshot.mediaDurationMs : null,
      mediaFps: Number.isFinite(sceneSnapshot.mediaFps) ? sceneSnapshot.mediaFps : null,
      mediaResolution: sceneSnapshot.mediaResolution ?? null,
      mediaBytes: Number.isFinite(sceneSnapshot.mediaBytes) ? sceneSnapshot.mediaBytes : null,
      assetPlan: sceneSnapshot.assetPlan ?? null,
      explanation: sceneSnapshot.explanation ?? null,
      messageId: sceneSnapshot.messageId ?? null,
      source,
      createdAt: createsNewArtifact ? now : activeArtifact.revisions[0]?.createdAt ?? now,
      updatedAt: now
    },
    activeArtifact.artifactId,
    artifactVersion,
    globalVersion,
    now
  );

  activeArtifact.revisions.push(currentScene);
  activeArtifact.revisionPointer = activeArtifact.revisions.length - 1;
  activeArtifact.updatedAt = now;

  if (createsNewArtifact && !activeArtifact.title) {
    activeArtifact.title = sceneId;
  }

  syncDerivedSessionFields(session);
  session.updatedAt = now;
  persistSession(session);

  return cloneSessionState(session);
}

export function undoSceneVersion(sessionId: string): { success: boolean; reason: string | null; state: SessionState } {
  const session = getOrCreateInternalSession(sessionId);

  if (session.artifacts.length === 0) {
    return { success: false, reason: "No artifacts available.", state: cloneSessionState(session) };
  }

  const activeArtifact = session.artifacts[session.artifactPointer];

  if (!activeArtifact || activeArtifact.revisions.length === 0) {
    return { success: false, reason: "No revisions to undo.", state: cloneSessionState(session) };
  }

  const pointer = activeArtifact.revisionPointer ?? activeArtifact.revisions.length - 1;

  if (pointer <= 0) {
    return { success: false, reason: "Already at the earliest revision for this artifact.", state: cloneSessionState(session) };
  }

  activeArtifact.revisionPointer = pointer - 1;
  activeArtifact.updatedAt = isoNow();
  syncDerivedSessionFields(session);
  session.updatedAt = isoNow();
  persistSession(session);

  return { success: true, reason: null, state: cloneSessionState(session) };
}

export function redoSceneVersion(sessionId: string): { success: boolean; reason: string | null; state: SessionState } {
  const session = getOrCreateInternalSession(sessionId);

  if (session.artifacts.length === 0) {
    return { success: false, reason: "No artifacts available.", state: cloneSessionState(session) };
  }

  const activeArtifact = session.artifacts[session.artifactPointer];

  if (!activeArtifact || activeArtifact.revisions.length === 0) {
    return { success: false, reason: "No revisions to redo.", state: cloneSessionState(session) };
  }

  const pointer = activeArtifact.revisionPointer ?? activeArtifact.revisions.length - 1;

  if (pointer >= activeArtifact.revisions.length - 1) {
    return { success: false, reason: "Already at the latest revision for this artifact.", state: cloneSessionState(session) };
  }

  activeArtifact.revisionPointer = pointer + 1;
  activeArtifact.updatedAt = isoNow();
  syncDerivedSessionFields(session);
  session.updatedAt = isoNow();
  persistSession(session);

  return { success: true, reason: null, state: cloneSessionState(session) };
}

function navigateArtifact(sessionId: string, direction: number): { success: boolean; reason: string | null; state: SessionState } {
  const session = getOrCreateInternalSession(sessionId);

  if (session.artifacts.length === 0) {
    return { success: false, reason: "No artifacts available.", state: cloneSessionState(session) };
  }

  const nextPointer = session.artifactPointer + direction;

  if (nextPointer < 0 || nextPointer >= session.artifacts.length) {
    return {
      success: false,
      reason: direction < 0 ? "Already at the earliest artifact." : "Already at the latest artifact.",
      state: cloneSessionState(session)
    };
  }

  session.artifactPointer = nextPointer;
  syncDerivedSessionFields(session);
  session.updatedAt = isoNow();
  persistSession(session);

  return { success: true, reason: null, state: cloneSessionState(session) };
}

function navigateSessionVersion(sessionId: string, direction: number): { success: boolean; reason: string | null; state: SessionState } {
  const session = getOrCreateInternalSession(sessionId);

  if (session.artifacts.length === 0) {
    return { success: false, reason: "No artifacts available.", state: cloneSessionState(session) };
  }

  const locations = buildRevisionLocations(session);
  if (locations.length === 0) {
    return { success: false, reason: "No versions available.", state: cloneSessionState(session) };
  }

  const currentIndex = resolveCurrentLocationIndex(session, locations);
  const targetIndex = currentIndex + direction;

  if (targetIndex < 0 || targetIndex >= locations.length) {
    return {
      success: false,
      reason: direction < 0 ? "Already at the earliest version." : "Already at the latest version.",
      state: cloneSessionState(session)
    };
  }

  const targetLocation = locations[targetIndex];
  const targetArtifact = session.artifacts[targetLocation.artifactIndex] as Artifact;

  session.artifactPointer = targetLocation.artifactIndex;
  targetArtifact.revisionPointer = targetLocation.revisionIndex;

  syncDerivedSessionFields(session);
  session.updatedAt = isoNow();
  persistSession(session);

  return { success: true, reason: null, state: cloneSessionState(session) };
}

export function previousArtifactVersion(sessionId: string) { return navigateArtifact(sessionId, -1); }
export function nextArtifactVersion(sessionId: string) { return navigateArtifact(sessionId, 1); }
export function previousRevision(sessionId: string) { return undoSceneVersion(sessionId); }
export function nextRevision(sessionId: string) { return redoSceneVersion(sessionId); }
export function previousSceneVersion(sessionId: string) { return navigateSessionVersion(sessionId, -1); }
export function nextSceneVersion(sessionId: string) { return navigateSessionVersion(sessionId, 1); }

export function selectSceneVersion(sessionId: string, versionId: string): { success: boolean; reason: string | null; state: SessionState } {
  const session = getOrCreateInternalSession(sessionId);

  if (session.artifacts.length === 0) {
    return { success: false, reason: "No artifacts available.", state: cloneSessionState(session) };
  }

  const normalizedVersionId = String(versionId ?? "").trim();
  if (!normalizedVersionId) {
    return { success: false, reason: "Version id is required.", state: cloneSessionState(session) };
  }

  const locations = buildRevisionLocations(session);
  if (locations.length === 0) {
    return { success: false, reason: "No versions available.", state: cloneSessionState(session) };
  }

  const targetLocation = locations.find((location) => location.versionId === normalizedVersionId);
  if (!targetLocation) {
    return { success: false, reason: "Version not found.", state: cloneSessionState(session) };
  }

  const targetArtifact = session.artifacts[targetLocation.artifactIndex] as Artifact;
  session.artifactPointer = targetLocation.artifactIndex;
  targetArtifact.revisionPointer = targetLocation.revisionIndex;

  syncDerivedSessionFields(session);
  session.updatedAt = isoNow();
  persistSession(session);

  return { success: true, reason: null, state: cloneSessionState(session) };
}

export function listSceneVersions(sessionId: string): any {
  const session = getOrCreateInternalSession(sessionId);

  const activeArtifact = session.artifacts[session.artifactPointer] ?? null;
  const pointer = activeArtifact?.revisionPointer ?? -1;

  return {
    sessionId: session.sessionId,
    artifactCount: session.artifacts.length,
    artifactPointer: session.artifactPointer,
    currentArtifactId: activeArtifact?.artifactId ?? null,
    versionCount: activeArtifact?.revisions.length ?? 0,
    versionPointer: pointer,
    revisionCount: activeArtifact?.revisions.length ?? 0,
    revisionPointer: pointer,
    versions: (activeArtifact?.revisions ?? []).map((version: SceneVersion, index: number) => ({
      ...version,
      isCurrent: index === pointer
    })),
    artifacts: session.artifacts.map((a, index) => ({
      artifactId: a.artifactId,
      title: deriveArtifactTitle(a, index),
      revisionCount: a.revisions.length,
      revisionPointer: a.revisionPointer,
      isCurrent: index === session.artifactPointer,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      latestSceneId: a.revisions[a.revisions.length - 1]?.sceneId ?? null,
      latestSkill: a.revisions[a.revisions.length - 1]?.skill ?? null
    })),
    artifactTimeline: session.artifacts.map((a, idx) => ({
      artifactId: a.artifactId,
      title: a.title,
      isCurrent: idx === session.artifactPointer,
      revisions: a.revisions.map((r, rIdx) => ({
        ...r,
        isCurrent: idx === session.artifactPointer && rIdx === a.revisionPointer
      }))
    }))
  };
}

export function createSessionMessageId(sessionId: string): string {
  const session = getOrCreateInternalSession(sessionId);
  return `message-${session.messages.length + 1}`;
}

export function appendOrchestrationTrace(sessionId: string, entry: Partial<TraceEntry> & { id?: string }): TraceEntry {
  const session = getOrCreateInternalSession(sessionId);
  const now = isoNow();
  const traceEntry: TraceEntry = {
    step: entry.step ?? "unknown",
    detail: entry.detail ?? undefined,
    payload: entry.payload ?? undefined,
    timestamp: entry.timestamp ?? now,
    duration: entry.duration
  };

  session.orchestrationTrace.push(traceEntry);
  session.updatedAt = now;
  return { ...traceEntry };
}

export function setSessionStatus(sessionId: string, status: SessionStatus): SessionState {
  const session = getOrCreateInternalSession(sessionId);
  const now = isoNow();
  session.status = status;
  session.updatedAt = now;
  persistSession(session);
  return cloneSessionState(session);
}

export function appendSessionMessage(sessionId: string, message: any): SessionMessage {
  const session = getOrCreateInternalSession(sessionId);
  const now = isoNow();
  const messageId = message.id ?? `message-${session.messages.length + 1}`;

  const existingMessage = session.messages.find((entry: SessionMessage) => entry.messageId === messageId);
  if (existingMessage) {
    return { ...existingMessage };
  }

  const storedMessage: SessionMessage = {
    messageId,
    role: message.role ?? "user",
    content: message.content ?? "",
    kind: message.kind,
    error: message.error,
    meta: message.meta,
    metadata: message.meta ?? {},
    createdAt: message.createdAt ?? now,
    updatedAt: now
  };

  session.messages.push(storedMessage);
  session.updatedAt = now;
  persistSession(session);
  return { ...storedMessage };
}

export function updateSessionMessage(sessionId: string, messageId: string, updates: Partial<SessionMessage>): SessionMessage | null {
  const session = getOrCreateInternalSession(sessionId);
  const messageIndex = session.messages.findIndex(m => m.messageId === messageId);
  
  if (messageIndex === -1) {
    return null;
  }
  
  const now = isoNow();
  const existing = session.messages[messageIndex] as SessionMessage;
  const updatedMessage: SessionMessage = {
    ...existing,
    ...updates,
    messageId: existing.messageId,
    role: updates.role ?? existing.role,
    content: updates.content ?? existing.content,
    createdAt: existing.createdAt,
    updatedAt: now
  };
  
  session.messages[messageIndex] = updatedMessage;
  session.updatedAt = now;
  persistSession(session);
  return { ...updatedMessage };
}

export function buildSessionResponse(sessionState: SessionState, websocketUrl?: string): any {
  return {
    session: sessionState,
    websocketUrl: websocketUrl ?? ""
  };
}

export function buildWebSocketUrl(req: any): string {
  const headers = req?.headers ?? {};
  const protocol = headers["x-forwarded-proto"] === "https" ? "wss" : "ws";
  const host = headers["x-forwarded-host"] || headers.host || "localhost:8000";
  return `${protocol}://${host}/ws`;
}

export function listSessionMessages(sessionId: string): SessionMessage[] {
  const session = getOrCreateInternalSession(sessionId);
  return session.messages.map((m: SessionMessage) => ({ ...m }));
}

export function buildSceneUpdatePayload(sessionId: string): any {
  const session = getOrCreateInternalSession(sessionId);
  const state = cloneSessionState(session);
  return {
    type: "scene_update",
    sessionId,
    scene: state.currentScene,
    versions: state.versions,
    currentVersionIndex: state.versionPointer
  };
}

export function buildCodeUpdatePayload(sessionId: string, payload: any): any {
  return {
    type: "code_update",
    sessionId,
    ...payload
  };
}
