/**
 * Tool metadata decorators — pragmatic TypeScript version.
 *
 * Instead of relying on experimental decorator metadata APIs,
 * we attach metadata directly to class constructors and method functions.
 * The registry introspects these at runtime.
 */

import type { ToolMetadata, MethodMetadata, ToolSchema } from "./types.js";

/* ── Symbol keys for metadata (collision-free) ── */

export const TOOL_METADATA_KEY = Symbol.for("vr.tool_metadata");
export const METHOD_METADATA_KEY = Symbol.for("vr.method_metadata");
export const TOOL_SCHEMAS_KEY = Symbol.for("vr.tool_schemas");

/* ── Class-level metadata ── */

export function toolMetadata(
  display_name: string,
  description: string,
  options: Partial<Omit<ToolMetadata, "display_name" | "description">> = {}
) {
  return function (target: any, _context?: any) {
    const metadata: ToolMetadata = {
      display_name,
      description,
      ...options,
    };

    // Attach to constructor so it's visible on the class
    target[TOOL_METADATA_KEY] = metadata;

    return target;
  };
}

/* ── Method-level metadata ── */

export function methodMetadata(
  display_name: string,
  description: string,
  options: Partial<Omit<MethodMetadata, "display_name" | "description">> = {}
) {
  return function (target: any, _context?: any) {
    const metadata: MethodMetadata = {
      display_name,
      description,
      ...options,
    };

    target[METHOD_METADATA_KEY] = metadata;

    return target;
  };
}

/* ── OpenAPI schema attachment ── */

export function openapiSchema(schema: Record<string, unknown>) {
  return function (target: any, _context?: any) {
    const toolSchema: ToolSchema = {
      schema_type: "openapi",
      schema,
    };

    const existing: ToolSchema[] = target[TOOL_SCHEMAS_KEY] ?? [];
    existing.push(toolSchema);
    target[TOOL_SCHEMAS_KEY] = existing;

    return target;
  };
}

/* ── Runtime metadata getters ── */

export function getToolMetadata(target: any): ToolMetadata | null {
  if (target[TOOL_METADATA_KEY]) {
    return target[TOOL_METADATA_KEY] as ToolMetadata;
  }
  if (target.prototype?.constructor?.[TOOL_METADATA_KEY]) {
    return target.prototype.constructor[TOOL_METADATA_KEY] as ToolMetadata;
  }
  return null;
}

export function getMethodMetadata(target: any, methodName: string): MethodMetadata | null {
  const proto = target.prototype || target;
  const descriptor = Object.getOwnPropertyDescriptor(proto, methodName);
  if (!descriptor) return null;

  const fn = descriptor.value;
  if (!fn) return null;

  return fn[METHOD_METADATA_KEY] ?? null;
}

export function getMethodSchemas(target: any, methodName: string): ToolSchema[] {
  const proto = target.prototype || target;
  const descriptor = Object.getOwnPropertyDescriptor(proto, methodName);
  if (!descriptor) return [];

  const fn = descriptor.value;
  if (!fn) return [];

  return fn[TOOL_SCHEMAS_KEY] ?? [];
}

export function getAllMethodNames(target: any): string[] {
  const proto = target.prototype || target;
  const methods: string[] = [];

  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === "constructor") continue;
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (descriptor && typeof descriptor.value === "function") {
      methods.push(key);
    }
  }

  return methods;
}
