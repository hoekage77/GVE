import './agents.css';

interface AgentBadgeProps {
  agentCount: number;
  recommendationCount: number;
  onClick?: () => void;
}

export default function AgentBadge({ 
  agentCount = 0,
  recommendationCount = 0,
  onClick 
}: AgentBadgeProps) {
  return (
    <button
      className="agent-badge"
      onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        opacity: onClick ? 1 : 0.6
      }}
      title={`${agentCount} agents analyzed, ${recommendationCount} recommendations`}
    >
      <span className="agent-badge-icon">✨</span>
      <span>{agentCount} agents</span>
      <span>•</span>
      <span>{recommendationCount} tips</span>
    </button>
  );
}
