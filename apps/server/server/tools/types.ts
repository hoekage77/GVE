/**
 * Core types for the agent tool system.
 * Ported from Kortix (terranet) architecture.
 */

export interface ToolSchema {
  schema_type: "openapi";
  schema: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  output: string;
}

export interface ToolMetadata {
  display_name: string;
  description: string;
  icon?: string;
  color?: string;
  is_core?: boolean;
  weight?: number;
  visible?: boolean;
  usage_guide?: string;
}

export interface MethodMetadata {
  display_name: string;
  description: string;
  is_core?: boolean;
  visible?: boolean;
}

export interface DiscoveredTool {
  name: string;
  className: string;
  modulePath: string;
  metadata: ToolMetadata | null;
  methods: Array<{
    name: string;
    metadata: MethodMetadata | null;
    schemas: ToolSchema[];
  }>;
}

export type ToolCategory =
  | "core"
  | "sandbox"
  | "search"
  | "utility"
  | "animation";

export interface ToolRegistration {
  category: ToolCategory;
  name: string;
  modulePath: string;
  className: string;
}
