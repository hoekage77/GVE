import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  ChevronRight,
  ChevronLeft,
  Monitor,
  Plug2,
  History,
  Brain,
  ListTree
} from "lucide-react";
import type { AgentActivityEvent, GveTask, GveTaskStatus, SessionMessage } from "@visual-runtime/shared";

interface TaskPlanViewerProps {
  tasks: GveTask[];
  activities?: AgentActivityEvent[];
  thoughts?: SessionMessage[];
  liveThought?: {
    text: string;
    step: string;
  } | null;
  currentStep?: string | null;
  currentStepStatus?: GveTaskStatus | null;
  planId?: string | null;
  onExecuteTask?: (task: GveTask) => void;
}

const STEP_LABELS: Record<string, string> = {
  parse_intent: "Intent Parsing",
  select_skill: "Skill Selection",
  build_prompt: "Prompt Building",
  generate_code: "Code Generation",
  validate_code: "Validation",
  execute_code: "Execution",
  sync_state: "State Sync"
};

const STEP_DESCRIPTIONS: Record<string, string> = {
  parse_intent: "Extracting action, entities, and constraints from your request",
  select_skill: "Scoring and ranking available rendering skills",
  build_prompt: "Assembling context, templates, and constraints for the model",
  generate_code: "Generating executable scene code via the LLM",
  validate_code: "Running syntax, security, and API whitelist checks",
  execute_code: "Executing validated code in the sandbox runtime",
  sync_state: "Committing scene version and broadcasting updates"
};

const ACTIVITY_LABELS: Record<string, string> = {
  ...STEP_LABELS,
  intent_parsed: "Intent Parsed",
  turn_complete: "Turn Complete",
  turn_error: "Turn Error"
};

type TurnStatus = "running" | "completed" | "failed";

interface TurnTrace {
  id: string;
  status: TurnStatus;
  startedAt: number;
  endedAt: number | null;
  activities: AgentActivityEvent[];
  thoughts: SessionMessage[];
}

function statusIcon(status: GveTaskStatus) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4 task-icon task-icon--completed" />;
    case "running":
      return <Loader2 className="h-4 w-4 task-icon task-icon--running" />;
    case "failed":
      return <XCircle className="h-4 w-4 task-icon task-icon--failed" />;
    default:
      return <Circle className="h-4 w-4 task-icon task-icon--pending" />;
  }
}

function mapOrcheStepToAction(step: string): string | null {
  const mapping: Record<string, string> = {
    parse_intent: "parse_intent",
    select_skill: "select_skill",
    build_prompt: "build_prompt",
    generate_code: "generate_code",
    execute_code: "execute_code",
    turn_started: "parse_intent",
    intent_parsed: "parse_intent",
    validate_code: "validate_code",
    validation_failed: "validate_code",
    code_generated: "generate_code",
    code_modified: "generate_code",
    executing: "execute_code",
    execution_skipped: "execute_code",
    sync_state: "sync_state",
    turn_complete: "sync_state",
    turn_error: "sync_state"
  };
  return mapping[step] ?? null;
}

function formatThoughtStep(step: string | null | undefined): string {
  if (!step) {
    return "thought";
  }

  const mapped = ACTIVITY_LABELS[step] ?? STEP_LABELS[mapOrcheStepToAction(step) ?? ""];
  if (mapped) {
    return mapped;
  }

  return step.replace(/_/g, " ");
}

function toTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isTurnStartStep(step: string): boolean {
  return step === "turn_started";
}

function isTurnTerminalStep(step: string): boolean {
  return step === "turn_complete" || step === "turn_error";
}

function buildTurnHistory(activities: AgentActivityEvent[], thoughts: SessionMessage[]): TurnTrace[] {
  type TimelineEntry =
    | { type: "activity"; step: string; at: number; item: AgentActivityEvent }
    | { type: "thought"; step: string; at: number; item: SessionMessage };

  const entries: TimelineEntry[] = [
    ...activities.map((activity) => ({
      type: "activity" as const,
      step: activity.step,
      at: toTimestamp(activity.createdAt),
      item: activity
    })),
    ...thoughts.map((thought) => {
      const step = thought.meta?.[0] ?? thought.kind ?? "thought";
      return {
        type: "thought" as const,
        step,
        at: toTimestamp(thought.createdAt),
        item: thought
      };
    })
  ].sort((a, b) => a.at - b.at);

  if (entries.length === 0) {
    return [];
  }

  const turns: TurnTrace[] = [];
  let current: TurnTrace | null = null;

  const openTurn = (at: number) => ({
    id: `turn-${turns.length + 1}`,
    status: "running" as TurnStatus,
    startedAt: at,
    endedAt: null,
    activities: [],
    thoughts: []
  });

  for (const entry of entries) {
    if (!current || isTurnStartStep(entry.step)) {
      if (current && (current.activities.length > 0 || current.thoughts.length > 0)) {
        turns.push(current);
      }
      current = openTurn(entry.at);
    }

    if (entry.type === "activity") {
      current.activities.push(entry.item);
    } else {
      current.thoughts.push(entry.item);
    }

    if (isTurnTerminalStep(entry.step)) {
      current.status = entry.step === "turn_error" ? "failed" : "completed";
      current.endedAt = entry.at;
      turns.push(current);
      current = null;
    }
  }

  if (current && (current.activities.length > 0 || current.thoughts.length > 0)) {
    turns.push(current);
  }

  return turns;
}

