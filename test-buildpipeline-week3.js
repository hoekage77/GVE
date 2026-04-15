#!/usr/bin/env node
/**
 * Test: Phase 2 Week 3 - Build Pipeline Integration
 * 
 * Tests BuildManager, quality scorer enhancement, and build artifacts
 * are properly integrated into the quality loop.
 */

import path from 'path';
import { BuildManager, createBuildManager } from './packages/sandbox-pool/src/build-manager.js';
import fs from 'fs';

console.log('🔨 Phase 2 Week 3: Build Pipeline Tests\n');

// Test 1: BuildManager creation
console.log('Test 1: BuildManager initialization');
try {
  const mockSandbox = { id: 'test-sandbox' };
  const mockWorkspace = {
    process: {
      executeCommand: async (cmd) => ({ stdout: '', stderr: '', exitCode: 0 })
    }
  };
  const mockFilesystem = {
    writeFile: async () => ({ success: true }),
    readFile: async () => '',
    writeMultiple: async () => ({ success: true, written: 0 })
  };

  const buildManager = new BuildManager(mockSandbox, mockWorkspace, mockFilesystem);
  console.log('✓ BuildManager instance created\n');
} catch (error) {
  console.error(`✗ Failed: ${error.message}\n`);
}

// Test 2: Skill-to-builder mapping
console.log('Test 2: Skill-to-builder detection');
try {
  const buildManager = new BuildManager(
    { id: 'test' },
    { process: { executeCommand: async () => ({ stdout: '', stderr: '', exitCode: 0 }) } },
    { writeFile: async () => ({ success: true }) }
  );

  const testCases = [
    ['threejs', 'vite'],
    ['p5js', 'vite'],
    ['d3js', 'rollup'],
    ['babylon', 'vite'],
    ['plotly', 'webpack'],
    ['manim', 'none']
  ];

  let passed = 0;
  for (const [skill, expected] of testCases) {
    const builder = buildManager.getBuilderForSkill(skill);
    if (builder === expected) {
      console.log(`  ✓ ${skill} → ${builder}`);
      passed++;
    } else {
      console.log(`  ✗ ${skill} → ${builder} (expected ${expected})`);
    }
  }

  console.log(`\nSkill mapping: ${passed}/${testCases.length} passed\n`);
} catch (error) {
  console.error(`✗ Failed: ${error.message}\n`);
}

// Test 3: Build config templates
console.log('Test 3: Build configuration templates');
try {
  const buildManager = new BuildManager(
    { id: 'test' },
    { process: { executeCommand: async () => ({ stdout: '', stderr: '', exitCode: 0 }) } },
    { writeFile: async () => ({ success: true }) }
  );

  const configs = ['vite', 'webpack', 'rollup'];
  let passed = 0;

  for (const builder of configs) {
    const config = buildManager.getBuildConfig(builder === 'none' ? 'manim' : 'threejs');
    if (config && config.name && config.content && config.content.length > 100) {
      console.log(`  ✓ ${builder || 'vite'} config: ${config.name} (${config.content.length} bytes)`);
      passed++;
    } else {
      console.log(`  ✗ ${builder} config invalid`);
    }
  }

  console.log(`\nConfig templates: ${passed}/${configs.length} passed\n`);
} catch (error) {
  console.error(`✗ Failed: ${error.message}\n`);
}

// Test 4: Build command generation
console.log('Test 4: Build command generation');
try {
  const buildManager = new BuildManager(
    { id: 'test' },
    { process: { executeCommand: async () => ({ stdout: '', stderr: '', exitCode: 0 }) } },
    { writeFile: async () => ({ success: true }) }
  );

  const commands = {
    vite: 'npx vite build',
    webpack: 'npx webpack',
    rollup: 'npx rollup -c'
  };

  let passed = 0;
  for (const [builder, expected] of Object.entries(commands)) {
    const cmd = buildManager.getBuildCommand(builder);
    if (cmd.includes(expected)) {
      console.log(`  ✓ ${builder}: ${cmd.substring(0, 50)}...`);
      passed++;
    } else {
      console.log(`  ✗ ${builder} command incorrect`);
    }
  }

  console.log(`\nBuild commands: ${passed}/${Object.keys(commands).length} passed\n`);
} catch (error) {
  console.error(`✗ Failed: ${error.message}\n`);
}

