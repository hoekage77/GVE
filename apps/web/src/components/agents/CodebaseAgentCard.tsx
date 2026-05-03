import { ChevronDown, ChevronUp } from 'lucide-react';
import type { CodebaseAgentResult } from './CodebaseAgentTypes';
import { SEVERITY_COLORS } from './CodebaseAgentTypes';

interface CodebaseAgentCardProps {
  result: CodebaseAgentResult;
  isExpanded: boolean;
  onToggle: () => void;
}

const SEVERITY_ORDER = ['error', 'warning', 'info', 'suggestion'] as const;

export default function CodebaseAgentCard({ result, isExpanded, onToggle }: CodebaseAgentCardProps) {
  const { agent, findings, score, scannedFiles, durationMs } = result;

  const severityBreakdown = SEVERITY_ORDER
    .filter(s => findings.some(f => f.severity === s))
    .map(s => ({
      severity: s,
      count: findings.filter(f => f.severity === s).length,
      ...SEVERITY_COLORS[s]
    }));

  const scoreColor = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';

  return (
    <div
      className="group mb-3 overflow-hidden rounded-xl transition-all duration-200 hover:border-opacity-60"
      style={{
        backgroundColor: agent.bgColor,
        border: `1px solid ${agent.color}40`
      }}
    >
      <div
        className="flex cursor-pointer select-none items-center justify-between p-4 active:opacity-80"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      >
        <div className="flex flex-1 items-center gap-3">
          <span className="text-2xl leading-none">{agent.icon}</span>
          <div className="flex-1 min-w-0">
            <h3 className="m-0 text-sm font-semibold leading-6" style={{ color: agent.textColor }}>
              {agent.name}
            </h3>
            <p className="m-0 text-xs leading-5 text-slate-400">
              {findings.length} finding{findings.length !== 1 ? 's' : ''} · {scannedFiles} file{scannedFiles !== 1 ? 's' : ''} · {durationMs}ms
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div
            className="min-w-[46px] rounded-md px-2 py-1 text-center text-[13px] font-bold leading-5"
            style={{ backgroundColor: scoreColor, color: '#fff' }}
          >
            {score}%
          </div>
          <button
            className="flex items-center justify-center rounded p-1 text-slate-400 transition-all duration-200 hover:bg-white/10 hover:text-slate-200"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      <div className="px-4 pb-0.5">
        <div className="mb-3 h-1 overflow-hidden rounded bg-white/10">
          <div
            className="h-full rounded transition-[width] duration-300 ease-out"
            style={{ width: `${score}%`, backgroundColor: scoreColor }}
          />
        </div>
      </div>

      <div className="px-4 pb-3">
        <div className="flex flex-wrap gap-1.5">
          {severityBreakdown.map(({ severity, count, border, text }) => (
            <div
              key={severity}
              className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px]"
              style={{ borderColor: `${border}60`, color: text }}
            >
              <span>{count}</span>
              <span className="opacity-70">{severity}</span>
            </div>
          ))}
        </div>
      </div>

      {isExpanded && (
        <div
          className="border-t px-4 py-3"
          style={{ borderColor: `${agent.color}30`, backgroundColor: 'rgba(0,0,0,0.2)' }}
        >
          <div className="text-xs leading-5" style={{ color: agent.textColor, opacity: 0.85 }}>
            {agent.description}
          </div>
          {findings.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-slate-400">
                Top Findings
              </p>
              {findings.slice(0, 5).map((f) => (
                <div
                  key={f.id}
                  className="rounded-lg border border-white/5 bg-white/[0.03] p-2.5"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className="mt-0.5 shrink-0 rounded px-1 py-[1px] text-[9px] font-semibold uppercase tracking-[0.05em]"
                      style={{
                        ...SEVERITY_COLORS[f.severity],
                        fontSize: '9px',
                        padding: '1px 4px',
                        borderRadius: '3px',
                        backgroundColor: SEVERITY_COLORS[f.severity].bg,
                        color: SEVERITY_COLORS[f.severity].text,
                        border: `1px solid ${SEVERITY_COLORS[f.severity].border}40`
                      }}
                    >
                      {SEVERITY_COLORS[f.severity].label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-[13px] font-medium leading-5 text-slate-200">
                        {f.title}
                      </p>
                      <p className="m-0 mt-0.5 text-xs leading-5 text-slate-400">
                        {f.description}
                      </p>
                      <p className="m-0 mt-1 text-[10px] leading-4 text-meta-muted font-mono">
                        {f.location.file}{f.location.line ? `:${f.location.line}` : ''}
                      </p>
                      {f.fix && (
                        <p className="m-0 mt-1.5 rounded border border-emerald-500/20 bg-emerald-500/5 p-2 text-[11px] leading-5 text-emerald-400">
                          <span className="font-semibold">Fix:</span> {f.fix}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}