import type {
  CodebaseFinding,
  CodebaseAgentId,
  CodebaseAgentResult,
  CodebaseAnalysisReport,
  Severity
} from './CodebaseAgentTypes';
import { AGENT_DEFINITIONS } from './CodebaseAgentTypes';

interface FileEntry {
  path: string;
  content: string;
}

interface CheckRule {
  id: string;
  severity: Severity;
  title: string;
  pattern: RegExp;
  message: (match: RegExpExecArray, line: string, lineNo: number) => string;
  fix: string | null;
  agentId: CodebaseAgentId;
}

function makeFindingId(agentId: string, file: string, line: number, ruleId: string): string {
  return `${agentId}:${file}:${line}:${ruleId}`;
}

const ARCHITECTURE_RULES: CheckRule[] = [
  {
    id: 'deep-imports',
    severity: 'warning',
    title: 'Deep relative imports detected',
    pattern: /from\s+['"]\.\.\/\.\.\/\.\.['"]/,
    message: () => 'Deep relative import (3+ levels up). Consider path aliases or barrel exports.',
    fix: 'Configure path aliases in tsconfig and use `@/` prefix',
    agentId: 'architecture'
  },
  {
    id: 'circular-deps',
    severity: 'warning',
    title: 'Potential circular dependency',
    pattern: /import\s+.*from\s+['"]\.\.\/\.\.\/.*\/components\/agents/,
    message: () => 'Import between sibling feature directories may indicate circular dependency.',
    fix: 'Extract shared types/interfaces into a separate package or barrel file',
    agentId: 'architecture'
  },
  {
    id: 'large-component',
    severity: 'info',
    title: 'Component exceeds recommended size',
    pattern: /^export\s+(default\s+)?function\s+(\w+)/,
    message: (_, line, lineNo) =>
      `Component detected at line ${lineNo}. Consider splitting into smaller components if file exceeds 300 lines.`,
    fix: 'Extract sub-components, hooks, or utility functions into separate files',
    agentId: 'architecture'
  },
  {
    id: 'god-store',
    severity: 'info',
    title: 'Large store slice detected',
    pattern: /create\(.*devtools\(/,
    message: () => 'Store may be growing too large. Consider splitting into domain-specific stores.',
    fix: 'Refactor into multiple small stores with clear boundaries',
    agentId: 'architecture'
  }
];

const PERFORMANCE_RULES: CheckRule[] = [
  {
    id: 'unstable-deps',
    severity: 'warning',
    title: 'Object/array literal in dependency array',
    pattern: /use(Memo|Callback|Effect)\(\s*(?:\(\)\s*=>\s*)?\{[\s\S]*?\}\s*,\s*\[([^\]]*)\]/,
    message: (match) => `useMemo/useCallback/useEffect may have unstable deps at: ${match[2]?.trim() || 'unknown'}. Check for object/array literals.`,
    fix: 'Memoize object/array values with useMemo or define outside component',
    agentId: 'performance'
  },
  {
    id: 'inline-function-props',
    severity: 'suggestion',
    title: 'Inline arrow function prop may cause re-renders',
    pattern: /on\w+=\{\(/g,
    message: (_, line, lineNo) =>
      `Inline callback at line ${lineNo}. Wrap with useCallback if passed to memoized children.`,
    fix: 'Wrap inline callbacks with useCallback or extract to named function',
    agentId: 'performance'
  },
  {
    id: 'missing-memo',
    severity: 'suggestion',
    title: 'Large component without React.memo',
    pattern: /export\s+default\s+function\s+(\w+)/,
    message: (match) => `${match[1]} is exported without React.memo wrapping. Consider memoizing if it re-renders frequently.`,
    fix: 'Wrap export with React.memo(Component)',
    agentId: 'performance'
  },
  {
    id: 'no-lazy-load',
    severity: 'suggestion',
    title: 'Could use code splitting for large component',
    pattern: /import\s+.*SceneViewer\s+from/,
    message: () => 'SceneViewer is imported eagerly. Consider React.lazy for code splitting.',
    fix: 'Use React.lazy(() => import("./components/SceneViewer"))',
    agentId: 'performance'
  }
];

const DESIGN_RULES: CheckRule[] = [
  {
    id: 'inline-styles',
    severity: 'warning',
    title: 'Inline style object detected',
    pattern: /style=\{\{/,
    message: (_, line, lineNo) =>
      `Inline style at line ${lineNo}. Prefer Tailwind classes or CSS modules for consistency.`,
    fix: 'Use Tailwind utility classes or add to index.css',
    agentId: 'design'
  },
  {
    id: 'magic-color',
    severity: 'suggestion',
    title: 'Hardcoded color instead of design token',
    pattern: /#[0-9a-fA-F]{3,6}(?!\s*\/)/,
    message: (match, line, lineNo) =>
      `Hardcoded color "${match[0]}" at line ${lineNo}. Map to design token or Tailwind theme color.`,
    fix: 'Reference the color as a Tailwind theme extension or CSS variable',
    agentId: 'design'
  },
  {
    id: 'no-aria-label',
    severity: 'warning',
    title: 'Icon button missing aria-label',
    pattern: /<button[^>]*>\s*(?:<[A-Z][a-zA-Z]+\s)/,
    message: (_, line, lineNo) =>
      `Button at line ${lineNo} with only an icon child should have aria-label for screen readers.`,
    fix: 'Add aria-label="description of action" to the button',
    agentId: 'design'
  },
  {
    id: 'hardcoded-transition',
    severity: 'suggestion',
    title: 'CSS transition without design token easing',
    pattern: /transition(?!-[a-z]+)*:\s*[^;]*\blinear\b/,
    message: (_, line, lineNo) =>
      `Linear transition at line ${lineNo}. Use design token easings per DESIGN_STYLE.md §1.3.`,
    fix: 'Replace linear with cubic-bezier values from motion tokens',
    agentId: 'design'
  }
];

const SECURITY_RULES: CheckRule[] = [
  {
    id: 'dangerously-html',
    severity: 'error',
    title: 'dangerouslySetInnerHTML usage',
    pattern: /dangerouslySetInnerHTML/,
    message: () => 'Using dangerouslySetInnerHTML — potential XSS vector. Ensure content is sanitized.',
    fix: 'Use a sanitization library (e.g. DOMPurify) before injecting HTML',
    agentId: 'security'
  },
  {
    id: 'eval-usage',
    severity: 'error',
    title: 'eval() or Function() constructor detected',
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
    message: () => 'eval() or new Function() usage — arbitrary code execution risk.',
    fix: 'Remove eval/Function. Use JSON.parse or a sandboxed interpreter instead',
    agentId: 'security'
  },
  {
    id: 'exposed-key',
    severity: 'error',
    title: 'Potential secret/hardcoded key',
    pattern: /(?:api_?key|secret|token|password)\s*[:=]\s*['"`][A-Za-z0-9_-]{16,}['"`]/i,
    message: (_, line, lineNo) =>
      `Possible hardcoded credential at line ${lineNo}. Move to environment variables.`,
    fix: 'Use environment variables (import.meta.env.VITE_*) for secrets',
    agentId: 'security'
  },
  {
    id: 'innerHTML',
    severity: 'warning',
    title: '.innerHTML assignment found',
    pattern: /\.innerHTML\s*=/,
    message: () => 'innerHTML assignment — XSS risk. Prefer textContent or DOM APIs.',
    fix: 'Use textContent, createElement, or sanitize with DOMPurify',
    agentId: 'security'
  }
];

const QUALITY_RULES: CheckRule[] = [
  {
    id: 'console-log',
    severity: 'info',
    title: 'console.log left in production code',
    pattern: /console\.(log|debug)\s*\(/,
    message: (_, line, lineNo) =>
      `console.log/debug at line ${lineNo}. Should be removed or use a logger abstraction.`,
    fix: 'Remove or replace with a structured logging utility gated by environment',
    agentId: 'quality'
  },
  {
    id: 'any-type',
    severity: 'warning',
    title: 'TypeScript `any` type used',
    pattern: /:\s*any\b/,
    message: (_, line, lineNo) =>
      `Type "any" at line ${lineNo}. Use unknown or proper typing for type safety.`,
    fix: 'Replace "any" with specific types or "unknown" with narrowing',
    agentId: 'quality'
  },
  {
    id: 'todo-fixme',
    severity: 'info',
    title: 'TODO/FIXME/HACK comment',
    pattern: /(?:\/\/|#)\s*(TODO|FIXME|HACK|XXX)\b/i,
    message: (match, line, lineNo) =>
      `${match[1]} comment at line ${lineNo}. Track these for follow-up resolution.`,
    fix: 'Create a ticket/story for this item or address it',
    agentId: 'quality'
  },
  {
    id: 'missing-return-type',
    severity: 'suggestion',
    title: 'Exported function missing return type annotation',
    pattern: /export\s+(default\s+)?function\s+(\w+)\s*\([^)]*\)\s*(?!:\s*\w)/,
    message: (match) => `${match[2]} lacks explicit return type. Add for better type safety.`,
    fix: 'Add explicit return type annotation (e.g. `: Promise<void>` or `: React.ReactNode`)',
    agentId: 'quality'
  },
  {
    id: 'ts-expect-error',
    severity: 'warning',
    title: '@ts-expect-error or @ts-ignore suppression',
    pattern: /@ts-(?:expect-error|ignore)/,
    message: (_, line, lineNo) =>
      `TypeScript error suppression at line ${lineNo}. Fix the underlying type issue instead.`,
    fix: 'Fix the type error rather than suppressing it',
    agentId: 'quality'
  }
];

const ACCESSIBILITY_RULES: CheckRule[] = [
  {
    id: 'missing-alt',
    severity: 'warning',
    title: 'Image missing alt attribute',
    pattern: /<img\s+(?![^>]*\balt\s*=\s*["'][^"']*["'])/,
    message: (_, line, lineNo) =>
      `<img> at line ${lineNo} has no alt attribute. Add descriptive alt text.`,
    fix: 'Add alt attribute with meaningful description',
    agentId: 'accessibility'
  },
  {
    id: 'non-semantic-button',
    severity: 'warning',
    title: 'Div/span used as button',
    pattern: /<(div|span)\s+[^>]*\b(?:onClick|role\s*=\s*["']button["'])/,
    message: (_, line, lineNo) =>
      `Non-semantic element used as button at line ${lineNo}. Use <button> for interactive elements.`,
    fix: 'Replace <div>/<span> with <button> element',
    agentId: 'accessibility'
  },
  {
    id: 'missing-role-tab',
    severity: 'warning',
    title: 'Custom tab missing ARIA role',
    pattern: /<div[^>]*onClick[^>]*tab/,
    message: () => 'Custom tab controls detected. Ensure role="tab", aria-selected, and keyboard support.',
    fix: 'Add role="tab", aria-selected, tabIndex, and keyboard handler',
    agentId: 'accessibility'
  },
  {
    id: 'no-label-input',
    severity: 'warning',
    title: 'Input without associated label',
    pattern: /<(?:input|textarea|select)\s+(?![^>]*\b(?:aria-label|aria-labelledby|id)\s*=\s*["'])/,
    message: (_, line, lineNo) =>
      `Form control at line ${lineNo} has no aria-label or label association.`,
    fix: 'Add aria-label or associate with a <label> via htmlFor/id',
    agentId: 'accessibility'
  }
];

const PATTERN_RULES: CheckRule[] = [
  {
    id: 'default-export-without-name',
    severity: 'info',
    title: 'Anonymous default export',
    pattern: /export\s+default\s+(function\s*(?!\w)|=>\s*\{|class\s*(?!\w))/,
    message: () => 'Default export should use named function/class for better DevTools debugging.',
    fix: 'Define a named function and export it as default',
    agentId: 'patterns'
  },
  {
    id: 'duplicate-logic',
    severity: 'suggestion',
    title: 'Duplicate utility pattern',
    pattern: /function\s+(\w+)\s*\([^)]*\)\s*\{\s*return\s+.*\b(\w+)\s*\?\?/,
    message: (match) => `Pattern ${match[1]} appears to reimplement a built-in. Use nullish coalescing (??) directly.`,
    fix: 'Remove wrapper function, use the operator directly',
    agentId: 'patterns'
  },
  {
    id: 'mutable-map-over-reduce',
    severity: 'suggestion',
    title: 'Mutable accumulation instead of reduce',
    pattern: /(?:forEach|map)\s*\([^)]*\)\s*\{[^}]*\.push\s*\(/,
    message: (_, line, lineNo) =>
      `Mutable accumulation (push inside forEach) at line ${lineNo}. Consider Array.reduce or flatMap.`,
    fix: 'Use Array.reduce() or Array.flatMap() for immutable accumulation',
    agentId: 'patterns'
  },
  {
    id: 'mutable-state-push',
    severity: 'warning',
    title: 'Direct state mutation (push/splice)',
    pattern: /(?:state|prev|prevState|draft|data)\.(push|splice|sort|reverse)\s*\(/,
    message: (m, line, lineNo) =>
      `Potential state mutation (${m[1]}) at line ${lineNo}. Use immutable patterns in React state.`,
    fix: 'Create new array with spread/array methods instead of mutation',
    agentId: 'patterns'
  }
];

const ALL_RULES: CheckRule[] = [
  ...ARCHITECTURE_RULES,
  ...PERFORMANCE_RULES,
  ...DESIGN_RULES,
  ...SECURITY_RULES,
  ...QUALITY_RULES,
  ...ACCESSIBILITY_RULES,
  ...PATTERN_RULES
];

function runRulesOnContent(
  content: string,
  filePath: string,
  agentId: CodebaseAgentId
): CodebaseFinding[] {
  const rules = ALL_RULES.filter((r) => r.agentId === agentId);
  const lines = content.split('\n');
  const findings: CodebaseFinding[] = [];

  for (const rule of rules) {
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g')
      ? rule.pattern.flags
      : `${rule.pattern.flags}g`);

    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const lineNo = content.substring(0, match.index).split('\n').length;
      const line = lines[lineNo - 1] || '';

      findings.push({
        id: makeFindingId(agentId, filePath, lineNo, rule.id),
        agentId,
        severity: rule.severity,
        title: rule.title,
        description: rule.message(match, line, lineNo),
        location: {
          file: filePath,
          line: lineNo,
          snippet: line.trim()
        },
        fix: rule.fix
      });

      if (!rule.pattern.flags.includes('g')) break;
    }
  }

  return findings;
}

export async function runCodebaseAnalysis(
  files: FileEntry[],
  projectRoot: string,
  targetAgents?: CodebaseAgentId[]
): Promise<CodebaseAnalysisReport> {
  const startTime = performance.now();
  const agentsToRun = targetAgents || Object.keys(AGENT_DEFINITIONS) as CodebaseAgentId[];
  const agentResults: CodebaseAgentResult[] = [];
  let allFindings: CodebaseFinding[] = [];

  for (const agentId of agentsToRun) {
    const agentStartTime = performance.now();
    const def = AGENT_DEFINITIONS[agentId];
    const findings: CodebaseFinding[] = [];

    for (const file of files) {
      const fileFindings = runRulesOnContent(file.content, file.path, agentId);
      findings.push(...fileFindings);
    }

    const errorCount = findings.filter(f => f.severity === 'error').length;
    const warnCount = findings.filter(f => f.severity === 'warning').length;

    const maxPenalty = files.length * 5;
    const penalty = errorCount * 10 + warnCount * 3;
    const score = Math.max(0, Math.min(100, 100 - Math.round((penalty / Math.max(1, maxPenalty)) * 100)));

    const agentEndTime = performance.now();

    const result: CodebaseAgentResult = {
      agent: def,
      findings,
      summary: generateAgentSummary(def, findings),
      score,
      scannedFiles: files.length,
      totalFindings: findings.length,
      durationMs: Math.round(agentEndTime - agentStartTime)
    };

    agentResults.push(result);
    allFindings = allFindings.concat(findings);
  }

  const overallScore = agentResults.length > 0
    ? Math.round(agentResults.reduce((sum, r) => sum + r.score, 0) / agentResults.length)
    : 100;

  const endTime = performance.now();

  return {
    id: `report-${Date.now()}`,
    createdAt: new Date().toISOString(),
    projectRoot,
    agents: agentResults,
    overallScore,
    totalFindings: allFindings.length,
    totalScannedFiles: files.length,
    totalDurationMs: Math.round(endTime - startTime),
    summary: generateOverallSummary(agentResults, overallScore, files.length)
  };
}

function generateAgentSummary(
  def: import('./CodebaseAgentTypes').CodebaseAgentDefinition,
  findings: CodebaseFinding[]
): string {
  if (findings.length === 0) return `No issues detected by ${def.name} agent.`;

  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  const infos = findings.filter(f => f.severity === 'info').length;
  const suggestions = findings.filter(f => f.severity === 'suggestion').length;

  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors > 1 ? 's' : ''}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings > 1 ? 's' : ''}`);
  if (infos > 0) parts.push(`${infos} info`);
  if (suggestions > 0) parts.push(`${suggestions} suggestion${suggestions > 1 ? 's' : ''}`);

  return `${def.name}: ${parts.join(', ')}`;
}

function generateOverallSummary(
  results: CodebaseAgentResult[],
  score: number,
  fileCount: number
): string {
  if (score >= 90) {
    return `Excellent — only minor items across ${fileCount} files. Score: ${score}/100.`;
  }
  if (score >= 70) {
    const totalFindings = results.reduce((s, r) => s + r.totalFindings, 0);
    return `Good with ${totalFindings} items to review across ${fileCount} files. Score: ${score}/100.`;
  }
  if (score >= 50) {
    const totalErrors = results.reduce((s, r) => s + r.findings.filter(f => f.severity === 'error').length, 0);
    return `Needs attention — ${totalErrors} errors and other issues across ${fileCount} files. Score: ${score}/100.`;
  }
  const critical = results.reduce((s, r) => s + r.findings.filter(f => f.severity === 'error').length, 0);
  return `Critical — ${critical} errors need immediate attention. Score: ${score}/100.`;
}

export const SCAN_TARGETS: { path: string; pattern: string; description: string }[] = [
  { path: 'apps/web/src/components', pattern: '**/*.{ts,tsx}', description: 'All Components' },
  { path: 'apps/web/src/stores', pattern: '**/*.ts', description: 'State Management' },
  { path: 'apps/web/src/lib', pattern: '**/*.ts', description: 'Utilities' },
  { path: 'apps/web/src/hooks', pattern: '**/*.{ts,tsx}', description: 'Custom Hooks' },
  { path: 'apps/web/src/pages', pattern: '**/*.tsx', description: 'Page Components' },
  { path: 'apps/web/src/components/layout', pattern: '**/*.tsx', description: 'Layout Shell' },
  { path: 'apps/web/src/components/chat', pattern: '**/*.tsx', description: 'Chat System' },
  { path: 'apps/web/src/components/agents', pattern: '**/*.{ts,tsx}', description: 'Agent System' },
  { path: 'apps/web/src/components/workspace', pattern: '**/*.{ts,tsx}', description: 'Workspace' },
  { path: 'apps/server', pattern: '**/*.ts', description: 'Backend Server' },
];