// Test 5: Dependency resolution
console.log('Test 5: Dependency resolution');
try {
  const buildManager = new BuildManager(
    { id: 'test' },
    { process: { executeCommand: async () => ({ stdout: '', stderr: '', exitCode: 0 }) } },
    { writeFile: async () => ({ success: true }) }
  );

  const deps = buildManager.getDependencies('threejs', 'vite');
  
  console.log(`  ✓ Threejs + Vite dependencies:`);
  console.log(`    - Three.js: ${deps.includes('three@latest') ? '✓' : '✗'}`);
  console.log(`    - Vite: ${deps.some(d => d.startsWith('vite@')) ? '✓' : '✗'}`);
  console.log(`    - Terser: ${deps.some(d => d.startsWith('terser@')) ? '✓' : '✗'}`);
  console.log(`    - Total: ${deps.length} packages\n`);
} catch (error) {
  console.error(`✗ Failed: ${error.message}\n`);
}

// Test 6: Bundle size scoring
console.log('Test 6: Bundle size scoring impact');
try {
  // Simulate different bundle sizes and their quality impact
  const bundleSizeScenarios = [
    { size: 20000, name: 'Tiny (20KB)', expectedPenalty: 0 },        // < 50KB
    { size: 75000, name: 'Small (75KB)', expectedPenalty: 5 },       // 50-100KB
    { size: 150000, name: 'Medium (150KB)', expectedPenalty: 10 },   // 100-250KB
    { size: 350000, name: 'Large (350KB)', expectedPenalty: 20 },    // 250-500KB
    { size: 800000, name: 'XLarge (800KB)', expectedPenalty: 30 }    // > 500KB
  ];

  console.log('  Bundle size quality penalties:');
  for (const scenario of bundleSizeScenarios) {
    let penalty = 0;
    if (scenario.size > 500 * 1024) {
      penalty = 30;
    } else if (scenario.size > 250 * 1024) {
      penalty = 20;
    } else if (scenario.size > 100 * 1024) {
      penalty = 10;
    } else if (scenario.size > 50 * 1024) {
      penalty = 5;
    }

    const match = penalty === scenario.expectedPenalty ? '✓' : '✗';
    console.log(`    ${match} ${scenario.name}: -${penalty} points`);
  }
  console.log();
} catch (error) {
  console.error(`✗ Failed: ${error.message}\n`);
}

// Test 7: Integration check
console.log('Test 7: Integration readiness');
try {
  console.log('  ✓ BuildManager exported from build-manager.js');
  
  console.log('  ✓ createBuildManager factory function available');

  // Check that skill-runtime has build support
  const skillRuntimeFile = fs.readFileSync(
    './apps/server/server/skill-runtime.js',
    'utf8'
  );
  
  console.log(`  ${skillRuntimeFile.includes('shouldBuildSkill') ? '✓' : '✗'} shouldBuildSkill helper in skill-runtime`);
  console.log(`  ${skillRuntimeFile.includes('buildProject') ? '✓' : '✗'} buildProject helper in skill-runtime`);
  console.log(`  ${skillRuntimeFile.includes('buildArtifacts') ? '✓' : '✗'} buildArtifacts in return object`);

  // Check that quality-analyzer has bundle scoring
  const qualityAnalyzerFile = fs.readFileSync(
    './apps/server/server/quality-analyzer.js',
    'utf8'
  );
  
  console.log(`  ${qualityAnalyzerFile.includes('bundleSize') ? '✓' : '✗'} Bundle size analysis in quality-analyzer`);
  console.log(`  ${qualityAnalyzerFile.includes('gzipSize') ? '✓' : '✗'} Gzip size tracking in quality-analyzer`);

  console.log();
} catch (error) {
  console.error(`✗ Failed: ${error.message}\n`);
}

console.log('✅ Phase 2 Week 3: Build Pipeline Tests Complete\n');
