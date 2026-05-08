/**
 * Tool Registry — Static tool imports with auto-discovery metadata.
 *
 * Eagerly imports all tool classes to avoid dynamic import resolution issues.
 * Tools self-declare schemas via decorators on class methods.
 */

import { Tool } from "./Tool.js";
import type { ToolCategory, ToolResult } from "./types.js";

/* ── Static tool imports ── */
import { MessageTool } from "./core/message-tool.js";
import { TerminatingTool } from "./core/terminating-tool.js";
import { WebSearchTool } from "./web-search-tool.js";
import { BrowserTool } from "./browser-tool.js";
import { SandboxFilesTool } from "./sandbox-files-tool.js";
import { SandboxShellTool } from "./sandbox-shell-tool.js";
import { Animation3jsTool } from "./animation-3js-tool.js";
import { AnimationP5jsTool } from "./animation-p5js-tool.js";
import { AnimationManimTool } from "./animation-manim-tool.js";

interface ToolEntry {
  name: string;
  category: ToolCategory;
  classRef: new () => Tool;
  instance?: Tool;
}

const TOOLS: ToolEntry[] = [
  { name: "message", category: "core", classRef: MessageTool },
  { name: "terminating", category: "core", classRef: TerminatingTool },
  { name: "web_search", category: "search", classRef: WebSearchTool },
  { name: "browser", category: "search", classRef: BrowserTool },
  { name: "sandbox_files", category: "sandbox", classRef: SandboxFilesTool },
  { name: "sandbox_shell", category: "sandbox", classRef: SandboxShellTool },
  { name: "animation_3js", category: "animation", classRef: Animation3jsTool },
  { name: "animation_p5js", category: "animation", classRef: AnimationP5jsTool },
  { name: "animation_manim", category: "animation", classRef: AnimationManimTool },
];

/** Tool names that, when successfully executed, end the coordinator loop. */
export const TERMINATING_TOOLS = new Set(["terminating_ask", "terminating_complete", "ask", "complete"]);

const instanceCache = new Map<string, Tool>();

let schemaCache: Array<{
  name: string;
  category: ToolCategory;
  openaiSchema: Record<string, unknown>;
}> | null = null;

/* ── Public API ── */

export function getAllRegistrations() {
  return TOOLS.map((t) => ({
    name: t.name,
    category: t.category,
    className: t.classRef.name,
  }));
}

export function getRegistrationsByCategory(category: ToolCategory) {
  return TOOLS.filter((t) => t.category === category).map((t) => ({
    name: t.name,
    category: t.category,
    className: t.classRef.name,
  }));
}

export function getRegistration(name: string) {
  const entry = TOOLS.find((t) => t.name === name);
  if (!entry) return undefined;
  return {
    name: entry.name,
    category: entry.category,
    className: entry.classRef.name,
  };
}

export function getTool(name: string): Tool | null {
  if (instanceCache.has(name)) {
    return instanceCache.get(name)!;
  }

  const entry = TOOLS.find((t) => t.name === name);
  if (!entry) return null;

  try {
    const instance = new entry.classRef();
    instanceCache.set(name, instance);
    return instance;
  } catch (err: any) {
    console.warn(`[Registry] Failed to instantiate tool ${name}: ${err.message}`);
    return null;
  }
}

export function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> | null {
  // Try exact tool match first
  let tool = getTool(name);
  let targetMethod: string | null = null;

  if (!tool) {
    // Try qualified name: "toolName_methodName"
    for (const entry of TOOLS) {
      const prefix = entry.name + "_";
      if (name.startsWith(prefix)) {
        const methodName = name.slice(prefix.length);
        tool = getTool(entry.name);
        if (tool) {
          const schemas = tool.getSchemas();
          if (schemas.has(methodName)) {
            targetMethod = methodName;
            break;
          }
        }
      }
    }
  }

  if (!tool) {
    return Promise.resolve({ success: false, output: `Tool "${name}" not found` });
  }

  const schemas = tool.getSchemas();
  const methods = tool.getMethodMetadata();
  const methodNames = Array.from(schemas.keys());

  if (methodNames.length === 0) {
    return Promise.resolve({ success: false, output: `Tool "${name}" has no callable methods` });
  }

  if (!targetMethod) {
    targetMethod =
      typeof args._method === "string" && methods.has(args._method)
        ? args._method
        : (methodNames[0] as string);
  }

  if (!targetMethod) {
    return Promise.resolve({ success: false, output: `Tool "${name}" has no callable methods` });
  }

  const method = (tool as any)[targetMethod];
  if (typeof method !== "function") {
    return Promise.resolve({ success: false, output: `Method "${targetMethod}" not found on tool "${name}"` });
  }

  return Promise.resolve(method.call(tool, args)).catch((err: any) => ({
    success: false,
    output: `Execution error: ${err.message}`,
  }));
}

/**
 * Build OpenAI-compatible function schemas for all registered tools.
 */
export function buildFunctionSchemas(): Record<string, Record<string, unknown>> {
  if (schemaCache) {
    return Object.fromEntries(schemaCache.map((c) => [c.name, c.openaiSchema]));
  }

  const schemas: Record<string, Record<string, unknown>> = {};
  schemaCache = [];

  for (const entry of TOOLS) {
    try {
      const tool = getTool(entry.name);
      if (!tool) continue;

      const toolSchemas = tool.getSchemas();
      for (const [methodName, methodSchemas] of toolSchemas.entries()) {
        for (const schema of methodSchemas) {
          if (schema.schema_type === "openapi" && schema.schema.type === "function") {
            const fnSchema = { ...(schema.schema.function ?? {}) } as Record<string, unknown>;
            const key =
              toolSchemas.size === 1 ? entry.name : `${entry.name}_${methodName}`;
            // Set the function name to the fully qualified key so the LLM
            // calls us back with an unambiguous identifier.
            fnSchema.name = key;
            schemas[key] = fnSchema;
            schemaCache.push({ name: key, category: entry.category, openaiSchema: fnSchema });
          }
        }
      }
    } catch (err: any) {
      console.warn(`[Registry] Schema extraction failed for ${entry.name}: ${err.message}`);
    }
  }

  return schemas;
}

/**
 * Return a JSON-serializable summary of all tools.
 */
export function getToolsSummary(): Array<{
  name: string;
  category: ToolCategory;
  display_name: string;
  description: string;
  methods: Array<{
    name: string;
    display_name: string;
    description: string;
  }>;
}> {
  const summaries = [];

  for (const entry of TOOLS) {
    try {
      const tool = getTool(entry.name);
      if (!tool) continue;

      const meta = tool.getMetadata();
      const methods = tool.getMethodMetadata();

      summaries.push({
        name: entry.name,
        category: entry.category,
        display_name: meta?.display_name ?? entry.classRef.name,
        description: meta?.description ?? "",
        methods: Array.from(methods.entries()).map(([name, m]) => ({
          name,
          display_name: m.display_name ?? name,
          description: m.description ?? "",
        })),
      });
    } catch {
      // skip
    }
  }

  return summaries;
}

/**
 * Warm up the registry by pre-instantiating all tools.
 */
export function warmUpRegistry(): void {
  console.log("[Registry] Warming up tool cache...");
  const start = Date.now();

  for (const entry of TOOLS) {
    try {
      getTool(entry.name);
    } catch (err: any) {
      console.warn(`[Registry] Warm-up failed for ${entry.name}: ${err.message}`);
    }
  }

  // Precompute schemas
  buildFunctionSchemas();

  console.log(
    `[Registry] Warm-up complete in ${Date.now() - start}ms (${instanceCache.size} tools)`
  );
}
