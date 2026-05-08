/**
 * Adapter Factory — Maps skill runtime adapter names to SkillAdapter instances.
 */

import { PythonManimAdapter } from "./python-manim-adapter.js";
import type { SkillAdapter } from "./types.js";

const adapterRegistry = new Map<string, SkillAdapter>([
  ["python-manim", new PythonManimAdapter()]
]);

export function getAdapter(adapterName: string): SkillAdapter {
  const adapter = adapterRegistry.get(adapterName);
  if (!adapter) {
    throw new Error(`[AdapterFactory] Unknown adapter "${adapterName}". ` +
      `JS skills are rendered client-side and do not use backend adapters.`);
  }
  return adapter;
}

export function registerAdapter(name: string, adapter: SkillAdapter): void {
  adapterRegistry.set(name, adapter);
}

export * from "./types.js";
export { PythonManimAdapter };
