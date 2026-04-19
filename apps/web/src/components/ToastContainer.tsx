import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useToastStore, type Toast } from '../stores/toastStore';

const TYPE_STYLES: Record<Toast['type'], { border: string; bg: string; iconColor: string }> = {
  success: {
    border: 'border-emerald-500',
    bg: 'bg-gradient-to-br from-emerald-950 to-emerald-700',
    iconColor: 'text-emerald-500'
  },
  error: {
    border: 'border-red-500',
    bg: 'bg-gradient-to-br from-red-950 to-red-700',
    iconColor: 'text-red-500'
  },
  warning: {
    border: 'border-amber-500',
    bg: 'bg-gradient-to-br from-amber-950 to-amber-700',
    iconColor: 'text-amber-500'
  },
  info: {
    border: 'border-blue-500',
    bg: 'bg-gradient-to-br from-blue-950 to-blue-700',
    iconColor: 'text-blue-500'
  }
};

const ICONS: Record<Toast['type'], React.ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5" />,
  error: <AlertCircle className="h-5 w-5" />,
  info: <Info className="h-5 w-5" />,
  warning: <AlertTriangle className="h-5 w-5" />
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const styles = TYPE_STYLES[toast.type];

  return (
    <div
      className={`flex items-center gap-3 px-5 py-4 sm:px-5 sm:py-4 border ${styles.border} ${styles.bg} rounded-lg shadow-[0_10px_25px_rgba(0,0,0,0.4)] backdrop-blur-sm pointer-events-auto animate-slide-in-right`}
      role="alert"
    >
      <div className={`shrink-0 ${styles.iconColor}`}>{ICONS[toast.type]}</div>
      <div className="flex-1 min-w-0">
        <p className="m-0 text-sm leading-relaxed text-slate-200 break-words">{toast.message}</p>
      </div>
      <button
        onClick={onDismiss}
        className="shrink-0 h-6 w-6 p-0 border-none bg-transparent text-slate-400 cursor-pointer rounded flex items-center justify-center transition-colors duration-200 hover:bg-white/10 hover:text-slate-200"
        aria-label="Close notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  return (
    <div
      className="fixed bottom-8 right-8 z-[9999] flex flex-col gap-3 pointer-events-none max-w-[420px] max-sm:bottom-4 max-sm:right-4 max-sm:left-4 max-sm:max-w-none"
      role="region"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}
