import { CheckCircle2, ChevronDown, Circle, ListTree, Loader2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GveTask, GveTaskAction, GveTaskStatus } from '@visual-runtime/shared';
import type { StageEventMap, TurnLifecycleStatus } from '../../stores/chatStore';

interface TaskStatusPanelProps {
  planId: string | null;
  turnStatus: TurnLifecycleStatus;
  currentStep: string | null;
  currentStepStatus: GveTaskStatus | null;
  tasks: GveTask[];
  stageEventsByAction: StageEventMap | null;
  activeStageAction: GveTaskAction | null;
}

const EMPTY_STAGE_EVENTS: StageEventMap = {
  parse_intent: [],
  select_skill: [],
  build_prompt: [],
  generate_code: [],
  validate_code: [],
  execute_code: [],
  sync_state: []
};

const STEP_LABELS: Record<string, string> = {
  turn_started: 'Starting',
  parse_intent: 'Parse Intent',
  intent_parsed: 'Parse Intent',
  select_skill: 'Select Skill',
  skill_selected: 'Select Skill',
  plan_created: 'Build Prompt',
  build_prompt: 'Build Prompt',
  generate_code: 'Generate Code',
  code_generated: 'Generate Code',
  code_modified: 'Generate Code',
  validate_code: 'Validate',
  validation_failed: 'Validate',
  execute_code: 'Execute',
  executing: 'Execute',
  execution_skipped: 'Execute',
  sync_state: 'Sync State',
  turn_complete: 'Done',
  turn_error: 'Error'
};

function toStepLabel(step: string | null | undefined): string {
  if (!step) {
    return 'Waiting';
  }

  return STEP_LABELS[step] ?? step.replace(/_/g, ' ');
}

function taskStatusIcon(status: GveTaskStatus) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 terranet-task-view__task-icon terranet-task-view__task-icon--completed" />;
    case 'running':
      return <Loader2 className="h-4 w-4 terranet-task-view__task-icon terranet-task-view__task-icon--running" />;
    case 'failed':
      return <XCircle className="h-4 w-4 terranet-task-view__task-icon terranet-task-view__task-icon--failed" />;
    default:
      return <Circle className="h-4 w-4 terranet-task-view__task-icon terranet-task-view__task-icon--pending" />;
  }
}

function turnStatusLabel(status: TurnLifecycleStatus): string {
  if (status === 'running') {
    return 'Running';
  }
  if (status === 'completed') {
    return 'Completed';
  }
  if (status === 'failed') {
    return 'Failed';
  }
  return 'Idle';
}

function turnStatusTone(status: TurnLifecycleStatus): 'running' | 'completed' | 'failed' | 'idle' {
  if (status === 'running') {
    return 'running';
  }
  if (status === 'completed') {
    return 'completed';
  }
  if (status === 'failed') {
    return 'failed';
  }
  return 'idle';
}

function eventSourceLabel(source: 'orchestration' | 'activity'): string {
  return source === 'orchestration' ? 'Pipeline' : 'Agent';
}

function formatEventTime(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return '--:--:--';
  }

  return parsed.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

export default function TaskStatusPanel({
  planId,
  turnStatus,
  currentStep,
  currentStepStatus,
  tasks,
  stageEventsByAction,
  activeStageAction
}: TaskStatusPanelProps) {
  const [manuallyExpandedActions, setManuallyExpandedActions] = useState<Partial<Record<GveTaskAction, boolean>>>({});

  useEffect(() => {
    if (turnStatus === 'running' && (currentStep === 'turn_started' || currentStep === 'parse_intent')) {
      setManuallyExpandedActions({});
    }
  }, [currentStep, turnStatus, planId]);

  const completedCount = tasks.filter((task) => task.status === 'completed').length;
  const progressPercent = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;
  const turnTone = turnStatusTone(turnStatus);
  const taskEvents = stageEventsByAction ?? EMPTY_STAGE_EVENTS;

  const hasContent = tasks.length > 0;

  if (!hasContent) {
    return (
      <div className="terranet-task-view terranet-task-view--empty">
        <p className="terranet-task-view__empty-title">Tasks will appear here once a turn starts.</p>
        <p className="terranet-task-view__empty-copy">Keep this tab open to monitor pipeline progress in real time.</p>
      </div>
    );
  }

  return (
    <div className="terranet-task-view">
      <header className="terranet-task-view__header">
        <div>
          <p className="terranet-task-view__title">Task Status</p>
          <p className="terranet-task-view__subtitle">
            {toStepLabel(currentStep)}
            {currentStepStatus ? ` · ${currentStepStatus}` : ''}
          </p>
        </div>
        <span className={`terranet-task-view__badge terranet-task-view__badge--${turnTone}`}>
          {turnStatusLabel(turnStatus)}
        </span>
      </header>

      {tasks.length > 0 && (
        <>
          <div className="terranet-task-view__progress-track" aria-hidden="true">
            <span className="terranet-task-view__progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <p className="terranet-task-view__progress-label">{completedCount}/{tasks.length} tasks complete</p>
        </>
      )}

      {planId && (
        <p className="terranet-task-view__plan-id">Plan {planId.slice(0, 12)}</p>
      )}

      {tasks.length > 0 && (
        <section className="terranet-task-view__section">
          <h3>
            <ListTree className="h-4 w-4" />
            Pipeline
          </h3>
          <ul className="terranet-task-view__tasks">
            {tasks.map((task) => {
              const events = taskEvents[task.action] ?? [];
              const isActive = activeStageAction === task.action;
              const isExpanded = isActive || Boolean(manuallyExpandedActions[task.action]);

              return (
                <li key={task.id} className={`terranet-task-view__task terranet-task-view__task--${task.status}`}>
                  <button
                    type="button"
                    className="terranet-task-view__task-toggle"
                    onClick={() => {
                      if (isActive) {
                        return;
                      }

                      setManuallyExpandedActions((current) => ({
                        ...current,
                        [task.action]: !Boolean(current[task.action])
                      }));
                    }}
                    aria-expanded={isExpanded}
                  >
                    <div className="terranet-task-view__task-main">
                      {taskStatusIcon(task.status)}
                      <div>
                        <p className="terranet-task-view__task-title">{task.title}</p>
                        <p className="terranet-task-view__task-copy">{task.description}</p>
                      </div>
                    </div>
                    <div className="terranet-task-view__task-meta">
                      <span className={`terranet-task-view__task-pill terranet-task-view__task-pill--${task.status}`}>
                        {task.status}
                      </span>
                      <ChevronDown className={`h-4 w-4 terranet-task-view__task-chevron${isExpanded ? ' is-open' : ''}`} />
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="terranet-task-view__task-events" role="log" aria-live={isActive ? 'polite' : 'off'}>
                      {events.length === 0 ? (
                        <p className="terranet-task-view__event-placeholder">Waiting for live events...</p>
                      ) : (
                        <ul className="terranet-task-view__event-list">
                          {events.map((entry, index) => (
                            <li
                              key={`${entry.id}-${index}`}
                              className={`terranet-task-view__event terranet-task-view__event--${entry.status}`}
                            >
                              <div className="terranet-task-view__event-header">
                                <span>{eventSourceLabel(entry.source)}</span>
                                <span>{formatEventTime(entry.createdAt)}</span>
                              </div>
                              <p className="terranet-task-view__event-text">{entry.text}</p>
                              {entry.detail && (
                                <p className="terranet-task-view__event-detail">{entry.detail}</p>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
