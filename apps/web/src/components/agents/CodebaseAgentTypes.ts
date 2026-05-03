export type Severity = 'error' | 'warning' | 'info' | 'suggestion';

export interface FindingLocation {
  file: string;
  line?: number;
  column?: number;
  snippet?: string;
}

export interface CodebaseFinding {
  id: string;
  agentId: CodebaseAgentId;
  severity: Severity;
  title: string;
  description: string;
  location: FindingLocation;
  fix: string | null;
  docsUrl?: string;
}

export type CodebaseAgentId =
  | 'architecture'
  | 'performance'
  | 'design'
  | 'security'
  | 'quality'
  | 'accessibility'
  | 'patterns';

export interface CodebaseAgentDefinition {
  id: CodebaseAgentId;
  name: string;
  icon: string;
  description: string;
  color: string;
  bgColor: string;
  textColor: string;
}

export interface CodebaseAgentResult {
  agent: CodebaseAgentDefinition;
  findings: CodebaseFinding[];
  summary: string;
  score: number; // 0–100
  scannedFiles: number;
  totalFindings: number;
  durationMs: number;
}

export interface CodebaseAnalysisReport {
  id: string;
  createdAt: string;
  projectRoot: string;
  agents: CodebaseAgentResult[];
  overallScore: number;
  totalFindings: number;
  totalScannedFiles: number;
  totalDurationMs: number;
  summary: string;
}

export const AGENT_DEFINITIONS: Record<CodebaseAgentId, CodebaseAgentDefinition> = {
  architecture: {
    id: 'architecture',
    name: 'Architecture',
    icon: '🏗',
    description: 'Component architecture, dependency graphs, module boundaries',
    color: '#3b82f6',
    bgColor: '#1e3a8a',
    textColor: '#93c5fd'
  },
  performance: {
    id: 'performance',
    name: 'Performance',
    icon: '⚡',
    description: 'Render optimization, bundle size, lazy loading, memoization',
    color: '#f59e0b',
    bgColor: '#451a03',
    textColor: '#fcd34d'
  },
  design: {
    id: 'design',
    name: 'Visual Design',
    icon: '🎨',
    description: 'Design consistency, responsive layout, visual hierarchy',
    color: '#ec4899',
    bgColor: '#4c0519',
    textColor: '#f9a8d4'
  },
  security: {
    id: 'security',
    name: 'Security',
    icon: '🛡',
    description: 'Vulnerabilities, exposed secrets, unsafe patterns',
    color: '#dc2626',
    bgColor: '#450a0a',
    textColor: '#fca5a5'
  },
  quality: {
    id: 'quality',
    name: 'Code Quality',
    icon: '💎',
    description: 'Code smells, complexity, type safety, testing coverage',
    color: '#10b981',
    bgColor: '#022c22',
    textColor: '#86efac'
  },
  accessibility: {
    id: 'accessibility',
    name: 'Accessibility',
    icon: '♿',
    description: 'ARIA labels, keyboard navigation, contrast ratios',
    color: '#f97316',
    bgColor: '#431407',
    textColor: '#fdba74'
  },
  patterns: {
    id: 'patterns',
    name: 'Patterns',
    icon: '🔍',
    description: 'Anti-patterns, convention breaks, consistency issues',
    color: '#8b5cf6',
    bgColor: '#2e1065',
    textColor: '#c4b5fd'
  }
};

export const SEVERITY_COLORS: Record<Severity, { bg: string; border: string; text: string; label: string }> = {
  error: {
    bg: 'rgba(239, 68, 68, 0.1)',
    border: '#ef4444',
    text: '#fca5a5',
    label: 'Error'
  },
  warning: {
    bg: 'rgba(245, 158, 11, 0.1)',
    border: '#f59e0b',
    text: '#fcd34d',
    label: 'Warning'
  },
  info: {
    bg: 'rgba(59, 130, 246, 0.1)',
    border: '#3b82f6',
    text: '#93c5fd',
    label: 'Info'
  },
  suggestion: {
    bg: 'rgba(139, 92, 246, 0.1)',
    border: '#8b5cf6',
    text: '#c4b5fd',
    label: 'Suggestion'
  }
};