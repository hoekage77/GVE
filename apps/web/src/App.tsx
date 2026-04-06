import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Database,
  Eye,
  LayoutGrid,
  ListChecks,
  LogOut,
  MessageSquarePlus,
  PanelRightOpen,
  PencilLine,
  Plus,
  Redo2,
  Search,
  Settings2,
  Sparkles,
  Undo2
} from "lucide-react";

import SceneViewer from "./components/SceneViewer";
import CodeEditor from "./components/CodeEditor";
import ThoughtsBar from "./components/ThoughtsBar";
import ThinkingBubble from "./components/ThinkingBubble";
import { MarkdownMessage } from "./components/MarkdownMessage";
import { MessageActions } from "./components/MessageActions";
import { TypingIndicator, TypingStatus } from "./components/TypingIndicator";
import { InlineSuggestions } from "./components/ContextAwareSuggestions";
import { SlashCommandMenu, createDefaultSlashCommands } from "./components/SlashCommandMenu";
import { MessageTimestamp, MessageTimestampCompact } from "./components/MessageTimestamp";
import { useAutoResize } from "./hooks/useAutoResize";
import { useSlashCommands } from "./hooks/useSlashCommands";

import "./components/MarkdownMessage.css";
import "./components/MessageActions.css";
import "./components/TypingIndicator.css";
import "./components/ContextAwareSuggestions.css";
import "./components/SlashCommandMenu.css";
import "./components/MessageTimestamp.css";

import {
  createSession,
  listSessions,
  listSessionMessages,
  resolveWebSocketUrl,
  planEngineTasks,
  type AgentActivityEvent,
  type SessionMessage,
  type SessionSceneState,
  type GveTask,
  type GveTaskStatus
} from "@visual-runtime/shared";

type ChatMessage = {
  id?: string;
  speaker?: "user" | "assistant";
  eyebrow?: string;
  title?: string;
  segments?: string[];
  body?: string;
  meta?: string[];
  thoughts?: SessionMessage[];
  error?: SessionMessage["error"] | null;
  sourceKind?: string | null;
  sourceCreatedAtMs?: number;
  assistantGroupKey?: string;
};

type AssistantCardVisualState = "generated" | "thinking" | "error";

type SessionGroup = {
  title: string;
  items: SessionSceneState[];
};

type LiveConnectionState = "connecting" | "open" | "closed" | "error";
type WorkspaceTab = "preview" | "code" | "tasks";

const RECENT_SESSION_LABELS = ["Today", "Yesterday", "Last 7 days", "Earlier"];
const TASK_THOUGHTS_STORAGE_KEY = "gve.task.thoughts.v1";
const AGENT_ACTIVITIES_STORAGE_KEY = "gve.agent.activities.v1";
const TASK_PLANS_STORAGE_KEY = "gve.task.plans.v1";
const MAX_PERSISTED_THOUGHTS = 240;
const WS_ACK_TIMEOUT_MS = 1800;
const WS_MAX_SEND_ATTEMPTS = 3;
const WS_TURN_COMPLETION_TIMEOUT_MS = 180000;
const WS_SCENE_COMMAND_TIMEOUT_MS = 12000;

type WebSocketTurnMode = "generate" | "modify";
type SceneCommandType =
  | "undo"
  | "redo"
  | "revision.previous"
  | "revision.next"
  | "version.previous"
  | "version.next"
  | "artifact.previous"
  | "artifact.next";

type TurnCompletionPayload = {
  type: "turn:complete" | "turn:error";
  payload?: {
    sessionId?: string;
    requestId?: string | null;
    mode?: "generate" | "modify" | "image-to-code" | string;
    message?: string | SessionMessage | null;
    messageCount?: number;
    duplicate?: boolean;
    sceneId?: string | null;
    sceneVersion?: number | null;
    explanation?: string | null;
    modifyOutcome?: string | null;
    noopReason?: string | null;
    diff?: {
      instruction?: string | null;
      currentVersion?: number | null;
      changed?: boolean | null;
      changeSummary?: string | null;
      source?: string | null;
      addedLines?: number | null;
      removedLines?: number | null;
      changedLines?: number | null;
    } | null;
    error?: SessionMessage["error"] | null;
  };
};

type PendingTurnCompletion = {
  timeoutId: number;
  resolve: (value: TurnCompletionPayload) => void;
  reject: (error: Error) => void;
};

type SceneCommandResultPayload = {
  type: "scene:command_result";
  payload?: {
    sessionId?: string;
    requestId?: string | null;
    idempotencyKey?: string | null;
    command?: SceneCommandType | string;
    success?: boolean;
    duplicate?: boolean;
    errorCode?: string | null;
    message?: string | null;
    sceneState?: SessionSceneState | null;
  };
};

type PendingSceneCommandCompletion = {
  timeoutId: number;
  resolve: (value: SceneCommandResultPayload) => void;
  reject: (error: Error) => void;
};

type PendingWebSocketTurn = {
  frame: {
    type: "message.send";
    payload: {
      sessionId: string;
      content: string;
      preferences?: unknown;
      mode?: WebSocketTurnMode;
      clientMessageId: string;
      requestId: string;
      idempotencyKey: string;
    };
  };
  attempts: number;
  acked: boolean;
  timeoutId: number | null;
};

type PendingWebSocketSceneCommand = {
  frame: {
    type: "scene.command";
    payload: {
      sessionId: string;
      command: SceneCommandType;
      requestId: string;
      idempotencyKey: string;
    };
  };
  attempts: number;
  acked: boolean;
  timeoutId: number | null;
};

const FALLBACK_TASK_PLAN: GveTask[] = [
  {
    id: "task-parse-intent",
    title: "Parse intent",
    description: "Extract action, entities, and constraints from the request",
    action: "parse_intent",
    command: "intent.parse",
    status: "pending",
    dependsOn: []
  },
  {
    id: "task-select-skill",
    title: "Select skill",
    description: "Rank available visual skills and choose the best fit",
    action: "select_skill",
    command: "skill.select",
    status: "pending",
    dependsOn: ["task-parse-intent"]
  },
  {
    id: "task-build-prompt",
    title: "Build prompt",
    description: "Assemble context and generation constraints",
    action: "build_prompt",
    command: "prompt.build",
    status: "pending",
    dependsOn: ["task-select-skill"]
  },
  {
    id: "task-generate-code",
    title: "Generate code",
    description: "Generate scene code for the selected skill",
    action: "generate_code",
    command: "scene.generate",
    status: "pending",
    dependsOn: ["task-build-prompt"]
  },
  {
    id: "task-validate-code",
    title: "Validate code",
    description: "Run syntax and policy validations",
    action: "validate_code",
    command: "scene.validate",
    status: "pending",
    dependsOn: ["task-generate-code"]
  },
  {
    id: "task-execute-code",
    title: "Execute code",
    description: "Execute the scene in the runtime sandbox",
    action: "execute_code",
    command: "scene.execute",
    status: "pending",
    dependsOn: ["task-validate-code"]
  },
  {
    id: "task-sync-state",
    title: "Sync state",
    description: "Commit scene revision and broadcast updates",
    action: "sync_state",
    command: "state.sync",
    status: "pending",
    dependsOn: ["task-execute-code"]
  }
];

function isThoughtMessage(message: SessionMessage | null | undefined): message is SessionMessage {
  return Boolean(message && (message.role === "thought" || message.kind === "thought"));
}

function buildThoughtSignature(message: SessionMessage): string {
  const step = message.meta?.[0] ?? message.kind ?? "thought";
  const content = message.content.trim();
  const minuteBucket = message.createdAt ? message.createdAt.slice(0, 16) : "";
  return `${step}::${content}::${minuteBucket}`;
}

function mergeThoughtMessages(existing: SessionMessage[], incoming: SessionMessage[]): SessionMessage[] {
  const seenIds = new Set<string>();
  const seenSignatures = new Set<string>();
  const merged: SessionMessage[] = [];

  for (const message of [...existing, ...incoming]) {
    if (!isThoughtMessage(message)) {
      continue;
    }

    if (seenIds.has(message.id)) {
      continue;
    }

    const signature = buildThoughtSignature(message);
    if (seenSignatures.has(signature)) {
      continue;
    }

    seenIds.add(message.id);
    seenSignatures.add(signature);
    merged.push(message);
  }

  merged.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  return merged.slice(-MAX_PERSISTED_THOUGHTS);
}

function parsePersistedThoughtMap(raw: string | null): Record<string, SessionMessage[]> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entries = Object.entries(parsed ?? {});
    const next: Record<string, SessionMessage[]> = {};

    for (const [sessionId, value] of entries) {
      if (!Array.isArray(value)) {
        continue;
      }

      const thoughts = value.filter((entry): entry is SessionMessage => {
        if (!entry || typeof entry !== "object") {
          return false;
        }

        const maybeMessage = entry as SessionMessage;
        return typeof maybeMessage.id === "string" && typeof maybeMessage.content === "string" && isThoughtMessage(maybeMessage);
      });

      if (thoughts.length > 0) {
        next[sessionId] = mergeThoughtMessages([], thoughts);
      }
    }

    return next;
  } catch {
    return {};
  }
}

function parsePersistedActivityMap(raw: string | null): Record<string, AgentActivityEvent[]> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entries = Object.entries(parsed ?? {});
    const next: Record<string, AgentActivityEvent[]> = {};

    for (const [sessionId, value] of entries) {
      if (!Array.isArray(value)) {
        continue;
      }

      const activities = value.filter((entry): entry is AgentActivityEvent => {
        if (!entry || typeof entry !== "object") {
          return false;
        }

        const maybeActivity = entry as AgentActivityEvent;
        return (
          typeof maybeActivity.id === "string" &&
          typeof maybeActivity.step === "string" &&
          typeof maybeActivity.text === "string" &&
          typeof maybeActivity.createdAt === "string"
        );
      });

      if (activities.length > 0) {
        next[sessionId] = activities.slice(-120);
      }
    }

    return next;
  } catch {
    return {};
  }
}

function parsePersistedTaskPlanMap(raw: string | null): Record<string, GveTask[]> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entries = Object.entries(parsed ?? {});
    const next: Record<string, GveTask[]> = {};

    for (const [sessionId, value] of entries) {
      if (!Array.isArray(value)) {
        continue;
      }

      const tasks = value.filter((entry): entry is GveTask => {
        if (!entry || typeof entry !== "object") {
          return false;
        }

        const maybeTask = entry as GveTask;
        return (
          typeof maybeTask.id === "string" &&
          typeof maybeTask.title === "string" &&
          typeof maybeTask.action === "string" &&
          typeof maybeTask.command === "string" &&
          typeof maybeTask.status === "string" &&
          Array.isArray(maybeTask.dependsOn)
        );
      });

      if (tasks.length > 0) {
        next[sessionId] = tasks;
      }
    }

    return next;
  } catch {
    return {};
  }
}

function cloneFallbackTaskPlan(): GveTask[] {
  return FALLBACK_TASK_PLAN.map((task) => ({ ...task }));
}

function mapOrchestrationStepToTaskAction(step: string | null | undefined): GveTask["action"] | null {
  if (!step) {
    return null;
  }

  const mapping: Record<string, GveTask["action"]> = {
    turn_started: "parse_intent",
    parse_intent: "parse_intent",
    intent_parsed: "parse_intent",
    select_skill: "select_skill",
    build_prompt: "build_prompt",
    generate_code: "generate_code",
    code_generated: "generate_code",
    code_modified: "generate_code",
    generation_failed: "generate_code",
    validate_code: "validate_code",
    validation_failed: "validate_code",
    execute_code: "execute_code",
    executing: "execute_code",
    execution_skipped: "execute_code",
    sync_state: "sync_state",
    turn_complete: "sync_state",
    turn_error: "sync_state"
  };

  return mapping[step] ?? null;
}

function normalizeTaskStatus(status: string | null | undefined): GveTaskStatus | null {
  if (status === "pending" || status === "running" || status === "completed" || status === "failed") {
    return status;
  }

  return null;
}

