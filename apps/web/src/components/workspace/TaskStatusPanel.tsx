import { CheckCircle2, ChevronDown, Circle, ListTree, Loader2, XCircle, Radio } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AgentActivityEvent, GveTask, GveTaskAction, GveTaskStatus, SceneAssetPlan } from '@visual-runtime/shared';
import type { StageEventMap, TurnLifecycleStatus, LiveConnectionState } from '../../stores/chatStore';
import { getTurnStepLabel } from '../chat/turnActivity';

interface TaskStatusPanelProps {
  planId: string | null;
  turnStatus: TurnLifecycleStatus;
  currentStep: string | null;
  currentStepStatus: GveTaskStatus | null;
  assetPlan?: SceneAssetPlan | null;
  tasks: GveTask[];
  stageEventsByAction: StageEventMap | null;
  activeStageAction: GveTaskAction | null;
  activities?: AgentActivityEvent[];
  connectionState?: LiveConnectionState;
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

function toStepLabel(step: string | null | undefined): string {
  return getTurnStepLabel(step);
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

function eventSourceLabel(source: 'orchestration' | 'activity' | 'task' | 'error'): string {
  if (source === 'orchestration') return 'Pipeline';
  if (source === 'activity') return 'Agent';
  if (source === 'task') return 'Task';
  if (source === 'error') return 'Error';
  return 'Event';
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

function toReadableLabel(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }

  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (token) => token.toUpperCase());
}

function activityStatusIcon(status: GveTaskStatus | string | undefined) {
  const resolvedStatus = status === 'completed' || status === 'success' ? 'completed' : status === 'running' ? 'running' : status === 'failed' || status === 'error' ? 'failed' : 'pending';
  switch (resolvedStatus) {
    case 'completed':
      return <CheckCircle2 className="h-3.5 w-3.5 terranet-task-view__activity-icon terranet-task-view__activity-icon--completed" />;
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 terranet-task-view__activity-icon terranet-task-view__activity-icon--running" />;
    case 'failed':
      return <XCircle className="h-3.5 w-3.5 terranet-task-view__activity-icon terranet-task-view__activity-icon--failed" />;
    default:
      return <Circle className="h-3.5 w-3.5 terranet-task-view__activity-icon terranet-task-view__activity-icon--pending" />;
  }
}

export default function TaskStatusPanel({
  planId,
  turnStatus,
  currentStep,
  currentStepStatus,
  assetPlan,
  tasks,
  stageEventsByAction,
  activeStageAction,
  activities,
  connectionState = 'open'
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

  // Show connection status when not connected
  if (connectionState === 'connecting') {
    return (
      <div className="terranet-task-view terranet-task-view--empty">
        <div className="terranet-task-view__connection-status">
          <Loader2 className="h-5 w-5 animate-spin terranet-task-view__connection-icon" />
        </div>
        <p className="terranet-task-view__empty-title">Waiting for connection...</p>
        <p className="terranet-task-view__empty-copy">Connecting to WebSocket server</p>
      </div>
    );
  }

  if (connectionState === 'closed') {
    return (
      <div className="terranet-task-view terranet-task-view--empty">
        <div className="terranet-task-view__connection-status">
          <Radio className="h-5 w-5 terranet-task-view__connection-icon terranet-task-view__connection-icon--warning" />
        </div>
        <p className="terranet-task-view__empty-title">Connection lost</p>
        <p className="terranet-task-view__empty-copy">Attempting to reconnect...</p>
      </div>
    );
  }

  if (connectionState === 'error') {
    return (
      <div className="terranet-task-view terranet-task-view--empty">
        <div className="terranet-task-view__connection-status">
          <XCircle className="h-5 w-5 terranet-task-view__connection-icon terranet-task-view__connection-icon--error" />
        </div>
        <p className="terranet-task-view__empty-title">Connection error</p>
        <p className="terranet-task-view__empty-copy">Check your network and try again</p>
      </div>
    );
  }

  if (!hasContent) {
    return (
      <div className="terranet-task-view terranet-task-view--empty">
        <p className="terranet-task-view__empty-title">No activity yet</p>
        <p className="terranet-task-view__empty-copy">Tasks and events will appear here once a turn starts</p>
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

      {Array.isArray(activities) && activities.length > 0 && (
        <section className="terranet-task-view__section terranet-task-view__section--activities">
          <h3>Activity Log</h3>
          <ul className="terranet-task-view__activity-list" role="log" aria-live="polite">
            {activities.map((activity) => (
              <li
                key={activity.id}
                className={`terranet-task-view__activity terranet-task-view__activity--${activity.status}`}
              >
                <div className="terranet-task-view__activity-icon-wrap">
                  {activityStatusIcon(activity.status)}
                </div>
                <div className="terranet-task-view__activity-content">
                  <p className="terranet-task-view__activity-text">{activity.text}</p>
                  {activity.technicalDetail && (
                    <p className="terranet-task-view__activity-detail">{activity.technicalDetail}</p>
                  )}
                </div>
                <div className="terranet-task-view__activity-meta">
                  <span className="terranet-task-view__activity-time">{formatEventTime(activity.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {planId && (
        <p className="terranet-task-view__plan-id">Plan {planId.slice(0, 12)}</p>
      )}

      {assetPlan && (
        <section className="terranet-task-view__section terranet-task-view__section--asset">
          <h3>Asset Strategy</h3>
          <div className="terranet-task-view__asset-summary">
            <p className="terranet-task-view__asset-line">
              <strong>{toReadableLabel(assetPlan.strategy)}</strong>
              {' · '}
              Quality {toReadableLabel(assetPlan.requestedQuality)}
            </p>
            {Array.isArray(assetPlan.categories) && assetPlan.categories.length > 0 && (
              <div className="terranet-task-view__asset-chips">
                {assetPlan.categories.slice(0, 6).map((category) => (
                  <span key={category} className="terranet-task-view__asset-chip">
                    {toReadableLabel(category)}
                  </span>
                ))}
              </div>
            )}
            <p className="terranet-task-view__asset-line terranet-task-view__asset-line--muted">
              Internet fallback {assetPlan.fallbackPolicy?.allowInternetFallback ? 'enabled' : 'disabled'}
              {' · '}
              Warning {assetPlan.fallbackPolicy?.requireFallbackWarning ? 'required' : 'optional'}
            </p>
          </div>
        </section>
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
