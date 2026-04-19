interface MemoryEntry {
  iteration: number;
  pattern: string;
  frequency: number;
  resolved: boolean;
}

interface AgentMemoryTimelineProps {
  memory: MemoryEntry[];
}

export default function AgentMemoryTimeline({ memory = [] }: AgentMemoryTimelineProps) {
  if (memory.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-5 text-center text-slate-400">
        <p>No learning patterns yet.</p>
        <p className="text-xs">Run multiple iterations to see patterns emerge.</p>
      </div>
    );
  }

  // Sort by iteration descending (newest first)
  const sortedMemory = [...memory].sort((a, b) => b.iteration - a.iteration);

  // Group by resolved status
  const resolved = sortedMemory.filter(m => m.resolved);
  const pending = sortedMemory.filter(m => !m.resolved);

  return (
    <div className="flex flex-col gap-3">
      {/* Resolved Patterns */}
      {resolved.length > 0 && (
        <div>
          <h4 style={{
            fontSize: '12px',
            fontWeight: '600',
            color: '#10b981',
            textTransform: 'uppercase',
            letterSpacing: '0.3px',
            margin: '0 0 8px 0',
            padding: '0 12px'
          }}>
            ✓ Fixed Issues
          </h4>
          {resolved.map((entry, idx) => (
            <div key={`resolved-${idx}`} className="rounded-lg border border-slate-700 border-l-[3px] border-l-blue-400 bg-slate-800 p-3">
              <div className="mb-1 text-[11px] uppercase tracking-[0.3px] text-slate-400">
                Iteration {entry.iteration}
              </div>
              <div className="mb-1 text-[13px] leading-5 text-slate-200">
                {entry.pattern}
              </div>
              <div className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                <span>Occurred {entry.frequency}x</span>
                <span className="ml-2 inline-flex items-center gap-1 text-emerald-500">
                  ✓ Resolved
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pending Patterns */}
      {pending.length > 0 && (
        <div>
          <h4 style={{
            fontSize: '12px',
            fontWeight: '600',
            color: '#f59e0b',
            textTransform: 'uppercase',
            letterSpacing: '0.3px',
            margin: '0 0 8px 0',
            padding: '0 12px'
          }}>
            ⚠ Ongoing Patterns
          </h4>
          {pending.map((entry, idx) => (
            <div key={`pending-${idx}`} className="rounded-lg border border-slate-700 border-l-[3px] border-l-blue-400 bg-slate-800 p-3">
              <div className="mb-1 text-[11px] uppercase tracking-[0.3px] text-slate-400">
                Iteration {entry.iteration}
              </div>
              <div className="mb-1 text-[13px] leading-5 text-slate-200">
                {entry.pattern}
              </div>
              <div className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                <span>Occurred {entry.frequency}x</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
