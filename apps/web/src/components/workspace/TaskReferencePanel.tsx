import { CheckCircle2, Circle, XCircle, Loader2 } from 'lucide-react';
import type { TaskCheckpoint } from '../../types/actionBlocks';

interface TaskReferencePanelProps {
  checkpoints: TaskCheckpoint[];
  title?: string;
  totalSteps?: number;
  currentStep?: number;
}

export default function TaskReferencePanel({
  checkpoints,
  title = 'Task Progress',
  totalSteps,
  currentStep
}: TaskReferencePanelProps) {
  if (!checkpoints || checkpoints.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-md border border-slate-700 bg-slate-900 px-4 text-sm italic text-slate-400">
        <p>No tasks in progress</p>
      </div>
    );
  }

  const completedCount = checkpoints.filter(c => c.completed).length;
  const displayTotal = totalSteps ?? checkpoints.length;
  const displayCurrent = currentStep ?? completedCount + 1;

  const getCheckpointIcon = (checkpoint: TaskCheckpoint) => {
    if (checkpoint.completed) {
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    }
    return <Circle className="h-4 w-4 text-slate-600" />;
  };

  return (
    <aside className="scrollbar flex h-full flex-col gap-4 overflow-y-auto border-l border-slate-700 bg-slate-900 px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-slate-700 pb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-200">{title}</h2>
        <span className="text-xs font-medium tabular-nums text-slate-400">
          {completedCount}/{displayTotal}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-[3px] overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-[width] duration-300 ease-out"
          style={{ width: `${Math.round((completedCount / displayTotal) * 100)}%` }}
        />
      </div>

      {/* Checklist */}
      <ul className="flex list-none flex-col gap-2 p-0">
        {checkpoints.map((checkpoint, index) => (
          <li
            key={checkpoint.id}
            className="grid grid-cols-[auto_1fr] items-start gap-3 rounded bg-transparent p-3"
          >
            <div className="flex shrink-0 items-center justify-center">
              {getCheckpointIcon(checkpoint)}
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <p className={`flex gap-2 break-words text-sm font-medium leading-5 ${checkpoint.completed ? 'text-emerald-300' : 'text-slate-300'}`}>
                <span className="shrink-0 text-xs opacity-70">[{String.fromCharCode(65 + index)}]</span>
                {checkpoint.label}
              </p>
              {checkpoint.description && (
                <p className="break-words text-xs leading-5 text-slate-400">{checkpoint.description}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
