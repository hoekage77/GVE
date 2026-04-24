import { useState } from "react";
import { ChevronDown, X, AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { useChatStore } from "../../stores";
import { AgentBadge } from "../agents";
import type { IterationState, QualitySignals } from "@visual-runtime/shared";

export default function IterationPanel() {
  const { iterationState, agentState } = useChatStore();
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
    <div className="mb-4 rounded-xl border border-white/[0.08] bg-white/[0.04] text-slate-200 shadow-[0_18px_36px_-28px_rgba(0,0,0,0.65)]">
      {/* Tabs */}
      <div className="flex gap-0 border-b border-white/[0.08] px-4">
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
          <div className="flex items-center justify-between px-4 pb-3 pt-3">
            <div className="flex items-center gap-2">
              {isIterating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : currentScore >= threshold ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <AlertCircle className="h-4 w-4 text-yellow-500" />
              )}
              <span className="text-[0.9rem] font-semibold text-slate-200">
                {isIterating ? "Improving quality..." : `Quality score: ${currentScore}/100`}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[0.8rem] text-slate-300">
                {currentIteration} / {maxIterations} iterations
              </span>
              {isIterating && (
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded-md bg-red-950/70 text-red-400 transition-colors duration-200 hover:bg-red-900/70"
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
            <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg bg-white/[0.03] p-2 text-xs">
              <div className={`rounded-md px-2 py-1 font-medium transition ${phase === "generating" ? "bg-blue-500 text-white" : "text-slate-400"}`}>Generate</div>
              <div className="text-slate-500">→</div>
              <div className={`rounded-md px-2 py-1 font-medium transition ${phase === "validating" ? "bg-blue-500 text-white" : "text-slate-400"}`}>Validate</div>
              <div className="text-slate-500">→</div>
              <div className={`rounded-md px-2 py-1 font-medium transition ${phase === "scoring" ? "bg-blue-500 text-white" : "text-slate-400"}`}>Score</div>
              {(phase === "patching" || phase === "finalizing") && (
                <>
                  <div className="text-slate-500">→</div>
                  <div className={`rounded-md px-2 py-1 font-medium transition ${phase === "patching" ? "bg-blue-500 text-white" : "text-slate-400"}`}>
                    {phase === "finalizing" ? "Finalize" : "Patch"}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Score bar */}
          <div className="relative mx-4 mb-1 h-2 overflow-hidden rounded-full bg-slate-700/40">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${currentScore}%`, backgroundColor: getScoreColor(currentScore) }}
            />
            <div className="absolute bottom-0 top-0 w-[2px] -translate-x-1/2 bg-slate-400" style={{ left: `${threshold}%` }} />
          </div>
          <div className="relative mb-4 flex justify-between px-4 text-[0.7rem] text-slate-400">
            <span>0</span>
            <span className="absolute left-1/2 -translate-x-1/2">Threshold: {threshold}</span>
            <span>100</span>
          </div>

          {/* Iteration list */}
          <div className="flex flex-col gap-2 px-4 pb-4">
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
        <div className="flex-1 overflow-auto p-4">
          {agentState && (
            <>
              <h3 className="mb-3 text-sm font-semibold text-slate-200">
                Agent Analysis
              </h3>
              <p className="mb-2 text-xs text-slate-400">
                {agentState.isAnalyzing 
                  ? 'Analyzing code with multi-agent framework...'
                  : `Analysis completed. Consensus: ${agentState.consensus}%`}
              </p>
              <div className="mt-3 flex gap-2">
                <AgentBadge 
                  agentCount={Object.keys(agentState.results).length}
                  recommendationCount={agentState.recommendations?.length || 0}
                />
              </div>
              {agentState.recommendations && agentState.recommendations.length > 0 && (
                <div className="mt-4 rounded-lg border border-slate-700 bg-slate-800 p-3 text-xs text-slate-200">
                  <p className="mb-2 font-semibold">
                    {agentState.shouldAutoApply 
                      ? '✅ Top recommendations will be auto-applied'
                      : `${agentState.recommendations.length} recommendations available`}
                  </p>
                  <ul className="m-0 list-disc pl-4 leading-6">
                    {agentState.recommendations.slice(0, 3).map((rec, idx) => (
                      <li key={idx} className="mb-1 text-slate-400">
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
    <div className={`overflow-hidden rounded-lg border ${isFinal ? 'border-emerald-500/25 bg-emerald-500/10' : 'border-white/[0.08] bg-white/[0.02]'}`}>
      <button type="button" className="flex w-full items-center justify-between bg-transparent px-3 py-2 transition-colors duration-200 hover:bg-white/[0.06]" onClick={onToggle}>
        <div className="flex items-center gap-2">
          <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
          <span className="text-[0.85rem] font-medium text-slate-200">Iteration {iterationNumber}</span>
          {isFinal && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[0.65rem] font-semibold uppercase text-white">FINAL</span>}
          {hasAgentData && (
            <span className="ml-2 cursor-pointer rounded border border-blue-400 px-1.5 py-0.5 text-[10px] text-blue-400" onClick={(e) => {
              e.stopPropagation();
              onShowAgents?.();
            }}>
              ✨ Agents
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <QualityBadge score={qualitySignals.composite} />
          <span className="text-xs text-slate-300">
            {(generationDurationMs + (validationDurationMs || 0)) / 1000}s
          </span>
        </div>
      </button>

      {isExpanded && (
        <div className="animate-[slideDown_0.2s_ease-out] border-t border-white/[0.06] bg-white/[0.03] p-3">
          <QualityBreakdown signals={qualitySignals} />
          
          {patchGoals && patchGoals.length > 0 && (
            <div className="mt-3">
              <h4 className="mb-2 text-xs font-semibold uppercase text-slate-400">Improvements made:</h4>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {patchGoals.map((goal) => (
                  <li key={goal.id} className={`flex items-start gap-2 rounded bg-white/[0.04] px-2 py-1.5 text-[0.8rem] ${goal.severity === 'critical' ? 'border-l-[3px] border-red-500' : goal.severity === 'warning' ? 'border-l-[3px] border-amber-500' : 'border-l-[3px] border-blue-500'}`}>
                    <span className="shrink-0 rounded bg-slate-700 px-1 py-0.5 text-[0.65rem] font-semibold uppercase text-slate-300">{goal.category}</span>
                    <span className="leading-5 text-slate-200">{goal.description}</span>
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
    <span className="rounded-full px-2 py-0.5 text-[0.7rem] font-semibold text-white" style={{ backgroundColor: color }}>
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
    <div className="mb-4 flex flex-col gap-2">
      {categories.map((cat) =>
        cat.score !== undefined ? (
          <div key={cat.key} className="flex items-center gap-3">
            <span className="w-16 text-xs font-medium uppercase text-slate-400">{cat.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-700/50">
              <div
                className="h-full rounded-full transition-[width] duration-300 ease-out"
                style={{ width: `${cat.score}%`, backgroundColor: getScoreColor(cat.score) }}
              />
            </div>
            <span className="w-8 text-right text-xs font-semibold text-slate-200">{cat.score}</span>
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
