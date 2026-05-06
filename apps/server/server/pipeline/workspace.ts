import { z } from "zod";

export type SkillId = "threejs" | "p5js" | "d3js" | "animejs" | "manim";

// ────────────────────────────────────────────────
//  WORKSPACE TYPES
// ────────────────────────────────────────────────

export interface FileRevision {
  version: number;
  content: string;
  createdAt: string;
  agentAction: "generate" | "patch" | "user-edit";
}

export interface FileEntry {
  path: string;
  content: string;
  purpose: string;
  skill: SkillId | SkillId[];
  generatedAt: string;
  history: FileRevision[];
}

export interface Workspace {
  files: Record<string, FileEntry>;
  entryPoint: string;
  dependencies: string[];
  createdAt: string;
  updatedAt: string;
}

export interface FileDiff {
  path: string;
  kind: "add" | "remove" | "modify" | "rename";
  oldContent?: string;
  newContent?: string;
  oldPath?: string;
}

// ────────────────────────────────────────────────
//  ZOD SCHEMAS
// ────────────────────────────────────────────────

const skillIdEnum = z.enum(["threejs", "p5js", "d3js", "animejs", "manim"]);

export const fileRevisionSchema = z.object({
  version: z.number().int().min(0),
  content: z.string(),
  createdAt: z.string().datetime(),
  agentAction: z.enum(["generate", "patch", "user-edit"])
});

export const fileEntrySchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  purpose: z.string().min(1),
  skill: skillIdEnum,
  generatedAt: z.string().datetime().optional(),
  history: z.array(fileRevisionSchema).default([])
});

export const workspaceSchema = z.object({
  files: z.record(z.string(), fileEntrySchema),
  entryPoint: z.string().min(1),
  dependencies: z.array(z.string()).default([]),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional()
});

// ────────────────────────────────────────────────
//  FACTORY
// ────────────────────────────────────────────────

export function createWorkspace(entryPoint = "src/index.js"): Workspace {
  const now = new Date().toISOString();
  return {
    files: {},
    entryPoint,
    dependencies: [],
    createdAt: now,
    updatedAt: now
  };
}

// ────────────────────────────────────────────────
//  FILE OPERATIONS (immutable)
// ────────────────────────────────────────────────

const MAX_HISTORY = 3;

function pushHistory(entry: FileEntry, action: FileRevision["agentAction"]): FileRevision[] {
  const revision: FileRevision = {
    version: entry.history.length + 1,
    content: entry.content,
    createdAt: entry.generatedAt,
    agentAction: entry.history.length === 0 ? "generate" : action
  };
  return [...entry.history, revision].slice(-MAX_HISTORY);
}

export function addFile(
  ws: Workspace,
  path: string,
  content: string,
  purpose: string,
  skill: SkillId | SkillId[] = "threejs",
  agentAction: FileRevision["agentAction"] = "generate"
): Workspace {
  if (!content.trim()) throw new Error(`Cannot add empty file: ${path}`);
  const cleanPath = path.replace(/^\/+/, "");
  if (ws.files[cleanPath]) throw new Error(`File already exists: ${cleanPath}`);
  const now = new Date().toISOString();
  return {
    ...ws,
    files: {
      ...ws.files,
      [cleanPath]: {
        path: cleanPath,
        content,
        purpose,
        skill,
        generatedAt: now,
        history: []
      }
    },
    updatedAt: now
  };
}

export function updateFile(
  ws: Workspace,
  path: string,
  content: string,
  agentAction: FileRevision["agentAction"] = "patch"
): Workspace {
  const cleanPath = path.replace(/^\/+/, "");
  const existing = ws.files[cleanPath];
  if (!existing) throw new Error(`File not found: ${cleanPath}`);
  if (!content.trim()) throw new Error(`Cannot write empty content to: ${cleanPath}`);
  const now = new Date().toISOString();
  return {
    ...ws,
    files: {
      ...ws.files,
      [cleanPath]: {
        ...existing,
        content,
        generatedAt: now,
        history: pushHistory(existing, agentAction)
      }
    },
    updatedAt: now
  };
}

export function removeFile(ws: Workspace, path: string): Workspace {
  const cleanPath = path.replace(/^\/+/, "");
  if (!ws.files[cleanPath]) throw new Error(`File not found: ${cleanPath}`);
  if (cleanPath === ws.entryPoint) {
    throw new Error(`Cannot remove entry point: ${cleanPath}`);
  }
  const next = { ...ws.files };
  delete next[cleanPath];
  return {
    ...ws,
    files: next,
    updatedAt: new Date().toISOString()
  };
}

export function revertFile(ws: Workspace, path: string, version: number): Workspace {
  const cleanPath = path.replace(/^\/+/, "");
  const existing = ws.files[cleanPath];
  if (!existing) throw new Error(`File not found: ${cleanPath}`);
  const revision = existing.history.find((h) => h.version === version);
  if (!revision) throw new Error(`Version ${version} not found for ${cleanPath}`);
  const now = new Date().toISOString();
  return {
    ...ws,
    files: {
      ...ws.files,
      [cleanPath]: {
        ...existing,
        content: revision.content,
        generatedAt: now,
        history: pushHistory(existing, "user-edit"),
      },
    },
    updatedAt: now,
  };
}

export function getFile(ws: Workspace, path: string): FileEntry | undefined {
  return ws.files[path.replace(/^\/+/, "")];
}

