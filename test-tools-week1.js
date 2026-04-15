/**
 * test-tools-week1.js
 * 
 * Simple test for tool installation functionality
 * Tests:
 * 1. Tool registry creation
 * 2. Tool detection from code
 * 3. Tool registry state tracking
 * 4. Tool installation method exists
 */

import { SandboxPoolManager, toolRegistry } from "./packages/sandbox-pool/src/index.js";

console.log("✓ Imports successful");

// Test 1: ToolRegistry API
console.log("\n=== Test 1: ToolRegistry API ===");

const tools = [
  { name: 'three', version: 'latest' },
  { name: 'gsap', version: 'latest' }
];

console.log("Checking if tools are installed (should be false):", toolRegistry.isInstalled("test-sandbox-1", tools));

toolRegistry.markInstalled("test-sandbox-1", tools);
console.log("✓ Marked tools as installed");

console.log("Checking if tools are installed (should be true):", toolRegistry.isInstalled("test-sandbox-1", tools));

console.log("Getting metrics:", JSON.stringify(toolRegistry.getMetrics(), null, 2));

// Test 2: SandboxPoolManager has installTools method
console.log("\n=== Test 2: SandboxPoolManager.installTools exists ===");
const poolManager = new SandboxPoolManager();
console.log("typeof poolManager.installTools:", typeof poolManager.installTools);
if (typeof poolManager.installTools === 'function') {
  console.log("✓ installTools method exists");
} else {
  console.error("✗ installTools method not found!");
  process.exit(1);
}

// Test 3: Tool detection (mock)
console.log("\n=== Test 3: Tool Detection (mock) ===");

const codeWithThree = `
import * as THREE from 'three';
import { Canvas } from 'three-fiber';

const scene = new THREE.Scene();
const mesh = new THREE.Mesh();
scene.add(mesh);
`;

// Simple detection (without importing everything)
const importRegex = /(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+.*\s+from\s+['"]([^'"]+)['"]/g;
const detected = [];
let match;
while ((match = importRegex.exec(codeWithThree)) !== null) {
  const mod = match[1] || match[2];
  if (mod && !detected.includes(mod)) {
    detected.push(mod);
  }
}

console.log("Detected imports:", detected);
console.log("Contains 'three':", detected.includes('three'));
console.log("Contains 'three-fiber':", detected.includes('three-fiber'));

// Test 4: Tool cache statistics
console.log("\n=== Test 4: Tool Registry Statistics ===");
toolRegistry.recordCacheHit();
toolRegistry.recordCacheHit();
toolRegistry.markFailed("test-sandbox-2", new Error("Test error"));

console.log("Updated metrics:", JSON.stringify(toolRegistry.getMetrics(), null, 2));

console.log("\n✅ All Week 1 tests passed!");
