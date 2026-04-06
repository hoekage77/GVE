interface TypingIndicatorProps {
  variant?: "dots" | "pulse" | "wave";
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function TypingIndicator({ 
  variant = "dots", 
  size = "md",
  className = "" 
}: TypingIndicatorProps) {
  const sizeClasses = {
    sm: "typing-indicator--sm",
    md: "typing-indicator--md",
    lg: "typing-indicator--lg"
  };

  if (variant === "dots") {
    return (
      <div className={`typing-indicator ${sizeClasses[size]} ${className}`}>
        <div className="typing-indicator__dot" />
        <div className="typing-indicator__dot" />
        <div className="typing-indicator__dot" />
      </div>
    );
  }

  if (variant === "pulse") {
    return (
      <div className={`typing-indicator typing-indicator--pulse ${sizeClasses[size]} ${className}`}>
        <div className="typing-indicator__pulse" />
      </div>
    );
  }

  if (variant === "wave") {
    return (
      <div className={`typing-indicator typing-indicator--wave ${sizeClasses[size]} ${className}`}>
        <div className="typing-indicator__bar" />
        <div className="typing-indicator__bar" />
        <div className="typing-indicator__bar" />
        <div className="typing-indicator__bar" />
      </div>
    );
  }

  return null;
}

// Extended typing indicator with status text
interface TypingStatusProps {
  status: string;
  subStatus?: string;
  progress?: number;
  className?: string;
}

export function TypingStatus({ 
  status, 
  subStatus,
  progress,
  className = "" 
}: TypingStatusProps) {
  return (
    <div className={`typing-status ${className}`}>
      <TypingIndicator variant="dots" size="sm" />
      <div className="typing-status__content">
        <span className="typing-status__text">{status}</span>
        {subStatus && (
          <span className="typing-status__sub">{subStatus}</span>
        )}
      </div>
      {progress !== undefined && (
        <div className="typing-status__progress">
          <div 
            className="typing-status__progress-bar" 
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
    </div>
  );
}
