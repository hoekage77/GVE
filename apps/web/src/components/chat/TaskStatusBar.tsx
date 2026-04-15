import { ListTree, Maximize2, Sparkles } from "lucide-react";
import type { SceneAssetPlan } from "@visual-runtime/shared";
import type { SessionTaskProgress, LiveConnectionState } from "../../stores/chatStore";
import TaskStatusPanel from "../workspace/TaskStatusPanel";
import { formatTaskSummary, getTurnStepLabel, getTurnTone, renderTurnStatusIcon } from "./turnActivity";

interface TaskStatusBarProps {
  taskProgress: SessionTaskProgress | null;
  statusStep: string | null | undefined;
  statusText: string | null | undefined;
  assetPlan?: SceneAssetPlan | null;
  isExpanded?: boolean;
  onToggle?: () => void;
  compact?: boolean;
  connectionState?: LiveConnectionState;
}

export default function TaskStatusBar({
  taskProgress,
  statusStep,
  statusText,
  assetPlan,
  isExpanded,
  onToggle,
  compact = false,
  connectionState = 'open'
}: TaskStatusBarProps) {
  const taskTotal = taskProgress?.tasks.length ?? 0;
  const taskCompleted = taskProgress?.tasks.filter((task) => task.status === "completed").length ?? 0;
  const resolvedStatusText = statusText?.trim() ? statusText : getTurnStepLabel(statusStep);
  const turnTone = getTurnTone(taskProgress?.turnStatus, compact ? "running" : "idle");
  const taskSummary = formatTaskSummary(taskCompleted, taskTotal);
  const panelId = taskProgress ? `chat-task-inline-${taskProgress.sessionId}` : "chat-task-inline";

  if (compact) {
    return (
      <div className={`chat-task-status-chip chat-task-status-chip--${turnTone}`} role="status" aria-live="polite">
        <span className="chat-task-status-chip__icon" aria-hidden="true">
          <Sparkles className="h-4 w-4" />
        </span>

        <div className="chat-task-status-chip__copy">
          <span className="chat-task-status-chip__title">{resolvedStatusText}</span>
          <span className="chat-task-status-chip__detail">
            {getTurnStepLabel(statusStep)}
            {taskTotal > 0 ? ` · ${taskSummary}` : ""}
          </span>
          <span className="chat-task-status-chip__track" aria-hidden="true">
            <span
              className={`chat-task-status-chip__track-fill ${taskTotal > 0 ? "" : "is-indeterminate"}`}
              style={taskTotal > 0 ? { width: `${Math.max(8, Math.round((taskCompleted / taskTotal) * 100))}%` } : undefined}
            />
          </span>
        </div>

        <span className="chat-task-status-chip__status" aria-hidden="true">
          {renderTurnStatusIcon(turnTone, "chat-task-status-chip__status-icon")}
        </span>
      </div>
    );
  }

  if (!taskProgress) {
    return null;
  }

  const isInteractive = typeof onToggle === "function";

  return (
    <section className={`chat-task-inline-panel ${isExpanded ? "is-expanded" : ""}`} aria-label="Task progress">
      <div
        className={`chat-task-status-strip chat-task-status-strip--${taskProgress.turnStatus}`}
        role={isInteractive ? undefined : "status"}
        aria-live={isInteractive ? undefined : "polite"}
      >
        {isInteractive ? (
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
            <span className="chat-task-status-strip__progress">{taskSummary}</span>
            <span className="chat-task-status-strip__status-wrap">
              {renderTurnStatusIcon(turnTone, "chat-task-status-strip__status-icon")}
            </span>
            <span className="chat-task-status-strip__stage" title={resolvedStatusText}>
              {resolvedStatusText}
            </span>
            <span className="chat-task-status-strip__expand" aria-hidden="true">
              <Maximize2 className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
            </span>
          </button>
        ) : (
          <div className="chat-task-status-strip__trigger" aria-hidden="true">
            <span className="chat-task-status-strip__task-icon" aria-hidden="true">
              <ListTree className="h-4 w-4" />
            </span>
            <span className="chat-task-status-strip__progress">{taskSummary}</span>
            <span className="chat-task-status-strip__status-wrap">
              {renderTurnStatusIcon(turnTone, "chat-task-status-strip__status-icon")}
            </span>
            <span className="chat-task-status-strip__stage" title={resolvedStatusText}>
              {resolvedStatusText}
            </span>
          </div>
        )}
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
          assetPlan={assetPlan}
          tasks={taskProgress.tasks}
          stageEventsByAction={taskProgress.stageEventsByAction}
          activeStageAction={taskProgress.activeStageAction}
          activities={taskProgress.activities}
          connectionState={connectionState}
        />
      </div>
    </section>
  );
}
