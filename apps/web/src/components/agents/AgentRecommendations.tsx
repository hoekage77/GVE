import { CheckCircle2, X } from 'lucide-react';
import type { UIAgentState } from '../../stores/chatStore';
import './agents.css';

interface AgentRecommendationsProps {
  recommendations: UIAgentState['recommendations'];
  onAccept?: (index: number) => void;
  onReject?: (index: number) => void;
  autoApply?: boolean;
}

const CATEGORY_ICONS: Record<string, string> = {
  structure: '🏗️',
  performance: '⚡',
  visual: '🎨',
  api: '🔌',
  safety: '🔒'
};

const CATEGORY_COLORS: Record<string, string> = {
  structure: '#3b82f6',
  performance: '#f59e0b',
  visual: '#ec4899',
  api: '#8b5cf6',
  safety: '#ef4444'
};

export default function AgentRecommendations({
  recommendations = [],
  onAccept,
  onReject,
  autoApply = false
}: AgentRecommendationsProps) {
  if (recommendations.length === 0) {
    return (
      <div className="agent-panel-empty">
        <p>No recommendations at this time.</p>
        <p style={{ fontSize: '12px' }}>Continue improving your scene or adjust parameters.</p>
      </div>
    );
  }

  // Group by priority
  const sortedRecs = [...recommendations].sort((a, b) => a.priority - b.priority);

  return (
    <div className="agent-recommendations">
      {autoApply && (
        <div style={{
          padding: '12px',
          background: '#064e3b',
          border: '1px solid #10b981',
          borderRadius: '8px',
          fontSize: '12px',
          color: '#86efac',
          marginBottom: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <CheckCircle2 size={16} />
          <span>✅ High confidence recommendations will be auto-applied in the next iteration</span>
        </div>
      )}

      {sortedRecs.map((rec, idx) => (
        <div
          key={idx}
          className="agent-recommendation-item"
          style={{
            borderLeftColor: CATEGORY_COLORS[rec.category] || '#60a5fa'
          }}
        >
          {/* Category Icon */}
          <div className="agent-recommendation-badge">
            {CATEGORY_ICONS[rec.category] || '💡'}
          </div>

          {/* Content */}
          <div className="agent-recommendation-content">
            <div className="agent-recommendation-text">
              {rec.action}
            </div>
            <div className="agent-recommendation-meta">
              <span className="agent-recommendation-agent">
                🤖 {rec.agentId}
              </span>
              <span>•</span>
              <span className="agent-recommendation-impact">
                +{rec.impact} impact
              </span>
            </div>
          </div>

          {/* Right Side */}
          <div className="agent-recommendation-right">
            <div className="agent-recommendation-confidence">
              {Math.round(rec.confidence)}%
            </div>
            
            {!autoApply && (
              <div className="agent-recommendation-actions">
                <button
                  className="agent-recommendation-btn accept"
                  onClick={() => onAccept?.(idx)}
                  title="Accept recommendation"
                >
                  ✓
                </button>
                <button
                  className="agent-recommendation-btn"
                  onClick={() => onReject?.(idx)}
                  title="Reject recommendation"
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
