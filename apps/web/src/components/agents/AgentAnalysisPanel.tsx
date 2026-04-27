import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import AgentCard from './AgentCard';
import AgentConfidenceMeter from './AgentConfidenceMeter';
import AgentRecommendations from './AgentRecommendations';
import AgentMemoryTimeline from './AgentMemoryTimeline';
import type { UIAgentState } from '../../stores/chat';

interface AgentAnalysisPanelProps {
  agentState: UIAgentState;
  onClose: () => void;
}

type TabView = 'analysis' | 'recommendations' | 'memory';

const TAB_BASE = "flex-1 min-w-[100px] whitespace-nowrap border-b-2 border-transparent px-4 py-3 text-xs font-semibold uppercase tracking-[0.3px] text-slate-400 transition-colors duration-200 hover:text-slate-200";
const TAB_ACTIVE = "border-b-blue-400 text-blue-400";

export default function AgentAnalysisPanel({
  agentState,
  onClose
}: AgentAnalysisPanelProps) {
  const [activeTab, setActiveTab] = useState<TabView>('analysis');
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());

  const toggleAgent = (agentId: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  };

  const agentList = Object.values(agentState.results || {});
  const showLoadingState = agentState.isAnalyzing && agentList.length === 0;

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[600px] animate-[slideInRight_0.3s_ease-out] flex-col border-l border-slate-700 bg-slate-900 shadow-[-4px_0_12px_rgba(0,0,0,0.3)] max-md:max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700 p-4">
        <h2 className="m-0 text-sm font-semibold text-slate-200">
          {agentState.isAnalyzing ? 'Analyzing Code...' : 'Agent Analysis'}
        </h2>
        <button
          className="flex items-center justify-center rounded p-1 text-slate-400 transition-all duration-200 hover:bg-slate-700 hover:text-slate-200"
          onClick={onClose}
          aria-label="Close panel"
          title="Close agent analysis panel"
        >
          <X size={18} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 overflow-x-auto border-b border-slate-700 px-4">
        <button
          className={`${TAB_BASE} ${activeTab === 'analysis' ? TAB_ACTIVE : ''}`}
          onClick={() => setActiveTab('analysis')}
        >
          Analysis
        </button>
        <button
          className={`${TAB_BASE} ${activeTab === 'recommendations' ? TAB_ACTIVE : ''}`}
          onClick={() => setActiveTab('recommendations')}
        >
          Tips
        </button>
        <button
          className={`${TAB_BASE} ${activeTab === 'memory' ? TAB_ACTIVE : ''}`}
          onClick={() => setActiveTab('memory')}
        >
          Learning
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {showLoadingState ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
            <Loader2 size={24} className="animate-spin" />
            <p>Running multi-agent analysis...</p>
          </div>
        ) : activeTab === 'analysis' ? (
          <>
            {/* Confidence Meter */}
            {agentState.consensus !== undefined && (
              <AgentConfidenceMeter
                consensus={agentState.consensus}
                agentCount={Object.keys(agentState.results || {}).length}
              />
            )}

            {/* Agent Cards */}
            {agentList.length > 0 ? (
              <div>
                {agentList.map(agent => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    isExpanded={expandedAgents.has(agent.id)}
                    onToggle={() => toggleAgent(agent.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-5 text-center text-slate-400">
                <p>No analysis available yet.</p>
                <p style={{ fontSize: '12px' }}>Generate code with agents enabled to see detailed analysis.</p>
              </div>
            )}
          </>
        ) : activeTab === 'recommendations' ? (
          <AgentRecommendations
            recommendations={agentState.recommendations || []}
            autoApply={agentState.shouldAutoApply}
          />
        ) : (
          <AgentMemoryTimeline memory={agentState.memory || []} />
        )}
      </div>
    </div>
  );
}
