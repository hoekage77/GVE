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
    <section className="meta-thought" aria-label="Thought trace">
      <button
        type="button"
        className="meta-thought__toggle"
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={isExpanded}
      >
        <ChevronDown className={`h-4 w-4 ${isExpanded ? "is-expanded" : ""}`} />
        <span>{`Thought for ${durationSeconds} seconds`}</span>
      </button>

      {isExpanded && (
        <div className="meta-thought__panel">
          {thoughts.map((thought, index) => (
            <article key={`${thought.step}-${index}`} className="meta-thought__item">
              <h4 className="meta-thought__step">{thought.step.replace(/_/g, " ").toUpperCase()}</h4>
              <p className="meta-thought__text">{thought.text}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
