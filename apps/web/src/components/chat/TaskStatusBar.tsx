import { ListTree, Maximize2, Sparkles } from "lucide-react";
import type { SceneAssetPlan } from "../../api";
import type { SessionTaskProgress, LiveConnectionState } from "../../stores/chat";
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
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3" role="status" aria-live="polite">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.07] text-sky-200" aria-hidden="true">
          <Sparkles className="h-4 w-4" />
        </span>

        <div className="mt-2 flex flex-col gap-1">
          <span className="text-sm font-medium text-white/90">{resolvedStatusText}</span>
          <span className="text-xs text-white/60">
            {getTurnStepLabel(statusStep)}
            {taskTotal > 0 ? ` · ${taskSummary}` : ""}
          </span>
          <span className="h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
            <span
              className={`block h-full rounded-full bg-sky-400 transition-[width] duration-300 ${taskTotal > 0 ? '' : 'w-1/3 animate-pulse'}`}
              style={taskTotal > 0 ? { width: `${Math.max(8, Math.round((taskCompleted / taskTotal) * 100))}%` } : undefined}
            />
          </span>
        </div>

        <span className="mt-2 inline-flex" aria-hidden="true">
          {renderTurnStatusIcon(turnTone)}
        </span>
      </div>
    );
  }

  if (!taskProgress) {
    return null;
  }

  const isInteractive = typeof onToggle === "function";

  return (
    <section className="overflow-hidden rounded-xl border border-white/10 bg-black/20" aria-label="Task progress">
      <div
        className="border-b border-white/10"
        role={isInteractive ? undefined : "status"}
        aria-live={isInteractive ? undefined : "polite"}
      >
        {isInteractive ? (
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left"
            onClick={onToggle}
            aria-label="Toggle tasks panel"
            title="Toggle tasks panel"
            aria-expanded={isExpanded}
            aria-controls={panelId}
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06] text-white/75" aria-hidden="true">
              <ListTree className="h-4 w-4" />
            </span>
            <span className="text-sm text-white/85">{taskSummary}</span>
            <span className="ml-auto inline-flex">
              {renderTurnStatusIcon(turnTone)}
            </span>
            <span className="max-w-[40%] truncate text-xs text-white/60" title={resolvedStatusText}>
              {resolvedStatusText}
            </span>
            <span className="inline-flex text-white/60" aria-hidden="true">
              <Maximize2 className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
            </span>
          </button>
        ) : (
          <div className="flex w-full items-center gap-2 px-3 py-2" aria-hidden="true">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06] text-white/75" aria-hidden="true">
              <ListTree className="h-4 w-4" />
            </span>
            <span className="text-sm text-white/85">{taskSummary}</span>
            <span className="ml-auto inline-flex">
              {renderTurnStatusIcon(turnTone)}
            </span>
            <span className="max-w-[40%] truncate text-xs text-white/60" title={resolvedStatusText}>
              {resolvedStatusText}
            </span>
          </div>
        )}
      </div>

      <div
        id={panelId}
        className={`${isExpanded ? 'block' : 'hidden'} p-2`}
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
