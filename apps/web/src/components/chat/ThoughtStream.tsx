import { useState, useMemo, useEffect } from "react";
import { ChevronDown, Check, Loader2, X } from "lucide-react";
import type { ThoughtItem } from "./MessageComponents";

interface ThoughtStreamProps {
  thoughts: ThoughtItem[];
  isThinking?: boolean;
  thinkingDuration?: number;
}

export function ThoughtStream({ thoughts, isThinking = false, thinkingDuration }: ThoughtStreamProps) {
  const [isExpanded, setIsExpanded] = useState(isThinking);

  useEffect(() => {
    setIsExpanded(isThinking);
  }, [isThinking]);

  const enrichedThoughts = useMemo(() => {
    return thoughts.map((t) => {
      let stepLabel = t.step.replace(/_/g, " ");
      let status = "completed";
      let durationMs: number | null = null;
      let detail: string | null = null;

      if (t.meta) {
        for (const meta of t.meta) {
          if (meta.startsWith("stepLabel:")) stepLabel = meta.substring("stepLabel:".length);
          if (meta.startsWith("status:")) status = meta.substring("status:".length);
          if (meta.startsWith("durationMs:")) durationMs = parseInt(meta.substring("durationMs:".length), 10);
          if (meta.startsWith("detail:")) detail = meta.substring("detail:".length);
        }
      }

      return { ...t, stepLabel, status, durationMs, detail };
    });
  }, [thoughts]);

  if (thoughts.length === 0 && !isThinking) return null;

  const durationSeconds = thinkingDuration && thinkingDuration > 0
    ? (thinkingDuration / 1000).toFixed(1)
    : "0.0";

  return (
    <div className="my-2 overflow-hidden rounded-2xl bg-white/[0.03] transition-colors duration-300 hover:bg-white/[0.04]">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <ChevronDown className={`h-3.5 w-3.5 text-white/40 transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`} />
        <span className={`text-[11px] font-medium uppercase tracking-[0.05em] ${isThinking ? "animate-pulse text-transparent bg-clip-text bg-gradient-to-r from-meta-muted to-white/70" : "text-white/50"}`}>
          {isThinking ? "Thinking..." : `Thought for ${durationSeconds}s · ${thoughts.length} steps`}
        </span>
      </button>

      <div 
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="overflow-hidden">
          <div className="relative px-3.5 pb-4 pt-1">
          {/* Vertical timeline connector */}
          <div className="absolute bottom-6 left-[21px] top-3 w-[2px] rounded-full bg-white/[0.06]" />

          <div className="relative space-y-4">
            {enrichedThoughts.map((thought, idx) => (
              <div key={`${thought.step}-${idx}`} className="flex gap-3.5 animate-[fadeIn_0.3s_ease-out]">
                {/* Node Indicator */}
                <div className={`relative z-10 mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${thought.status === "streaming" ? "border-ide-accent/40 bg-ide-accent/10 shadow-[0_0_8px_rgba(0,120,212,0.2)]" : "border-white/10 bg-white/5"}`}>
                  {thought.status === "streaming" ? (
                    <div className="h-1.5 w-1.5 rounded-full bg-ide-accent animate-pulse" />
                  ) : thought.status === "failed" ? (
                    <X className="h-2.5 w-2.5 text-red-400" />
                  ) : (
                    <Check className="h-2.5 w-2.5 text-white/40" />
                  )}
                </div>

                {/* Content */}
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-white/50">
                      {thought.stepLabel.toUpperCase()}
                    </span>
                    {thought.durationMs != null && thought.durationMs > 0 && (
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-mono text-white/30">
                        {thought.durationMs}ms
                      </span>
                    )}
                  </div>
                  <p className={`text-[12px] leading-relaxed ${thought.status === "streaming" ? "text-white/80" : "text-white/60"}`}>
                    {thought.text}
                  </p>
                  {thought.detail && (
                    <p className="mt-1 overflow-x-auto font-mono text-[10.5px] text-white/40">
                      {thought.detail}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
