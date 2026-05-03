import {
  type Workspace,
  listFiles,
  getDependencyGraph,
  extractImports,
} from "../pipeline/workspace.js";

// ────────────────────────────────────────────────
//  TYPES
// ────────────────────────────────────────────────

export interface ImportGraphHealth {
  unresolvedImports: Array<{ file: string; importSpec: string }>;
  orphanedFiles: string[];
  circularDependencies: string[][];
  importCountByFile: Record<string, number>;
  importedByCount: Record<string, number>;
  cohesionScore: number;
}

export interface ProjectQualityReport {
  importGraph: ImportGraphHealth;
  fileScores: Record<string, number>;
  compositeScore: number;
  weakestFiles: string[];
  recommendations: string[];
}

// ────────────────────────────────────────────────
//  IMPORT GRAPH ANALYSIS
// ────────────────────────────────────────────────

export function analyzeImportGraph(ws: Workspace): ImportGraphHealth {
  const files = listFiles(ws);
  const filePaths = new Set(files.map(f => f.path));
  const graph = getDependencyGraph(ws);

  const unresolvedImports: Array<{ file: string; importSpec: string }> = [];
  const importCountByFile: Record<string, number> = {};
  const importedByCount: Record<string, number> = {};

  for (const file of files) {
    importCountByFile[file.path] = 0;
    importedByCount[file.path] = 0;
    const imports = extractImports(file.content);
    for (const spec of imports) {
      if (!spec.startsWith(".")) continue;
      let resolved = false;
      for (const dep of graph[file.path] || []) {
        if (dep === spec || dep.replace(/\.js$/, "") === spec || dep + ".js" === spec) {
          resolved = true;
          break;
        }
      }
      if (!resolved) {
        unresolvedImports.push({ file: file.path, importSpec: spec });
      }
    }
  }

  for (const file of files) {
    importCountByFile[file.path] = (graph[file.path] || []).length;
    for (const dep of graph[file.path] || []) {
      if (importedByCount[dep] !== undefined) importedByCount[dep]++;
    }
  }

  const orphanedFiles = files
    .filter(f => f.path !== ws.entryPoint && (importedByCount[f.path] || 0) === 0)
    .map(f => f.path);

  const circularDependencies = findCircularDependencies(graph);

  const resolvedCount = unresolvedImports.length;
  const orphanCount = orphanedFiles.length;
  const cycleCount = circularDependencies.length;

  const cohesionScore = Math.max(0, Math.min(100,
    100
    - resolvedCount * 8
    - orphanCount * 10
    - cycleCount * 25
    - (files.length === 1 ? 0 : Math.max(0, 30 - (files.length - 1) * 5))
  ));

  return { unresolvedImports, orphanedFiles, circularDependencies, importCountByFile, importedByCount, cohesionScore };
}

function findCircularDependencies(graph: Record<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack: string[] = [];
  const inStack = new Set<string>();

  function dfs(node: string) {
    if (inStack.has(node)) {
      const cycleStart = stack.indexOf(node);
      if (cycleStart >= 0) {
        cycles.push([...stack.slice(cycleStart), node]);
      }
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.push(node);
    inStack.add(node);
    for (const dep of graph[node] || []) dfs(dep);
    stack.pop();
    inStack.delete(node);
  }

  for (const node of Object.keys(graph)) dfs(node);
  return cycles;
}

// ────────────────────────────────────────────────
//  PROJECT-LEVEL QUALITY
// ────────────────────────────────────────────────

export function computeProjectQuality(
  ws: Workspace,
  fileScores: Record<string, number> = {}
): ProjectQualityReport {
  const importGraph = analyzeImportGraph(ws);
  const files = listFiles(ws);

  const avgFileScore = files.length > 0
    ? files.reduce((sum, f) => sum + (fileScores[f.path] || 0), 0) / files.length
    : 0;

  const compositeScore = Math.round(
    avgFileScore * 0.6 + importGraph.cohesionScore * 0.4
  );

  const scoreEntries = Object.entries(fileScores).sort(([, a], [, b]) => a - b);
  const weakestFiles = scoreEntries.slice(0, Math.min(3, scoreEntries.length)).map(([path]) => path);

  const recommendations: string[] = [];
  if (importGraph.unresolvedImports.length > 0) {
    recommendations.push(`Fix ${importGraph.unresolvedImports.length} unresolved imports across the project.`);
  }
  if (importGraph.orphanedFiles.length > 0) {
    recommendations.push(`Consider removing orphaned files: ${importGraph.orphanedFiles.join(", ")}.`);
  }
  if (importGraph.circularDependencies.length > 0) {
    recommendations.push(`Resolve ${importGraph.circularDependencies.length} circular dependency chain(s).`);
  }
  if (weakestFiles.length > 0) {
    recommendations.push(`Focus quality improvements on weakest file(s): ${weakestFiles.join(", ")}.`);
  }
  if (importGraph.cohesionScore < 60) {
    recommendations.push("Project structure is fragmented — consider consolidating related files.");
  }

  return {
    importGraph,
    fileScores,
    compositeScore,
    weakestFiles,
    recommendations
  };
}