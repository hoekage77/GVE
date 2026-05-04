import { useState, useCallback } from 'react';
import { X, Loader2, Play, Filter } from 'lucide-react';
import CodebaseAgentCard from './CodebaseAgentCard';
import CodebaseAgentFindings from './CodebaseAgentFindings';
import { runCodebaseAnalysis } from './CodebaseAgentRunner';
import {
  AGENT_DEFINITIONS,
  SEVERITY_COLORS
} from './CodebaseAgentTypes';
import type {
  CodebaseAnalysisReport,
  Severity,
  CodebaseFinding
} from './CodebaseAgentTypes';
import type { UIAgentState } from '../../stores/chat/types';
import { useChatStore } from '../../stores';

interface CodebaseAgentPanelProps {
  onClose: () => void;
}

type TabView = 'agents' | 'findings' | 'overview';
type SeverityFilter = Severity | 'all';

function bridgeToUIAgentState(report: CodebaseAnalysisReport): UIAgentState {
  const results: UIAgentState['results'] = {};
  const recommendations: UIAgentState['recommendations'] = [];

  for (const ar of report.agents) {
    results[ar.agent.id] = {
      id: ar.agent.id,
      name: ar.agent.name,
      score: ar.score,
      findings: [
        ...ar.findings.filter(f => f.severity === 'error').map(f => `[ERROR] ${f.title}: ${f.description}`),
        ...ar.findings.filter(f => f.severity === 'warning').slice(0, 3).map(f => `[WARN] ${f.title}`),
        ...(ar.findings.length > 5 ? [`${ar.findings.length - 5} more findings`] : []),
      ],
      recommendations: ar.findings
        .filter(f => f.fix)
        .map(f => ({
          action: f.fix!,
          impact: f.severity === 'error' ? 15 : f.severity === 'warning' ? 8 : 3,
          confidence: f.severity === 'error' ? 90 : f.severity === 'warning' ? 70 : 50,
          category: (f.severity === 'error' ? 'safety' : f.severity === 'warning' ? 'structure' : 'visual') as 'structure' | 'performance' | 'visual' | 'api' | 'safety',
        })),
    };

    for (const f of ar.findings.filter(f => f.severity === 'error' || f.severity === 'warning')) {
      recommendations.push({
        agentId: ar.agent.id,
        action: f.fix ?? f.title,
        impact: f.severity === 'error' ? 15 : 8,
        confidence: f.severity === 'error' ? 90 : 70,
        category: f.severity === 'error' ? 'safety' : 'structure',
        priority: f.severity === 'error' ? 0 : 1,
      });
    }
  }

  return {
    isAnalyzing: false,
    results,
    consensus: report.overallScore,
    shouldAutoApply: report.overallScore >= 80,
    recommendations,
    memory: [],
    lastAnalyzedAt: report.createdAt,
  };
}

const TAB_BASE = "flex-1 min-w-[80px] whitespace-nowrap border-b-2 border-transparent px-3 py-3 text-xs font-semibold uppercase tracking-[0.3px] text-slate-400 transition-colors duration-200 hover:text-slate-200";
const TAB_ACTIVE = "border-b-[#06b6d4] text-[#06b6d4]";

