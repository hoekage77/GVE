import { CheckCircle2, ChevronRight, Loader2, XCircle } from 'lucide-react';
import type { ActionStep, ActionBlockStatus, STATUS_ICONS } from '../../types/actionBlocks';

interface ActionStepProps {
  step: ActionStep;
  index: number;
}

const STEP_STYLES: Record<ActionBlockStatus, { text: string; accent: string }> = {
  pending: { text: 'text-slate-400', accent: 'text-slate-600' },
  running: { text: 'text-amber-300', accent: 'text-amber-500' },
  completed: { text: 'text-emerald-300', accent: 'text-emerald-500' },
  failed: { text: 'text-red-300', accent: 'text-red-500' }
};

export default function ActionStepComponent({ step, index }: ActionStepProps) {
  const statusStyle = STEP_STYLES[step.status] ?? STEP_STYLES.pending;

  const getStatusIcon = (status: ActionBlockStatus) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className={`h-3.5 w-3.5 ${statusStyle.accent}`} />;
      case 'running':
        return <Loader2 className={`h-3.5 w-3.5 animate-spin ${statusStyle.accent}`} />;
      case 'failed':
        return <XCircle className={`h-3.5 w-3.5 ${statusStyle.accent}`} />;
      default:
        return <ChevronRight className={`h-3.5 w-3.5 ${statusStyle.accent}`} />;
    }
  };

  const formatTime = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '--:--:--';
    }
  };

  return (
    <li className="grid list-none grid-cols-[auto_1fr_auto] items-start gap-3 py-2">
      <div className="flex shrink-0 items-center justify-center">
        {getStatusIcon(step.status)}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <p className={`break-words text-[0.813rem] leading-5 ${statusStyle.text}`}>{step.label}</p>
        {step.detail && (
          <p className="break-words text-xs leading-5 text-slate-400">{step.detail}</p>
        )}
        {step.technicalDetail && (
          <p className="overflow-hidden text-ellipsis whitespace-nowrap rounded bg-black/30 px-2 py-1 font-mono text-[0.7rem] text-zinc-400">{step.technicalDetail}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[0.7rem] tabular-nums text-slate-500">{formatTime(step.timestamp)}</span>
      </div>
    </li>
  );
}
