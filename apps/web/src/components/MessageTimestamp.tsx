import { useState, useCallback } from "react";
import { Clock } from "lucide-react";

interface MessageTimestampProps {
  timestamp: string;
  showIcon?: boolean;
  className?: string;
}

// Format timestamp relative to now
function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) {
    return "Just now";
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric"
    });
  }
}

// Format absolute timestamp
function formatAbsoluteTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

export function MessageTimestamp({
  timestamp,
  showIcon = false,
  className = ""
}: MessageTimestampProps) {
  const [showAbsolute, setShowAbsolute] = useState(false);

  const handleClick = useCallback(() => {
    setShowAbsolute(prev => !prev);
  }, []);

  if (!timestamp) return null;

  return (
    <span
      className={`message-timestamp ${className}`}
      onClick={handleClick}
      title={formatAbsoluteTime(timestamp)}
    >
      {showIcon && <Clock className="message-timestamp__icon" />}
      <span className="message-timestamp__text">
        {showAbsolute ? formatAbsoluteTime(timestamp) : formatRelativeTime(timestamp)}
      </span>
    </span>
  );
}

// Compact version for inline display
export function MessageTimestampCompact({
  timestamp,
  className = ""
}: {
  timestamp: string;
  className?: string;
}) {
  if (!timestamp) return null;

  return (
    <span className={`message-timestamp message-timestamp--compact ${className}`}>
      {formatRelativeTime(timestamp)}
    </span>
  );
}

// Timestamp group separator (e.g., "Today", "Yesterday")
export function TimestampGroup({
  label,
  className = ""
}: {
  label: string;
  className?: string;
}) {
  return (
    <div className={`timestamp-group ${className}`}>
      <span className="timestamp-group__label">{label}</span>
    </div>
  );
}

// Hook for grouping messages by date
export function useMessageGroups<T extends { createdAt?: string }>(
  messages: T[]
): Array<{ label: string; items: T[] }> {
  const groups: Array<{ label: string; items: T[] }> = [];
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);

  messages.forEach(message => {
    if (!message.createdAt) return;
    
    const date = new Date(message.createdAt);
    date.setHours(0, 0, 0, 0);
    
    let label: string;
    if (date.getTime() === today.getTime()) {
      label = "Today";
    } else if (date.getTime() === yesterday.getTime()) {
      label = "Yesterday";
    } else if (date > lastWeek) {
      label = date.toLocaleDateString(undefined, { weekday: "long" });
    } else {
      label = date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
    }

    const existingGroup = groups.find(g => g.label === label);
    if (existingGroup) {
      existingGroup.items.push(message);
    } else {
      groups.push({ label, items: [message] });
    }
  });

  return groups;
}
