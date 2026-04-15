import { useEffect } from 'react';
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useToastStore, type Toast } from '../stores/toastStore';
import '../styles/toast.css';

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const icons = {
    success: <CheckCircle2 className="h-5 w-5" />,
    error: <AlertCircle className="h-5 w-5" />,
    info: <Info className="h-5 w-5" />,
    warning: <AlertTriangle className="h-5 w-5" />
  };

  const baseClasses = 'toast-item animate-slide-in';
  const typeClasses = {
    success: 'toast-item--success',
    error: 'toast-item--error',
    info: 'toast-item--info',
    warning: 'toast-item--warning'
  };

  return (
    <div className={`${baseClasses} ${typeClasses[toast.type]}`} role="alert">
      <div className="toast-item__icon">{icons[toast.type]}</div>
      <div className="toast-item__content">
        <p className="toast-item__message">{toast.message}</p>
      </div>
      <button
        onClick={onDismiss}
        className="toast-item__close"
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
    <div className="toast-container" role="region" aria-live="polite" aria-label="Notifications">
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
