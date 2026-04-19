import { useState } from "react";
import { ChevronDown } from "lucide-react";

interface ThoughtTraceEntry {
  step: string;
  text: string;
}

interface ThoughtTraceToggleProps {
  thoughts: ThoughtTraceEntry[];
  durationMs?: number;
}

export function ThoughtTraceToggle({ thoughts, durationMs }: ThoughtTraceToggleProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const durationSeconds = durationMs && durationMs > 0
    ? (durationMs / 1000).toFixed(1)
    : "0.0";

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.03] p-2" aria-label="Thought trace">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-white/70"
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={isExpanded}
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
        <span>{`Thought for ${durationSeconds} seconds`}</span>
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-2">
          {thoughts.map((thought, index) => (
            <article key={`${thought.step}-${index}`} className="rounded border border-white/10 bg-black/20 p-2">
              <h4 className="text-[10px] uppercase tracking-[0.08em] text-white/45">{thought.step.replace(/_/g, " ").toUpperCase()}</h4>
              <p className="mt-1 text-xs leading-5 text-white/75">{thought.text}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
