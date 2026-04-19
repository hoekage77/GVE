import { randomUUID } from "node:crypto";
import { loadAllSessions, saveSession, saveSessionSync, flushAll } from "./file-store.js";

const sessions = new Map<string, any>();
let initialized = false;

/**
 * Initialize sessions from disk. Call once on server startup.
 */
export function initializeSessions(): void {
  if (initialized) return;

  const persisted = loadAllSessions();
  for (const [id, state] of persisted) {
    sessions.set(id, state);
  }

  initialized = true;
  console.log(`[SessionState] Initialized with ${sessions.size} session(s).`);
}

/**
 * Flush all pending writes. Call on server shutdown.
 */
export function shutdownSessions(): void {
  flushAll();
}

function persistSession(session: any): void {
  saveSession(session.sessionId, session);
}

function isoNow(): string {
  return new Date().toISOString();
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.min(Math.max(value, minimum), maximum);
}

function cloneSceneVersion(version: any): any {
  if (!version) {
    return null;
  }

  return { ...version };
}

function normalizeSceneVersion(version: any, artifactId: string, artifactVersion: number, globalVersion: number, fallbackTime: string): any {
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

function deriveArtifactTitle(artifact: any, index: number): string {
  if (artifact.title?.trim()) {
    return artifact.title.trim();
  }

  const firstRevision = artifact.revisions?.[0];
  if (firstRevision?.sceneId) {
    return firstRevision.sceneId;
  }

  return `Artifact ${index + 1}`;
}

function buildArtifactSummaries(session: any): any[] {
  const artifactPointer = session.artifactPointer ?? session.artifacts.length - 1;

  return session.artifacts.map((artifact: any, index: number) => ({
    artifactId: artifact.artifactId,
    title: deriveArtifactTitle(artifact, index),
    revisionCount: artifact.revisions.length,
    revisionPointer: artifact.revisionPointer,
    isCurrent: index === artifactPointer,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    latestSceneId: artifact.revisions[artifact.revisions.length - 1]?.sceneId ?? null,
    latestSkill: artifact.revisions[artifact.revisions.length - 1]?.skill ?? null
  }));
}

function flattenArtifactRevisions(artifacts: any[]): any[] {
  const all: any[] = [];
  for (const artifact of artifacts) {
    for (const revision of artifact.revisions) {
      all.push(revision);
    }
  }
  return all;
}

function buildRevisionLocations(session: any): any[] {
  const locations: any[] = [];

  for (let artifactIndex = 0; artifactIndex < session.artifacts.length; artifactIndex += 1) {
    const artifact = session.artifacts[artifactIndex];
    for (let revisionIndex = 0; revisionIndex < artifact.revisions.length; revisionIndex += 1) {
      const revision = artifact.revisions[revisionIndex];
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

function buildArtifactTimeline(session: any): any[] {
  return session.artifacts.map((artifact: any, artifactIndex: number) => {
    const pointer = artifact.revisionPointer ?? artifact.revisions.length - 1;

    return {
      artifactId: artifact.artifactId,
      title: artifact.title,
      isCurrent: artifactIndex === session.artifactPointer,
      revisions: artifact.revisions.map((revision: any, revisionIndex: number) => ({
        ...revision,
        isCurrent: artifactIndex === session.artifactPointer && revisionIndex === pointer
      }))
    };
  });
}

function resolveCurrentLocationIndex(session: any, locations: any[]): number {
  if (!locations.length) {
    return -1;
  }

  const activeArtifact = session.artifacts[session.artifactPointer];
  const activeRevisionPointer = activeArtifact?.revisionPointer ?? -1;

  const directIndex = locations.findIndex(
    (location) =>
      location.artifactIndex === session.artifactPointer &&
      location.revisionIndex === activeRevisionPointer
  );

  if (directIndex >= 0) {
    return directIndex;
  }

  if (session.currentScene?.versionId) {
    const byVersionId = locations.findIndex((location) => location.versionId === session.currentScene.versionId);
    if (byVersionId >= 0) {
      return byVersionId;
    }
  }

  if (session.currentScene?.sceneId) {
    const bySceneId = locations.findIndex((location) => location.sceneId === session.currentScene.sceneId);
    if (bySceneId >= 0) {
      return bySceneId;
    }
  }

  if (Number.isInteger(session.versionPointer) && session.versionPointer >= 0 && session.versionPointer < locations.length) {
    return session.versionPointer;
  }

  return locations.length - 1;
}

function syncDerivedSessionFields(session: any): void {
  if (!Array.isArray(session.artifacts)) {
    session.artifacts = [];
  }

  if (session.artifacts.length === 0) {
    session.artifactPointer = -1;
    session.currentScene = null;
    session.versions = [];
    session.sceneVersions = [];
    session.versionPointer = -1;
    session.revisionPointer = -1;
    return;
  }

  session.artifactPointer = clamp(session.artifactPointer ?? session.artifacts.length - 1, 0, session.artifacts.length - 1);
  const activeArtifact = session.artifacts[session.artifactPointer];

  if (!Array.isArray(activeArtifact.revisions)) {
    activeArtifact.revisions = [];
  }

  if (activeArtifact.revisions.length === 0) {
    activeArtifact.revisionPointer = -1;
    session.currentScene = null;
    session.versions = [];
    session.versionPointer = -1;
    session.revisionPointer = -1;
    session.sceneVersions = flattenArtifactRevisions(session.artifacts);
    return;
  }

  activeArtifact.revisionPointer = clamp(activeArtifact.revisionPointer ?? activeArtifact.revisions.length - 1, 0, activeArtifact.revisions.length - 1);

  session.currentScene = activeArtifact.revisions[activeArtifact.revisionPointer];
  session.versions = activeArtifact.revisions;
  session.versionPointer = activeArtifact.revisionPointer;
  session.revisionPointer = activeArtifact.revisionPointer;
  session.sceneVersions = flattenArtifactRevisions(session.artifacts);
}

function hydrateLegacyArtifacts(session: any): void {
  const now = isoNow();
  const legacyRevisions =
    Array.isArray(session.sceneVersions) && session.sceneVersions.length > 0
      ? session.sceneVersions
      : Array.isArray(session.versions) && session.versions.length > 0
        ? session.versions
        : session.currentScene
          ? [session.currentScene]
          : [];

  if (legacyRevisions.length === 0) {
    session.artifacts = [];
    session.artifactPointer = -1;
    return;
  }

  const artifacts: any[] = [];
  const flattenedLocations: any[] = [];

  let activeArtifact: any = null;
  let globalVersion = 0;

  for (const revision of legacyRevisions) {
    if (!revision) {
      continue;
    }

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

    flattenedLocations.push({
      versionId: normalizedRevision.versionId,
      artifactIndex: artifacts.length - 1,
      revisionIndex: activeArtifact.revisionPointer,
      sceneId: normalizedRevision.sceneId
    });
  }

  session.artifacts = artifacts;

  const currentVersionId = session.currentScene?.versionId;
  let targetLocation = currentVersionId ? flattenedLocations.find((entry) => entry.versionId === currentVersionId) : null;

  if (!targetLocation && Number.isInteger(session.versionPointer) && session.versionPointer >= 0 && session.versionPointer < flattenedLocations.length) {
    targetLocation = flattenedLocations[session.versionPointer];
  }

  if (!targetLocation && session.currentScene?.sceneId) {
    targetLocation = [...flattenedLocations].reverse().find((entry) => entry.sceneId === session.currentScene.sceneId) ?? null;
  }

  if (!targetLocation) {
    targetLocation = flattenedLocations[flattenedLocations.length - 1] ?? null;
  }

  if (targetLocation) {
    session.artifactPointer = targetLocation.artifactIndex;
    const targetArtifact = session.artifacts[targetLocation.artifactIndex];
    targetArtifact.revisionPointer = targetLocation.revisionIndex;
  } else {
    session.artifactPointer = artifacts.length - 1;
  }
}

function normalizeArtifacts(session: any): void {
  const now = isoNow();

  if (!Array.isArray(session.artifacts) || session.artifacts.length === 0) {
    hydrateLegacyArtifacts(session);
  }

  if (!Array.isArray(session.artifacts)) {
    session.artifacts = [];
  }

  let globalVersion = 0;
  session.artifacts = session.artifacts.map((artifact: any, artifactIndex: number) => {
    const artifactId = artifact.artifactId ?? `artifact-${session.sessionId}-${artifactIndex + 1}`;
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
      title: artifact.title ?? deriveArtifactTitle({ ...artifact, revisions: normalizedRevisions }, artifactIndex),
      createdAt,
      updatedAt,
      revisions: normalizedRevisions,
      revisionPointer
    };
  });

  syncDerivedSessionFields(session);
}

function cloneSessionState(session: any): any {
  normalizeArtifacts(session);

  const revisionPointer = session.revisionPointer ?? session.versionPointer ?? session.versions.length - 1;
  const artifactPointer = session.artifactPointer ?? session.artifacts.length - 1;

  return {
    sessionId: session.sessionId,
    sceneId: session.currentScene?.sceneId ?? null,
    versionCount: session.versions.length,
    versionPointer: revisionPointer,
    revisionCount: session.versions.length,
    revisionPointer,
    artifactCount: session.artifacts.length,
    artifactPointer,
    currentArtifactId: session.artifacts[artifactPointer]?.artifactId ?? null,
    canUndo: revisionPointer > 0,
    canRedo: revisionPointer < session.versions.length - 1,
    canPreviousArtifact: artifactPointer > 0,
    canNextArtifact: artifactPointer < session.artifacts.length - 1,
    currentScene: cloneSceneVersion(session.currentScene),
    versions: session.versions.map((version: any) => ({ ...version })),
    sceneVersions: session.sceneVersions.map((version: any) => ({ ...version })),
    artifacts: buildArtifactSummaries(session),
    messages: session.messages.map((message: any) => ({ ...message })),
    orchestrationTrace: session.orchestrationTrace.map((entry: any) => ({ ...entry })),
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  };
}

function createInternalSession(sessionId: string): any {
  const now = isoNow();

  return {
    sessionId,
    createdAt: now,
    updatedAt: now,
    status: "idle",
    currentScene: null,
    artifacts: [],
    artifactPointer: -1,
    versions: [],
    sceneVersions: [],
    versionPointer: -1,
    revisionPointer: -1,
    messages: [],
    orchestrationTrace: []
  };
}

function getOrCreateInternalSession(sessionId: string): any {
  const resolvedSessionId = sessionId?.trim();
  if (!resolvedSessionId) {
    throw new Error("Session ID is required.");
  }

  const existing = sessions.get(resolvedSessionId);
  if (existing) {
    normalizeArtifacts(existing);
    return existing;
  }

  const session = createInternalSession(resolvedSessionId);
  sessions.set(resolvedSessionId, session);
  return session;
}

export function createSession(sessionId?: string): any {
  const resolvedSessionId = sessionId?.trim() || randomUUID();
  const existing = sessions.get(resolvedSessionId);

  if (existing) {
    return cloneSessionState(existing);
  }

  const session = createInternalSession(resolvedSessionId);
  sessions.set(resolvedSessionId, session);
  saveSessionSync(resolvedSessionId, session);
  return cloneSessionState(session);
}

export function listSessions(): any[] {
  return Array.from(sessions.values())
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((session) => cloneSessionState(session));
}

export function ensureSession(sessionId: string): any {
  return createSession(sessionId);
}

export function recordSceneVersion(sessionId: string, sceneSnapshot: any): any {
  const session = getOrCreateInternalSession(sessionId);
  normalizeArtifacts(session);
  const now = isoNow();

  const source = sceneSnapshot.source ?? "generate";
  const createsNewArtifact = source !== "modify" || session.artifacts.length === 0 || sceneSnapshot.forceNewArtifact === true;

  if (createsNewArtifact && session.artifactPointer >= 0 && session.artifactPointer < session.artifacts.length - 1) {
    session.artifacts = session.artifacts.slice(0, session.artifactPointer + 1);
  }

  let activeArtifact = session.artifacts[session.artifactPointer] ?? null;

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
  sessions.set(sessionId, session);
  persistSession(session);

  return cloneSessionState(session);
}

export function undoSceneVersion(sessionId: string): { success: boolean; reason: string | null; state: any } {
  const session = getOrCreateInternalSession(sessionId);
  normalizeArtifacts(session);

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
  sessions.set(sessionId, session);
  persistSession(session);

  return { success: true, reason: null, state: cloneSessionState(session) };
}

export function redoSceneVersion(sessionId: string): { success: boolean; reason: string | null; state: any } {
  const session = getOrCreateInternalSession(sessionId);
  normalizeArtifacts(session);

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
  sessions.set(sessionId, session);
  persistSession(session);

  return { success: true, reason: null, state: cloneSessionState(session) };
}

function navigateArtifact(sessionId: string, direction: number): { success: boolean; reason: string | null; state: any } {
  const session = getOrCreateInternalSession(sessionId);
  normalizeArtifacts(session);

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
  sessions.set(sessionId, session);
  persistSession(session);

  return { success: true, reason: null, state: cloneSessionState(session) };
}

function navigateSessionVersion(sessionId: string, direction: number): { success: boolean; reason: string | null; state: any } {
  const session = getOrCreateInternalSession(sessionId);
  normalizeArtifacts(session);

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
  const targetArtifact = session.artifacts[targetLocation.artifactIndex];

  session.artifactPointer = targetLocation.artifactIndex;
  targetArtifact.revisionPointer = targetLocation.revisionIndex;

  syncDerivedSessionFields(session);
  session.updatedAt = isoNow();
  sessions.set(sessionId, session);
  persistSession(session);

  return { success: true, reason: null, state: cloneSessionState(session) };
}

export function previousArtifactVersion(sessionId: string) {
  return navigateArtifact(sessionId, -1);
}

export function nextArtifactVersion(sessionId: string) {
  return navigateArtifact(sessionId, 1);
}

export function previousRevision(sessionId: string) {
  return undoSceneVersion(sessionId);
}

export function nextRevision(sessionId: string) {
  return redoSceneVersion(sessionId);
}

export function previousSceneVersion(sessionId: string) {
  return navigateSessionVersion(sessionId, -1);
}

export function nextSceneVersion(sessionId: string) {
  return navigateSessionVersion(sessionId, 1);
}

export function selectSceneVersion(sessionId: string, versionId: string): { success: boolean; reason: string | null; state: any } {
  const session = getOrCreateInternalSession(sessionId);
  normalizeArtifacts(session);

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

  const targetArtifact = session.artifacts[targetLocation.artifactIndex];
  session.artifactPointer = targetLocation.artifactIndex;
  targetArtifact.revisionPointer = targetLocation.revisionIndex;

  syncDerivedSessionFields(session);
  session.updatedAt = isoNow();
  sessions.set(sessionId, session);
  persistSession(session);

  return { success: true, reason: null, state: cloneSessionState(session) };
}

export function listSceneVersions(sessionId: string): any {
  const session = getOrCreateInternalSession(sessionId);
  normalizeArtifacts(session);

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
    versions: (activeArtifact?.revisions ?? []).map((version: any, index: number) => ({
      ...version,
      isCurrent: index === pointer
    })),
    artifacts: buildArtifactSummaries(session),
    artifactTimeline: buildArtifactTimeline(session)
  };
}

export function createSessionMessageId(sessionId: string): string {
  const session = getOrCreateInternalSession(sessionId);
  return `message-${session.messages.length + 1}`;
}

export function appendOrchestrationTrace(sessionId: string, entry: any): any {
  const session = getOrCreateInternalSession(sessionId);
  normalizeArtifacts(session);
  const now = isoNow();
  const traceEntry = {
    id: entry.id ?? `trace-${session.orchestrationTrace.length + 1}`,
    step: entry.step,
    payload: entry.payload ?? null,
    createdAt: entry.createdAt ?? now
  };

  session.orchestrationTrace.push(traceEntry);
  session.updatedAt = now;
  sessions.set(sessionId, session);

  return { ...traceEntry };
}

export function setSessionStatus(sessionId: string, status: string): any {
  const session = getOrCreateInternalSession(sessionId);
  normalizeArtifacts(session);
  const now = isoNow();
  session.status = status;
  session.updatedAt = now;
  sessions.set(sessionId, session);
  persistSession(session);

  return cloneSessionState(session);
}

export function appendSessionMessage(sessionId: string, message: any): any {
  const session = getOrCreateInternalSession(sessionId);
  normalizeArtifacts(session);
  const now = isoNow();
  const messageId = message.id ?? `message-${session.messages.length + 1}`;

  const existingMessage = session.messages.find((entry: any) => entry.id === messageId);
  if (existingMessage) {
    return { ...existingMessage };
  }

  const storedMessage = {
    id: messageId,
    role: message.role,
    content: message.content,
    kind: message.kind ?? null,
    meta: Array.isArray(message.meta) ? [...message.meta] : [],
    error: message.error ?? null,
    createdAt: message.createdAt ?? now,
    updatedAt: now
  };

  session.messages.push(storedMessage);
  session.updatedAt = now;
  sessions.set(sessionId, session);
  persistSession(session);

  return { ...storedMessage };
}

export function updateSessionMessage(sessionId: string, messageId: string, updates: any): any {
  const session = getOrCreateInternalSession(sessionId);
  normalizeArtifacts(session);
  const now = isoNow();
  const index = session.messages.findIndex((entry: any) => entry.id === messageId);

  if (index === -1) {
    return null;
  }

  const currentMessage = session.messages[index];
  const hasErrorUpdate = Boolean(updates && Object.prototype.hasOwnProperty.call(updates, "error"));
  const updatedMessage = {
    ...currentMessage,
    ...updates,
    meta: Array.isArray(updates?.meta) ? [...updates.meta] : currentMessage.meta,
    error: hasErrorUpdate ? updates.error ?? null : currentMessage.error ?? null,
    updatedAt: now
  };

  session.messages[index] = updatedMessage;
  session.updatedAt = now;
  sessions.set(sessionId, session);
  persistSession(session);

  return { ...updatedMessage };
}

export function listSessionMessages(sessionId: string): any[] {
  const session = getOrCreateInternalSession(sessionId);
  normalizeArtifacts(session);
  return session.messages.map((message: any) => ({ ...message }));
}

export function buildSessionResponse(sessionState: any, websocketUrl: string): any {
  return {
    sessionId: sessionState.sessionId,
    websocketUrl,
    sceneState: sessionState
  };
}

export function buildSceneUpdatePayload(sessionState: any): any {
  return {
    sessionId: sessionState.sessionId,
    sceneState: sessionState
  };
}

export function buildCodeUpdatePayload(sessionState: any, details: any = {}): any {
  return {
    sessionId: sessionState.sessionId,
    sceneState: sessionState,
    ...details
  };
}

export function buildWebSocketUrl(request: any, path = "/ws"): string {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const isSecure = forwardedProto === "https" || request.protocol === "https";
  const protocol = isSecure ? "wss" : "ws";
  const host = request.headers.host ?? `localhost:${process.env.PORT ?? 8000}`;

  return `${protocol}://${host}${path}`;
}
