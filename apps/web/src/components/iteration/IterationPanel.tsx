import { useState } from "react";
import { ChevronDown, X, Sparkles, AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { useChatStore } from "../../stores";
import { AgentAnalysisPanel, AgentBadge } from "../agents";
import type { IterationState, QualitySignals } from "@visual-runtime/shared";

export default function IterationPanel() {
  const { iterationState, agentState, closePanel, openPanel, panelOpen } = useChatStore();
  const [expandedIterations, setExpandedIterations] = useState<number[]>([]);
  const [activeAgentTab, setActiveAgentTab] = useState<'iterations' | 'agents'>('iterations');

  if (!iterationState || (!iterationState.isIterating && iterationState.iterations.length === 0)) {
    return null;
  }

  const { isIterating, currentIteration, maxIterations, currentScore, threshold, phase, iterations } = iterationState;
  const hasAgentData = !!(agentState && (Object.keys(agentState.results || {}).length > 0 || agentState.isAnalyzing));

  const toggleIteration = (num: number) => {
    setExpandedIterations((prev) =>
      prev.includes(num) ? prev.filter((n) => n !== num) : [...prev, num]
    );
  };

  return (
    <div className="iteration-panel">
      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: '0',
        borderBottom: '1px solid #334155',
        padding: '0 16px'
      }}>
        <button
          onClick={() => setActiveAgentTab('iterations')}
          style={{
            flex: 1,
            padding: '12px 16px',
            background: 'transparent',
            border: 'none',
            borderBottom: activeAgentTab === 'iterations' ? '2px solid #60a5fa' : '2px solid transparent',
            color: activeAgentTab === 'iterations' ? '#60a5fa' : '#94a3b8',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: '0.3px'
          }}
        >
          Iterations
        </button>
        {hasAgentData && (
          <button
            onClick={() => setActiveAgentTab('agents')}
            style={{
              flex: 1,
              padding: '12px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeAgentTab === 'agents' ? '2px solid #60a5fa' : '2px solid transparent',
              color: activeAgentTab === 'agents' ? '#60a5fa' : '#94a3b8',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: '0.3px'
            }}
          >
            ✨ Agents
          </button>
        )}
      </div>

      {activeAgentTab === 'iterations' ? (
        <>
          {/* Header - Current Progress */}
          <div className="iteration-header">
            <div className="iteration-header-left">
              {isIterating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : currentScore >= threshold ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <AlertCircle className="h-4 w-4 text-yellow-500" />
              )}
              <span className="iteration-title">
                {isIterating ? "Improving quality..." : `Quality score: ${currentScore}/100`}
              </span>
            </div>
            <div className="iteration-header-right">
              <span className="iteration-progress">
                {currentIteration} / {maxIterations} iterations
              </span>
              {isIterating && (
                <button
                  type="button"
                  className="iteration-abort-btn"
                  onClick={() => useChatStore.getState().abortIteration()}
                  title="Stop iteration"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Phase indicator */}
          {isIterating && (
            <div className="iteration-phase-bar">
              <div className={`iteration-phase ${phase === "generating" ? "active" : ""}`}>Generate</div>
              <div className="iteration-phase-arrow">→</div>
              <div className={`iteration-phase ${phase === "validating" ? "active" : ""}`}>Validate</div>
              <div className="iteration-phase-arrow">→</div>
              <div className={`iteration-phase ${phase === "scoring" ? "active" : ""}`}>Score</div>
              {(phase === "patching" || phase === "finalizing") && (
                <>
                  <div className="iteration-phase-arrow">→</div>
                  <div className={`iteration-phase ${phase === "patching" ? "active" : ""}`}>
                    {phase === "finalizing" ? "Finalize" : "Patch"}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Score bar */}
          <div className="iteration-score-bar">
            <div
              className="iteration-score-fill"
              style={{ width: `${currentScore}%`, backgroundColor: getScoreColor(currentScore) }}
            />
            <div className="iteration-threshold-marker" style={{ left: `${threshold}%` }} />
          </div>
          <div className="iteration-score-labels">
            <span>0</span>
            <span className="iteration-threshold-label">Threshold: {threshold}</span>
            <span>100</span>
          </div>

          {/* Iteration list */}
          <div className="iteration-list">
            {iterations.map((iteration) => (
              <IterationItem
                key={iteration.iterationNumber}
                iteration={iteration}
                isExpanded={expandedIterations.includes(iteration.iterationNumber)}
                onToggle={() => toggleIteration(iteration.iterationNumber)}
                hasAgentData={hasAgentData}
                onShowAgents={() => setActiveAgentTab('agents')}
              />
            ))}
          </div>
        </>
      ) : hasAgentData ? (
        <div style={{ padding: '16px', overflow: 'auto', flex: 1 }}>
          {agentState && (
            <>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#e2e8f0' }}>
                Agent Analysis
              </h3>
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#94a3b8' }}>
                {agentState.isAnalyzing 
                  ? 'Analyzing code with multi-agent framework...'
                  : `Analysis completed. Consensus: ${agentState.consensus}%`}
              </p>
              <div style={{
                display: 'flex',
                gap: '8px',
                marginTop: '12px'
              }}>
                <AgentBadge 
                  agentCount={Object.keys(agentState.results).length}
                  recommendationCount={agentState.recommendations?.length || 0}
                />
              </div>
              {agentState.recommendations && agentState.recommendations.length > 0 && (
                <div style={{
                  marginTop: '16px',
                  padding: '12px',
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#e2e8f0'
                }}>
                  <p style={{ margin: '0 0 8px 0', fontWeight: '600' }}>
                    {agentState.shouldAutoApply 
                      ? '✅ Top recommendations will be auto-applied'
                      : `${agentState.recommendations.length} recommendations available`}
                  </p>
                  <ul style={{ margin: '0', paddingLeft: '16px', lineHeight: '1.5' }}>
                    {agentState.recommendations.slice(0, 3).map((rec, idx) => (
                      <li key={idx} style={{ color: '#94a3b8', marginBottom: '4px' }}>
                        {rec.action}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function IterationItem({
  iteration,
  isExpanded,
  onToggle,
  hasAgentData,
  onShowAgents
}: {
  iteration: IterationState;
  isExpanded: boolean;
  onToggle: () => void;
  hasAgentData?: boolean;
  onShowAgents?: () => void;
}) {
  const { iterationNumber, qualitySignals, isFinal, patchGoals, generationDurationMs, validationDurationMs } = iteration;

  return (
    <div className={`iteration-item ${isFinal ? "final" : ""}`}>
      <button type="button" className="iteration-item-header" onClick={onToggle}>
        <div className="iteration-item-left">
          <ChevronDown className={`h-4 w-4 ${isExpanded ? "rotated" : ""}`} />
          <span className="iteration-number">Iteration {iterationNumber}</span>
          {isFinal && <span className="iteration-final-badge">FINAL</span>}
          {hasAgentData && (
            <span style={{
              fontSize: '10px',
              padding: '2px 6px',
              background: '#1e293b',
              border: '1px solid #60a5fa',
              borderRadius: '3px',
              color: '#60a5fa',
              marginLeft: '8px',
              cursor: 'pointer'
            }} onClick={(e) => {
              e.stopPropagation();
              onShowAgents?.();
            }}>
              ✨ Agents
            </span>
          )}
        </div>
        <div className="iteration-item-right">
          <QualityBadge score={qualitySignals.composite} />
          <span className="iteration-duration">
            {(generationDurationMs + (validationDurationMs || 0)) / 1000}s
          </span>
        </div>
      </button>

      {isExpanded && (
        <div className="iteration-details">
          <QualityBreakdown signals={qualitySignals} />
          
          {patchGoals && patchGoals.length > 0 && (
            <div className="iteration-patch-goals">
              <h4>Improvements made:</h4>
              <ul>
                {patchGoals.map((goal) => (
                  <li key={goal.id} className={`patch-goal-${goal.severity}`}>
                    <span className="patch-goal-category">{goal.category}</span>
                    <span className="patch-goal-desc">{goal.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function QualityBadge({ score }: { score: number }) {
  const color = getScoreColor(score);
  const label = score >= 90 ? "Excellent" : score >= 75 ? "Good" : score >= 60 ? "Fair" : "Poor";

  return (
    <span className="quality-badge" style={{ backgroundColor: color }}>
      {score} - {label}
    </span>
  );
}

function QualityBreakdown({ signals }: { signals: QualitySignals }) {
  const categories = [
    { key: "static", label: "Static", score: signals.static.score },
    { key: "runtime", label: "Runtime", score: signals.runtime.score },
    { key: "visual", label: "Visual", score: signals.visual?.score },
    { key: "semantic", label: "Semantic", score: signals.semantic?.score },
  ];

  return (
    <div className="quality-breakdown">
      {categories.map((cat) =>
        cat.score !== undefined ? (
          <div key={cat.key} className="quality-metric">
            <span className="quality-metric-label">{cat.label}</span>
            <div className="quality-metric-bar">
              <div
                className="quality-metric-fill"
                style={{ width: `${cat.score}%`, backgroundColor: getScoreColor(cat.score) }}
              />
            </div>
            <span className="quality-metric-value">{cat.score}</span>
          </div>
        ) : null
      )}
    </div>
  );
}

function getScoreColor(score: number): string {
  if (score >= 90) return "#22c55e"; // green-500
  if (score >= 75) return "#3b82f6"; // blue-500
  if (score >= 60) return "#f59e0b"; // amber-500
  return "#ef4444"; // red-500
}
