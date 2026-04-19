import { useState, useCallback } from "react";
import { Clock } from "lucide-react";

interface MessageTimestampProps {
  timestamp: string;
  showIcon?: boolean;
  className?: string;
}

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
      className={`inline-flex items-center gap-1 text-[0.65rem] text-slate-400/60 cursor-pointer transition-colors duration-150 select-none hover:text-blue-300/85 ${className}`}
      onClick={handleClick}
      title={formatAbsoluteTime(timestamp)}
    >
      {showIcon && <Clock className="w-[0.7rem] h-[0.7rem] opacity-60" />}
      <span className="font-medium tracking-[0.02em]">
        {showAbsolute ? formatAbsoluteTime(timestamp) : formatRelativeTime(timestamp)}
      </span>
    </span>
  );
}

export function MessageTimestampCompact({
  timestamp,
  className = ""
}: {
  timestamp: string;
  className?: string;
}) {
  if (!timestamp) return null;

  return (
    <span className={`inline-flex items-center gap-1 text-[0.6rem] text-slate-500/50 select-none ${className}`}>
      {formatRelativeTime(timestamp)}
    </span>
  );
}

export function TimestampGroup({
  label,
  className = ""
}: {
  label: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-center my-4 md:my-3 before:flex-1 before:h-px before:bg-slate-600/40 after:flex-1 after:h-px after:bg-slate-600/40 ${className}`}>
      <span className="px-3 text-[0.65rem] md:text-[0.6rem] font-semibold uppercase tracking-[0.08em] text-slate-400/60">{label}</span>
    </div>
  );
}

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
