import { useState } from 'react';
import { ChevronDown, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { ActionBlock as ActionBlockType } from '../../types/actionBlocks';
import { ACTION_BLOCK_ICONS } from '../../types/actionBlocks';
import ActionStep from './ActionStep';

interface ActionBlockProps {
  block: ActionBlockType;
  index: number;
}

export default function ActionBlock({ block, index }: ActionBlockProps) {
  const [isExpanded, setIsExpanded] = useState(block.expanded ?? false);

  const getStatusIcon = () => {
    switch (block.status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 action-block__status-icon action-block__status-icon--completed" />;
      case 'running':
        return <Loader2 className="h-4 w-4 action-block__status-icon action-block__status-icon--running" />;
      case 'failed':
        return <XCircle className="h-4 w-4 action-block__status-icon action-block__status-icon--failed" />;
      default:
        return null;
    }
  };

  const icon = ACTION_BLOCK_ICONS[block.icon] || '•';

  return (
    <div className={`action-block action-block--${block.status}`}>
      {/* Header */}
      <div
        className={`action-block__header ${block.expandable ? 'action-block__header--clickable' : ''}`}
        onClick={() => block.expandable && setIsExpanded(!isExpanded)}
        role={block.expandable ? 'button' : undefined}
        tabIndex={block.expandable ? 0 : undefined}
        onKeyDown={(e) => {
          if (block.expandable && (e.key === 'Enter' || e.key === ' ')) {
            setIsExpanded(!isExpanded);
          }
        }}
      >
        <div className="action-block__header-left">
          {block.expandable && (
            <ChevronDown
              className={`action-block__chevron ${isExpanded ? 'action-block__chevron--open' : ''}`}
            />
          )}
          <span className="action-block__icon-emoji">{icon}</span>
          <div className="action-block__title-group">
            <p className="action-block__title">{block.label}</p>
            {block.detail && (
              <p className="action-block__subtitle">{block.detail}</p>
            )}
          </div>
        </div>

        <div className="action-block__header-right">
          {block.progress && (
            <span className="action-block__progress">
              {block.progress.completed}/{block.progress.total}
            </span>
          )}
          {getStatusIcon()}
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && block.steps && block.steps.length > 0 && (
        <div className="action-block__body">
          <ul className="action-block__steps">
            {block.steps.map((step, stepIndex) => (
              <ActionStep key={step.id} step={step} index={stepIndex} />
            ))}
          </ul>
        </div>
      )}

      {/* Progress Bar */}
      {block.progress && (
        <div className="action-block__progress-track">
          <div
            className="action-block__progress-fill"
            style={{ width: `${Math.round((block.progress.completed / block.progress.total) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
