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
      className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300"
      onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        opacity: onClick ? 1 : 0.6
      }}
      title={`${agentCount} agents analyzed, ${recommendationCount} recommendations`}
    >
      <span className="text-xs">✨</span>
      <span>{agentCount} agents</span>
      <span>•</span>
      <span>{recommendationCount} tips</span>
    </button>
  );
}
