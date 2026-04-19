interface TypingIndicatorProps {
  variant?: "dots" | "pulse" | "wave";
  size?: "sm" | "md" | "lg";
  className?: string;
}

const DOT_SIZES = { sm: "w-1 h-1", md: "w-1.5 h-1.5", lg: "w-2 h-2" } as const;
const PULSE_SIZES = { sm: "w-2 h-2", md: "w-3 h-3", lg: "w-4 h-4" } as const;
const BAR_SIZES = { sm: "w-0.5 h-2", md: "w-[3px] h-3", lg: "w-1 h-4" } as const;

export function TypingIndicator({
  variant = "dots",
  size = "md",
  className = ""
}: TypingIndicatorProps) {
  if (variant === "dots") {
    const dotSize = DOT_SIZES[size];
    return (
      <div className={`inline-flex items-center justify-center gap-1 ${className}`}>
        <div className={`${dotSize} rounded-full bg-current opacity-40 animate-[typing-bounce_1.4s_ease-in-out_infinite_both]`} style={{ animationDelay: "-0.32s" }} />
        <div className={`${dotSize} rounded-full bg-current opacity-40 animate-[typing-bounce_1.4s_ease-in-out_infinite_both]`} style={{ animationDelay: "-0.16s" }} />
        <div className={`${dotSize} rounded-full bg-current opacity-40 animate-[typing-bounce_1.4s_ease-in-out_infinite_both]`} />
      </div>
    );
  }

  if (variant === "pulse") {
    const pulseSize = PULSE_SIZES[size];
    return (
      <div className={`relative inline-flex items-center justify-center ${className}`}>
        <div className={`${pulseSize} rounded-full bg-current animate-[typing-pulse_1.5s_ease-in-out_infinite]`} />
      </div>
    );
  }

  if (variant === "wave") {
    const barSize = BAR_SIZES[size];
    return (
      <div className={`inline-flex items-center justify-center gap-0.5 ${className}`}>
        {[0, 0.1, 0.2, 0.3].map((delay, i) => (
          <div
            key={i}
            className={`${barSize} rounded-sm bg-current animate-[typing-wave_1s_ease-in-out_infinite]`}
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
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
    <div className={`relative inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-300/90 text-xs font-medium ${className}`}>
      <TypingIndicator variant="dots" size="sm" />
      <div className="flex flex-col gap-px">
        <span className="font-semibold leading-tight">{status}</span>
        {subStatus && (
          <span className="text-[0.65rem] opacity-80 leading-none">{subStatus}</span>
        )}
      </div>
      {progress !== undefined && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500/20 rounded-b-full overflow-hidden">
          <div
            className="h-full bg-blue-300/80 transition-[width] duration-300 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
    </div>
  );
}
