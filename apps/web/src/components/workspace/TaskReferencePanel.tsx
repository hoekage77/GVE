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
      <div className="task-reference-panel task-reference-panel--empty">
        <p>No tasks in progress</p>
      </div>
    );
  }

  const completedCount = checkpoints.filter(c => c.completed).length;
  const displayTotal = totalSteps ?? checkpoints.length;
  const displayCurrent = currentStep ?? completedCount + 1;

  const getCheckpointIcon = (checkpoint: TaskCheckpoint) => {
    if (checkpoint.completed) {
      return <CheckCircle2 className="h-4 w-4 task-checkpoint__icon task-checkpoint__icon--completed" />;
    }
    return <Circle className="h-4 w-4 task-checkpoint__icon task-checkpoint__icon--pending" />;
  };

  return (
    <aside className="task-reference-panel">
      {/* Header */}
      <div className="task-reference-panel__header">
        <h2 className="task-reference-panel__title">{title}</h2>
        <span className="task-reference-panel__counter">
          {completedCount}/{displayTotal}
        </span>
      </div>

      {/* Progress bar */}
      <div className="task-reference-panel__progress-track">
        <div
          className="task-reference-panel__progress-fill"
          style={{ width: `${Math.round((completedCount / displayTotal) * 100)}%` }}
        />
      </div>

      {/* Checklist */}
      <ul className="task-reference-panel__checklist">
        {checkpoints.map((checkpoint, index) => (
          <li
            key={checkpoint.id}
            className={`task-checkpoint task-checkpoint--${checkpoint.completed ? 'completed' : 'pending'}`}
          >
            <div className="task-checkpoint__icon-wrap">
              {getCheckpointIcon(checkpoint)}
            </div>
            <div className="task-checkpoint__content">
              <p className="task-checkpoint__label">
                <span className="task-checkpoint__index">[{String.fromCharCode(65 + index)}]</span>
                {checkpoint.label}
              </p>
              {checkpoint.description && (
                <p className="task-checkpoint__description">{checkpoint.description}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
