import { CheckCircle2, ChevronDown, Circle, ListTree, Loader2, XCircle, Radio } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AgentActivityEvent, GveTask, GveTaskAction, GveTaskStatus, SceneAssetPlan } from '@visual-runtime/shared';
import type { StageEventMap, TurnLifecycleStatus, LiveConnectionState } from '../../stores/chat';
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
  provision_sandbox: [],
  analyze_quality: [],
  autonomous_patching: [],
  execute_code: [],
  sync_state: []
};

function toStepLabel(step: string | null | undefined): string {
  return getTurnStepLabel(step);
}

function taskStatusIcon(status: GveTaskStatus) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case 'running':
      return <Loader2 className="h-4 w-4 animate-spin text-amber-500" />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-500" />;
    default:
      return <Circle className="h-4 w-4 text-neutral-600" />;
  }
}

function turnStatusLabel(status: TurnLifecycleStatus): string {
  if (status === 'running') return 'Running';
  if (status === 'completed') return 'Completed';
  if (status === 'failed') return 'Failed';
  return 'Idle';
}

function turnStatusToneClass(status: TurnLifecycleStatus): string {
  if (status === 'running') return 'border-amber-500/20 bg-amber-500/10 text-amber-500';
  if (status === 'completed') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500';
  if (status === 'failed') return 'border-red-500/20 bg-red-500/10 text-red-500';
  return 'border-neutral-700 bg-neutral-800 text-neutral-400';
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
  if (Number.isNaN(parsed.getTime())) return '--:--:--';
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function toReadableLabel(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  return normalized.replace(/[_-]+/g, ' ').replace(/\b\w/g, (token) => token.toUpperCase());
}

function activityStatusIcon(status: GveTaskStatus | string | undefined) {
  const resolvedStatus = status === 'completed' || status === 'success' ? 'completed' : status === 'running' ? 'running' : status === 'failed' || status === 'error' ? 'failed' : 'pending';
  switch (resolvedStatus) {
    case 'completed':
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />;
    case 'failed':
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    default:
      return <Circle className="h-3.5 w-3.5 text-neutral-600" />;
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
  const taskEvents = stageEventsByAction ?? EMPTY_STAGE_EVENTS;
  const hasContent = tasks.length > 0;

  // Connection states
  if (connectionState === 'connecting') {
    return (
      <div className="flex h-full flex-col items-center justify-center border-l border-neutral-800 bg-neutral-900 p-8 text-center">
        <Loader2 className="mb-4 h-6 w-6 animate-spin text-neutral-500" />
        <p className="text-sm font-medium text-neutral-200">Waiting for connection...</p>
        <p className="mt-1 text-xs text-neutral-500">Connecting to WebSocket server</p>
      </div>
    );
  }

  if (connectionState === 'closed') {
    return (
      <div className="flex h-full flex-col items-center justify-center border-l border-neutral-800 bg-neutral-900 p-8 text-center">
        <Radio className="mb-4 h-6 w-6 text-amber-500" />
        <p className="text-sm font-medium text-neutral-200">Connection lost</p>
        <p className="mt-1 text-xs text-neutral-500">Attempting to reconnect...</p>
      </div>
    );
  }

  if (connectionState === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center border-l border-neutral-800 bg-neutral-900 p-8 text-center">
        <XCircle className="mb-4 h-6 w-6 text-red-500" />
        <p className="text-sm font-medium text-neutral-200">Connection error</p>
        <p className="mt-1 text-xs text-neutral-500">Check your network and try again</p>
      </div>
    );
  }

  if (!hasContent) {
    return (
      <div className="flex h-full flex-col items-center justify-center border-l border-neutral-800 bg-neutral-900 p-8 text-center">
        <p className="text-sm font-medium text-neutral-200">No activity yet</p>
        <p className="mt-1 text-xs text-neutral-500">Tasks and events will appear here once a turn starts</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto border-l border-neutral-800 bg-neutral-900 text-neutral-300">
      
      {/* Header */}
      <header className="flex items-start justify-between border-b border-neutral-800/50 p-5">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-neutral-200">Task Status</p>
          <p className="text-xs text-neutral-400">
            {toStepLabel(currentStep)}
            {currentStepStatus ? ` · ${currentStepStatus}` : ''}
          </p>
        </div>
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${turnStatusToneClass(turnStatus)}`}>
          {turnStatusLabel(turnStatus)}
        </span>
      </header>

      {/* Progress Track */}
      {tasks.length > 0 && (
        <div className="px-5 py-4">
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-neutral-400">
            <span>Progress</span>
            <span>{completedCount}/{tasks.length} tasks complete</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800" aria-hidden="true">
            <div className="h-full rounded-full bg-neutral-300 transition-all duration-500 ease-out" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      )}

      {/* Activity Log */}
      {Array.isArray(activities) && activities.length > 0 && (
        <section className="flex flex-col border-t border-neutral-800/50">
          <h3 className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-neutral-500">Activity Log</h3>
          <ul className="flex flex-col px-5 pb-4 space-y-3" role="log" aria-live="polite">
            {activities.map((activity) => (
              <li key={activity.id} className="flex items-start gap-3">
                <div className="mt-0.5 flex shrink-0 items-center justify-center">
                  {activityStatusIcon(activity.status)}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="text-sm text-neutral-200">{activity.text}</p>
                  {activity.technicalDetail && (
                    <p className="text-xs text-neutral-500">{activity.technicalDetail}</p>
                  )}
                </div>
                <span className="shrink-0 text-[10px] text-neutral-500 whitespace-nowrap">
                  {formatEventTime(activity.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Plan ID */}
      {planId && (
        <div className="border-t border-neutral-800/50 px-5 py-3">
          <p className="font-mono text-[11px] text-neutral-500">Plan {planId.slice(0, 12)}</p>
        </div>
      )}

      {/* Asset Strategy */}
      {assetPlan && (
        <section className="flex flex-col border-t border-neutral-800/50">
          <h3 className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-neutral-500">Asset Strategy</h3>
          <div className="flex flex-col px-5 pb-4 gap-2">
            <p className="text-xs text-neutral-300">
              <strong className="font-medium text-neutral-200">{toReadableLabel(assetPlan.strategy)}</strong>
              <span className="text-neutral-600 mx-1">·</span>
              Quality {toReadableLabel(assetPlan.requestedQuality)}
            </p>
            {Array.isArray(assetPlan.categories) && assetPlan.categories.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {assetPlan.categories.slice(0, 6).map((category) => (
                  <span key={category} className="rounded-md bg-neutral-800 border border-neutral-700/50 px-2 py-0.5 text-[10px] font-medium text-neutral-300">
                    {toReadableLabel(category)}
                  </span>
                ))}
              </div>
            )}
            <p className="text-[10px] text-neutral-500 mt-1">
              Internet fallback {assetPlan.fallbackPolicy?.allowInternetFallback ? 'enabled' : 'disabled'}
              <span className="text-neutral-700 mx-1">·</span>
              Warning {assetPlan.fallbackPolicy?.requireFallbackWarning ? 'required' : 'optional'}
            </p>
          </div>
        </section>
      )}

      {/* Pipeline */}
      {tasks.length > 0 && (
        <section className="flex flex-1 flex-col border-t border-neutral-800/50">
          <h3 className="flex items-center gap-2 px-5 py-3 text-xs font-medium uppercase tracking-wider text-neutral-500">
            <ListTree className="h-3.5 w-3.5" />
            Pipeline
          </h3>
          <ul className="flex flex-col divide-y divide-neutral-800/30">
            {tasks.map((task) => {
              const events = taskEvents[task.action] ?? [];
              const isActive = activeStageAction === task.action;
              const isExpanded = isActive || Boolean(manuallyExpandedActions[task.action]);

              return (
                <li key={task.id} className="flex flex-col">
                  <button
                    type="button"
                    className="flex items-center justify-between px-5 py-3 hover:bg-neutral-800/30 transition-colors focus:outline-none"
                    onClick={() => {
                      if (isActive) return;
                      setManuallyExpandedActions((current) => ({
                        ...current,
                        [task.action]: !Boolean(current[task.action])
                      }));
                    }}
                    aria-expanded={isExpanded}
                  >
                    <div className="flex items-center gap-3">
                      {taskStatusIcon(task.status)}
                      <div className="flex flex-col text-left">
                        <p className={`text-sm font-medium ${isActive ? 'text-neutral-100' : 'text-neutral-300'}`}>{task.title}</p>
                        <p className="text-xs text-neutral-500">{task.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-[10px] font-medium uppercase tracking-wider ${
                        task.status === 'completed' ? 'text-emerald-500' :
                        task.status === 'running' ? 'text-amber-500' :
                        task.status === 'failed' ? 'text-red-500' : 'text-neutral-600'
                      }`}>
                        {task.status}
                      </span>
                      <ChevronDown className={`h-4 w-4 text-neutral-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="bg-neutral-900/50 px-5 py-3 shadow-inner" role="log" aria-live={isActive ? 'polite' : 'off'}>
                      {events.length === 0 ? (
                        <p className="text-xs text-neutral-500 italic">Waiting for live events...</p>
                      ) : (
                        <ul className="flex flex-col gap-3">
                          {events.map((entry, index) => (
                            <li key={`${entry.id}-${index}`} className="flex flex-col gap-1 border-l-2 border-neutral-800 pl-3">
                              <div className="flex items-center justify-between text-[10px] font-medium text-neutral-500">
                                <span className="uppercase tracking-wider">{eventSourceLabel(entry.source)}</span>
                                <span>{formatEventTime(entry.createdAt)}</span>
                              </div>
                              <p className={`text-xs ${entry.status === 'failed' ? 'text-red-400' : 'text-neutral-300'}`}>
                                {entry.text}
                              </p>
                              {entry.detail && (
                                <p className="text-[10px] text-neutral-500">{entry.detail}</p>
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
