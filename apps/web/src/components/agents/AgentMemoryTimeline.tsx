import './agents.css';

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
      <div className="agent-panel-empty">
        <p>No learning patterns yet.</p>
        <p style={{ fontSize: '12px' }}>Run multiple iterations to see patterns emerge.</p>
      </div>
    );
  }

  // Sort by iteration descending (newest first)
  const sortedMemory = [...memory].sort((a, b) => b.iteration - a.iteration);

  // Group by resolved status
  const resolved = sortedMemory.filter(m => m.resolved);
  const pending = sortedMemory.filter(m => !m.resolved);

  return (
    <div className="agent-memory-timeline">
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
            <div key={`resolved-${idx}`} className="agent-memory-item">
              <div className="agent-memory-iteration">
                Iteration {entry.iteration}
              </div>
              <div className="agent-memory-pattern">
                {entry.pattern}
              </div>
              <div className="agent-memory-frequency">
                <span>Occurred {entry.frequency}x</span>
                <span className="agent-memory-resolved">
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
            <div key={`pending-${idx}`} className="agent-memory-item">
              <div className="agent-memory-iteration">
                Iteration {entry.iteration}
              </div>
              <div className="agent-memory-pattern">
                {entry.pattern}
              </div>
              <div className="agent-memory-frequency">
                <span>Occurred {entry.frequency}x</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