function deriveRecoveredTaskPlan(
  session: SessionSceneState,
  messages: SessionMessage[],
  activities: AgentActivityEvent[],
  persistedThoughts: SessionMessage[]
): GveTask[] {
  const recovered = cloneFallbackTaskPlan();
  const byAction = new Map<GveTask["action"], GveTask>();

  for (const task of recovered) {
    byAction.set(task.action, task);
  }

  const thoughtMessages = messages.filter((message) => isThoughtMessage(message));
  const mergedThoughts = mergeThoughtMessages(thoughtMessages, persistedThoughts);

  let hasEvidence = false;
  let hasFailureEvidence = false;

  for (const activity of activities) {
    const action = mapOrchestrationStepToTaskAction(activity.step);
    if (!action) {
      continue;
    }

    const task = byAction.get(action);
    if (!task) {
      continue;
    }

    hasEvidence = true;

    const normalized = normalizeTaskStatus(activity.status);
    const inferredStatus: GveTaskStatus =
      normalized ??
      (activity.step === "turn_error" || activity.step === "validation_failed" || activity.step === "execution_skipped"
        ? "failed"
        : "completed");

    task.status = inferredStatus;

    if (inferredStatus === "failed") {
      hasFailureEvidence = true;
    }
  }

  for (const thought of mergedThoughts) {
    const thoughtStep = thought.meta?.[0] ?? thought.kind ?? "thought";
    const action = mapOrchestrationStepToTaskAction(thoughtStep);
    if (!action) {
      continue;
    }

    const task = byAction.get(action);
    if (!task) {
      continue;
    }

    hasEvidence = true;

    if (task.status === "pending") {
      task.status = "completed";
    }
  }

  if (messages.some((message) => Boolean(message.error))) {
    hasFailureEvidence = true;
  }

  const hasSceneArtifact = Boolean(
    session.currentScene &&
      (session.currentScene.code || session.currentScene.previewUrl || session.currentScene.sceneId)
  );

  if (hasSceneArtifact) {
    hasEvidence = true;

    if (!hasFailureEvidence) {
      const terminalActions: Array<GveTask["action"]> = ["generate_code", "validate_code", "execute_code", "sync_state"];
      for (const action of terminalActions) {
        const task = byAction.get(action);
        if (task && task.status === "pending") {
          task.status = "completed";
        }
      }
    }
  }

  if (!hasEvidence) {
    return recovered;
  }

  const furthestKnownStep = recovered.reduce((highest, task, index) => {
    if (task.status !== "pending") {
      return index;
    }

    return highest;
  }, -1);

  if (furthestKnownStep >= 0) {
    for (let index = 0; index < furthestKnownStep; index += 1) {
      if (recovered[index].status === "pending") {
        recovered[index] = {
          ...recovered[index],
          status: "completed"
        };
      }
    }
  }

  return recovered;
}

function formatTimeStamp(value: string): string {
  try {
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return value;
  }
}

function formatMessageTime(value: string): string {
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return value;
  }
}

function groupSessions(sessions: SessionSceneState[]): SessionGroup[] {
  const now = Date.now();
  const buckets: Record<string, SessionSceneState[]> = {
    Today: [],
    Yesterday: [],
    "Last 7 days": [],
    Earlier: []
  };

  for (const session of sessions) {
    const updatedAt = new Date(session.updatedAt).getTime();
    const deltaMs = now - updatedAt;
    const deltaDays = Number.isFinite(deltaMs) ? Math.floor(deltaMs / (24 * 60 * 60 * 1000)) : 999;

    if (deltaDays <= 0) {
      buckets.Today.push(session);
    } else if (deltaDays === 1) {
      buckets.Yesterday.push(session);
    } else if (deltaDays <= 7) {
      buckets["Last 7 days"].push(session);
    } else {
      buckets.Earlier.push(session);
    }
  }

  return RECENT_SESSION_LABELS.map((title) => ({ title, items: buckets[title] })).filter((group) => group.items.length > 0);
}

function deriveSessionTitle(session: SessionSceneState, messages?: SessionMessage[]): string {
  const latestUserMessage =
    messages
      ?.slice()
      .reverse()
      .find((message) => message.role === "user" && message.content.trim().length > 0)?.content ?? "";

  if (latestUserMessage) {
    return latestUserMessage;
  }

  if (session.currentScene?.sceneId) {
    return session.currentScene.sceneId;
  }

  return `Session ${session.sessionId.slice(0, 8)}`;
}

function toTimestamp(value: string | null | undefined): number {
  if (!value) {
    return NaN;
  }

  return new Date(value).getTime();
}

function normalizeMessageContent(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function isOptimisticClientMessageId(id: string | null | undefined): boolean {
  if (!id) {
    return false;
  }

  return id.startsWith("client-") || id.startsWith("preview-");
}

function extractCorrelationIds(message: SessionMessage): string[] {
  const tokens: string[] = [];
  for (const metaEntry of message.meta ?? []) {
    const trimmed = String(metaEntry ?? "").trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim().toLowerCase();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!value) {
      continue;
    }

    if (key === "clientmessageid" || key === "requestid" || key === "idempotencykey") {
      tokens.push(value);
    }
  }

  return tokens;
}

function normalizeMessageKind(kind: string | null | undefined): string {
  const normalized = String(kind ?? "").trim().toLowerCase();
  return normalized || "unknown";
}

function findMetaTokenValue(meta: string[] | null | undefined, tokenPrefix: string): string {
  if (!Array.isArray(meta) || meta.length === 0) {
    return "";
  }

  const prefix = tokenPrefix.toLowerCase();
  for (const entry of meta) {
    const normalized = String(entry ?? "").trim();
    if (!normalized) {
      continue;
    }

    const lower = normalized.toLowerCase();
    if (!lower.startsWith(prefix)) {
      continue;
    }

    return normalized.slice(prefix.length).trim();
  }

  return "";
}

function isToolishAssistantMessage(message: SessionMessage): boolean {
  const kind = normalizeMessageKind(message.kind);
  if (
    kind === "tool" ||
    kind === "tool_result" ||
    kind === "browser_state" ||
    kind === "status" ||
    kind === "runtime"
  ) {
    return true;
  }

  return (message.meta ?? []).some((entry) => {
    const normalized = String(entry ?? "").toLowerCase();
    return normalized.startsWith("tool:") || normalized.startsWith("browser:") || normalized.startsWith("runtime:");
  });
}

function buildAssistantGroupKey(message: SessionMessage): string {
  const kind = normalizeMessageKind(message.kind);
  const sceneToken = findMetaTokenValue(message.meta, "scene:");
  const sourceToken = findMetaTokenValue(message.meta, "source:");
  const errorToken = findMetaTokenValue(message.meta, "error:");

  if (isToolishAssistantMessage(message)) {
    // Keep tool/system-like entries isolated for deterministic boundaries.
    return `toolish:${kind}:${sceneToken}:${sourceToken}:${errorToken}:${message.id}`;
  }

  return `${kind}:${sceneToken}:${sourceToken}:${errorToken}`;
}

function buildChatItems(messages: SessionMessage[]): ChatMessage[] {
  const OPTIMISTIC_DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
  const REPLAY_DUPLICATE_WINDOW_MS = 20 * 1000;
  const ASSISTANT_GROUP_MERGE_WINDOW_MS = 2 * 60 * 1000;

  const persistedUserMessageTimesByContent = new Map<string, number[]>();
  const persistedUserCorrelationIds = new Set<string>();
  for (const message of messages) {
    if (message.role !== "user" || isOptimisticClientMessageId(message.id)) {
      continue;
    }

    for (const correlationId of extractCorrelationIds(message)) {
      persistedUserCorrelationIds.add(correlationId);
    }

    const normalizedContent = normalizeMessageContent(message.content);
    if (!normalizedContent) {
      continue;
    }

    const messageTime = toTimestamp(message.createdAt);
    if (!Number.isFinite(messageTime)) {
      continue;
    }

    const existingTimes = persistedUserMessageTimesByContent.get(normalizedContent) ?? [];
    existingTimes.push(messageTime);
    persistedUserMessageTimesByContent.set(normalizedContent, existingTimes);
  }

  const items: ChatMessage[] = [];
  let pendingThoughts: SessionMessage[] = [];
  const recentAssistantContentSeen = new Map<string, number>();

  for (const msg of messages) {
    if (msg.role === "thought" || msg.kind === "thought") {
      pendingThoughts.push(msg);
      continue;
    }

    // Guard against legacy persisted records where assistant updates were
    // accidentally written onto a user-role message id.
    const isUserSpeaker = msg.role === "user" && (msg.kind === "input" || msg.kind === null);
    const hasAssistantContent = typeof msg.content === "string" && msg.content.trim().length > 0;

    // Filter out metadata/system messages that shouldn't appear in chat
    const isMetadataMessage = msg.role === "assistant" && msg.content && (
      msg.content.includes("Generated through LangGraph") ||
      msg.content.includes("orchestration pipeline") ||
      msg.content.includes("local fallback pipeline") ||
      msg.content.includes("Runtime: degraded") ||
      msg.content.includes("Runtime recovery skipped") ||
      msg.content.includes("liveness ping") ||
      msg.content.includes("Sandbox gve-") ||
      msg.content.startsWith("Generated through") ||
      msg.content.startsWith("Runtime degraded")
    );

    if (isMetadataMessage) {
      continue;
    }

    if (!isUserSpeaker && !hasAssistantContent && !msg.error) {
      continue;
    }

    const normalizedContent = normalizeMessageContent(msg.content);
    const messageTime = toTimestamp(msg.createdAt);

    if (isUserSpeaker && isOptimisticClientMessageId(msg.id) && normalizedContent) {
      const optimisticCorrelationIds = new Set<string>([
        ...extractCorrelationIds(msg),
        msg.id ?? ""
      ]);
      const hasCorrelationMatch = Array.from(optimisticCorrelationIds).some(
        (correlationId) => correlationId && persistedUserCorrelationIds.has(correlationId)
      );

      if (hasCorrelationMatch) {
        continue;
      }

      const persistedTimes = persistedUserMessageTimesByContent.get(normalizedContent) ?? [];
      const hasPersistedDuplicate = persistedTimes.some((persistedTime) => {
        if (!Number.isFinite(messageTime)) {
          return true;
        }

        return Math.abs(persistedTime - messageTime) <= OPTIMISTIC_DUPLICATE_WINDOW_MS;
      });

      if (hasPersistedDuplicate) {
        continue;
      }
    }

    if (!isUserSpeaker && !msg.error && normalizedContent) {
      const previousSeenTime = recentAssistantContentSeen.get(normalizedContent);
      if (
        typeof previousSeenTime === "number" &&
        Number.isFinite(messageTime) &&
        messageTime - previousSeenTime <= REPLAY_DUPLICATE_WINDOW_MS
      ) {
        continue;
      }

      if (Number.isFinite(messageTime)) {
        recentAssistantContentSeen.set(normalizedContent, messageTime);
      }
    }

    const nextItem: ChatMessage = {
      id: msg.id,
      speaker: isUserSpeaker ? "user" : "assistant",
      eyebrow: isUserSpeaker ? "YOU" : undefined,
      title: msg.content,
      segments: !isUserSpeaker && msg.content.trim().length > 0 ? [msg.content.trim()] : undefined,
      error: msg.error ?? null,
      body: formatMessageTime(msg.createdAt),
      meta: undefined,
      sourceKind: msg.kind,
      sourceCreatedAtMs: Number.isFinite(messageTime) ? messageTime : undefined,
      assistantGroupKey: !isUserSpeaker ? buildAssistantGroupKey(msg) : undefined
    };

    if (msg.role === "assistant" && pendingThoughts.length > 0) {
      nextItem.thoughts = pendingThoughts;
      pendingThoughts = [];
    }

    if (!isUserSpeaker) {
      const previousItem = items[items.length - 1];
      const canMergeWithPrevious =
        Boolean(previousItem) &&
        previousItem?.speaker === "assistant" &&
        !previousItem.error &&
        !nextItem.error;

      const withinMergeWindow =
        Number.isFinite(previousItem?.sourceCreatedAtMs) && Number.isFinite(nextItem.sourceCreatedAtMs)
          ? Math.abs((nextItem.sourceCreatedAtMs ?? 0) - (previousItem?.sourceCreatedAtMs ?? 0)) <=
            ASSISTANT_GROUP_MERGE_WINDOW_MS
          : true;

      const sameGroupingBoundary =
        previousItem?.assistantGroupKey && nextItem.assistantGroupKey
          ? previousItem.assistantGroupKey === nextItem.assistantGroupKey
          : false;

      if (canMergeWithPrevious && sameGroupingBoundary && withinMergeWindow) {
        const incomingText = (nextItem.title ?? "").trim();
        if (incomingText) {
          const existingSegments = (previousItem.segments ?? []).map((segment) => segment.trim());
          if (!existingSegments.includes(incomingText)) {
            previousItem.segments = [...(previousItem.segments ?? []), incomingText];
          }
        }

        previousItem.id = nextItem.id ?? previousItem.id;
        previousItem.body = nextItem.body ?? previousItem.body;
        previousItem.sourceCreatedAtMs = nextItem.sourceCreatedAtMs ?? previousItem.sourceCreatedAtMs;

        if (nextItem.thoughts && nextItem.thoughts.length > 0) {
          previousItem.thoughts = mergeThoughtMessages(previousItem.thoughts ?? [], nextItem.thoughts);
        }

        continue;
      }
    }

    items.push(nextItem);
  }

  if (pendingThoughts.length > 0) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (items[index]?.speaker === "assistant") {
        items[index] = {
          ...items[index],
          thoughts: [...(items[index]?.thoughts ?? []), ...pendingThoughts]
        };
        break;
      }
    }
  }

  return items;
}

