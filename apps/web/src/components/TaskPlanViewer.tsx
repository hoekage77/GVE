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
  ListTree,
  Clock,
  ChevronDown,
  ChevronUp
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
  parse_intent: "Parse Intent",
  select_skill: "Select Skill",
  build_prompt: "Build Prompt",
  generate_code: "Generate Code",
  validate_code: "Validate",
  execute_code: "Execute",
  sync_state: "Sync State"
};

const STEP_DESCRIPTIONS: Record<string, string> = {
  parse_intent: "Extract action, entities, constraints",
  select_skill: "Score and rank rendering skills",
  build_prompt: "Assemble context for the model",
  generate_code: "Generate executable scene code",
  validate_code: "Syntax, security, API checks",
  execute_code: "Run in sandbox runtime",
  sync_state: "Commit scene version"
};

const ACTIVITY_LABELS: Record<string, string> = {
  ...STEP_LABELS,
  intent_parsed: "Intent Parsed",
  turn_complete: "Complete",
  turn_error: "Error"
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

function statusIcon(status: GveTaskStatus, size: "sm" | "md" = "sm") {
  const sizeClass = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  switch (status) {
    case "completed":
      return <CheckCircle2 className={`${sizeClass} task-icon task-icon--completed`} />;
    case "running":
      return <Loader2 className={`${sizeClass} task-icon task-icon--running animate-spin`} />;
    case "failed":
      return <XCircle className={`${sizeClass} task-icon task-icon--failed`} />;
    default:
      return <Circle className={`${sizeClass} task-icon task-icon--pending`} />;
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
  if (!step) return "thought";
  const mapped = ACTIVITY_LABELS[step] ?? STEP_LABELS[mapOrcheStepToAction(step) ?? ""];
  return mapped ?? step.replace(/_/g, " ");
}

function toTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
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

  if (entries.length === 0) return [];

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
  if (status === "failed") return "Error";
  if (status === "completed") return "Done";
  return "Running";
}

function formatTime(ts: number | null): string {
  if (!ts) return "--";
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDuration(start: number, end: number | null): string {
  const duration = (end ?? Date.now()) - start;
  if (duration < 1000) return `${duration}ms`;
  return `${(duration / 1000).toFixed(1)}s`;
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
  const [expandedSections, setExpandedSections] = useState({
    pipeline: false,
    activity: true,
    thoughts: true
  });

  useEffect(() => {
    setLiveTasks(tasks);
  }, [tasks]);

  useEffect(() => {
    if (!currentStep) return;
    const matchedAction = mapOrcheStepToAction(currentStep);
    if (!matchedAction) return;

    setLiveTasks(prev => {
      const taskIndex = prev.findIndex(t => t.action === matchedAction);
      if (taskIndex === -1) return prev;

      let resolvedStatus = currentStepStatus ?? null;
      if (!resolvedStatus) {
        const isTerminal = currentStep === "turn_complete" || currentStep === "turn_error";
        const isFailed = currentStep === "validation_failed" || currentStep === "execution_skipped" || currentStep === "turn_error";
        resolvedStatus = (isFailed ? "failed" : isTerminal ? "completed" : "running") as GveTaskStatus;
      }

      return prev.map((task, idx) => {
        if (task.action === matchedAction) {
          return { ...task, status: resolvedStatus as GveTaskStatus };
        }
        if (taskIndex > idx && task.status === "pending") {
          return { ...task, status: "completed" as GveTaskStatus };
        }
        return task;
      });
    });
  }, [currentStep, currentStepStatus, tasks]);

  useEffect(() => {
    if (activities.length === 0) return;
    const latestStatusByAction = new Map<string, GveTaskStatus>();
    for (const activity of activities) {
      const action = mapOrcheStepToAction(activity.step);
      if (action) latestStatusByAction.set(action, activity.status);
    }
    if (latestStatusByAction.size === 0) return;

    setLiveTasks((prev) => {
      let changed = false;
      const next = prev.map((task) => {
        const status = latestStatusByAction.get(task.action);
        if (!status || status === task.status) return task;
        changed = true;
        return { ...task, status };
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
  const focusLabel = focusTask ? (STEP_LABELS[focusTask.action] ?? focusTask.title) : "Ready";
  
  const turnHistory = useMemo(() => buildTurnHistory(activities, thoughts), [activities, thoughts]);
  const latestTurnIndex = Math.max(turnHistory.length - 1, 0);

  useEffect(() => {
    setSelectedTurnIndex((prev) => followLatestTurn ? latestTurnIndex : Math.min(prev, latestTurnIndex));
  }, [followLatestTurn, latestTurnIndex]);

  const selectedTurn = turnHistory[selectedTurnIndex] ?? null;
  const selectedActivities = selectedTurn?.activities ?? [];
  const selectedThoughts = selectedTurn?.thoughts ?? [];

  const visibleThoughts = selectedThoughts.slice().reverse();
  
  const latestActivity = activities.length > 0 ? activities[activities.length - 1] : null;
  let deploymentLabel = "Waiting...";
  if (failedTask) deploymentLabel = "Issue encountered";
  else if (totalCount > 0 && completedCount === totalCount) deploymentLabel = "Complete";
  else if (latestActivity?.text) deploymentLabel = latestActivity.text;

  // Compact task list for sidebar
  const renderCompactTaskList = () => (
    <div className="task-sidebar__list">
      {liveTasks.map((task, index) => (
        <div
          key={task.id}
          className={`task-sidebar__item task-sidebar__item--${task.status}`}
          title={STEP_DESCRIPTIONS[task.action]}
        >
          <div className="task-sidebar__icon">
            {statusIcon(task.status, "sm")}
          </div>
          <span className="task-sidebar__label">{STEP_LABELS[task.action] ?? task.title}</span>
          {task.status === "running" && (
            <div className="task-sidebar__pulse" />
          )}
        </div>
      ))}
    </div>
  );

  if (liveTasks.length === 0 && activities.length === 0) {
    return (
      <div className="task-sidebar task-sidebar--empty">
        <div className="task-sidebar__header">
          <Monitor className="h-4 w-4" />
          <span>Task History</span>
        </div>
        <p className="task-sidebar__empty-text">Submit a request to see task progress</p>
      </div>
    );
  }

  return (
    <div className="task-sidebar">
      {/* Header */}
      <div className="task-sidebar__header">
        <div className="task-sidebar__title">
          <Monitor className="h-4 w-4" />
          <span>Tasks</span>
        </div>
        <div className="task-sidebar__progress">
          <span>{completedCount}/{totalCount}</span>
        </div>
      </div>

      {/* Mini Progress Bar */}
      <div className="task-sidebar__progress-bar">
        <div 
          className="task-sidebar__progress-fill" 
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Current Status */}
      <div className="task-sidebar__status">
        <Plug2 className="h-3 w-3" />
        <span className="task-sidebar__status-text">{deploymentLabel}</span>
      </div>

      {/* Compact Task List */}
      {renderCompactTaskList()}

      {/* Turn Navigator */}
      {turnHistory.length > 1 && (
        <div className="task-sidebar__turns">
          <button
            type="button"
            className="task-sidebar__turn-btn"
            onClick={() => {
              setSelectedTurnIndex(Math.max(0, selectedTurnIndex - 1));
              setFollowLatestTurn(false);
            }}
            disabled={selectedTurnIndex <= 0}
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
          <span className="task-sidebar__turn-label">
            Turn {selectedTurnIndex + 1}/{turnHistory.length}
          </span>
          <button
            type="button"
            className="task-sidebar__turn-btn"
            onClick={() => {
              setSelectedTurnIndex(Math.min(latestTurnIndex, selectedTurnIndex + 1));
              setFollowLatestTurn(selectedTurnIndex + 1 >= latestTurnIndex);
            }}
            disabled={selectedTurnIndex >= latestTurnIndex}
          >
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Expandable Activity Section */}
      {selectedActivities.length > 0 && (
        <div className="task-sidebar__section">
          <button
            type="button"
            className="task-sidebar__section-header"
            onClick={() => setExpandedSections(prev => ({ ...prev, activity: !prev.activity }))}
          >
            <ListTree className="h-3 w-3" />
            <span>Activity</span>
            {expandedSections.activity ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          
          {expandedSections.activity && (
            <div className="task-sidebar__activity-list">
              {selectedActivities.slice(-4).reverse().map((activity) => (
                <div key={activity.id} className={`task-sidebar__activity task-sidebar__activity--${activity.status}`}>
                  <span className="task-sidebar__activity-step">
                    {ACTIVITY_LABELS[activity.step] ?? activity.step}
                  </span>
                  <span className="task-sidebar__activity-time">
                    {new Date(activity.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Expandable Thoughts Section */}
      {(liveThought || visibleThoughts.length > 0) && (
        <div className="task-sidebar__section">
          <button
            type="button"
            className="task-sidebar__section-header"
            onClick={() => setExpandedSections(prev => ({ ...prev, thoughts: !prev.thoughts }))}
          >
            <Brain className="h-3 w-3" />
            <span>Thoughts</span>
            {expandedSections.thoughts ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          
          {expandedSections.thoughts && (
            <div className="task-sidebar__thoughts-list">
              {liveThought && selectedTurnIndex === latestTurnIndex && (
                <div className="task-sidebar__thought task-sidebar__thought--live">
                  <span className="task-sidebar__thought-step">{formatThoughtStep(liveThought.step)}</span>
                  <p className="task-sidebar__thought-text">{liveThought.text}</p>
                </div>
              )}
              {visibleThoughts.slice(0, 3).map((thought) => (
                <div key={thought.id} className="task-sidebar__thought">
                  <span className="task-sidebar__thought-step">
                    {formatThoughtStep(thought.meta?.[0] ?? thought.kind)}
                  </span>
                  <p className="task-sidebar__thought-text">{thought.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pipeline Toggle */}
      <button
        type="button"
        className="task-sidebar__pipeline-toggle"
        onClick={() => setExpandedSections(prev => ({ ...prev, pipeline: !prev.pipeline }))}
      >
        {expandedSections.pipeline ? "Hide Pipeline" : "Show Pipeline"}
      </button>

      {/* Expanded Pipeline */}
      {expandedSections.pipeline && (
        <div className="task-sidebar__pipeline">
          {liveTasks.map((task, index) => {
            const isLast = index === liveTasks.length - 1;
            return (
              <div key={task.id} className={`task-pipeline__step task-pipeline__step--${task.status}`}>
                <div className="task-pipeline__connector">
                  {statusIcon(task.status, "sm")}
                  {!isLast && <div className={`task-pipeline__line task-pipeline__line--${task.status}`} />}
                </div>
                <div className="task-pipeline__content">
                  <span className="task-pipeline__title">{STEP_LABELS[task.action] ?? task.title}</span>
                  <span className="task-pipeline__desc">{STEP_DESCRIPTIONS[task.action]}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {planId && (
        <div className="task-sidebar__footer">
          <span className="task-sidebar__plan-id">{planId.slice(0, 8)}</span>
        </div>
      )}
    </div>
  );
}
