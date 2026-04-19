import { CheckCircle2, X } from 'lucide-react';
import type { UIAgentState } from '../../stores/chatStore';

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
      <div className="flex h-full flex-col items-center justify-center gap-3 p-5 text-center text-slate-400">
        <p>No recommendations at this time.</p>
        <p className="text-xs">Continue improving your scene or adjust parameters.</p>
      </div>
    );
  }

  // Group by priority
  const sortedRecs = [...recommendations].sort((a, b) => a.priority - b.priority);

  return (
    <div className="flex flex-col gap-2">
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
          className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-slate-700 bg-slate-800 p-3 transition-all duration-200 hover:border-blue-400 hover:bg-slate-700/70 max-md:grid-cols-1"
          style={{
            borderLeftColor: CATEGORY_COLORS[rec.category] || '#60a5fa'
          }}
        >
          {/* Category Icon */}
          <div className="text-base leading-none">
            {CATEGORY_ICONS[rec.category] || '💡'}
          </div>

          {/* Content */}
          <div className="min-w-0">
            <div className="mb-1 text-[13px] leading-5 text-slate-200">
              {rec.action}
            </div>
            <div className="flex gap-2 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-0.5">
                🤖 {rec.agentId}
              </span>
              <span>•</span>
              <span className="text-xs font-bold text-emerald-500">
                +{rec.impact} impact
              </span>
            </div>
          </div>

          {/* Right Side */}
          <div className="flex shrink-0 items-center gap-2 max-md:justify-self-start">
            <div className="inline-flex h-7 min-w-8 items-center justify-center rounded bg-slate-700 px-1.5 text-xs font-bold text-blue-400">
              {Math.round(rec.confidence)}%
            </div>
            
            {!autoApply && (
              <div className="flex gap-1">
                <button
                  className="rounded border border-emerald-500 bg-emerald-500 px-2 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-80"
                  onClick={() => onAccept?.(idx)}
                  title="Accept recommendation"
                >
                  ✓
                </button>
                <button
                  className="rounded border border-slate-700 px-2 py-1 text-slate-400 transition-colors hover:border-blue-400 hover:bg-blue-400 hover:text-white"
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
