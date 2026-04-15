import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import AgentCard from './AgentCard';
import AgentConfidenceMeter from './AgentConfidenceMeter';
import AgentRecommendations from './AgentRecommendations';
import AgentMemoryTimeline from './AgentMemoryTimeline';
import type { UIAgentState } from '../../stores/chatStore';
import './agents.css';

interface AgentAnalysisPanelProps {
  agentState: UIAgentState;
  onClose: () => void;
}

type TabView = 'analysis' | 'recommendations' | 'memory';

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
    <div className="agent-analysis-panel">
      {/* Header */}
      <div className="agent-panel-header">
        <h2 className="agent-panel-title">
          {agentState.isAnalyzing ? 'Analyzing Code...' : 'Agent Analysis'}
        </h2>
        <button
          className="agent-panel-close-btn"
          onClick={onClose}
          aria-label="Close panel"
          title="Close agent analysis panel"
        >
          <X size={18} />
        </button>
      </div>

      {/* Tabs */}
      <div className="agent-panel-tabs">
        <button
          className={`agent-panel-tab ${activeTab === 'analysis' ? 'active' : ''}`}
          onClick={() => setActiveTab('analysis')}
        >
          Analysis
        </button>
        <button
          className={`agent-panel-tab ${activeTab === 'recommendations' ? 'active' : ''}`}
          onClick={() => setActiveTab('recommendations')}
        >
          Tips
        </button>
        <button
          className={`agent-panel-tab ${activeTab === 'memory' ? 'active' : ''}`}
          onClick={() => setActiveTab('memory')}
        >
          Learning
        </button>
      </div>

      {/* Content */}
      <div className="agent-panel-content">
        {showLoadingState ? (
          <div className="agent-panel-loading">
            <Loader2 size={24} className="agent-loading-spinner" />
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
              <div className="agent-panel-empty">
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
