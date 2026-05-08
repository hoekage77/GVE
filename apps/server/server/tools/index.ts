/**
 * Tool System — Main entry point.
 *
 * Re-exports all tool system modules.
 * Use `warmUpRegistry()` at startup to pre-load tools.
 */

export { Tool } from "./Tool.js";
export { toolMetadata, methodMetadata, openapiSchema } from "./decorators.js";
export type { ToolMetadata, MethodMetadata, ToolSchema, ToolResult, ToolCategory } from "./types.js";

export {
  getAllRegistrations,
  getRegistrationsByCategory,
  getRegistration,
  getTool,
  executeTool,
  buildFunctionSchemas,
  getToolsSummary,
  warmUpRegistry,
} from "./registry.js";
