/**
 * Base Tool class for all agent tools.
 *
 * All tools inherit from this class. It provides:
 * - Schema registration and introspection
 * - Metadata access
 * - Result helpers (successResponse, failResponse)
 */

import {
  getToolMetadata,
  getMethodMetadata,
  getMethodSchemas,
  getAllMethodNames,
} from "./decorators.js";
import type { ToolMetadata, MethodMetadata, ToolSchema, ToolResult } from "./types.js";

export abstract class Tool {
  private _schemas: Map<string, ToolSchema[]> = new Map();
  private _metadata: ToolMetadata | null = null;
  private _methodMetadata: Map<string, MethodMetadata> = new Map();

  constructor() {
    this._registerMetadata();
    this._registerSchemas();
  }

  private _registerMetadata(): void {
    // Class-level metadata
    const ctor = this.constructor as any;
    this._metadata = getToolMetadata(ctor);

    // Method-level metadata
    const methodNames = getAllMethodNames(ctor);
    for (const name of methodNames) {
      const meta = getMethodMetadata(ctor, name);
      if (meta) {
        this._methodMetadata.set(name, meta);
      }
    }
  }

  private _registerSchemas(): void {
    const ctor = this.constructor as any;
    const methodNames = getAllMethodNames(ctor);

    for (const name of methodNames) {
      const schemas = getMethodSchemas(ctor, name);
      if (schemas.length > 0) {
        this._schemas.set(name, schemas);
      }
    }
  }

  /** Get all registered schemas mapped by method name. */
  getSchemas(): Map<string, ToolSchema[]> {
    return new Map(this._schemas);
  }

  /** Get tool-level metadata. */
  getMetadata(): ToolMetadata | null {
    return this._metadata;
  }

  /** Get metadata for all methods. */
  getMethodMetadata(): Map<string, MethodMetadata> {
    return new Map(this._methodMetadata);
  }

  /** Create a successful tool result. */
  successResponse(data: Record<string, unknown> | string | unknown[]): ToolResult {
    let output: string;
    if (typeof data === "string") {
      output = data;
    } else {
      output = JSON.stringify(data);
    }
    return { success: true, output };
  }

  /** Create a failed tool result. */
  failResponse(msg: string): ToolResult {
    return { success: false, output: msg };
  }

  /** Convenience: get the tool's display name. */
  getDisplayName(): string {
    return this._metadata?.display_name ?? this.constructor.name;
  }

  /** Convenience: get the tool's description. */
  getDescription(): string {
    return this._metadata?.description ?? "";
  }

  /** Return a plain object summary for the LLM / frontend. */
  toJSON(): {
    name: string;
    display_name: string;
    description: string;
    metadata: ToolMetadata | null;
    methods: Array<{
      name: string;
      metadata: MethodMetadata | null;
      schemas: ToolSchema[];
    }>;
  } {
    const ctor = this.constructor as any;
    const methodNames = getAllMethodNames(ctor);

    const methods = methodNames.map((name) => ({
      name,
      metadata: this._methodMetadata.get(name) ?? null,
      schemas: this._schemas.get(name) ?? [],
    }));

    return {
      name: ctor.name,
      display_name: this.getDisplayName(),
      description: this.getDescription(),
      metadata: this._metadata,
      methods,
    };
  }
}
