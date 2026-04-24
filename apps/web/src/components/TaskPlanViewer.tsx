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
  Brain,
  ListTree,
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
  const sizeClass = size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5";
  switch (status) {
    case "completed":
      return <CheckCircle2 className={`${sizeClass} text-emerald-500`} />;
    case "running":
      return <Loader2 className={`${sizeClass} text-amber-500 animate-spin`} />;
    case "failed":
      return <XCircle className={`${sizeClass} text-red-500`} />;
    default:
      return <Circle className={`${sizeClass} text-neutral-600`} />;
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

export default function TaskPlanViewer({
  tasks,
  activities = [],
  thoughts = [],
  liveThought = null,
  currentStep,
  currentStepStatus,
  planId
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
    <div className="flex flex-col gap-1 px-4 pb-4">
      {liveTasks.map((task) => (
        <div
          key={task.id}
          className="flex items-center gap-2.5 rounded-lg py-1.5"
          title={STEP_DESCRIPTIONS[task.action]}
        >
          <div className="flex items-center justify-center">
            {statusIcon(task.status, "sm")}
          </div>
          <span className={`text-[13px] font-medium ${
            task.status === 'completed' ? 'text-neutral-400' :
            task.status === 'running' ? 'text-neutral-200' :
            task.status === 'failed' ? 'text-red-400' : 'text-neutral-600'
          }`}>
            {STEP_LABELS[task.action] ?? task.title}
          </span>
        </div>
      ))}
    </div>
  );

  if (liveTasks.length === 0 && activities.length === 0) {
    return (
      <div className="flex h-full flex-col bg-neutral-900 border-l border-neutral-800 text-neutral-400">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-neutral-800">
          <Monitor className="h-4 w-4" />
          <span className="text-sm font-medium">Task History</span>
        </div>
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm">
          Submit a request to see task progress
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-neutral-900 border-l border-neutral-800 text-neutral-300 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2 font-medium text-neutral-200">
          <Monitor className="h-4 w-4 text-neutral-400" />
          <span className="text-sm">Tasks</span>
        </div>
        <div className="text-[11px] font-medium tracking-wide text-neutral-500">
          {completedCount}/{totalCount}
        </div>
      </div>

      {/* Mini Progress Bar */}
      <div className="px-5 pb-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
          <div 
            className="h-full rounded-full bg-neutral-300 transition-all duration-500 ease-out" 
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Current Status */}
      <div className="flex items-center gap-2 px-5 pb-4">
        <Plug2 className="h-3.5 w-3.5 text-neutral-500" />
        <span className="truncate text-xs font-medium text-neutral-400">{deploymentLabel}</span>
      </div>

      {/* Compact Task List */}
      {renderCompactTaskList()}

      {/* Turn Navigator */}
      {turnHistory.length > 1 && (
        <div className="flex items-center justify-between border-t border-neutral-800 bg-neutral-800/20 px-3 py-2">
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30 disabled:hover:bg-transparent"
            onClick={() => {
              setSelectedTurnIndex(Math.max(0, selectedTurnIndex - 1));
              setFollowLatestTurn(false);
            }}
            disabled={selectedTurnIndex <= 0}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-xs font-medium text-neutral-500">
            Turn {selectedTurnIndex + 1} of {turnHistory.length}
          </span>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30 disabled:hover:bg-transparent"
            onClick={() => {
              setSelectedTurnIndex(Math.min(latestTurnIndex, selectedTurnIndex + 1));
              setFollowLatestTurn(selectedTurnIndex + 1 >= latestTurnIndex);
            }}
            disabled={selectedTurnIndex >= latestTurnIndex}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex-1 divide-y divide-neutral-800">
        {/* Expandable Activity Section */}
        {selectedActivities.length > 0 && (
          <div className="flex flex-col">
            <button
              type="button"
              className="flex items-center justify-between px-5 py-3 hover:bg-neutral-800/30 transition-colors focus:outline-none"
              onClick={() => setExpandedSections(prev => ({ ...prev, activity: !prev.activity }))}
            >
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
                <ListTree className="h-3.5 w-3.5" />
                <span>Activity</span>
              </div>
              {expandedSections.activity ? <ChevronUp className="h-3.5 w-3.5 text-neutral-600" /> : <ChevronDown className="h-3.5 w-3.5 text-neutral-600" />}
            </button>
            
            {expandedSections.activity && (
              <div className="flex flex-col px-5 pb-4 space-y-3">
                {selectedActivities.slice(-4).reverse().map((activity) => (
                  <div key={activity.id} className="flex justify-between items-baseline gap-2">
                    <span className="text-[13px] text-neutral-300 truncate">
                      {ACTIVITY_LABELS[activity.step] ?? activity.step}
                    </span>
                    <span className="text-[10px] text-neutral-500 whitespace-nowrap">
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
          <div className="flex flex-col">
            <button
              type="button"
              className="flex items-center justify-between px-5 py-3 hover:bg-neutral-800/30 transition-colors focus:outline-none"
              onClick={() => setExpandedSections(prev => ({ ...prev, thoughts: !prev.thoughts }))}
            >
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
                <Brain className="h-3.5 w-3.5" />
                <span>Thoughts</span>
              </div>
              {expandedSections.thoughts ? <ChevronUp className="h-3.5 w-3.5 text-neutral-600" /> : <ChevronDown className="h-3.5 w-3.5 text-neutral-600" />}
            </button>
            
            {expandedSections.thoughts && (
              <div className="flex flex-col px-5 pb-4 space-y-4">
                {liveThought && selectedTurnIndex === latestTurnIndex && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-emerald-500 uppercase tracking-wider">
                      {formatThoughtStep(liveThought.step)}
                    </span>
                    <p className="text-[13px] leading-relaxed text-neutral-200">{liveThought.text}</p>
                  </div>
                )}
                {visibleThoughts.slice(0, 3).map((thought) => (
                  <div key={thought.id} className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                      {formatThoughtStep(thought.meta?.[0] ?? thought.kind)}
                    </span>
                    <p className="text-[13px] leading-relaxed text-neutral-400">{thought.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {planId && (
        <div className="mt-auto border-t border-neutral-800 px-5 py-3">
          <span className="font-mono text-[10px] text-neutral-600">Plan ID: {planId.slice(0, 8)}</span>
        </div>
      )}
    </div>
  );
}