function buildSceneFallbackMessage(session: SessionSceneState): ChatMessage {
  return {
    speaker: "assistant",
    title: session.currentScene?.explanation ?? "This session has not generated a scene yet.",
    body: session.currentScene ? formatMessageTime(session.currentScene.updatedAt) : undefined,
    meta: undefined
  };
}

function hasSessionVisual(session: SessionSceneState | null | undefined, messages?: SessionMessage[]): boolean {
  if (!session) {
    return false;
  }

  const scene = session.currentScene;
  if (scene?.code || scene?.previewUrl || scene?.sceneId) {
    return true;
  }

  return Boolean(
    messages?.some((message) =>
      message.role === "assistant" &&
      Array.isArray(message.meta) &&
      message.meta.some((entry) => entry.startsWith("scene:"))
    )
  );
}

function isDarkSceneRequested(messages: SessionMessage[] | undefined): boolean {
  if (!Array.isArray(messages) || messages.length === 0) {
    return false;
  }

  const latestUserMessage = messages
    .slice()
    .reverse()
    .find((message) => message.role === "user" && message.content.trim().length > 0);

  if (!latestUserMessage) {
    return false;
  }

  return /(dark|night|midnight|space|outer\s+space|deep\s+space|noir|black\s+background|black\b)/i.test(
    latestUserMessage.content
  );
}

