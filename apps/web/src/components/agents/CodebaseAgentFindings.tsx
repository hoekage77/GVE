import { ExternalLink, FileText } from 'lucide-react';
import type { CodebaseFinding } from './CodebaseAgentTypes';
import { AGENT_DEFINITIONS, SEVERITY_COLORS } from './CodebaseAgentTypes';

interface CodebaseAgentFindingsProps {
  findings: CodebaseFinding[];
  filterSeverity?: string;
  filterAgent?: string;
  filterFile?: string;
}

function groupByFile(findings: CodebaseFinding[]): Map<string, CodebaseFinding[]> {
  const groups = new Map<string, CodebaseFinding[]>();
  for (const f of findings) {
    const existing = groups.get(f.location.file) || [];
    existing.push(f);
    groups.set(f.location.file, existing);
  }
  return groups;
}

const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2, suggestion: 3 };

function sortFindings(findings: CodebaseFinding[]): CodebaseFinding[] {
  return [...findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
  );
}

export default function CodebaseAgentFindings({
  findings,
  filterSeverity,
  filterAgent,
  filterFile
}: CodebaseAgentFindingsProps) {
  let filtered = findings;

  if (filterSeverity && filterSeverity !== 'all') {
    filtered = filtered.filter((f) => f.severity === filterSeverity);
  }
  if (filterAgent && filterAgent !== 'all') {
    filtered = filtered.filter((f) => f.agentId === filterAgent);
  }
  if (filterFile) {
    const lf = filterFile.toLowerCase();
    filtered = filtered.filter((f) => f.location.file.toLowerCase().includes(lf));
  }

  const sorted = sortFindings(filtered);
  const byFile = groupByFile(sorted);

  if (sorted.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-5 text-center text-slate-400">
        <FileText size={32} className="opacity-30" />
        <p className="text-sm">No findings match the current filters.</p>
        <p className="text-xs">Try adjusting severity, agent, or file filters.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-slate-400">
          {sorted.length} finding{sorted.length !== 1 ? 's' : ''} · {byFile.size} file{byFile.size !== 1 ? 's' : ''}
        </span>
      </div>

      {[...byFile.entries()].map(([filePath, fileFindings]) => {
        const sortedFileFindings = sortFindings(fileFindings);
        const errorCount = fileFindings.filter(f => f.severity === 'error').length;
        const warnCount = fileFindings.filter(f => f.severity === 'warning').length;

        return (
          <div key={filePath} className="rounded-xl border border-white/5 bg-surface-2 overflow-hidden">
            <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2.5">
              <FileText size={14} className="text-meta-muted shrink-0" />
              <span className="flex-1 truncate text-xs font-medium text-slate-300 font-mono">
                {filePath}
              </span>
              {errorCount > 0 && (
                <span className="text-[10px] font-semibold text-red-400">
                  {errorCount} error{errorCount !== 1 ? 's' : ''}
                </span>
              )}
              {warnCount > 0 && (
                <span className="text-[10px] font-semibold text-amber-400">
                  {warnCount} warn{warnCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            <div className="divide-y divide-white/[0.03]">
              {sortedFileFindings.map((finding) => {
                const agentDef = AGENT_DEFINITIONS[finding.agentId];
                const sev = SEVERITY_COLORS[finding.severity];

                return (
                  <div
                    key={finding.id}
                    className="flex items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-white/[0.03]"
                  >
                    <div className="flex items-center gap-2 shrink-0 pt-0.5">
                      <span
                        className="shrink-0 rounded px-1.5 py-[2px] text-[9px] font-semibold uppercase tracking-[0.05em]"
                        style={{
                          backgroundColor: sev.bg,
                          color: sev.text,
                          border: `1px solid ${sev.border}40`
                        }}
                      >
                        {sev.label}
                      </span>
                      {agentDef && (
                        <span
                          className="shrink-0 rounded px-1.5 py-[2px] text-[9px] font-semibold uppercase tracking-[0.05em]"
                          style={{
                            backgroundColor: agentDef.bgColor,
                            color: agentDef.textColor,
                            border: `1px solid ${agentDef.color}40`
                          }}
                        >
                          {agentDef.icon} {agentDef.name}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-[13px] font-medium leading-5 text-slate-200">
                        {finding.title}
                      </p>
                      <p className="m-0 mt-0.5 text-xs leading-5 text-slate-400">
                        {finding.description}
                      </p>

                      {finding.location.line && (
                        <div className="mt-1.5 flex items-center gap-3">
                          <span className="text-[10px] text-meta-muted font-mono">
                            line {finding.location.line}
                          </span>
                          {finding.location.snippet && (
                            <code className="truncate text-[10px] text-slate-500 font-mono block max-w-[300px]">
                              {finding.location.snippet}
                            </code>
                          )}
                        </div>
                      )}

                      {finding.fix && (
                        <div className="mt-2 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] p-2.5">
                          <div className="flex items-start gap-2">
                            <span className="mt-0.5 shrink-0 text-[10px] font-semibold uppercase text-emerald-400">
                              Fix
                            </span>
                            <p className="m-0 text-[11px] leading-5 text-emerald-400/90">
                              {finding.fix}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    {finding.docsUrl && (
                      <a
                        href={finding.docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded p-1 text-slate-500 transition-colors hover:text-slate-300"
                        aria-label="View documentation"
                        title="View docs"
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}