export function listFiles(ws: Workspace): FileEntry[] {
  return Object.values(ws.files);
}

export function hasFile(ws: Workspace, path: string): boolean {
  return path.replace(/^\/+/, "") in ws.files;
}

// ────────────────────────────────────────────────
//  IMPORT RESOLUTION
// ────────────────────────────────────────────────

const IMPORT_RE = /(?:import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|require\s*\(\s*["']([^"']+)["']\s*\))/g;

export function extractImports(content: string): string[] {
  const imports: string[] = [];
  let match;
  while ((match = IMPORT_RE.exec(content)) !== null) {
    const spec = match[1] || match[2] || "";
    if (spec && spec.startsWith(".")) imports.push(spec);
  }
  IMPORT_RE.lastIndex = 0;
  return [...new Set(imports)];
}

export function resolveImportPath(
  ws: Workspace,
  sourcePath: string,
  importSpec: string
): string | null {
  if (!importSpec.startsWith(".")) return null;
  const dir = sourcePath.replace(/\/?[^/]*$/, "");
  const base = dir ? `${dir}/${importSpec}` : importSpec;
  const segments = base.split("/");
  const clean = segments.reduce<string[]>((acc, s) => {
    if (s === "..") acc.pop();
    else if (s !== ".") acc.push(s);
    return acc;
  }, []);
  const normalised = clean.join("/");
  const candidates = [normalised, `${normalised}.js`, `${normalised}.ts`, `${normalised}/index.js`];
  return candidates.find(c => ws.files[c]) || null;
}

export function getDependencyGraph(ws: Workspace): Record<string, string[]> {
  const graph: Record<string, string[]> = {};
  for (const entry of Object.values(ws.files)) {
    graph[entry.path] = [];
    for (const spec of extractImports(entry.content)) {
      const resolved = resolveImportPath(ws, entry.path, spec);
      if (resolved) graph[entry.path]!.push(resolved);
    }
  }
  return graph;
}

export function getTopologicalOrder(ws: Workspace): FileEntry[] {
  const graph = getDependencyGraph(ws);
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: FileEntry[] = [];

  function visit(p: string) {
    if (visited.has(p)) return;
    if (visiting.has(p)) throw new Error(`Circular dependency detected: ${p}`);
    visiting.add(p);
    for (const dep of graph[p] || []) visit(dep);
    visiting.delete(p);
    visited.add(p);
    const f = ws.files[p];
    if (f) order.push(f);
  }

  if (ws.files[ws.entryPoint]) visit(ws.entryPoint);
  for (const f of Object.values(ws.files)) {
    if (!visited.has(f.path)) visit(f.path);
  }
  return order;
}

// ────────────────────────────────────────────────
//  CONVERSION
// ────────────────────────────────────────────────

export interface SandboxPayload {
  files: Array<{ path: string; content: string; skill?: SkillId | SkillId[] }>;
  entryPoint: string;
  dependencies: string[];
}

export function toSandboxPayload(ws: Workspace): SandboxPayload {
  return {
    files: Object.values(ws.files).map(f => ({ path: f.path, content: f.content, skill: f.skill })),
    entryPoint: ws.entryPoint,
    dependencies: ws.dependencies
  };
}

export function fromSingleFile(
  code: string,
  skill: SkillId = "threejs",
  purpose = "Main scene file"
): Workspace {
  const entryPath = "src/index.js";
  const now = new Date().toISOString();
  return {
    files: {
      [entryPath]: {
        path: entryPath,
        content: code,
        purpose,
        skill,
        generatedAt: now,
        history: []
      }
    },
    entryPoint: entryPath,
    dependencies: [],
    createdAt: now,
    updatedAt: now
  };
}

// ────────────────────────────────────────────────
//  DIFFING
// ────────────────────────────────────────────────

export function diffWorkspaces(before: Workspace, after: Workspace): FileDiff[] {
  const diffs: FileDiff[] = [];
  const allPaths = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);

  for (const path of allPaths) {
    const oldEntry = before.files[path];
    const newEntry = after.files[path];
    if (!oldEntry && newEntry) {
      diffs.push({ path, kind: "add", newContent: newEntry.content });
    } else if (oldEntry && !newEntry) {
      diffs.push({ path, kind: "remove", oldContent: oldEntry.content });
    } else if (oldEntry && newEntry && oldEntry.content !== newEntry.content) {
      diffs.push({
        path,
        kind: "modify",
        oldContent: oldEntry.content,
        newContent: newEntry.content
      });
    }
  }

  return diffs;
}

// ────────────────────────────────────────────────
//  UTILITIES
// ────────────────────────────────────────────────

export function getSourceTree(ws: Workspace): string {
  const lines: string[] = [];
  const entries = Object.values(ws.files).sort((a, b) => a.path.localeCompare(b.path));
  for (const f of entries) {
    const marker = f.path === ws.entryPoint ? " [entry]" : "";
    const skillTag = f.skill !== "threejs" ? ` (${f.skill})` : "";
    lines.push(`${f.path}${marker}${skillTag} — ${f.purpose}`);
  }
  return lines.join("\n");
}

export function totalLineCount(ws: Workspace): number {
  let count = 0;
  for (const f of Object.values(ws.files)) {
    count += f.content.split("\n").length;
  }
  return count;
}

export function isEmpty(ws: Workspace): boolean {
  return Object.keys(ws.files).length === 0;
}