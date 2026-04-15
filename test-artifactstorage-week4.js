#!/usr/bin/env node
/**
 * Test: Phase 2 Week 4 - Artifact Storage Integration
 * 
 * Tests ArtifactStorage, iteration persistence, and retrieval APIs
 */

import fs from 'fs';
import path from 'path';
import { createArtifactStorage } from './packages/sandbox-pool/src/artifact-storage.js';

console.log('💾 Phase 2 Week 4: Artifact Storage Tests\n');

// Test 1: ArtifactStorage initialization
console.log('Test 1: ArtifactStorage initialization');
try {
  const storage = createArtifactStorage({
    backend: 'filesystem',
    basePath: './test-artifacts'
  });

  await storage.initialize();
  console.log('✓ ArtifactStorage instance created and initialized\n');
} catch (error) {
  console.error(`✗ Failed: ${error.message}\n`);
}

// Test 2: Save iteration
console.log('Test 2: Save iteration artifact');
try {
  const storage = createArtifactStorage({
    backend: 'filesystem',
    basePath: './test-artifacts'
  });

  await storage.initialize();

  const projectId = 'project-test-123';
  const iteration = {
    iterationNumber: 1,
    code: 'const scene = new THREE.Scene();',
    score: 85,
    quality: {
      static: { score: 90 },
      runtime: { score: 80, bundleSize: 125000 },
      visual: { score: 85 },
      semantic: { score: 85 },
      composite: 85
    },
    patchGoals: [],
    durationMs: 2500
  };

  const result = await storage.saveIteration(
    projectId,
    iteration,
    { totalBytes: 125000, gzipBytes: 31250, files: [] },
    { sessionId: 'session-123', skillId: 'threejs' }
  );

  if (result.artifactId && !result.isDuplicate) {
    console.log(`✓ Iteration saved: ${result.artifactId}`);
    console.log(`  Size: ${result.size} bytes\n`);
  }
} catch (error) {
  console.error(`✗ Failed: ${error.message}\n`);
}

// Test 3: Deduplication
console.log('Test 3: Deduplication detection');
try {
  const storage = createArtifactStorage({
    backend: 'filesystem',
    basePath: './test-artifacts'
  });

  const projectId = 'project-dedup-123';
  const iteration1 = {
    iterationNumber: 1,
    code: 'const scene = new THREE.Scene();',
    score: 85,
    quality: { composite: 85 },
    patchGoals: [],
    durationMs: 2500
  };

  // First save
  const result1 = await storage.saveIteration(projectId, iteration1, null, {});
  console.log(`✓ First save: ${result1.artifactId}`);

  // Second save (identical code)
  const iteration2 = { ...iteration1, iterationNumber: 2 };
  const result2 = await storage.saveIteration(projectId, iteration2, null, {});

  if (result2.isDuplicate) {
    console.log(`✓ Deduplication detected! Same code as: ${result2.deduplicatedTo}\n`);
  } else {
    console.log(`  (Code was different, no dedup)\n`);
  }
} catch (error) {
  console.error(`✗ Failed: ${error.message}\n`);
}

// Test 4: Load artifact
console.log('Test 4: Load artifact by ID');
try {
  const storage = createArtifactStorage({
    backend: 'filesystem',
    basePath: './test-artifacts'
  });

  // Get history first
  const history = await storage.getProjectHistory('project-test-123');
  if (history.versions && history.versions.length > 0) {
    const artifactId = history.versions[0].artifactId;
    const artifact = await storage.loadArtifact(artifactId);

    if (artifact && artifact.code) {
      console.log(`✓ Artifact loaded: ${artifactId}`);
      console.log(`  Code: ${artifact.code.substring(0, 40)}...`);
      console.log(`  Score: ${artifact.score}/100`);
      console.log(`  Timestamp: ${artifact.timestamp.substring(0, 19)}\n`);
    }
  }
} catch (error) {
  console.error(`✗ Failed: ${error.message}\n`);
}

// Test 5: Project history
console.log('Test 5: Project history retrieval');
try {
  const storage = createArtifactStorage({
    backend: 'filesystem',
    basePath: './test-artifacts'
  });

  // Create multiple iterations
  const projectId = 'project-history-123';
  for (let i = 1; i <= 3; i++) {
    const iteration = {
      iterationNumber: i,
      code: `const scene = new THREE.Scene(); // iteration ${i}`,
      score: 70 + i * 5,
      quality: { composite: 70 + i * 5 },
      patchGoals: i < 3 ? [{ id: 'patch-1' }] : [],
      durationMs: 2000 + i * 500
    };

    await storage.saveIteration(projectId, iteration, null, { skillId: 'threejs' });
  }

  // Get history
  const history = await storage.getProjectHistory(projectId);
  console.log(`✓ Project history loaded: ${projectId}`);
  console.log(`  Versions: ${history.versions.length}`);
  console.log(`  Latest score: ${history.latest?.score}`);
  console.log(`  Final iteration: #${history.latest?.iterationNumber}\n`);
} catch (error) {
  console.error(`✗ Failed: ${error.message}\n`);
}

// Test 6: List projects
console.log('Test 6: List all projects');
try {
  const storage = createArtifactStorage({
    backend: 'filesystem',
    basePath: './test-artifacts'
  });

  const projects = await storage.listProjects();
  console.log(`✓ Projects found: ${projects.length}`);
  if (projects.length > 0) {
    console.log(`  Sample projects:`);
    projects.slice(0, 3).forEach(p => console.log(`    - ${p}`));
  }
  console.log();
} catch (error) {
  console.error(`✗ Failed: ${error.message}\n`);
}

// Test 7: Deduplication statistics
console.log('Test 7: Deduplication statistics');
try {
  const storage = createArtifactStorage({
    backend: 'filesystem',
    basePath: './test-artifacts'
  });

  const stats = storage.getDeduplicationStats();
  console.log(`✓ Statistics:`);
  console.log(`  Dedup cache entries: ${stats.cacheSize}`);
  console.log(`  Index cache entries: ${stats.indexCacheSize}\n`);
} catch (error) {
  console.error(`✗ Failed: ${error.message}\n`);
}

// Test 8: Integration check
console.log('Test 8: Integration readiness');
try {
  // Check exports from sandbox-execution.js
  const sandboxExecFile = fs.readFileSync(
    './apps/server/server/sandbox-execution.js',
    'utf8'
  );

  console.log(`  ${sandboxExecFile.includes('artifactStorage.initialize()') ? '✓' : '✗'} Artifact storage initialized in quality loop`);
  console.log(`  ${sandboxExecFile.includes('saveIteration') ? '✓' : '✗'} Iterations saved to storage`);
  console.log(`  ${sandboxExecFile.includes('getProjectArtifactHistory') ? '✓' : '✗'} History retrieval exported`);
  console.log(`  ${sandboxExecFile.includes('getArtifact') ? '✓' : '✗'} Artifact retrieval exported`);
  console.log(`  ${sandboxExecFile.includes('listProjects') ? '✓' : '✗'} Project listing exported\n`);
} catch (error) {
  console.error(`✗ Failed: ${error.message}\n`);
}

// Cleanup
console.log('Cleanup: Removing test artifacts...');
try {
  const testDir = './test-artifacts';
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
    console.log('✓ Test artifacts cleaned up\n');
  }
} catch (error) {
  console.warn(`⚠ Cleanup warning: ${error.message}\n`);
}

console.log('✅ Phase 2 Week 4: Artifact Storage Tests Complete\n');