export default function CodebaseAgentPanel({ onClose }: CodebaseAgentPanelProps) {
  const updateAgentState = useChatStore(s => s.updateAgentState);
  const [activeTab, setActiveTab] = useState<TabView>('overview');
  const [report, setReport] = useState<CodebaseAnalysisReport | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [fileFilter, setFileFilter] = useState('');

  const toggleAgent = useCallback((agentId: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);

  const handleRunAnalysis = useCallback(async () => {
    setIsRunning(true);
    try {
      const resp = await fetch('/api/scan-files');
      if (!resp.ok) throw new Error('Scan failed');
      const files = await resp.json() as Array<{ path: string; content: string }>;
      const result = await runCodebaseAnalysis(files, '/home/kage/visualruntime');
      setReport(result);
      updateAgentState(bridgeToUIAgentState(result));
      setActiveTab('overview');
    } catch {
      const demoFiles: Array<{ path: string; content: string }> = [
        { path: 'apps/web/src/components/layout/Sidebar.tsx', content: 'export default function Sidebar() { const x: any = null; console.log("debug"); return <div onClick={() => {}}><img src="a.jpg" /><button><Icon /></button></div>; }' },
        { path: 'apps/web/src/stores/chat/store.ts', content: 'import { devtools } from "zustand/middleware"; const store = create(devtools(() => ({ count: 0 })));' },
        { path: 'apps/web/src/components/agents/AgentCard.tsx', content: 'export default function AgentCard() { eval("test"); dangerouslySetInnerHTML: { __html: "<b>hi</b>" }; return null; }' }
      ];
      const result = await runCodebaseAnalysis(demoFiles, '/home/kage/visualruntime');
      setReport(result);
      updateAgentState(bridgeToUIAgentState(result));
      setActiveTab('overview');
    } finally {
      setIsRunning(false);
    }
  }, [updateAgentState]);

  const allFindings: CodebaseFinding[] = report
    ? report.agents.flatMap(a => a.findings)
    : [];

  const scoreColor = report
    ? report.overallScore >= 80 ? '#10b981'
      : report.overallScore >= 60 ? '#f59e0b' : '#ef4444'
    : '#6b7280';

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[600px] animate-[slideInRight_0.3s_ease-out] flex-col border-l border-white/10 bg-surface shadow-[-4px_0_12px_rgba(0,0,0,0.3)] max-md:max-w-full">
      <div className="flex items-center justify-between border-b border-white/5 p-4">
        <div className="flex items-center gap-3">
          <h2 className="m-0 text-sm font-semibold text-slate-200">
            {isRunning ? 'Scanning Codebase...' : report ? 'Codebase Analysis' : 'Codebase Scanner'}
          </h2>
          {report && (
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white"
              style={{ backgroundColor: scoreColor }}
            >
              {report.overallScore}/100
            </span>
          )}
        </div>
        <button
          className="flex items-center justify-center rounded p-1 text-slate-400 transition-all duration-200 hover:bg-white/10 hover:text-slate-200"
          onClick={onClose}
          aria-label="Close panel"
        >
          <X size={18} />
        </button>
      </div>

      {!report && !isRunning && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="text-5xl">🔍</div>
          <h3 className="text-lg font-semibold text-slate-200">Scan Your Codebase</h3>
          <p className="max-w-xs text-sm text-slate-400">
            7 specialized agents will analyze your code for architecture, performance, design consistency, security, quality, accessibility, and pattern issues.
          </p>
          <div className="flex flex-wrap justify-center gap-2 mt-2">
            {Object.values(AGENT_DEFINITIONS).map(def => (
              <span
                key={def.id}
                className="rounded-full border px-2.5 py-1 text-[10px] font-semibold"
                style={{
                  borderColor: `${def.color}40`,
                  color: def.textColor,
                  backgroundColor: def.bgColor
                }}
              >
                {def.icon} {def.name}
              </span>
            ))}
          </div>
          <button
            onClick={handleRunAnalysis}
            className="mt-4 flex items-center gap-2 rounded-lg bg-[#06b6d4] px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-[#06b6d4]/80 active:scale-[0.97]"
          >
            <Play size={16} />
            Run Analysis
          </button>
        </div>
      )}

      {isRunning && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-400">
          <Loader2 size={24} className="animate-spin text-[#06b6d4]" />
          <p className="text-sm">Running multi-agent codebase analysis...</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {Object.values(AGENT_DEFINITIONS).map(def => (
              <span
                key={def.id}
                className="animate-pulse rounded-full border px-2 py-0.5 text-[10px]"
                style={{
                  borderColor: `${def.color}40`,
                  color: def.textColor,
                  backgroundColor: def.bgColor
                }}
              >
                {def.icon} {def.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {report && !isRunning && (
        <>
          <div className="flex gap-0 overflow-x-auto border-b border-white/5 px-4">
            <button
              className={`${TAB_BASE} ${activeTab === 'overview' ? TAB_ACTIVE : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              Overview
            </button>
            <button
              className={`${TAB_BASE} ${activeTab === 'agents' ? TAB_ACTIVE : ''}`}
              onClick={() => setActiveTab('agents')}
            >
              Agents
            </button>
            <button
              className={`${TAB_BASE} ${activeTab === 'findings' ? TAB_ACTIVE : ''}`}
              onClick={() => setActiveTab('findings')}
            >
              Findings
            </button>
            <button
              className="ml-auto shrink-0 rounded-md px-3 py-2 text-[11px] font-semibold text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
              onClick={handleRunAnalysis}
            >
              Re-scan
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'overview' && (
              <div className="space-y-4">
                <div className="flex items-center gap-6 rounded-xl border border-white/5 bg-surface-2 p-5">
                  <div className="shrink-0">
                    <svg width="100" height="100" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="44" fill="none" stroke="#334155" strokeWidth="2" />
                      <circle
                        cx="50" cy="50" r="44"
                        fill="none"
                        stroke={scoreColor}
                        strokeWidth="4"
                        strokeDasharray={`${(report.overallScore / 100) * 276} 276`}
                        strokeLinecap="round"
                        style={{ transition: 'stroke-dasharray 0.5s ease' }}
                        transform="rotate(-90 50 50)"
                      />
                      <text x="50" y="46" textAnchor="middle" fontSize="22" fontWeight="bold" fill="#e2e8f0">
                        {report.overallScore}
                      </text>
                      <text x="50" y="64" textAnchor="middle" fontSize="10" fill="#94a3b8">
                        Score
                      </text>
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="mb-1 text-sm font-semibold text-slate-200">Codebase Health</h3>
                    <p className="mb-2 text-[13px] text-slate-400">{report.summary}</p>
                    <div className="flex gap-4 text-[11px] text-slate-400">
                      <span>{report.totalScannedFiles} files</span>
                      <span>{report.totalFindings} findings</span>
                      <span>{(report.totalDurationMs / 1000).toFixed(1)}s</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {(['error', 'warning', 'info', 'suggestion'] as Severity[]).map(sev => {
                    const count = allFindings.filter(f => f.severity === sev).length;
                    const sevDef = SEVERITY_COLORS[sev];
                    return (
                      <div
                        key={sev}
                        className="rounded-lg border border-white/5 bg-surface-2 p-3 cursor-pointer transition-all duration-200 hover:border-opacity-60"
                        style={{ borderLeftColor: sevDef.border, borderLeftWidth: '3px' }}
                        onClick={() => { setSeverityFilter(sev); setActiveTab('findings'); }}
                      >
                        <div className="text-2xl font-bold" style={{ color: sevDef.text }}>{count}</div>
                        <div className="text-[11px] uppercase tracking-[0.3px] text-slate-400">{sevDef.label}</div>
                      </div>
                    );
                  })}
                </div>

                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-slate-400">Agent Scores</p>
                  <div className="space-y-2">
                    {report.agents.map(ar => (
                      <div key={ar.agent.id} className="flex items-center gap-3 rounded-lg border border-white/5 bg-surface-2 p-2.5 cursor-pointer transition-colors hover:bg-surface-3" onClick={() => { setAgentFilter(ar.agent.id); setActiveTab('agents'); }}>
                        <span className="text-lg">{ar.agent.icon}</span>
                        <span className="flex-1 text-xs font-medium text-slate-300">{ar.agent.name}</span>
                        <span
                          className="rounded px-2 py-0.5 text-[11px] font-bold text-white"
                          style={{ backgroundColor: ar.agent.color }}
                        >
                          {ar.score}%
                        </span>
                        <span className="text-[10px] text-slate-500">{ar.totalFindings}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'agents' && (
              <div>
                {report.agents.map(ar => (
                  <CodebaseAgentCard
                    key={ar.agent.id}
                    result={ar}
                    isExpanded={expandedAgents.has(ar.agent.id)}
                    onToggle={() => toggleAgent(ar.agent.id)}
                  />
                ))}
              </div>
            )}

            {activeTab === 'findings' && (
              <div>
                <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-surface-2 p-3">
                  <Filter size={14} className="text-slate-400 shrink-0" />
                  <select
                    className="rounded border border-white/10 bg-surface-3 px-2 py-1 text-[11px] text-slate-300"
                    value={severityFilter}
                    onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
                    aria-label="Filter by severity"
                  >
                    <option value="all">All severities</option>
                    {Object.entries(SEVERITY_COLORS).map(([key, val]) => (
                      <option key={key} value={key}>{val.label}</option>
                    ))}
                  </select>
                  <select
                    className="rounded border border-white/10 bg-surface-3 px-2 py-1 text-[11px] text-slate-300"
                    value={agentFilter}
                    onChange={(e) => setAgentFilter(e.target.value)}
                    aria-label="Filter by agent"
                  >
                    <option value="all">All agents</option>
                    {Object.values(AGENT_DEFINITIONS).map(def => (
                      <option key={def.id} value={def.id}>{def.icon} {def.name}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    className="flex-1 min-w-[120px] rounded border border-white/10 bg-surface-3 px-2 py-1 text-[11px] text-slate-300 placeholder:text-slate-500"
                    placeholder="Filter by file..."
                    value={fileFilter}
                    onChange={(e) => setFileFilter(e.target.value)}
                    aria-label="Filter by file path"
                  />
                </div>

                <CodebaseAgentFindings
                  findings={allFindings}
                  filterSeverity={severityFilter}
                  filterAgent={agentFilter}
                  filterFile={fileFilter}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}