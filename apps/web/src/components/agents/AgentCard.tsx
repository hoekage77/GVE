import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { AgentResult } from '../../stores/chatStore';
import './agents.css';

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
    <div className="agent-card" style={{ borderColor: colors.border }}>
      {/* Header */}
      <div className="agent-card-header" onClick={onToggle} role="button" tabIndex={0}>
        <div className="agent-card-header-left">
          <span className="agent-icon">{icon}</span>
          <div className="agent-card-title-group">
            <h3 className="agent-card-title">{agent.name}</h3>
            <p className="agent-card-subtitle">
              {agent.recommendations.length} recommendations
            </p>
          </div>
        </div>
        
        <div className="agent-card-header-right">
          <div className="agent-score-badge" style={{ backgroundColor: colors.border }}>
            {agent.score}%
          </div>
          {onToggle && (
            <button 
              className="agent-expand-btn" 
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
      <div className="agent-card-content">
        {/* Score Bar */}
        <div className="agent-score-bar">
          <div 
            className="agent-score-fill"
            style={{ 
              width: `${agent.score}%`,
              backgroundColor: colors.border 
            }}
          />
        </div>

        {/* Key Findings */}
        {agent.findings.length > 0 && (
          <div className="agent-findings">
            <p className="agent-findings-label">Key findings:</p>
            <ul className="agent-findings-list">
              {agent.findings.slice(0, 2).map((finding, idx) => (
                <li key={idx}>{finding}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Stats */}
        <div className="agent-stats">
          <div className="agent-stat">
            <span className="agent-stat-label">Avg Impact</span>
            <span className="agent-stat-value">{avgImpact}</span>
          </div>
          <div className="agent-stat">
            <span className="agent-stat-label">Recommendations</span>
            <span className="agent-stat-value">{agent.recommendations.length}</span>
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="agent-card-details">
          <div className="agent-details-section">
            <h4 className="agent-details-title">Recommendations by Category</h4>
            <div className="agent-categories">
              {Object.entries(categoryCount).map(([category, count]) => (
                <div key={category} className="agent-category-badge">
                  <span className="agent-category-name">{category}</span>
                  <span className="agent-category-count">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* All Findings */}
          {agent.findings.length > 2 && (
            <div className="agent-details-section">
              <h4 className="agent-details-title">All Findings</h4>
              <ul className="agent-all-findings">
                {agent.findings.map((finding, idx) => (
                  <li key={idx}>{finding}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
