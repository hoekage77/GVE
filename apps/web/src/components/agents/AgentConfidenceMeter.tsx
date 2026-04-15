import './agents.css';

interface AgentConfidenceMeterProps {
  consensus: number; // 0-100
  agentCount?: number;
  agreingCount?: number;
}

export default function AgentConfidenceMeter({ 
  consensus, 
  agentCount = 5,
  agreingCount 
}: AgentConfidenceMeterProps) {
  // Determine color based on consensus level
  const getColor = () => {
    if (consensus >= 80) return '#10b981'; // green
    if (consensus >= 60) return '#f59e0b'; // amber
    return '#ef4444'; // red
  };

  const getLabel = () => {
    if (consensus >= 80) return 'High Consensus';
    if (consensus >= 60) return 'Moderate Consensus';
    return 'Low Consensus';
  };

  const displayAgreeingCount = agreingCount ?? Math.round((consensus / 100) * agentCount);

  return (
    <div className="agent-confidence-meter">
      {/* Circular Progress */}
      <div className="agent-confidence-circle">
        <svg width="120" height="120" viewBox="0 0 120 120">
          {/* Background circle */}
          <circle
            cx="60"
            cy="60"
            r="56"
            fill="none"
            stroke="#334155"
            strokeWidth="2"
          />
          {/* Progress circle */}
          <circle
            cx="60"
            cy="60"
            r="56"
            fill="none"
            stroke={getColor()}
            strokeWidth="4"
            strokeDasharray={`${(consensus / 100) * 352} 352`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.3s ease' }}
            transform="rotate(-90 60 60)"
          />
          {/* Center text */}
          <text
            x="60"
            y="55"
            textAnchor="middle"
            fontSize="24"
            fontWeight="bold"
            fill="#e2e8f0"
          >
            {Math.round(consensus)}%
          </text>
          <text
            x="60"
            y="75"
            textAnchor="middle"
            fontSize="11"
            fill="#94a3b8"
          >
            Consensus
          </text>
        </svg>
      </div>

      {/* Text Info */}
      <div className="agent-confidence-info">
        <h3 className="agent-confidence-label">{getLabel()}</h3>
        <p className="agent-confidence-detail">
          {displayAgreeingCount} of {agentCount} agents agreed
        </p>
        <p className="agent-confidence-description">
          {consensus >= 80
            ? 'Strong agreement across agents'
            : consensus >= 60
            ? 'Most agents aligned'
            : 'Mixed opinions among agents'}
        </p>
      </div>
    </div>
  );
}