function formatTurnStatus(status: TurnStatus): string {
  if (status === "failed") {
    return "Error";
  }
  if (status === "completed") {
    return "Complete";
  }
  return "In Progress";
}

function formatTime(ts: number | null): string {
  if (!ts) {
    return "--";
  }

  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function TaskPlanViewer({
  tasks,
  activities = [],
  thoughts = [],
  liveThought = null,
  currentStep,
  currentStepStatus,
  planId,
  onExecuteTask
}: TaskPlanViewerProps) {
  const [liveTasks, setLiveTasks] = useState<GveTask[]>(tasks);
  const [selectedTurnIndex, setSelectedTurnIndex] = useState(0);
  const [followLatestTurn, setFollowLatestTurn] = useState(true);
  const [showPipelineSteps, setShowPipelineSteps] = useState(false);

  useEffect(() => {
    setLiveTasks(tasks);
  }, [tasks]);

  useEffect(() => {
    if (!currentStep) return;

    const matchedAction = mapOrcheStepToAction(currentStep);
    if (!matchedAction) return;

    setLiveTasks(prev => {
      const taskIndex = prev.findIndex(t => t.action === matchedAction);
      if (taskIndex === -1) {
        return prev;
      }

      let resolvedStatus = currentStepStatus ?? null;
      if (!resolvedStatus) {
        const isTerminal = currentStep === "turn_complete" || currentStep === "turn_error";
        const isFailed = currentStep === "validation_failed" || currentStep === "execution_skipped" || currentStep === "turn_error";
        resolvedStatus = (isFailed ? "failed" : isTerminal ? "completed" : "running") as GveTaskStatus;
      }

      const next = prev.map(task => {
        if (task.action === matchedAction) {
          return {
            ...task,
            status: resolvedStatus as GveTaskStatus
          };
        }

        // Mark earlier tasks as completed if a later step is active
        const currentIndex = prev.findIndex(t => t.id === task.id);
        if (taskIndex > currentIndex && task.status === "pending") {
          return { ...task, status: "completed" as GveTaskStatus };
        }

        return task;
      });
      return next;
    });
  }, [currentStep, currentStepStatus, tasks]);

  useEffect(() => {
    if (activities.length === 0) {
      return;
    }

    const latestStatusByAction = new Map<string, GveTaskStatus>();
    for (const activity of activities) {
      const action = mapOrcheStepToAction(activity.step);
      if (!action) {
        continue;
      }

      latestStatusByAction.set(action, activity.status);
    }

    if (latestStatusByAction.size === 0) {
      return;
    }

    setLiveTasks((prev) => {
      let changed = false;
      const next = prev.map((task) => {
        const status = latestStatusByAction.get(task.action);
        if (!status || status === task.status) {
          return task;
        }

        changed = true;
        return {
          ...task,
          status
        };
      });

      return changed ? next : prev;
    });
  }, [activities]);

  const completedCount = liveTasks.filter(t => t.status === "completed").length;
  const totalCount = liveTasks.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const failedTask = liveTasks.find(task => task.status === "failed");
  const runningTask = liveTasks.find(task => task.status === "running");
  const focusTask = failedTask ?? runningTask ?? liveTasks[completedCount] ?? liveTasks[liveTasks.length - 1];
  const focusLabel = focusTask ? (STEP_LABELS[focusTask.action] ?? focusTask.title) : "Pipeline Overview";
  const latestActivity = activities.length > 0 ? activities[activities.length - 1] : null;

  const turnHistory = useMemo(() => buildTurnHistory(activities, thoughts), [activities, thoughts]);
  const latestTurnIndex = Math.max(turnHistory.length - 1, 0);

  useEffect(() => {
    setSelectedTurnIndex((prev) => {
      if (followLatestTurn) {
        return latestTurnIndex;
      }
      return Math.min(prev, latestTurnIndex);
    });
  }, [followLatestTurn, latestTurnIndex]);

  const selectedTurn = turnHistory[selectedTurnIndex] ?? null;
  const selectedActivities = selectedTurn?.activities ?? [];
  const selectedThoughts = selectedTurn?.thoughts ?? [];

  const activityByStep = useMemo(() => {
    const map = new Map<string, AgentActivityEvent>();
    for (const activity of selectedActivities) {
      map.set(activity.step, activity);
    }
    return map;
  }, [selectedActivities]);

  const visibleThoughts = selectedThoughts.slice().reverse();
  const hasTimelineContent = Boolean(
    liveThought || selectedActivities.length > 0 || visibleThoughts.length > 0 || turnHistory.length > 0
  );

  const selectedStatusByAction = useMemo(() => {
    const statusMap = new Map<string, GveTaskStatus>();
    for (const activity of selectedActivities) {
      const action = mapOrcheStepToAction(activity.step);
      if (!action) {
        continue;
      }
      statusMap.set(action, activity.status);
    }
    return statusMap;
  }, [selectedActivities]);

  const displayTasks = useMemo(() => {
    if (!selectedTurn || selectedTurnIndex === latestTurnIndex || selectedStatusByAction.size === 0) {
      return liveTasks;
    }

    return liveTasks.map((task) => {
      const mapped = selectedStatusByAction.get(task.action);
      return {
        ...task,
        status: mapped ?? "pending"
      };
    });
  }, [latestTurnIndex, liveTasks, selectedStatusByAction, selectedTurn, selectedTurnIndex]);

  let deploymentLabel = "Pipeline running";
  if (failedTask) {
    deploymentLabel = "Generation encountered an issue";
  } else if (totalCount > 0 && completedCount === totalCount) {
    deploymentLabel = "Scene generated and synced";
  }

  if (latestActivity?.text) {
    deploymentLabel = latestActivity.text;
  }

  if (liveTasks.length === 0 && !hasTimelineContent) {
    return (
      <div className="task-viewer task-viewer--empty">
        <div className="scene-kimi-header">
          <div className="scene-kimi-header__top">
            <div className="scene-kimi-header__identity">
              <span className="scene-kimi-header__icon" aria-hidden="true">
                <Monitor className="h-4 w-4" />
              </span>
              <div className="scene-kimi-header__identity-copy">
                <p className="scene-kimi-header__title">dosco</p>
                <p className="scene-kimi-header__meta">
                  <span className="scene-kimi-header__dot" aria-hidden="true" />
                  <span>Task Progress 0/0</span>
                  <span className="scene-kimi-header__divider" aria-hidden="true" />
                  <span className="scene-kimi-header__focus">Pipeline overview</span>
                  <ChevronRight className="h-3 w-3" aria-hidden="true" />
                </p>
              </div>
            </div>
          </div>
          <div className="scene-kimi-header__line" />
          <p className="scene-kimi-header__status">
            <Plug2 className="h-3.5 w-3.5" aria-hidden="true" />
            Waiting for orchestration plan
          </p>
        </div>

        <div className="workspace-empty-state">
          <div className="workspace-empty-state__icon">◇</div>
          <p className="workspace-empty-state__title">Orchestration pipeline will appear here</p>
          <p className="workspace-empty-state__hint">Submit a generation request to stream task progress in real time</p>
        </div>
      </div>
    );
  }

  return (
    <div className="task-viewer">
      <div className="scene-kimi-header">
        <div className="scene-kimi-header__top">
          <div className="scene-kimi-header__identity">
            <span className="scene-kimi-header__icon" aria-hidden="true">
              <Monitor className="h-4 w-4" />
            </span>
            <div className="scene-kimi-header__identity-copy">
              <p className="scene-kimi-header__title">dosco</p>
              <p className="scene-kimi-header__meta">
                <span className="scene-kimi-header__dot" aria-hidden="true" />
                <span>Task Progress {completedCount}/{totalCount}</span>
                <span className="scene-kimi-header__divider" aria-hidden="true" />
                <span className="scene-kimi-header__focus">{focusLabel}</span>
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
              </p>
            </div>
          </div>
        </div>
        <div className="scene-kimi-header__line" />
        <p className="scene-kimi-header__status">
          <Plug2 className="h-3.5 w-3.5" aria-hidden="true" />
          {deploymentLabel}
        </p>
      </div>

      <div className="task-viewer__progress-bar">
        <div className="task-viewer__progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      {turnHistory.length > 0 && (
        <section className="task-viewer__history" aria-label="Task history">
          <p className="task-viewer__section-label">
            <History className="h-3.5 w-3.5" aria-hidden="true" />
            Task history
          </p>
          <div className="task-viewer__history-controls">
            <button
              type="button"
              className="task-viewer__history-btn"
              onClick={() => {
                setSelectedTurnIndex((prev) => Math.max(0, prev - 1));
                setFollowLatestTurn(false);
              }}
              disabled={selectedTurnIndex <= 0}
              aria-label="Previous turn"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>

            <div className="task-viewer__history-summary-wrap">
              <p className="task-viewer__history-summary">
                Turn {selectedTurnIndex + 1} / {turnHistory.length}
              </p>
              <p className={`task-viewer__history-status task-viewer__history-status--${selectedTurn?.status ?? "running"}`}>
                {formatTurnStatus(selectedTurn?.status ?? "running")}
              </p>
            </div>

            <button
              type="button"
              className="task-viewer__history-btn"
              onClick={() => {
                setSelectedTurnIndex((prev) => Math.min(latestTurnIndex, prev + 1));
                setFollowLatestTurn(selectedTurnIndex + 1 >= latestTurnIndex);
              }}
              disabled={selectedTurnIndex >= latestTurnIndex}
              aria-label="Next turn"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="task-viewer__history-range">
            {selectedTurn ? `${formatTime(selectedTurn.startedAt)} - ${formatTime(selectedTurn.endedAt ?? selectedTurn.startedAt)}` : "--"}
          </p>
        </section>
      )}

      {selectedActivities.length > 0 && (
        <section className="task-viewer__activity" aria-label="Agent activity">
          <p className="task-viewer__section-label">
            <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
            Agent activity
          </p>
          <div className="task-viewer__activity-list">
            {selectedActivities.slice(-6).reverse().map((activity) => (
              <article key={activity.id} className={`task-viewer__activity-item task-viewer__activity-item--${activity.status}`}>
                <p className="task-viewer__activity-meta">
                  <span>{ACTIVITY_LABELS[activity.step] ?? STEP_LABELS[mapOrcheStepToAction(activity.step) ?? ""] ?? activity.step}</span>
                  <span>{new Date(activity.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
                </p>
                <p className="task-viewer__activity-text">{activity.text}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {(liveThought || visibleThoughts.length > 0) && (
        <section className="task-viewer__thoughts" aria-label="Agent reasoning trace">
          <p className="task-viewer__section-label">
            <Brain className="h-3.5 w-3.5" aria-hidden="true" />
            Reasoning trace
          </p>
          <div className="task-viewer__thoughts-list">
            {liveThought && selectedTurnIndex === latestTurnIndex ? (
              <article className="task-viewer__thought-item task-viewer__thought-item--live">
                <p className="task-viewer__thought-meta">
                  <span>{formatThoughtStep(liveThought.step)}</span>
                  <span>live</span>
                </p>
                <p className="task-viewer__thought-text">{liveThought.text}</p>
              </article>
            ) : null}

            {visibleThoughts.map((thought) => {
              const step = thought.meta?.[0] ?? thought.kind ?? "thought";
              return (
                <article key={thought.id} className="task-viewer__thought-item">
                  <p className="task-viewer__thought-meta">
                    <span>{formatThoughtStep(step)}</span>
                    <span>{new Date(thought.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                  </p>
                  <p className="task-viewer__thought-text">{thought.content}</p>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <div className="task-viewer__steps-header">
        <button
          type="button"
          className="task-viewer__steps-toggle"
          onClick={() => setShowPipelineSteps((prev) => !prev)}
        >
          {showPipelineSteps ? "Hide pipeline steps" : "Show pipeline steps"}
        </button>
      </div>

      {showPipelineSteps ? (
      <div className="task-viewer__steps">
        {displayTasks.map((task, index) => {
          const isActive = task.status === "running";
          const isLast = index === displayTasks.length - 1;
          const activity = activityByStep.get(task.action);

          return (
            <div
              key={task.id}
              className={`task-step ${isActive ? "task-step--active" : ""} task-step--${task.status}`}
            >
              <div className="task-step__connector">
                {statusIcon(task.status)}
                {!isLast && <div className={`task-step__line task-step__line--${task.status}`} />}
              </div>
              <div className="task-step__content">
                <div className="task-step__header">
                  <span className="task-step__title">
                    {STEP_LABELS[task.action] ?? task.title}
                  </span>
                  {task.status === "completed" && (
                    <span className="task-step__badge task-step__badge--done">Done</span>
                  )}
                  {task.status === "failed" && (
                    <span className="task-step__badge task-step__badge--failed">Failed</span>
                  )}
                  {task.status === "running" && (
                    <span className="task-step__badge task-step__badge--running">Running</span>
                  )}
                </div>
                <p className="task-step__description">
                  {activity?.text ?? STEP_DESCRIPTIONS[task.action] ?? task.description}
                </p>
                {task.dependsOn.length > 0 && (
                  <div className="task-step__deps">
                    {task.dependsOn.map(dep => (
                      <span key={dep} className="task-step__dep-badge">
                        <ChevronRight className="h-3 w-3" />
                        {dep}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      ) : null}

      {planId && (
        <div className="task-viewer__footer">
          <span className="task-viewer__plan-id">Plan: {planId}</span>
        </div>
      )}
    </div>
  );
}
