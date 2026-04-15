import { CheckCircle2, ChevronRight, Loader2, XCircle } from 'lucide-react';
import type { ActionStep, ActionBlockStatus, STATUS_ICONS } from '../../types/actionBlocks';

interface ActionStepProps {
  step: ActionStep;
  index: number;
}

export default function ActionStepComponent({ step, index }: ActionStepProps) {
  const getStatusIcon = (status: ActionBlockStatus) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-3.5 w-3.5 action-step__icon action-step__icon--completed" />;
      case 'running':
        return <Loader2 className="h-3.5 w-3.5 action-step__icon action-step__icon--running" />;
      case 'failed':
        return <XCircle className="h-3.5 w-3.5 action-step__icon action-step__icon--failed" />;
      default:
        return <ChevronRight className="h-3.5 w-3.5 action-step__icon action-step__icon--pending" />;
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
    <li className={`action-step action-step--${step.status}`}>
      <div className="action-step__icon-wrap">
        {getStatusIcon(step.status)}
      </div>
      <div className="action-step__content">
        <p className="action-step__label">{step.label}</p>
        {step.detail && (
          <p className="action-step__detail">{step.detail}</p>
        )}
        {step.technicalDetail && (
          <p className="action-step__technical-detail">{step.technicalDetail}</p>
        )}
      </div>
      <div className="action-step__meta">
        <span className="action-step__timestamp">{formatTime(step.timestamp)}</span>
      </div>
    </li>
  );
}
