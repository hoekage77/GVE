import { ChevronDown, ChevronUp } from 'lucide-react';
import type { AgentResult } from '../../stores/chatStore';

interface AgentCardProps {
  agent: AgentResult;
  isExpanded?: boolean;
  onToggle?: () => void;
}

const AGENT_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  architect: {
    bg: '#1e3a8a',
    border: '#3b82f6',
    text: '#93c5fd'
  },
  materialDesigner: {
    bg: '#1f3a2f',
    border: '#10b981',
    text: '#86efac'
  },
  animator: {
    bg: '#3b2c2c',
    border: '#f59e0b',
    text: '#fcd34d'
  },
  optimizer: {
    bg: '#2d1b4e',
    border: '#a78bfa',
    text: '#d8b4fe'
  },
  tester: {
    bg: '#3b2c2c',
    border: '#ef4444',
    text: '#fca5a5'
  }
};

const AGENT_ICONS: Record<string, string> = {
  architect: '🏗️',
  materialDesigner: '🎨',
  animator: '✨',
  optimizer: '⚡',
  tester: '🧪'
};

export default function AgentCard({ agent, isExpanded = false, onToggle }: AgentCardProps) {
  const colors = AGENT_COLORS[agent.id] || AGENT_COLORS.architect;
  const icon = AGENT_ICONS[agent.id] || '🤖';
  
  // Calculate category breakdown
  const categoryCount = agent.recommendations.reduce((acc, rec) => {
    acc[rec.category] = (acc[rec.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const avgImpact = agent.recommendations.length > 0
    ? Math.round(agent.recommendations.reduce((sum, rec) => sum + rec.impact, 0) / agent.recommendations.length)
    : 0;

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-slate-700 bg-slate-800 transition-all duration-200 hover:border-blue-400 hover:bg-slate-700/90" style={{ borderColor: colors.border }}>
      {/* Header */}
      <div className="flex cursor-pointer select-none items-center justify-between p-4 active:opacity-80" onClick={onToggle} role="button" tabIndex={0}>
        <div className="flex flex-1 items-center gap-3">
          <span className="text-2xl leading-none">{icon}</span>
          <div className="flex-1">
            <h3 className="m-0 text-sm font-semibold leading-6 text-slate-200">{agent.name}</h3>
            <p className="m-0 text-xs leading-5 text-slate-400">
              {agent.recommendations.length} recommendations
            </p>
          </div>
        </div>
        
        <div className="flex shrink-0 items-center gap-2">
          <div className="min-w-[46px] rounded-md px-2 py-1 text-center text-[13px] font-bold leading-5 text-white" style={{ backgroundColor: colors.border }}>
            {agent.score}%
          </div>
          {onToggle && (
            <button 
              className="flex items-center justify-center rounded p-1 text-slate-400 transition-all duration-200 hover:bg-slate-700 hover:text-slate-200" 
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="border-t border-slate-700 px-4 pb-3 pt-0">
        {/* Score Bar */}
        <div className="mb-3 mt-3 h-1 overflow-hidden rounded bg-slate-700">
          <div 
            className="h-full rounded transition-[width] duration-300 ease-out"
            style={{ 
              width: `${agent.score}%`,
              backgroundColor: colors.border 
            }}
          />
        </div>

        {/* Key Findings */}
        {agent.findings.length > 0 && (
          <div className="mb-3">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.5px] text-slate-400">Key findings:</p>
            <ul className="m-0 list-none p-0">
              {agent.findings.slice(0, 2).map((finding, idx) => (
                <li key={idx} className="relative mb-1 pl-3 text-xs leading-5 text-slate-400 before:absolute before:left-0 before:text-blue-400 before:content-['•']">{finding}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.3px] text-slate-400">Avg Impact</span>
            <span className="text-base font-bold text-blue-400">{avgImpact}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.3px] text-slate-400">Recommendations</span>
            <span className="text-base font-bold text-blue-400">{agent.recommendations.length}</span>
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t border-slate-700 bg-slate-900/70 px-4 py-3">
          <div className="mb-3">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.3px] text-slate-200">Recommendations by Category</h4>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(categoryCount).map(([category, count]) => (
                <div key={category} className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-400">
                  <span className="capitalize">{category}</span>
                  <span className="font-bold text-blue-400">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* All Findings */}
          {agent.findings.length > 2 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.3px] text-slate-200">All Findings</h4>
              <ul className="m-0 list-none p-0">
                {agent.findings.map((finding, idx) => (
                  <li key={idx} className="relative mb-1.5 pl-3 text-xs leading-5 text-slate-400 before:absolute before:left-0 before:text-blue-400 before:content-['▸']">{finding}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