function upsertSessionMessage(messages: SessionMessage[], message: SessionMessage): SessionMessage[] {
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

function formatOrchestrationStep(step: string): string {
  const labels: Record<string, string> = {
    parse_intent: "Parsing intent",
    select_skill: "Selecting skill",
    build_prompt: "Building prompt",
    generate_code: "Generating code",
    execute_code: "Executing scene",
    intent_parsed: "Intent parsed",
    validate_code: "Validating",
    validation_failed: "Validation failed",
    execution_skipped: "Execution skipped",
    code_generated: "Code generated",
    code_modified: "Code modified",
    executing: "Executing",
    sync_state: "Syncing state",
    generation_failed: "Generation failed"
  };

  return labels[step] ?? step.replace(/_/g, " ");
}

function getTurnErrorGuidance(errorCode: string | null | undefined): string | null {
  if (!errorCode) {
    return null;
  }

  const normalized = String(errorCode).toUpperCase();
  if (normalized === "SANDBOX_DNS_UNAVAILABLE") {
    return "Retry in a few seconds while DNS recovers.";
  }

  if (normalized === "SANDBOX_ACQUIRE_TIMEOUT") {
    return "Retry now or simplify the request to reduce startup time.";
  }

  if (normalized === "SANDBOX_ACQUIRE_BUDGET_EXHAUSTED") {
    return "Start a fresh turn or simplify the request to fit the turn budget.";
  }

  if (normalized === "SANDBOX_NETWORK_UNAVAILABLE") {
    return "Retry now.";
  }

  return null;
}

function mapWorkspaceTabForStep(step: string): WorkspaceTab | null {
  if (
    step === "generate_code" ||
    step === "code_generated" ||
    step === "code_modified" ||
    step === "validate_code" ||
    step === "validation_failed"
  ) {
    return "code";
  }

  if (step === "execute_code" || step === "executing" || step === "sync_state") {
    return "preview";
  }

  return null;
}

function waitForWebSocketOpen(socket: WebSocket, timeoutMs = 900): Promise<boolean> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve(true);
  }

  if (socket.readyState !== WebSocket.CONNECTING) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let settled = false;

    const cleanup = (): void => {
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("close", handleCloseOrError);
      socket.removeEventListener("error", handleCloseOrError);
    };

    const finish = (value: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const handleOpen = (): void => {
      finish(true);
    };

    const handleCloseOrError = (): void => {
      finish(false);
    };

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("close", handleCloseOrError);
    socket.addEventListener("error", handleCloseOrError);

    window.setTimeout(() => {
      finish(socket.readyState === WebSocket.OPEN);
    }, timeoutMs);
  });
}

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [conversationStarted, setConversationStarted] = useState(false);
  const [composerValue, setComposerValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sessions, setSessions] = useState<SessionSceneState[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionSceneState | null>(null);
  const [sessionMessages, setSessionMessages] = useState<Record<string, SessionMessage[]>>({});
  const [agentActivities, setAgentActivities] = useState<Record<string, AgentActivityEvent[]>>({});
  const [persistedThoughtsBySession, setPersistedThoughtsBySession] = useState<Record<string, SessionMessage[]>>({});
  const [taskPlansBySession, setTaskPlansBySession] = useState<Record<string, GveTask[]>>({});
  const [taskPlanIdsBySession, setTaskPlanIdsBySession] = useState<Record<string, string | null>>({});
  const [messageLoadingSessionId, setMessageLoadingSessionId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<LiveConnectionState>("connecting");
  const [liveStep, setLiveStep] = useState<string | null>(null);
  const [rawLiveStep, setRawLiveStep] = useState<string | null>(null);
  const [rawLiveStepStatus, setRawLiveStepStatus] = useState<GveTaskStatus | null>(null);
  const [websocketUrl, setWebsocketUrl] = useState(resolveWebSocketUrl());
  const [websocketConnectVersion, setWebsocketConnectVersion] = useState(0);
  
  // Auto-resize textarea hook
  const { ref: composerTextareaRef, reset: resetComposerHeight } = useAutoResize<HTMLTextAreaElement>({
    minHeight: 80,
    maxHeight: 400,
    enabled: true
  });
  
  const composerAbortControllerRef = useRef<AbortController | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const websocketReconnectTimerRef = useRef<number | null>(null);
  const websocketPendingTurnsRef = useRef<Record<string, PendingWebSocketTurn>>({});
  const websocketPendingCompletionsRef = useRef<Record<string, PendingTurnCompletion>>({});
  const websocketPendingSceneCommandsRef = useRef<Record<string, PendingWebSocketSceneCommand>>({});
  const websocketPendingSceneCommandCompletionsRef = useRef<Record<string, PendingSceneCommandCompletion>>({});
  const websocketLastSeqRef = useRef(0);
  const activeRequestIdRef = useRef<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("preview");
  const activeSessionIdRef = useRef<string | null>(null);
  const activeTabRef = useRef<WorkspaceTab>("preview");
  const inFlightSessionIdRef = useRef<string | null>(null);
  const [taskPlan, setTaskPlan] = useState<GveTask[]>([]);
  const [taskPlanId, setTaskPlanId] = useState<string | null>(null);
  const [editedCode, setEditedCode] = useState<string | null>(null);
  const [streamedCodeBySession, setStreamedCodeBySession] = useState<Record<string, string>>({});
  const [isApplyingPreviewEdit, setIsApplyingPreviewEdit] = useState(false);
  const [sceneViewerCollapsed, setSceneViewerCollapsed] = useState(true);
  const [thinkingText, setThinkingText] = useState("");
  const [thinkingStep, setThinkingStep] = useState("");
  const [liveAssistantMessageId, setLiveAssistantMessageId] = useState<string | null>(null);
  const chatThreadRef = useRef<HTMLElement | null>(null);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const autoScrollRef = useRef(true);

  const shellStyle = {
    ["--sidebar-width" as never]: sidebarOpen ? "clamp(18rem, 30vw, 20.5rem)" : "3.85rem"
  } as CSSProperties;

  const selectedSession = useMemo(() => {
    if (!activeSessionId) {
      return sessionState;
    }

    return sessions.find((session) => session.sessionId === activeSessionId) ?? sessionState;
  }, [activeSessionId, sessionState, sessions]);

  const sessionGroups = useMemo(() => groupSessions(sessions), [sessions]);

  const chatMessages = useMemo<ChatMessage[]>(() => {
    if (!activeSessionId) {
      return [];
    }

    const messages = sessionMessages[activeSessionId];
    if (messages && messages.length > 0) {
      return buildChatItems(messages);
    }

    if (selectedSession) {
      return selectedSession.currentScene ? [buildSceneFallbackMessage(selectedSession)] : [];
    }

    return [];
  }, [activeSessionId, selectedSession, sessionMessages]);

  const activeSessionActivities = useMemo<AgentActivityEvent[]>(() => {
    if (!activeSessionId) {
      return [];
    }

    return agentActivities[activeSessionId] ?? [];
  }, [activeSessionId, agentActivities]);

  function openWorkspaceTab(tab: WorkspaceTab): void {
    activeTabRef.current = tab;
    setActiveTab(tab);
    setSceneViewerCollapsed(false);
  }

  function setCurrentActiveSessionId(sessionId: string | null): void {
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
  }

  function clearPendingTurnTimeout(requestId: string): void {
    const pending = websocketPendingTurnsRef.current[requestId];
    if (!pending?.timeoutId) {
      return;
    }

    window.clearTimeout(pending.timeoutId);
    pending.timeoutId = null;
  }

  function removePendingTurn(requestId: string): void {
    clearPendingTurnTimeout(requestId);
    delete websocketPendingTurnsRef.current[requestId];
  }

  function resolvePendingTurnCompletion(requestId: string, completion: TurnCompletionPayload): void {
    const pending = websocketPendingCompletionsRef.current[requestId];
    if (!pending) {
      return;
    }

    window.clearTimeout(pending.timeoutId);
    delete websocketPendingCompletionsRef.current[requestId];
    pending.resolve(completion);
  }

  function rejectPendingTurnCompletion(requestId: string, error: Error): void {
    const pending = websocketPendingCompletionsRef.current[requestId];
    if (!pending) {
      return;
    }

    window.clearTimeout(pending.timeoutId);
    delete websocketPendingCompletionsRef.current[requestId];
    pending.reject(error);
  }

  function clearPendingTurnCompletion(requestId: string): void {
    const pending = websocketPendingCompletionsRef.current[requestId];
    if (!pending) {
      return;
    }

    window.clearTimeout(pending.timeoutId);
    delete websocketPendingCompletionsRef.current[requestId];
  }

  function markPendingTurnAcknowledged(requestId: string): void {
    const pending = websocketPendingTurnsRef.current[requestId];
    if (!pending) {
      return;
    }

    pending.acked = true;
    clearPendingTurnTimeout(requestId);
  }

  function schedulePendingTurnAckRetry(requestId: string): void {
    const pending = websocketPendingTurnsRef.current[requestId];
    if (!pending || pending.acked) {
      return;
    }

    clearPendingTurnTimeout(requestId);

    pending.timeoutId = window.setTimeout(() => {
      const latestPending = websocketPendingTurnsRef.current[requestId];
      if (!latestPending || latestPending.acked) {
        return;
      }

      if (latestPending.attempts >= WS_MAX_SEND_ATTEMPTS) {
        removePendingTurn(requestId);
        rejectPendingTurnCompletion(requestId, new Error("Connection unstable. Please retry."));
        setLiveStep("Connection unstable. Please retry.");
        setIsSending(false);
        if (activeRequestIdRef.current === requestId) {
          activeRequestIdRef.current = null;
          inFlightSessionIdRef.current = null;
        }
        return;
      }

      const socket = websocketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        schedulePendingTurnAckRetry(requestId);
        return;
      }

      latestPending.attempts += 1;
      socket.send(JSON.stringify(latestPending.frame));
      schedulePendingTurnAckRetry(requestId);
    }, WS_ACK_TIMEOUT_MS);
  }

  function resendUnackedPendingTurns(socket: WebSocket): void {
    const pendingEntries = Object.entries(websocketPendingTurnsRef.current);
    for (const [requestId, pending] of pendingEntries) {
      if (pending.acked) {
        continue;
      }

      if (pending.attempts >= WS_MAX_SEND_ATTEMPTS) {
        removePendingTurn(requestId);
        rejectPendingTurnCompletion(requestId, new Error("Connection unstable. Please retry."));
        continue;
      }

      pending.attempts += 1;
      socket.send(JSON.stringify(pending.frame));
      schedulePendingTurnAckRetry(requestId);
    }
  }

  function clearPendingSceneCommandTimeout(requestId: string): void {
    const pending = websocketPendingSceneCommandsRef.current[requestId];
    if (!pending?.timeoutId) {
      return;
    }

    window.clearTimeout(pending.timeoutId);
    pending.timeoutId = null;
  }

  function removePendingSceneCommand(requestId: string): void {
    clearPendingSceneCommandTimeout(requestId);
    delete websocketPendingSceneCommandsRef.current[requestId];
  }

  function resolvePendingSceneCommandCompletion(requestId: string, completion: SceneCommandResultPayload): void {
    const pending = websocketPendingSceneCommandCompletionsRef.current[requestId];
    if (!pending) {
      return;
    }

    window.clearTimeout(pending.timeoutId);
    delete websocketPendingSceneCommandCompletionsRef.current[requestId];
    pending.resolve(completion);
  }

  function rejectPendingSceneCommandCompletion(requestId: string, error: Error): void {
    const pending = websocketPendingSceneCommandCompletionsRef.current[requestId];
    if (!pending) {
      return;
    }

    window.clearTimeout(pending.timeoutId);
    delete websocketPendingSceneCommandCompletionsRef.current[requestId];
    pending.reject(error);
  }

  function markPendingSceneCommandAcknowledged(requestId: string): void {
    const pending = websocketPendingSceneCommandsRef.current[requestId];
    if (!pending) {
      return;
    }

    pending.acked = true;
    clearPendingSceneCommandTimeout(requestId);
  }

  function schedulePendingSceneCommandAckRetry(requestId: string): void {
    const pending = websocketPendingSceneCommandsRef.current[requestId];
    if (!pending || pending.acked) {
      return;
    }

    clearPendingSceneCommandTimeout(requestId);

    pending.timeoutId = window.setTimeout(() => {
      const latestPending = websocketPendingSceneCommandsRef.current[requestId];
      if (!latestPending || latestPending.acked) {
        return;
      }

      if (latestPending.attempts >= WS_MAX_SEND_ATTEMPTS) {
        removePendingSceneCommand(requestId);
        rejectPendingSceneCommandCompletion(requestId, new Error("Connection unstable. Please retry."));
        return;
      }

      const socket = websocketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        schedulePendingSceneCommandAckRetry(requestId);
        return;
      }

      latestPending.attempts += 1;
      socket.send(JSON.stringify(latestPending.frame));
      schedulePendingSceneCommandAckRetry(requestId);
    }, WS_ACK_TIMEOUT_MS);
  }

  function resendUnackedPendingSceneCommands(socket: WebSocket): void {
    const pendingEntries = Object.entries(websocketPendingSceneCommandsRef.current);
    for (const [requestId, pending] of pendingEntries) {
      if (pending.acked) {
        continue;
      }

      if (pending.attempts >= WS_MAX_SEND_ATTEMPTS) {
        removePendingSceneCommand(requestId);
        rejectPendingSceneCommandCompletion(requestId, new Error("Connection unstable. Please retry."));
        continue;
      }

      pending.attempts += 1;
      socket.send(JSON.stringify(pending.frame));
      schedulePendingSceneCommandAckRetry(requestId);
    }
  }

  async function hydrateTaskPlanForSession(session: SessionSceneState, messages: SessionMessage[]): Promise<void> {
    const sessionId = session.sessionId;

    if ((taskPlansBySession[sessionId] ?? []).length > 0) {
      setTaskPlan(taskPlansBySession[sessionId] ?? []);
      setTaskPlanId(taskPlanIdsBySession[sessionId] ?? null);
      return;
    }

    const latestUserMessage = messages
      .slice()
      .reverse()
      .find((message) => message.role === "user" && message.content.trim().length > 0);

    if (!latestUserMessage) {
      if (session.currentScene) {
        const recoveredPlan = deriveRecoveredTaskPlan(
          session,
          messages,
          agentActivities[sessionId] ?? [],
          persistedThoughtsBySession[sessionId] ?? []
        );
        setTaskPlan(recoveredPlan);
        setTaskPlanId(null);
        setTaskPlansBySession((previous) => ({
          ...previous,
          [sessionId]: previous[sessionId] && previous[sessionId].length > 0 ? previous[sessionId] : recoveredPlan
        }));
      }
      return;
    }

    const fallbackPlan = cloneFallbackTaskPlan();
    setTaskPlan(fallbackPlan);
    setTaskPlanId(null);
    setTaskPlansBySession((previous) => ({
      ...previous,
      [sessionId]: previous[sessionId] && previous[sessionId].length > 0 ? previous[sessionId] : fallbackPlan
    }));

    try {
      const planned = await planEngineTasks({
        query: latestUserMessage.content,
        sessionId
      });

      setTaskPlan(planned.tasks);
      setTaskPlanId(planned.planId ?? null);
      setTaskPlansBySession((previous) => ({
        ...previous,
        [sessionId]: planned.tasks
      }));
      setTaskPlanIdsBySession((previous) => ({
        ...previous,
        [sessionId]: planned.planId ?? null
      }));
    } catch {
      // Keep fallback plan when planning endpoint is unavailable.
    }
  }

  async function loadSessionMessages(sessionId: string): Promise<SessionMessage[]> {
    setMessageLoadingSessionId(sessionId);

    try {
      const response = await listSessionMessages(sessionId);
      setSessionMessages((previous) => ({
        ...previous,
        [sessionId]: response.messages
      }));

      const thoughtMessages = response.messages.filter((message) => isThoughtMessage(message));
      if (thoughtMessages.length > 0) {
        setPersistedThoughtsBySession((previous) => ({
          ...previous,
          [sessionId]: mergeThoughtMessages(previous[sessionId] ?? [], thoughtMessages)
        }));
      }

      return response.messages;
    } catch {
      // Preserve existing in-memory messages if a refresh call fails.
      return sessionMessages[sessionId] ?? [];
    } finally {
      setMessageLoadingSessionId((current) => (current === sessionId ? null : current));
    }
  }

  async function refreshSessions(preferredSessionId?: string): Promise<void> {
    setSessionsLoading(true);
    setSessionsError(null);

    try {
      const response = await listSessions();
      setSessions(response.sessions);

      const selectedId = preferredSessionId ?? activeSessionId;
      if (selectedId) {
        const nextSession = response.sessions.find((session) => session.sessionId === selectedId) ?? null;
        setSessionState(nextSession);

        if (nextSession) {
          const nextMessages = await loadSessionMessages(nextSession.sessionId);
          setConversationStarted(nextMessages.length > 0 || Boolean(nextSession.currentScene));
        }
      }
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : "Unable to load sessions.");
    } finally {
      setSessionsLoading(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedThoughts = parsePersistedThoughtMap(window.localStorage.getItem(TASK_THOUGHTS_STORAGE_KEY));
    if (Object.keys(storedThoughts).length > 0) {
      setPersistedThoughtsBySession(storedThoughts);
    }

    const storedActivities = parsePersistedActivityMap(window.localStorage.getItem(AGENT_ACTIVITIES_STORAGE_KEY));
    if (Object.keys(storedActivities).length > 0) {
      setAgentActivities((previous) => ({
        ...storedActivities,
        ...previous
      }));
    }

    const storedTaskPlans = parsePersistedTaskPlanMap(window.localStorage.getItem(TASK_PLANS_STORAGE_KEY));
    if (Object.keys(storedTaskPlans).length > 0) {
      setTaskPlansBySession(storedTaskPlans);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(TASK_THOUGHTS_STORAGE_KEY, JSON.stringify(persistedThoughtsBySession));
    } catch {
      // Ignore localStorage write failures.
    }
  }, [persistedThoughtsBySession]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(AGENT_ACTIVITIES_STORAGE_KEY, JSON.stringify(agentActivities));
    } catch {
      // Ignore localStorage write failures.
    }
  }, [agentActivities]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(TASK_PLANS_STORAGE_KEY, JSON.stringify(taskPlansBySession));
    } catch {
      // Ignore localStorage write failures.
    }
  }, [taskPlansBySession]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    void refreshSessions();
    // Load the current live session list on first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !websocketUrl) {
      return;
    }

    setConnectionState("connecting");
    let shouldReconnect = true;

    const socket = new WebSocket(websocketUrl);
    websocketRef.current = socket;

    socket.addEventListener("open", () => {
      setConnectionState("open");

      socket.send(
        JSON.stringify({
          type: "session.resume",
          payload: {
            sessionId: activeSessionIdRef.current,
            lastSeq: websocketLastSeqRef.current
          }
        })
      );

      resendUnackedPendingTurns(socket);
      resendUnackedPendingSceneCommands(socket);
    });

    socket.addEventListener("close", () => {
      setConnectionState("closed");

      if (shouldReconnect) {
        if (websocketReconnectTimerRef.current !== null) {
          window.clearTimeout(websocketReconnectTimerRef.current);
        }

        websocketReconnectTimerRef.current = window.setTimeout(() => {
          setWebsocketConnectVersion((previous) => previous + 1);
        }, 750);
      }
    });

    socket.addEventListener("error", () => {
      setConnectionState("error");
    });

    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          type?: string;
          seq?: number;
          payload?: {
            sessionId?: string;
            message?: SessionMessage | string;
            sceneState?: SessionSceneState;
            step?: string;
            status?: GveTaskStatus | string;
            requestId?: string | null;
            clientMessageId?: string | null;
            idempotencyKey?: string | null;
            command?: SceneCommandType | string;
            success?: boolean;
            duplicate?: boolean;
            errorCode?: string | null;
            replayedCount?: number;
            latestSeq?: number;
            tasks?: GveTask[];
            planId?: string;
            id?: string;
            messageId?: string | null;
            text?: string;
            tone?: "progress" | "success" | "error";
            technicalDetail?: string | null;
            createdAt?: string;
            error?: SessionMessage["error"] | null;
            messageCount?: number;
            code?: string;
            delta?: string;
            done?: boolean;
            reset?: boolean;
            mode?: "generate" | "modify" | string;
            modifyOutcome?: string | null;
            noopReason?: string | null;
            diff?: {
              instruction?: string;
              currentVersion?: number;
              changed?: boolean;
              changeSummary?: string;
              source?: string;
              patch?: string;
              addedLines?: number;
              removedLines?: number;
              changedLines?: number;
            } | null;
          };
        };

        if (!payload.type) {
          return;
        }

        if (typeof payload.seq === "number") {
          if (payload.seq <= websocketLastSeqRef.current) {
            return;
          }
          websocketLastSeqRef.current = payload.seq;
        }

        const selectedSessionId = activeSessionIdRef.current;
        const inFlightSessionId = inFlightSessionIdRef.current;
        const isRelevantSession = (eventSessionId?: string): boolean => {
          if (!eventSessionId) {
            return true;
          }

          if (!selectedSessionId) {
            return true;
          }

          return eventSessionId === selectedSessionId || eventSessionId === inFlightSessionId;
        };

        if (payload.type === "connection:ready") {
          const latestSeq = Number(payload.payload?.latestSeq ?? 0);
          if (Number.isFinite(latestSeq) && latestSeq > websocketLastSeqRef.current) {
            websocketLastSeqRef.current = latestSeq;
          }
          setConnectionState("open");
          return;
        }

        if (payload.type === "session:resumed") {
          const latestSeq = Number(payload.payload?.latestSeq ?? 0);
          if (Number.isFinite(latestSeq) && latestSeq > websocketLastSeqRef.current) {
            websocketLastSeqRef.current = latestSeq;
          }

          if ((payload.payload?.replayedCount ?? 0) > 0) {
            setLiveStep("Connection restored. Replayed live updates.");
          }
          return;
        }

        if (payload.type === "message:ack") {
          const requestId = payload.payload?.requestId ? String(payload.payload.requestId) : null;
          const status = String(payload.payload?.status ?? "");
          if (requestId && ["received", "processing", "in_progress", "accepted", "duplicate"].includes(status)) {
            markPendingTurnAcknowledged(requestId);
          }

          setLiveStep("Message received.");
          return;
        }

        if (payload.type === "scene:command_ack") {
          const requestId = payload.payload?.requestId ? String(payload.payload.requestId) : null;
          const status = String(payload.payload?.status ?? "");

          if (requestId && ["received", "processing", "in_progress", "accepted", "duplicate"].includes(status)) {
            markPendingSceneCommandAcknowledged(requestId);
          }

          return;
        }

        if (payload.type === "scene:command_result") {
          const requestId = payload.payload?.requestId ? String(payload.payload.requestId) : null;
          if (!requestId) {
            return;
          }

          removePendingSceneCommand(requestId);

          const commandResult: SceneCommandResultPayload = {
            type: "scene:command_result",
            payload: {
              sessionId: payload.payload?.sessionId,
              requestId,
              idempotencyKey: payload.payload?.idempotencyKey ?? null,
              command: payload.payload?.command,
              success: Boolean(payload.payload?.success),
              duplicate: Boolean(payload.payload?.duplicate),
              errorCode: payload.payload?.errorCode ?? null,
              message: typeof payload.payload?.message === "string" ? payload.payload.message : null,
              sceneState: payload.payload?.sceneState ?? null
            }
          };

          resolvePendingSceneCommandCompletion(requestId, commandResult);
          return;
        }

        if (payload.type === "message:error") {
          const requestId = payload.payload?.requestId ? String(payload.payload.requestId) : activeRequestIdRef.current;
          if (requestId) {
            removePendingTurn(requestId);
            const reason = typeof payload.payload?.message === "string"
              ? payload.payload.message
              : "Websocket request failed.";
            rejectPendingTurnCompletion(requestId, new Error(reason));
          }
          return;
        }

        if (payload.type === "message:accepted") {
          const requestId = payload.payload?.requestId ? String(payload.payload.requestId) : null;
          if (requestId) {
            removePendingTurn(requestId);
          }
          return;
        }

        if (payload.type === "agent:activity" && payload.payload?.sessionId) {
          const activitySessionId = payload.payload.sessionId;
          if (!isRelevantSession(activitySessionId)) {
            return;
          }

          const incomingStatus: GveTaskStatus =
            payload.payload.status === "pending"
            || payload.payload.status === "running"
            || payload.payload.status === "completed"
            || payload.payload.status === "failed"
              ? payload.payload.status
              : "running";

          const incomingActivity: AgentActivityEvent = {
            id: payload.payload.id ?? `activity-${Date.now()}`,
            sessionId: activitySessionId,
            messageId: payload.payload.messageId ?? null,
            step: payload.payload.step ?? "unknown",
            status: incomingStatus,
            tone: payload.payload.tone,
            text: payload.payload.text ?? "Processing step...",
            technicalDetail: payload.payload.technicalDetail ?? null,
            createdAt: payload.payload.createdAt ?? new Date().toISOString()
          };

          setAgentActivities((previous) => {
            const existing = previous[activitySessionId] ?? [];
            if (existing.some((entry) => entry.id === incomingActivity.id)) {
              return previous;
            }

            const trimmed = [...existing, incomingActivity].slice(-120);
            return {
              ...previous,
              [activitySessionId]: trimmed
            };
          });

          setLiveStep(incomingActivity.text);
          setRawLiveStep(incomingActivity.step);
          setRawLiveStepStatus(incomingActivity.status);
          return;
        }

        if (payload.type === "code:stream" && payload.payload?.sessionId) {
          const streamPayload = payload.payload;
          const codeSessionId = streamPayload.sessionId;
          if (!codeSessionId) {
            return;
          }
          if (!isRelevantSession(codeSessionId)) {
            return;
          }

          const hasCode = typeof streamPayload.code === "string";
          if (!hasCode) {
            return;
          }

          setStreamedCodeBySession((previous) => ({
            ...previous,
            [codeSessionId]: streamPayload.code as string
          }));

          if (streamPayload.done) {
            setLiveStep("Code stream complete");
          }

          return;
        }

        if (
          (payload.type === "message:created" || payload.type === "message:update" || payload.type === "message.append")
          && payload.payload?.message
          && typeof payload.payload.message === "object"
          && "id" in payload.payload.message
        ) {
          const { sessionId } = payload.payload;
          const message = payload.payload.message as SessionMessage;
          if (!sessionId || !message) {
            return;
          }

          setSessionMessages((previous) => {
            const existing = previous[sessionId] ?? [];
            return {
              ...previous,
              [sessionId]: upsertSessionMessage(existing, message)
            };
          });

          setConversationStarted(true);

          if (isThoughtMessage(message)) {
            setPersistedThoughtsBySession((previous) => ({
              ...previous,
              [sessionId]: mergeThoughtMessages(previous[sessionId] ?? [], [message])
            }));
          }

          if (message.role === "assistant" && (!activeSessionId || sessionId === activeSessionId)) {
            setLiveAssistantMessageId(message.id);
          }

          return;
        }

        if (payload.type === "turn:started") {
          if (!isRelevantSession(payload.payload?.sessionId)) {
            return;
          }
          const turnSessionId = payload.payload?.sessionId;
          setLiveStep("Working on your request...");
          setRawLiveStep(null);
          setRawLiveStepStatus(null);
          setConversationStarted(true);
          setThinkingText("");
          setThinkingStep("");
          setLiveAssistantMessageId(null);
          setEditedCode(null);
          if (turnSessionId) {
            setStreamedCodeBySession((previous) => ({
              ...previous,
              [turnSessionId]: ""
            }));
          }
          return;
        }

        if (payload.type === "thought:stream" && payload.payload) {
          const { sessionId: thoughtSessionId, thought, step: thoughtStep, isFinal } = payload.payload as {
            sessionId?: string;
            thought?: string;
            step?: string;
            isFinal?: boolean;
          };

          if (!isRelevantSession(thoughtSessionId)) {
            return;
          }

          if (thought) {
            setThinkingText(thought);
          }
          if (thoughtStep) {
            setThinkingStep(thoughtStep);
          }

          if (isFinal && thought && thoughtSessionId) {
            const createdAt = new Date().toISOString();
            const thoughtMessage: SessionMessage = {
              id: `live-thought-${thoughtSessionId}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
              role: "thought",
              content: thought,
              kind: "thought",
              meta: [thoughtStep ?? "thought"],
              createdAt,
              updatedAt: createdAt
            };

            setPersistedThoughtsBySession((previous) => ({
              ...previous,
              [thoughtSessionId]: mergeThoughtMessages(previous[thoughtSessionId] ?? [], [thoughtMessage])
            }));
          }

          return;
        }
        
        if (payload.type === "orchestration:plan" && payload.payload?.tasks) {
          if (!isRelevantSession(payload.payload?.sessionId)) {
            return;
          }
          const planSessionId = payload.payload.sessionId ?? selectedSessionId;
          if (planSessionId) {
            setTaskPlansBySession((previous) => ({
              ...previous,
              [planSessionId]: payload.payload?.tasks ?? []
            }));
            setTaskPlanIdsBySession((previous) => ({
              ...previous,
              [planSessionId]: payload.payload?.planId ?? null
            }));
          }

          setTaskPlan(payload.payload.tasks);
          setTaskPlanId(payload.payload.planId ?? null);
          setRawLiveStep(null);
          setRawLiveStepStatus(null);
          openWorkspaceTab("tasks");
          return;
        }

        if (payload.type === "orchestration:step" && payload.payload?.step) {
          const stepPayload = payload.payload as {
            step: string;
            status?: GveTaskStatus;
            sessionId?: string;
            payload?: { sessionId?: string };
          };
          const eventSessionId = stepPayload.payload?.sessionId ?? stepPayload.sessionId;
          if (!isRelevantSession(eventSessionId)) {
            return;
          }

          const step = stepPayload.step;
          setRawLiveStep(step);
          setRawLiveStepStatus(stepPayload.status ?? null);
          setLiveStep(formatOrchestrationStep(step));

          const tab = mapWorkspaceTabForStep(step);
          if (tab && activeTabRef.current !== "tasks") {
            openWorkspaceTab(tab);
          }

          return;
        }

        if (payload.type === "thinking:analysis_failed") {
          if (!isRelevantSession(payload.payload?.sessionId)) {
            return;
          }

          const diagnostics = (payload.payload?.error ?? null) as {
            message?: string;
            code?: string;
            status?: number;
          } | null;

          const reason = diagnostics?.message ?? "Background analysis unavailable.";
          const code = diagnostics?.code ? ` (${diagnostics.code})` : "";

          setLiveStep(`Background analysis failed${code}. Continuing turn.`);
          setRawLiveStep("thinking_analysis_failed");
          setRawLiveStepStatus("failed");
          console.warn(`[WS] thinking analysis failed: ${reason}${code}`);
          return;
        }

        if (payload.type === "generation:started" || payload.type === "code:started") {
          openWorkspaceTab("code");
          return;
        }

        if (payload.type === "generation:complete" || payload.type === "code:update") {
          openWorkspaceTab("preview");
          return;
        }

        if (payload.type === "scene:update" && payload.payload?.sceneState) {
          const nextSceneState = payload.payload.sceneState;
          setSessions((previous) => previous.map((session) => (session.sessionId === nextSceneState.sessionId ? nextSceneState : session)));
          setSessionState((previous) => (previous?.sessionId === nextSceneState.sessionId ? nextSceneState : previous));
          if (nextSceneState.currentScene?.code) {
            setStreamedCodeBySession((previous) => ({
              ...previous,
              [nextSceneState.sessionId]: nextSceneState.currentScene?.code ?? ""
            }));
          }
          openWorkspaceTab("preview");
          return;
        }

        if (payload.type === "turn:complete") {
          if (!isRelevantSession(payload.payload?.sessionId)) {
            return;
          }
          const completedRequestId = payload.payload?.requestId ? String(payload.payload.requestId) : activeRequestIdRef.current;
          if (completedRequestId) {
            removePendingTurn(completedRequestId);
            resolvePendingTurnCompletion(completedRequestId, {
              type: "turn:complete",
              payload:
                payload
                ? {
                    ...payload.payload,
                    requestId: completedRequestId
                  }
                : { requestId: completedRequestId }
            });
          }
          setLiveStep("Turn complete");
          setRawLiveStep("turn_complete");
          setRawLiveStepStatus("completed");
          setIsSending(false);
          setThinkingText("");
          setThinkingStep("");
          setLiveAssistantMessageId(null);
          activeRequestIdRef.current = null;
          inFlightSessionIdRef.current = null;
          if (payload.payload?.sessionId) {
            void refreshSessions(payload.payload.sessionId);
          }
          return;
        }

        if (payload.type === "turn:error") {
          if (!isRelevantSession(payload.payload?.sessionId)) {
            return;
          }
          const failedRequestId = payload.payload?.requestId ? String(payload.payload.requestId) : activeRequestIdRef.current;
          if (failedRequestId) {
            removePendingTurn(failedRequestId);
            const errorMessage = payload.payload?.error?.userMessage
              ?? (typeof payload.payload?.message === "string" ? payload.payload.message : null)
              ?? "Turn failed";
            rejectPendingTurnCompletion(failedRequestId, new Error(errorMessage));
          }
          const payloadMessage = typeof payload.payload?.message === "string" ? payload.payload.message : null;
          const turnErrorText = payload.payload?.error?.userMessage ?? payloadMessage ?? "Turn failed";
          const turnTechnicalDetail = payload.payload?.error?.technicalDetail ?? null;
          const turnErrorCode = payload.payload?.error?.code ?? null;
          const turnSuggestedAction = payload.payload?.error?.suggestedAction ?? getTurnErrorGuidance(turnErrorCode);

          if (turnTechnicalDetail || turnErrorCode) {
            const codeSuffix = turnErrorCode ? ` (${turnErrorCode})` : "";
            console.warn(`[WS] turn:error${codeSuffix}: ${turnTechnicalDetail ?? turnErrorText}`);
          }

          setLiveStep(turnSuggestedAction ? `${turnErrorText} ${turnSuggestedAction}` : turnErrorText);
          setRawLiveStep("turn_error");
          setRawLiveStepStatus("failed");
          setIsSending(false);
          setThinkingText("");
          setThinkingStep("");
          setLiveAssistantMessageId(null);
          activeRequestIdRef.current = null;
          inFlightSessionIdRef.current = null;
          if (payload.payload?.sessionId) {
            void refreshSessions(payload.payload.sessionId);
          }
        }
      } catch {
        // Ignore malformed websocket payloads.
      }
    });

    return () => {
      shouldReconnect = false;

      if (websocketReconnectTimerRef.current !== null) {
        window.clearTimeout(websocketReconnectTimerRef.current);
        websocketReconnectTimerRef.current = null;
      }

      if (websocketRef.current === socket) {
        websocketRef.current = null;
      }
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener("open", () => socket.close());
      } else {
        socket.close();
      }
    };
  }, [websocketUrl, websocketConnectVersion]);

  async function waitForActiveWebSocket(timeoutMs = 4500): Promise<WebSocket | null> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const socket = websocketRef.current;

      if (socket?.readyState === WebSocket.OPEN) {
        return socket;
      }

      if (socket?.readyState === WebSocket.CONNECTING) {
        const remaining = Math.max(120, deadline - Date.now());
        const opened = await waitForWebSocketOpen(socket, Math.min(remaining, 1200));
        if (opened && websocketRef.current?.readyState === WebSocket.OPEN) {
          return websocketRef.current;
        }
      } else {
        setWebsocketConnectVersion((previous) => previous + 1);
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
    }

    return websocketRef.current?.readyState === WebSocket.OPEN ? websocketRef.current : null;
  }

  async function dispatchWebSocketTurn({
    sessionId,
    content,
    mode,
    preferences,
    requestId,
    clientMessageId,
    awaitCompletion = false,
    timeoutMs = WS_TURN_COMPLETION_TIMEOUT_MS
  }: {
    sessionId: string;
    content: string;
    mode?: WebSocketTurnMode;
    preferences?: unknown;
    requestId: string;
    clientMessageId: string;
    awaitCompletion?: boolean;
    timeoutMs?: number;
  }): Promise<TurnCompletionPayload | null> {
    const socket = await waitForActiveWebSocket();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Live websocket is not connected yet. Please retry in a moment.");
    }

    const payload: PendingWebSocketTurn["frame"]["payload"] = {
      sessionId,
      content,
      preferences,
      mode,
      clientMessageId,
      requestId,
      idempotencyKey: requestId
    };

    const frame: PendingWebSocketTurn["frame"] = {
      type: "message.send",
      payload
    };

    websocketPendingTurnsRef.current[requestId] = {
      frame,
      attempts: 1,
      acked: false,
      timeoutId: null
    };

    let completionPromise: Promise<TurnCompletionPayload> | null = null;
    if (awaitCompletion) {
      completionPromise = new Promise<TurnCompletionPayload>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          removePendingTurn(requestId);
          rejectPendingTurnCompletion(requestId, new Error("Turn timed out before completion."));
        }, timeoutMs);

        websocketPendingCompletionsRef.current[requestId] = {
          timeoutId,
          resolve,
          reject
        };
      });
    }

    socket.send(JSON.stringify(frame));
    schedulePendingTurnAckRetry(requestId);

    if (!completionPromise) {
      return null;
    }

    try {
      return await completionPromise;
    } finally {
      removePendingTurn(requestId);
    }
  }

  async function dispatchWebSocketSceneCommand({
    sessionId,
    command,
    timeoutMs = WS_SCENE_COMMAND_TIMEOUT_MS
  }: {
    sessionId: string;
    command: SceneCommandType;
    timeoutMs?: number;
  }): Promise<SceneCommandResultPayload> {
    const socket = await waitForActiveWebSocket();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Live websocket is not connected yet. Please retry in a moment.");
    }

    const requestId = `scene-cmd-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`}`;
    const frame: PendingWebSocketSceneCommand["frame"] = {
      type: "scene.command",
      payload: {
        sessionId,
        command,
        requestId,
        idempotencyKey: requestId
      }
    };

    websocketPendingSceneCommandsRef.current[requestId] = {
      frame,
      attempts: 1,
      acked: false,
      timeoutId: null
    };

    const completionPromise = new Promise<SceneCommandResultPayload>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        removePendingSceneCommand(requestId);
        rejectPendingSceneCommandCompletion(requestId, new Error("Scene command timed out."));
      }, timeoutMs);

      websocketPendingSceneCommandCompletionsRef.current[requestId] = {
        timeoutId,
        resolve,
        reject
      };
    });

    socket.send(JSON.stringify(frame));
    schedulePendingSceneCommandAckRetry(requestId);

    try {
      const completion = await completionPromise;
      if (!completion.payload?.success) {
        const message = completion.payload?.message?.trim() || "Scene command failed.";
        throw new Error(message);
      }

      return completion;
    } finally {
      removePendingSceneCommand(requestId);
    }
  }

  async function selectSession(session: SessionSceneState): Promise<void> {
    setCurrentActiveSessionId(session.sessionId);
    setSessionState(session);
    setComposerValue("");
    setLiveAssistantMessageId(null);
    setEditedCode(null);
    setStreamedCodeBySession((previous) => ({
      ...previous,
      [session.sessionId]: session.currentScene?.code ?? ""
    }));

    const messages = await loadSessionMessages(session.sessionId);
    setConversationStarted(messages.length > 0 || Boolean(session.currentScene));

    const storedPlan = taskPlansBySession[session.sessionId] ?? [];
    setTaskPlan(storedPlan);
    setTaskPlanId(taskPlanIdsBySession[session.sessionId] ?? null);

    if (storedPlan.length === 0) {
      await hydrateTaskPlanForSession(session, messages);
    }

    if (hasSessionVisual(session, messages)) {
      openWorkspaceTab("preview");
    }

    setSidebarOpen(false);
  }

  async function ensureSession(): Promise<SessionSceneState> {
    if (sessionState?.sessionId) {
      return sessionState;
    }

    const response = await createSession();
    setSessions((previous) => [response.sceneState, ...previous.filter((session) => session.sessionId !== response.sessionId)]);
    setCurrentActiveSessionId(response.sessionId);
    setSessionState(response.sceneState);
    setWebsocketUrl(response.websocketUrl);
    setLiveAssistantMessageId(null);
    setEditedCode(null);
    setSessionMessages((previous) => ({
      ...previous,
      [response.sessionId]: []
    }));
    setTaskPlan([]);
    setTaskPlanId(null);
    setStreamedCodeBySession((previous) => ({
      ...previous,
      [response.sessionId]: response.sceneState.currentScene?.code ?? ""
    }));
    setSidebarOpen(false);
    return response.sceneState;
  }

  async function handleComposerSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const trimmedValue = composerValue.trim();
    if (!trimmedValue || isSending) {
      return;
    }

    const abortController = new AbortController();
    composerAbortControllerRef.current = abortController;
    setIsSending(true);
    setLiveStep("Waiting for response...");
    setConversationStarted(true);
    const clientMessageId = `client-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`}`;
    const requestId = clientMessageId;
    let sessionId = "";

    try {
      const session = await ensureSession();
      sessionId = session.sessionId;
      inFlightSessionIdRef.current = sessionId;
      setComposerValue("");
      resetComposerHeight();
      setSourceMenuOpen(false);
      setEditedCode(null);

      setSessionMessages((previous) => {
        const nextMessages = previous[sessionId] ? [...previous[sessionId]] : [];
        nextMessages.push({
          id: clientMessageId,
          role: "user",
          content: trimmedValue,
          kind: "input",
          meta: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        return {
          ...previous,
          [sessionId]: nextMessages
        };
      });

      activeRequestIdRef.current = requestId;
      await dispatchWebSocketTurn({
        sessionId,
        content: trimmedValue,
        clientMessageId,
        requestId,
        preferences: undefined,
        awaitCompletion: false
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setLiveStep("Turn stopped");
        setIsSending(false);
        inFlightSessionIdRef.current = null;
        return;
      }

      if (!sessionId) {
        setSessionsError(error instanceof Error ? error.message : "Chat request failed.");
        return;
      }

      const fallbackMessage: ChatMessage = {
        speaker: "assistant",
        eyebrow: "AGENT",
        title: "Unable to send message right now.",
        body: error instanceof Error ? error.message : "Chat request failed."
      };

      setSessionMessages((previous) => {
        const nextMessages = previous[sessionId] ? [...previous[sessionId]] : [];
        nextMessages.push({
          id: `local-${Date.now()}`,
          role: "assistant",
          content: fallbackMessage.title ?? "Unable to send message right now.",
          kind: "error",
          meta: fallbackMessage.body ? [fallbackMessage.body] : [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        return {
          ...previous,
          [sessionId]: nextMessages
        };
      });

      setIsSending(false);
      activeRequestIdRef.current = null;
      inFlightSessionIdRef.current = null;
      removePendingTurn(requestId);
    } finally {
      if (composerAbortControllerRef.current === abortController) {
        composerAbortControllerRef.current = null;
      }
    }
  }

  function handleComposerStop(): void {
    const socket = websocketRef.current;
    const currentRequestId = activeRequestIdRef.current;

    if (socket && socket.readyState === WebSocket.OPEN && currentRequestId) {
      socket.send(
        JSON.stringify({
          type: "turn.abort",
          payload: {
            sessionId: activeSessionId,
            requestId: currentRequestId
          }
        })
      );
    } else {
      composerAbortControllerRef.current?.abort();
    }

    if (currentRequestId) {
      removePendingTurn(currentRequestId);
      rejectPendingTurnCompletion(currentRequestId, new Error("Turn stopped"));
    }

    composerAbortControllerRef.current = null;
    setIsSending(false);
    setLiveStep("Turn stopped");
    activeRequestIdRef.current = null;
    inFlightSessionIdRef.current = null;
  }

  function handleStartConversation(prompt: string): void {
    setConversationStarted(true);
    setComposerValue(prompt);
  }

  async function handleUndo(): Promise<void> {
    if (!activeSessionId) return;
    try {
      const result = await dispatchWebSocketSceneCommand({
        sessionId: activeSessionId,
        command: "revision.previous"
      });
      if (result.payload?.sceneState) {
        const nextSceneState = result.payload.sceneState;
        setSessionState(nextSceneState);
        setSessions((previous) => previous.map((session) => (session.sessionId === nextSceneState.sessionId ? nextSceneState : session)));
        setEditedCode(null);
      }
    } catch { /* ignore */ }
  }

  async function handleRedo(): Promise<void> {
    if (!activeSessionId) return;
    try {
      const result = await dispatchWebSocketSceneCommand({
        sessionId: activeSessionId,
        command: "revision.next"
      });
      if (result.payload?.sceneState) {
        const nextSceneState = result.payload.sceneState;
        setSessionState(nextSceneState);
        setSessions((previous) => previous.map((session) => (session.sessionId === nextSceneState.sessionId ? nextSceneState : session)));
        setEditedCode(null);
      }
    } catch { /* ignore */ }
  }

  async function handlePreviousArtifact(): Promise<void> {
    if (!activeSessionId) return;

    try {
      const result = await dispatchWebSocketSceneCommand({
        sessionId: activeSessionId,
        command: "artifact.previous"
      });
      if (result.payload?.sceneState) {
        const nextSceneState = result.payload.sceneState;
        setSessionState(nextSceneState);
        setSessions((previous) => previous.map((session) => (session.sessionId === nextSceneState.sessionId ? nextSceneState : session)));
        setEditedCode(null);
        openWorkspaceTab("preview");
      }
    } catch {
      // ignore
    }
  }

  async function handleNextArtifact(): Promise<void> {
    if (!activeSessionId) return;

    try {
      const result = await dispatchWebSocketSceneCommand({
        sessionId: activeSessionId,
        command: "artifact.next"
      });
      if (result.payload?.sceneState) {
        const nextSceneState = result.payload.sceneState;
        setSessionState(nextSceneState);
        setSessions((previous) => previous.map((session) => (session.sessionId === nextSceneState.sessionId ? nextSceneState : session)));
        setEditedCode(null);
        openWorkspaceTab("preview");
      }
    } catch {
      // ignore
    }
  }

  function handleCodeRun(code: string): void {
    setEditedCode(code);
    // The SceneViewer will pick up editedCode when it changes
  }

  async function handlePreviewNaturalLanguageEdit(instruction: string): Promise<{ ok: boolean; message: string }> {
    const trimmedInstruction = instruction.trim();
    if (!trimmedInstruction) {
      return {
        ok: false,
        message: "Enter an edit instruction first."
      };
    }

    if (!activeSessionId) {
      return {
        ok: false,
        message: "Start a session before applying preview edits."
      };
    }

    if (!selectedSession?.currentScene?.code) {
      return {
        ok: false,
        message: "Generate a scene first, then apply an edit instruction."
      };
    }

    setIsApplyingPreviewEdit(true);
    setLiveStep("Applying preview edit...");
    setRawLiveStep("generate_code");
    setRawLiveStepStatus("running");
    setEditedCode(null);

    const previewSkill = currentSkill === "threejs" || currentSkill === "p5js" || currentSkill === "d3js" || currentSkill === "animejs"
      ? currentSkill
      : "auto";
    const clientMessageId = `preview-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`}`;
    const requestId = clientMessageId;

    try {
      activeRequestIdRef.current = requestId;
      inFlightSessionIdRef.current = activeSessionId;
      const completion = await dispatchWebSocketTurn({
        sessionId: activeSessionId,
        content: trimmedInstruction,
        mode: "modify",
        clientMessageId,
        requestId,
        preferences: {
          skill: previewSkill,
          mode: "modify"
        },
        awaitCompletion: true
      });

      await refreshSessions(activeSessionId);

      setRawLiveStep("sync_state");
      setRawLiveStepStatus("completed");
      setLiveStep("Preview edit applied");

      const diffSummary = completion?.payload?.diff?.changeSummary?.trim();
      const modifyOutcome = completion?.payload?.modifyOutcome ?? null;
      if (modifyOutcome === "rejected_noop") {
        return {
          ok: false,
          message: diffSummary || "No meaningful code changes were produced. Please try a more specific edit instruction."
        };
      }

      return {
        ok: true,
        message: diffSummary ? `Applied. ${diffSummary}` : "Applied edit and refreshed the preview."
      };
    } catch (error) {
      setRawLiveStep("turn_error");
      setRawLiveStepStatus("failed");
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Unable to apply preview edit right now."
      };
    } finally {
      if (activeRequestIdRef.current === requestId) {
        activeRequestIdRef.current = null;
      }
      if (inFlightSessionIdRef.current === activeSessionId) {
        inFlightSessionIdRef.current = null;
      }
      removePendingTurn(requestId);
      clearPendingTurnCompletion(requestId);
      setIsApplyingPreviewEdit(false);
    }
  }

  const activeSessionMessages = activeSessionId ? sessionMessages[activeSessionId] ?? [] : [];
  const activeThoughtMessages = useMemo<SessionMessage[]>(() => {
    if (!activeSessionId) {
      return [];
    }

    const apiThoughts = activeSessionMessages.filter((message) => isThoughtMessage(message));
    const persistedThoughts = persistedThoughtsBySession[activeSessionId] ?? [];
    return mergeThoughtMessages(apiThoughts, persistedThoughts);
  }, [activeSessionId, activeSessionMessages, persistedThoughtsBySession]);
  const hasStreamedCode = Boolean(activeSessionId && Object.prototype.hasOwnProperty.call(streamedCodeBySession, activeSessionId));
  const effectiveTaskPlan = useMemo<GveTask[]>(() => {
    if (taskPlan.length > 0) {
      return taskPlan;
    }

    if (activeSessionId && selectedSession?.currentScene) {
      const activeMessages = sessionMessages[activeSessionId] ?? [];
      return deriveRecoveredTaskPlan(
        selectedSession,
        activeMessages,
        activeSessionActivities,
        activeThoughtMessages
      );
    }

    if (activeSessionActivities.length > 0 || activeThoughtMessages.length > 0 || Boolean(rawLiveStep)) {
      return cloneFallbackTaskPlan();
    }

    return [];
  }, [
    taskPlan,
    activeSessionId,
    selectedSession,
    sessionMessages,
    activeSessionActivities,
    activeThoughtMessages,
    rawLiveStep
  ]);
  const streamedCode = activeSessionId && hasStreamedCode ? streamedCodeBySession[activeSessionId] : null;
  const currentCode = editedCode ?? streamedCode ?? selectedSession?.currentScene?.code ?? null;
  const currentSkill = selectedSession?.currentScene?.skill ?? null;
  const allowDarkBackground = isDarkSceneRequested(activeSessionMessages);
  const canUndo = selectedSession?.canUndo ?? false;
  const canRedo = selectedSession?.canRedo ?? false;
  const canPreviousArtifact = selectedSession?.canPreviousArtifact ?? false;
  const canNextArtifact = selectedSession?.canNextArtifact ?? false;
  const revisionCount = selectedSession?.revisionCount ?? selectedSession?.versionCount ?? 0;
  const revisionPointer = selectedSession?.revisionPointer ?? selectedSession?.versionPointer ?? (revisionCount > 0 ? revisionCount - 1 : -1);
  const artifactCount = selectedSession?.artifactCount ?? selectedSession?.artifacts?.length ?? (revisionCount > 0 ? 1 : 0);
  const artifactPointer = selectedSession?.artifactPointer ?? (artifactCount > 0 ? artifactCount - 1 : -1);
  const workspaceCollapsed = sceneViewerCollapsed;
  const assistantMessageIds = chatMessages
    .filter((message) => message.speaker === "assistant" && typeof message.id === "string")
    .map((message) => message.id as string);
  const hasLiveAssistantAnchor = Boolean(liveAssistantMessageId && assistantMessageIds.includes(liveAssistantMessageId));
  const hasThinkingSignal = Boolean(
    isSending ||
      thinkingText.trim().length > 0 ||
      rawLiveStepStatus === "running" ||
      rawLiveStep
  );
  const showPendingThinkingIndicator = conversationStarted && hasThinkingSignal && !hasLiveAssistantAnchor;
  const pendingThinkingStep = thinkingStep || rawLiveStep || "turn_started";

  // Slash commands setup
  const slashCommands = useMemo(() => createDefaultSlashCommands({
    onUndo: handleUndo,
    onRedo: handleRedo,
    onClear: () => {
      setComposerValue("");
      resetComposerHeight();
    },
    onExplain: () => {
      setComposerValue("Explain how this code works");
      composerTextareaRef.current?.focus();
    },
    onHelp: () => {
      console.log("Available commands: /undo, /redo, /clear, /explain, /help");
    }
  }), [handleUndo, handleRedo, resetComposerHeight]);

  const {
    isOpen: isSlashMenuOpen,
    filteredCommands,
    selectedIndex: slashSelectedIndex,
    handleInput: handleSlashInput,
    handleSelect: handleSlashSelect,
    handleKeyDown: handleSlashKeyDown,
    closeMenu: closeSlashMenu
  } = useSlashCommands({ commands: slashCommands });

  function renderAssistantMessageCard({
    cardKey,
    message,
    isThinkingActive,
    avatarStep,
    forcedState
  }: {
    cardKey: string;
    message: ChatMessage;
    isThinkingActive: boolean;
    avatarStep: string;
    forcedState?: AssistantCardVisualState;
  }) {
    const segments = (message.segments && message.segments.length > 0 ? message.segments : [message.title ?? ""])
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

    const hasSegments = segments.length > 0;
    const state: AssistantCardVisualState =
      forcedState ?? (message.error ? "error" : isThinkingActive && !hasSegments ? "thinking" : "generated");

    return (
      <article
        key={cardKey}
        className={`bubble-card bubble-card--assistant bubble-card--assistant-message bubble-card--assistant-message--${state}`}
      >
        <div className="message-row">
          {/* Avatar - shows thinking animation when active */}
          <div 
            className={`message-avatar ${isThinkingActive ? "message-avatar--thinking" : ""}`}
            aria-hidden="true"
          >
            {isThinkingActive ? (
              <ThinkingBubble
                thought=""
                step={avatarStep}
                isActive={true}
                variant="avatar"
              />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            )}
          </div>

          {/* Message Content */}
          <div className="message-content">
            <div className="message-author">AI</div>
            
            {hasSegments ? (
              <div className="message-text">
                <MarkdownMessage 
                  content={segments.join("\n\n")} 
                  className="assistant-message__markdown" 
                />
              </div>
            ) : state === "thinking" ? (
              <div className="message-thinking">
                <div className="thinking-dots">
                  <span className="thinking-dot" />
                  <span className="thinking-dot" />
                  <span className="thinking-dot" />
                </div>
                <span>Thinking...</span>
              </div>
            ) : null}

            {message.error ? (
              <div className="assistant-error" aria-label="Generation error">
                <p className="assistant-error__title">{message.error.title}</p>
                <p className="assistant-error__message">{message.error.userMessage}</p>
              </div>
            ) : null}

            {message.sourceCreatedAtMs && (
              <div className="message-time">
                {new Date(message.sourceCreatedAtMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </div>
            )}
          </div>
        </div>
      </article>
    );
  }

  function isChatNearBottom(element: HTMLElement): boolean {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
  }

  function scrollChatToBottom(behavior: ScrollBehavior = "smooth"): void {
    const thread = chatThreadRef.current;
    if (!thread) {
      return;
    }

    thread.scrollTo({
      top: thread.scrollHeight,
      behavior
    });
  }

  function handleChatThreadScroll(): void {
    const thread = chatThreadRef.current;
    if (!thread) {
      return;
    }

    const nearBottom = isChatNearBottom(thread);
    autoScrollRef.current = nearBottom;
    setShowScrollToLatest(!nearBottom);
  }

  useEffect(() => {
    if (!activeSessionId) {
      setShowScrollToLatest(false);
      return;
    }

    autoScrollRef.current = true;
    window.requestAnimationFrame(() => {
      scrollChatToBottom("auto");
      setShowScrollToLatest(false);
    });
  }, [activeSessionId]);

  useEffect(() => {
    if (!chatThreadRef.current) {
      return;
    }

    if (autoScrollRef.current) {
      window.requestAnimationFrame(() => {
        scrollChatToBottom("auto");
        setShowScrollToLatest(false);
      });
      return;
    }

    setShowScrollToLatest(true);
  }, [chatMessages.length, thinkingText, isSending]);

  return (
    <main
      className={`page-shell chat-page ${sidebarOpen ? "chat-page--sidebar-open" : "chat-page--sidebar-closed"}`}
      style={shellStyle}
    >
      <aside className={`sidebar-drawer ${sidebarOpen ? "sidebar-drawer--open" : "sidebar-drawer--closed"}`} aria-label="Sidebar">
        <div className="sidebar-shell">
          <header className="sidebar-shell__top">
            <button
              type="button"
              className="sidebar-shell__anchor sidebar-entry-button"
              aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen((value) => !value)}
            >
              {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
            </button>

            <div className="sidebar-shell__top-tools">
              <button type="button" className="sidebar-shell__icon" aria-label="Settings">
                <Settings2 className="h-4 w-4" />
              </button>
              <button type="button" className="sidebar-shell__icon" aria-label="Search">
                <Search className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div className="sidebar-shell__body">
            <div className="sidebar-shell__primary">
              <button type="button" className="sidebar-action sidebar-action--active">
                <PencilLine className="h-4 w-4" />
                <span>Create new chat</span>
              </button>
              <button type="button" className="sidebar-action">
                <Sparkles className="h-4 w-4" />
                <span>New model</span>
              </button>
              <button type="button" className="sidebar-action">
                <LayoutGrid className="h-4 w-4" />
                <span>History</span>
              </button>
            </div>

            <div className="sidebar-shell__groups">
              {sessionsLoading ? (
                <section className="sidebar-group">
                  <button type="button" className="sidebar-group__header">
                    <span>Sessions</span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <div className="sidebar-group__items">
                    <button type="button" className="sidebar-item" disabled>
                      <span>Loading sessions...</span>
                    </button>
                  </div>
                </section>
              ) : sessionsError ? (
                <section className="sidebar-group">
                  <button type="button" className="sidebar-group__header">
                    <span>Sessions</span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <div className="sidebar-group__items">
                    <button type="button" className="sidebar-item" disabled>
                      <span>{sessionsError}</span>
                    </button>
                  </div>
                </section>
              ) : sessionGroups.length === 0 ? (
                <section className="sidebar-group">
                  <button type="button" className="sidebar-group__header">
                    <span>Sessions</span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <div className="sidebar-group__items">
                    <button type="button" className="sidebar-item" disabled>
                      <span>No sessions yet</span>
                    </button>
                  </div>
                </section>
              ) : (
                sessionGroups.map((group) => (
                  <section key={group.title} className="sidebar-group">
                    <button type="button" className="sidebar-group__header">
                      <span>{group.title}</span>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <div className="sidebar-group__items">
                      {group.items.map((session) => {
                        const isActive = session.sessionId === activeSessionId;
                        const title = deriveSessionTitle(session, sessionMessages[session.sessionId]);

                        return (
                          <button
                            key={session.sessionId}
                            type="button"
                            className={`sidebar-item ${isActive ? "sidebar-item--active" : ""}`}
                            onClick={() => {
                              void selectSession(session);
                            }}
                          >
                            <span className="sidebar-item__title">{title}</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))
              )}
            </div>

            <footer className="sidebar-footer" aria-label="Profile and plan">
              <button type="button" className="sidebar-user">
                <span className="sidebar-user__avatar">w</span>
                <span className="sidebar-user__name">wlad</span>
                <span className="sidebar-user__badge">pro</span>
              </button>

              <div className="sidebar-footer__actions">
                <button type="button" className="sidebar-footer__pill">
                  + PRO
                </button>
                <button type="button" className="sidebar-footer__icon" aria-label="Log out">
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            </footer>
          </div>
        </div>
      </aside>

      <div className={`chat-layout ${workspaceCollapsed ? "chat-layout--workspace-collapsed" : ""}`}>
        {workspaceCollapsed ? (
          <button
            type="button"
            className="sidebar-shell__anchor sidebar-entry-button workspace-entry-button"
            aria-label="Open workspace"
            onClick={() => setSceneViewerCollapsed(false)}
            title="Open workspace"
          >
            <PanelRightOpen className="h-4 w-4" />
          </button>
        ) : null}

        {/* ── Left: Chat Panel ── */}
        <div
          className={`chat-panel ${workspaceCollapsed ? "chat-panel--workspace-collapsed" : ""} ${
            !conversationStarted ? "chat-panel--welcome-mode" : "chat-panel--conversation-mode"
          }`}
        >

        {!conversationStarted ? (
          <section className="welcome-stage" aria-label="Welcome screen">
            <article className="bubble-card bubble-card--welcome">
              <p className="bubble-card__eyebrow">WELCOME</p>
              <h2 className="bubble-card__title">Ask dosco to build visuals for you</h2>
              <p className="bubble-card__body">Start with a prompt or pick one to begin.</p>

              <div className="welcome-stage__actions">
                {[
                  "Build a rotating 3D cube",
                  "Draft a compact UI shell",
                  "Explain the architecture"
                ].map((prompt) => (
                  <button key={prompt} type="button" className="welcome-chip" onClick={() => handleStartConversation(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
            </article>
          </section>
        ) : (
          <section className="chat-stage" aria-label="Conversation">
            <section className="chat-thread" aria-label="Conversation messages" ref={chatThreadRef} onScroll={handleChatThreadScroll}>
            {chatMessages.length > 0 ? (
                <>
                {chatMessages.map((message, index) => {
                  const isAssistant = message.speaker === "assistant";
                  const liveThinkingAttached = Boolean(
                    isAssistant &&
                      hasLiveAssistantAnchor &&
                      message.id &&
                      liveAssistantMessageId &&
                      message.id === liveAssistantMessageId
                  );
                  const messageKey = message.id ?? `${message.speaker}-${message.eyebrow}-${message.title}-${index}`;
                  const assistantSegments =
                    message.segments && message.segments.length > 0
                      ? message.segments.filter((segment) => segment.trim().length > 0)
                      : (message.title ? [message.title.trim()] : []);
                  const hasAssistantVisibleContent = Boolean(
                    assistantSegments.length > 0 || message.error
                  );

                  if (isAssistant && !hasAssistantVisibleContent && !liveThinkingAttached) {
                    return null;
                  }

                  if (isAssistant) {
                    return renderAssistantMessageCard({
                      cardKey: messageKey,
                      message,
                      isThinkingActive: liveThinkingAttached,
                      avatarStep: thinkingStep || "turn_started"
                    });
                  }

                  // User message with new clean layout
                  return (
                  <article
                    key={messageKey}
                    className="bubble-card bubble-card--user"
                  >
                    <div className="message-row message-row--user">
                      <div className="message-avatar message-avatar--user">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                          <circle cx="12" cy="7" r="4"/>
                        </svg>
                      </div>
                      <div className="message-content">
                        <div className="message-author message-author--user">You</div>
                        <div className="message-text">{message.title}</div>
                        {message.sourceCreatedAtMs && (
                          <div className="message-time">
                            {new Date(message.sourceCreatedAtMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                  );
                })}
                {showPendingThinkingIndicator ? (
                  renderAssistantMessageCard({
                    cardKey: "pending-thinking",
                    message: { speaker: "assistant" },
                    isThinkingActive: true,
                    avatarStep: pendingThinkingStep,
                    forcedState: "thinking"
                  })
                ) : null}
                </>
              ) : showPendingThinkingIndicator ? (
                renderAssistantMessageCard({
                  cardKey: "pending-thinking-empty",
                  message: { speaker: "assistant" },
                  isThinkingActive: true,
                  avatarStep: pendingThinkingStep,
                  forcedState: "thinking"
                })
              ) : messageLoadingSessionId === activeSessionId ? (
                <article className="bubble-card bubble-card--assistant bubble-card--welcome">
                  <p className="bubble-card__eyebrow">AGENT</p>
                  <h2 className="bubble-card__title">Loading live conversation...</h2>
                  <p className="bubble-card__body">Fetching the transcript for this session from the API.</p>
                </article>
              ) : selectedSession ? (
                <article className="bubble-card bubble-card--assistant bubble-card--welcome">
                  <p className="bubble-card__eyebrow">AGENT</p>
                  <h2 className="bubble-card__title">{selectedSession.currentScene?.explanation ?? "This session has not generated a scene yet."}</h2>
                  <p className="bubble-card__body">
                    {selectedSession.currentScene
                      ? `Live session ${selectedSession.sessionId.slice(0, 8)} · ${selectedSession.versionCount} version${selectedSession.versionCount === 1 ? "" : "s"}`
                      : "Select or create a conversation to see live data from the session API."}
                  </p>
                </article>
              ) : (
                <article className="bubble-card bubble-card--welcome">
                  <p className="bubble-card__eyebrow">CHAT SCREEN</p>
                  <h2 className="bubble-card__title">No live conversation yet.</h2>
                  <p className="bubble-card__body">Use the composer below to create a session and generate live assistant bubbles from the API.</p>
                </article>
              )}
            </section>

            {showScrollToLatest ? (
              <button
                type="button"
                className="chat-scroll-to-latest"
                onClick={() => {
                  autoScrollRef.current = true;
                  scrollChatToBottom("smooth");
                  setShowScrollToLatest(false);
                }}
                aria-label="Scroll to latest message"
              >
                <ChevronDown className="h-3.5 w-3.5" />
                Latest
              </button>
            ) : null}
          </section>
        )}

        {/* Agent Thoughts Bar - Collapsible component above composer */}
        <ThoughtsBar
          thoughts={activeThoughtMessages}
          liveThought={thinkingText ? { text: thinkingText, step: thinkingStep || "turn_started" } : null}
          isThinking={isSending}
        />

        <section className="composer-stage" aria-label="Composer">
          <form className="composer-shell" onSubmit={handleComposerSubmit}>
            <div className="composer-shell__input-wrap">
              {/* Plus Button */}
              <div className="composer-menu-anchor">
                <button
                  type="button"
                  className="composer-add-button"
                  aria-label="Add source"
                  aria-expanded={sourceMenuOpen}
                  onClick={() => setSourceMenuOpen((value) => !value)}
                >
                  <Plus className="h-4 w-4" />
                </button>

                {sourceMenuOpen && (
                  <div className="composer-source-menu" role="menu" aria-label="Add source menu">
                    <button type="button" className="composer-source-menu__item" role="menuitem">
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Upload spec</span>
                    </button>
                    <button type="button" className="composer-source-menu__item" role="menuitem">
                      <Search className="h-3.5 w-3.5" />
                      <span>Import meeting notes</span>
                    </button>
                    <button type="button" className="composer-source-menu__item" role="menuitem">
                      <LayoutGrid className="h-3.5 w-3.5" />
                      <span>Connect repo</span>
                    </button>
                    <button type="button" className="composer-source-menu__item" role="menuitem">
                      <Database className="h-3.5 w-3.5" />
                      <span>Attach dataset</span>
                    </button>
                    <button type="button" className="composer-source-menu__item" role="menuitem">
                      <MessageSquarePlus className="h-3.5 w-3.5" />
                      <span>Choose from Library</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Text Input */}
              <textarea
                id="composer-input"
                ref={composerTextareaRef}
                className="composer-input"
                placeholder="Type a new message"
                aria-label="Composer input"
                value={composerValue}
                onChange={(event) => {
                  setComposerValue(event.target.value);
                  // Handle slash command input
                  handleSlashInput(event.target.value, event.target.selectionStart || 0);
                }}
                onKeyDown={(event) => {
                  // Handle slash command menu navigation
                  if (isSlashMenuOpen) {
                    const handled = handleSlashKeyDown(event);
                    if (handled) return;
                  }
                }}
                rows={1}
              />

              {/* Slash Command Menu */}
              {isSlashMenuOpen && (
                <SlashCommandMenu
                  commands={filteredCommands}
                  selectedIndex={slashSelectedIndex}
                  onSelect={handleSlashSelect}
                />
              )}

              {/* Send/Stop Button */}
              {isSending ? (
                <button type="button" className="composer-send-button composer-send-button--stop" aria-label="Stop generation" onClick={handleComposerStop}>
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              ) : (
                <button
                  type="submit"
                  className="composer-send-button"
                  aria-label="Send message"
                  disabled={composerValue.trim().length === 0}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M12 5v14m0-14 6 6m-6-6-6 6" />
                  </svg>
                </button>
              )}
            </div>
          </form>
        </section>
        </div>

        {/* ── Right: Workspace Panel ── */}
        {!workspaceCollapsed ? (
        <div className="workspace-panel">
          <div className="workspace-panel__toolbar">
            <div className="workspace-tabs">
              <button
                type="button"
                className={`workspace-tab ${activeTab === "preview" ? "workspace-tab--active" : ""}`}
                onClick={() => setActiveTab("preview")}
              >
                <Eye className="h-3.5 w-3.5" style={{ display: "inline", verticalAlign: "-2px", marginRight: "4px" }} />
                Preview
              </button>
              <button
                type="button"
                className={`workspace-tab ${activeTab === "code" ? "workspace-tab--active" : ""}`}
                onClick={() => setActiveTab("code")}
              >
                <Code2 className="h-3.5 w-3.5" style={{ display: "inline", verticalAlign: "-2px", marginRight: "4px" }} />
                Code
              </button>
            </div>

            <div className="workspace-toolbar-actions">
              {artifactCount > 0 ? (
                <div className="workspace-toolbar-group" aria-label="Artifact navigation">
                  <button
                    type="button"
                    className="workspace-toolbar-btn"
                    onClick={handlePreviousArtifact}
                    disabled={!canPreviousArtifact}
                    aria-label="Previous artifact"
                    title="Previous artifact"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="version-label">Artifact {artifactPointer + 1}/{artifactCount}</span>
                  <button
                    type="button"
                    className="workspace-toolbar-btn"
                    onClick={handleNextArtifact}
                    disabled={!canNextArtifact}
                    aria-label="Next artifact"
                    title="Next artifact"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
              {revisionCount > 0 ? <span className="version-label">Revision {revisionPointer + 1}/{revisionCount}</span> : null}
              <button
                type="button"
                className="workspace-toolbar-btn"
                onClick={handleUndo}
                disabled={!canUndo || revisionCount <= 0}
                aria-label="Undo revision"
                title="Undo revision"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="workspace-toolbar-btn"
                onClick={handleRedo}
                disabled={!canRedo || revisionCount <= 0}
                aria-label="Redo revision"
                title="Redo revision"
              >
                <Redo2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="workspace-toolbar-btn"
                onClick={() => setSceneViewerCollapsed(true)}
                aria-label="Minimize workspace"
                title="Minimize workspace"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="workspace-panel__body">
            {activeTab === "preview" && (
              <SceneViewer
                code={currentCode}
                skill={currentSkill}
              />
            )}
            {activeTab === "code" && (
              <CodeEditor
                code={currentCode}
                skill={currentSkill}
                onRun={handleCodeRun}
              />
            )}
          </div>
        </div>
        ) : null}
      </div>
    </main>
  );
}

export default App;
