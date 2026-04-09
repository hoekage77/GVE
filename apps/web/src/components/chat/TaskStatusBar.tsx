import { CheckCircle2, Circle, ListTree, Loader2, Maximize2, XCircle } from "lucide-react";
import type { SessionTaskProgress } from "../../stores/chatStore";
import TaskStatusPanel from "../workspace/TaskStatusPanel";

interface TaskStatusBarProps {
  taskProgress: SessionTaskProgress;
  statusStep: string | null | undefined;
  statusText: string | null | undefined;
  isExpanded: boolean;
  onToggle: () => void;
}

const TASK_STRIP_STEP_LABELS: Record<string, string> = {
  turn_started: "Starting",
  parse_intent: "Parse Intent",
  intent_parsed: "Parse Intent",
  select_skill: "Select Skill",
  skill_selected: "Select Skill",
  plan_created: "Build Prompt",
  build_prompt: "Build Prompt",
  generate_code: "Generate Code",
  code_generated: "Generate Code",
  code_modified: "Generate Code",
  validate_code: "Validate",
  validation_failed: "Validate",
  execute_code: "Execute",
  executing: "Execute",
  execution_skipped: "Execute",
  sync_state: "Sync State",
  turn_complete: "Done",
  turn_error: "Error"
};

function toTaskStripStepLabel(step: string | null | undefined): string {
  if (!step) {
    return "Waiting";
  }

  return TASK_STRIP_STEP_LABELS[step] ?? step.replace(/_/g, " ");
}

function renderTurnStatusIcon(status: "idle" | "running" | "completed" | "failed") {
  if (status === "running") {
    return <Loader2 className="chat-task-status-strip__status-icon chat-task-status-strip__status-icon--running" />;
  }

  if (status === "completed") {
    return <CheckCircle2 className="chat-task-status-strip__status-icon chat-task-status-strip__status-icon--completed" />;
  }

  if (status === "failed") {
    return <XCircle className="chat-task-status-strip__status-icon chat-task-status-strip__status-icon--failed" />;
  }

  return <Circle className="chat-task-status-strip__status-icon chat-task-status-strip__status-icon--idle" />;
}

export default function TaskStatusBar({
  taskProgress,
  statusStep,
  statusText,
  isExpanded,
  onToggle
}: TaskStatusBarProps) {
  const taskTotal = taskProgress.tasks.length;
  const taskCompleted = taskProgress.tasks.filter((task) => task.status === "completed").length;
  const resolvedStatusText = statusText?.trim() ? statusText : toTaskStripStepLabel(statusStep);
  const panelId = `chat-task-inline-${taskProgress.sessionId}`;

  return (
    <section className={`chat-task-inline-panel ${isExpanded ? "is-expanded" : ""}`} aria-label="Task progress">
      <div
        className={`chat-task-status-strip chat-task-status-strip--${taskProgress.turnStatus}`}
        role="status"
        aria-live="polite"
      >
        <button
          type="button"
          className="chat-task-status-strip__trigger"
          onClick={onToggle}
          aria-label="Toggle tasks panel"
          title="Toggle tasks panel"
          aria-expanded={isExpanded}
          aria-controls={panelId}
        >
          <span className="chat-task-status-strip__task-icon" aria-hidden="true">
            <ListTree className="h-4 w-4" />
          </span>
          <span className="chat-task-status-strip__progress">Task Progress {taskCompleted}/{taskTotal}</span>
          <span className="chat-task-status-strip__status-wrap">
            {renderTurnStatusIcon(taskProgress.turnStatus)}
          </span>
          <span className="chat-task-status-strip__stage" title={resolvedStatusText}>
            {resolvedStatusText}
          </span>
          <span className="chat-task-status-strip__expand" aria-hidden="true">
            <Maximize2 className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
          </span>
        </button>
      </div>

      <div
        id={panelId}
        className="chat-task-inline-panel__content"
        aria-hidden={!isExpanded}
      >
        <TaskStatusPanel
          planId={taskProgress.planId}
          turnStatus={taskProgress.turnStatus}
          currentStep={taskProgress.currentStep}
          currentStepStatus={taskProgress.currentStepStatus}
          tasks={taskProgress.tasks}
          stageEventsByAction={taskProgress.stageEventsByAction}
          activeStageAction={taskProgress.activeStageAction}
        />
      </div>
    </section>
  );
}
