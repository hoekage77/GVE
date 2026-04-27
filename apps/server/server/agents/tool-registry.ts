/**
 * Tool Registry - Manages dynamic tool installation in sandboxes
 *
 * This module provides a registry of available tools/packages that can be
 * dynamically installed in Linux sandbox environments. It handles version
 * resolution, dependency management, and installation orchestration.
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface ToolMetadata {
  name: string;
  category: string;
  description: string;
  npmPackage: string;
  defaultVersion: string;
  versions: string[];
  dependencies: string[];
  peerDependencies?: string[];
  extras?: Record<string, string>;
  installTime: "fast" | "medium" | "slow";
  size: "small" | "medium" | "large";
}

// Tool registry with metadata
const TOOL_REGISTRY: Record<string, ToolMetadata> = {
  // 3D Libraries
  three: {
    name: "three",
    category: "3d",
    description: "Three.js - JavaScript 3D library",
    npmPackage: "three",
    defaultVersion: "^0.160.0",
    versions: ["0.160.0", "0.159.0", "0.158.0", "0.128.0"],
    dependencies: [],
    extras: {
      addons: "three-addons",
      examples: "three/examples"
    },
    installTime: "medium",
    size: "medium"
  },

  // React Three Fiber
  "@react-three/fiber": {
    name: "@react-three/fiber",
    category: "3d",
    description: "React renderer for Three.js",
    npmPackage: "@react-three/fiber",
    defaultVersion: "^8.15.0",
    versions: ["8.15.0", "8.14.0", "8.13.0"],
    dependencies: ["three"],
    peerDependencies: ["react", "react-dom"],
    installTime: "medium",
    size: "medium"
  },

  "@react-three/drei": {
    name: "@react-three/drei",
    category: "3d",
    description: "Useful helpers for React Three Fiber",
    npmPackage: "@react-three/drei",
    defaultVersion: "^9.92.0",
    versions: ["9.92.0", "9.88.0", "9.80.0"],
    dependencies: ["three", "@react-three/fiber"],
    peerDependencies: ["react", "react-dom"],
    installTime: "slow",
    size: "large"
  },

  // Creative Coding
  p5: {
    name: "p5",
    category: "creative",
    description: "p5.js - Creative coding library",
    npmPackage: "p5",
    defaultVersion: "^1.9.0",
    versions: ["1.9.0", "1.8.0", "1.7.0", "1.6.0"],
    dependencies: [],
    installTime: "fast",
    size: "small"
  },

  // Data Visualization
  d3: {
    name: "d3",
    category: "data-viz",
    description: "D3.js - Data visualization library",
    npmPackage: "d3",
    defaultVersion: "^7.8.5",
    versions: ["7.8.5", "7.8.0", "7.7.0"],
    dependencies: [],
    installTime: "medium",
    size: "medium"
  },

  // Animation
  animejs: {
    name: "animejs",
    category: "animation",
    description: "Anime.js - Lightweight animation library",
    npmPackage: "animejs",
    defaultVersion: "^3.2.2",
    versions: ["3.2.2", "3.2.1", "3.2.0"],
    dependencies: [],
    installTime: "fast",
    size: "small"
  },

  gsap: {
    name: "gsap",
    category: "animation",
    description: "GSAP - Professional-grade animation",
    npmPackage: "gsap",
    defaultVersion: "^3.12.0",
    versions: ["3.12.5", "3.12.0", "3.11.0"],
    dependencies: [],
    installTime: "medium",
    size: "medium"
  },

  // Build Tools
  vite: {
    name: "vite",
    category: "build-tool",
    description: "Vite - Next generation frontend tooling",
    npmPackage: "vite",
    defaultVersion: "^5.0.0",
    versions: ["5.0.12", "5.0.0", "4.5.0"],
    dependencies: [],
    installTime: "slow",
    size: "large"
  },

  rollup: {
    name: "rollup",
    category: "build-tool",
    description: "Rollup - JavaScript module bundler",
    npmPackage: "rollup",
    defaultVersion: "^4.9.0",
    versions: ["4.9.6", "4.9.0", "4.6.0"],
    dependencies: [],
    installTime: "medium",
    size: "medium"
  },

  // Post-processing & Effects
  "postprocessing": {
    name: "postprocessing",
    category: "effects",
    description: "Post Processing - Visual effects for Three.js",
    npmPackage: "postprocessing",
    defaultVersion: "^6.33.0",
    versions: ["6.33.0", "6.32.0", "6.30.0"],
    dependencies: ["three"],
    installTime: "medium",
    size: "medium"
  },

  // Physics
  "cannon-es": {
    name: "cannon-es",
    category: "physics",
    description: "Cannon-es - Physics engine",
    npmPackage: "cannon-es",
    defaultVersion: "^0.20.0",
    versions: ["0.20.0", "0.19.0"],
    dependencies: [],
    installTime: "medium",
    size: "medium"
  },

  "@react-three/cannon": {
    name: "@react-three/cannon",
    category: "physics",
    description: "Physics hooks for React Three Fiber",
    npmPackage: "@react-three/cannon",
    defaultVersion: "^6.6.0",
    versions: ["6.6.0", "6.5.0"],
    dependencies: ["three", "@react-three/fiber", "cannon-es"],
    installTime: "slow",
    size: "large"
  },

  // Shaders
  "three-custom-shader-material": {
    name: "three-custom-shader-material",
    category: "shaders",
    description: "Custom shader material for Three.js",
    npmPackage: "three-custom-shader-material",
    defaultVersion: "^5.4.0",
    versions: ["5.4.0", "5.3.0"],
    dependencies: ["three"],
    installTime: "medium",
    size: "small"
  },

  // Utilities
  "lodash-es": {
    name: "lodash-es",
    category: "utility",
    description: "Lodash ES modules",
    npmPackage: "lodash-es",
    defaultVersion: "^4.17.21",
    versions: ["4.17.21"],
    dependencies: [],
    installTime: "fast",
    size: "medium"
  },

  "uuid": {
    name: "uuid",
    category: "utility",
    description: "UUID generation",
    npmPackage: "uuid",
    defaultVersion: "^9.0.0",
    versions: ["9.0.1", "9.0.0", "8.3.2"],
    dependencies: [],
    installTime: "fast",
    size: "small"
  }
};

const INSTALL_TIME_ESTIMATES: Record<string, number> = {
  fast: 5000,
  medium: 15000,
  slow: 45000
};

export function getTool(toolName: string): ToolMetadata | null {
  return TOOL_REGISTRY[toolName] || null;
}

export function getAllTools(): Record<string, ToolMetadata> {
  return { ...TOOL_REGISTRY };
}

export function getToolsByCategory(category: string): ToolMetadata[] {
  return Object.values(TOOL_REGISTRY).filter(tool => tool.category === category);
}

export function getCategories(): string[] {
  const categories = new Set(Object.values(TOOL_REGISTRY).map(t => t.category));
  return [...categories];
}

export function resolveDependencies(requestedTools: string[]): string[] {
  if (!requestedTools) return [];
  const resolved = new Set<string>();
  const visiting = new Set<string>();

  function visit(toolName: string) {
    if (resolved.has(toolName)) return;
    if (visiting.has(toolName)) {
      throw new Error(`Circular dependency detected: ${toolName}`);
    }

    visiting.add(toolName);

    const tool = TOOL_REGISTRY[toolName];
    if (tool) {
      for (const dep of tool.dependencies || []) {
        visit(dep);
      }
      resolved.add(toolName);
    }

    visiting.delete(toolName);
  }

  for (const tool of requestedTools) {
    visit(tool);
  }

  return [...resolved];
}

export async function installToolsInSandbox(
  containerId: string,
  tools: string[],
  options: { version?: string } = {}
): Promise<{ success: boolean; installed: string[]; failed: string[]; durationMs: number }> {
  const startTime = Date.now();
  const installed: string[] = [];
  const failed: string[] = [];

  const toolsToInstall = resolveDependencies(tools);

  for (const toolName of toolsToInstall) {
    const tool = TOOL_REGISTRY[toolName];
    if (!tool) {
      failed.push(`${toolName} (not in registry)`);
      continue;
    }

    try {
      const version = options.version || tool.defaultVersion;
      const packageSpec = `${tool.npmPackage}@${version}`;

      await execAsync(`docker exec ${containerId} npm install ${packageSpec} --save`, {
        timeout: 120000
      });

      installed.push(toolName);
    } catch (error: any) {
      failed.push(`${toolName}: ${error.message}`);
    }
  }

  return {
    success: failed.length === 0,
    installed,
    failed,
    durationMs: Date.now() - startTime
  };
}

export function getInstallTimeEstimate(tools: string[]): number {
  const toolsToInstall = resolveDependencies(tools);

  let totalTime = 0;
  for (const toolName of toolsToInstall) {
    const tool = TOOL_REGISTRY[toolName];
    if (tool) {
      totalTime += INSTALL_TIME_ESTIMATES[tool.installTime] || 10000;
    }
  }

  return totalTime;
}

export function getSizeEstimate(tools: string[]): "small" | "medium" | "large" {
  const toolsToInstall = resolveDependencies(tools);

  let totalSize = 0;
  for (const toolName of toolsToInstall) {
    const tool = TOOL_REGISTRY[toolName];
    if (tool) {
      const sizeValue = tool.size === "small" ? 1 : tool.size === "medium" ? 2 : 3;
      totalSize += sizeValue;
    }
  }

  if (totalSize <= 3) return "small";
  if (totalSize <= 6) return "medium";
  return "large";
}

export function validateToolCombination(tools: string[]): { valid: boolean; conflicts: string[] } {
  const conflicts: string[] = [];
  const versionConstraints: Record<string, string[]> = {};
  const toolsToInstall = resolveDependencies(tools);

  for (const toolName of toolsToInstall) {
    const tool = TOOL_REGISTRY[toolName];
    if (!tool) continue;

    for (const dep of tool.dependencies || []) {
      if (!versionConstraints[dep]) {
        versionConstraints[dep] = [];
      }
      versionConstraints[dep].push(toolName);
    }
  }

  const depCount = Object.keys(versionConstraints).length;
  if (depCount > 10) {
    conflicts.push(`Large dependency tree (${depCount} packages) may slow installation`);
  }

  return {
    valid: conflicts.length === 0,
    conflicts
  };
}

export function generatePackageJson(tools: string[], basePackage: any = {}): any {
  const toolsToInstall = resolveDependencies(tools);
  const dependencies: Record<string, string> = {};

  for (const toolName of toolsToInstall) {
    const tool = TOOL_REGISTRY[toolName];
    if (tool) {
      dependencies[tool.npmPackage] = tool.defaultVersion;
    }
  }

  return {
    name: basePackage.name || "terranet-scene",
    version: basePackage.version || "1.0.0",
    type: "module",
    dependencies: {
      ...basePackage.dependencies,
      ...dependencies
    },
    scripts: basePackage.scripts || {
      start: "node index.js",
      build: "vite build",
      preview: "vite preview"
    }
  };
}

export function getRecommendedTools(skill: string): string[] {
  const recommendations: Record<string, string[]> = {
    threejs: ["three", "postprocessing"],
    "threejs-advanced": ["three", "@react-three/fiber", "@react-three/drei", "postprocessing"],
    "threejs-physics": ["three", "@react-three/fiber", "cannon-es", "@react-three/cannon"],
    p5js: ["p5"],
    d3js: ["d3"],
    animejs: ["animejs", "gsap"],
    default: []
  };

  return recommendations[skill] ?? recommendations.default ?? [];
}

export function searchTools(query: string): ToolMetadata[] {
  const queryLower = query.toLowerCase();
  return Object.values(TOOL_REGISTRY).filter((tool) => {
    return (
      tool.name.toLowerCase().includes(queryLower) ||
      tool.description.toLowerCase().includes(queryLower) ||
      tool.category.toLowerCase().includes(queryLower)
    );
  });
}

export function isToolAvailable(toolName: string): boolean {
  return toolName in TOOL_REGISTRY;
}

export async function getToolStatus(
  containerId: string,
  toolName: string
): Promise<{ installed: boolean; version?: string }> {
  const tool = TOOL_REGISTRY[toolName];
  if (!tool) {
    return { installed: false };
  }

  try {
    const { stdout } = await execAsync(`docker exec ${containerId} npm list ${tool.npmPackage} --json`, {
      timeout: 10000
    });

    const pkgInfo = JSON.parse(stdout);
    const installed = pkgInfo.dependencies && pkgInfo.dependencies[tool.npmPackage];

    return {
      installed: !!installed,
      version: installed?.version
    };
  } catch {
    return { installed: false };
  }
}

export function formatToolList(tools: string[]): Array<{ name: string; description: string; category: string }> {
  return tools.map((toolName) => {
    const tool = TOOL_REGISTRY[toolName];
    if (!tool) {
      return { name: toolName, description: "Unknown tool", category: "unknown" };
    }
    return {
      name: tool.name,
      description: tool.description,
      category: tool.category
    };
  });
}

export function getRegistryStats(): { total: number; byCategory: Record<string, number>; totalSize: string } {
  const tools = Object.values(TOOL_REGISTRY);
  const byCategory: Record<string, number> = {};

  for (const tool of tools) {
    byCategory[tool.category] = (byCategory[tool.category] || 0) + 1;
  }

  let sizeValue = 0;
  for (const tool of tools) {
    sizeValue += tool.size === "small" ? 1 : tool.size === "medium" ? 2 : 3;
  }

  const totalSize = sizeValue <= 10 ? "small" : sizeValue <= 30 ? "medium" : "large";

  return {
    total: tools.length,
    byCategory,
    totalSize
  };
}
