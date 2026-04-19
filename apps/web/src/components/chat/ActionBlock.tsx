import { useState } from 'react';
import { ChevronDown, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { ActionBlock as ActionBlockType } from '../../types/actionBlocks';
import { ACTION_BLOCK_ICONS } from '../../types/actionBlocks';
import ActionStep from './ActionStep';

interface ActionBlockProps {
  block: ActionBlockType;
  index: number;
}

const STATUS_STYLES = {
  pending: {
    border: 'border-slate-700',
    bg: 'bg-slate-800',
    accent: 'text-slate-400'
  },
  running: {
    border: 'border-amber-900',
    bg: 'bg-amber-950',
    accent: 'text-amber-500'
  },
  completed: {
    border: 'border-emerald-900',
    bg: 'bg-emerald-950/50',
    accent: 'text-emerald-500'
  },
  failed: {
    border: 'border-red-900',
    bg: 'bg-red-950/50',
    accent: 'text-red-500'
  }
} as const;

export default function ActionBlock({ block, index }: ActionBlockProps) {
  const [isExpanded, setIsExpanded] = useState(block.expanded ?? false);
  const statusStyle = STATUS_STYLES[block.status] ?? STATUS_STYLES.pending;

  const getStatusIcon = () => {
    switch (block.status) {
      case 'completed':
        return <CheckCircle2 className={`h-4 w-4 ${statusStyle.accent}`} />;
      case 'running':
        return <Loader2 className={`h-4 w-4 animate-spin ${statusStyle.accent}`} />;
      case 'failed':
        return <XCircle className={`h-4 w-4 ${statusStyle.accent}`} />;
      default:
        return null;
    }
  };

  const icon = ACTION_BLOCK_ICONS[block.icon] || '•';

  return (
    <div className={`overflow-hidden rounded-md border transition-colors duration-200 ${statusStyle.border} ${statusStyle.bg}`}>
      {/* Header */}
      <div
        className={`grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-3 transition-colors duration-200 ${block.expandable ? 'cursor-pointer hover:border-b hover:border-current/20 hover:bg-white/[0.03]' : ''}`}
        onClick={() => block.expandable && setIsExpanded(!isExpanded)}
        role={block.expandable ? 'button' : undefined}
        tabIndex={block.expandable ? 0 : undefined}
        onKeyDown={(e) => {
          if (block.expandable && (e.key === 'Enter' || e.key === ' ')) {
            setIsExpanded(!isExpanded);
          }
        }}
      >
        <div className="flex min-w-0 items-center gap-3">
          {block.expandable && (
            <ChevronDown
              className={`h-4 w-4 shrink-0 transition-transform duration-200 ${statusStyle.accent} ${isExpanded ? 'rotate-180' : ''}`}
            />
          )}
          <span className="shrink-0 text-xl leading-none">{icon}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-5 text-slate-200">{block.label}</p>
            {block.detail && (
              <p className="mt-1 truncate text-xs text-slate-400">{block.detail}</p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {block.progress && (
            <span className={`text-xs font-medium tabular-nums ${statusStyle.accent}`}>
              {block.progress.completed}/{block.progress.total}
            </span>
          )}
          {getStatusIcon()}
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && block.steps && block.steps.length > 0 && (
        <div className={`flex flex-col border-t bg-black/20 ${statusStyle.border} animate-[slideDown_0.2s_ease-out]`}>
          <ul className="flex list-none flex-col gap-2 p-3">
            {block.steps.map((step, stepIndex) => (
              <ActionStep key={step.id} step={step} index={stepIndex} />
            ))}
          </ul>
        </div>
      )}

      {/* Progress Bar */}
      {block.progress && (
        <div className="h-0.5 overflow-hidden bg-black/20">
          <div
            className={`h-full transition-[width] duration-300 ease-out ${statusStyle.accent.replace('text-', 'bg-')}`}
            style={{ width: `${Math.round((block.progress.completed / block.progress.total) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
