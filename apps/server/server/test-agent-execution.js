/**
 * Real Agent Execution Test
 * Verifies that actual agents can analyze code
 *
 * Run: node apps/server/server/test-agent-execution.js
 */

import assert from 'assert';
import { createWorkflowCoordinator } from './multi-agent-framework.js';

// Mock LLM provider for testing
const mockLLM = {
  generate: async (prompt) => {
    // Simulate LLM response with JSON
    return JSON.stringify({
      findings: ['Issue found'],
      suggestions: [{ action: 'Example fix', impact: 10, code_snippet: 'code here' }],
      confidence: 0.8
    });
  }
};

async function runTests() {
  let passed = 0;
  let failed = 0;

  const test = async (name, fn) => {
    try {
      await fn();
      passed += 1;
      console.log(`✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`✗ ${name}`);
      console.error(`  ${err.message}`);
    }
  };

  console.log('\n=== Agent Execution Tests ===\n');

  // Test 1: Coordinator creation
  await test('Coordinator creates all agents', () => {
    const coordinator = createWorkflowCoordinator(mockLLM);
    assert.ok(coordinator);
    assert.strictEqual(coordinator.registry.agents.size, 5);
  });

  // Test 2: Get individual agents
  await test('Get architect agent', () => {
    const coordinator = createWorkflowCoordinator(mockLLM);
    const architect = coordinator.registry.getAgent('architect');
    assert.ok(architect);
    assert.strictEqual(architect.roleId, 'architect');
  });

  // Test 3: Agent has analyze method
  await test('Agents have analyze method', () => {
    const coordinator = createWorkflowCoordinator(mockLLM);
    const architect = coordinator.registry.getAgent('architect');
    assert.strictEqual(typeof architect.analyze, 'function');
  });

  // Test 4: Execute single agent
  await test('Single agent can execute', async () => {
    const coordinator = createWorkflowCoordinator(mockLLM);
    const architect = coordinator.registry.getAgent('architect');
    
    const analysis = await architect.analyze({
      scenePrompt: 'A test scene',
      currentScene: { code: 'const x = 1;', quality: 50 }
    });

    assert.ok(analysis);
    assert.strictEqual(analysis.agentId, 'architect');
    assert.ok(Array.isArray(analysis.findings));
    assert.ok(analysis.confidence > 0);
  });

  // Test 5: All agents execute
  await test('All agents can execute', async () => {
    const coordinator = createWorkflowCoordinator(mockLLM);
    const agents = coordinator.registry.getAllAgents();

    for (const agent of agents) {
      const analysis = await agent.analyze({
        scenePrompt: 'Test scene',
        currentScene: { code: 'test', quality: 60 }
      });

      assert.ok(analysis);
      assert.ok(analysis.agentId);
      assert.ok(analysis.confidence >= 0 && analysis.confidence <= 1);
    }
  });

  // Test 6: Workflow execution
  await test('Execute full workflow sequentially', async () => {
    const coordinator = createWorkflowCoordinator(mockLLM);
    
    const result = await coordinator.executeWorkflow({
      scenePrompt: 'A glowing sphere',
      currentScene: { code: 'const sphere = new THREE.Sphere();', quality: 65 }
    }, {
      parallel: false
    });

    assert.ok(result);
    assert.strictEqual(result.agentsExecuted, 5);
    assert.ok(result.durationMs > 0);
    assert.ok(result.results);
  });

  // Test 7: Agent stats tracking
  await test('Agent tracks execution stats', async () => {
    const coordinator = createWorkflowCoordinator(mockLLM);
    const architect = coordinator.registry.getAgent('architect');

    // Execute 3 times
    for (let i = 0; i < 3; i++) {
      await architect.analyze({
        scenePrompt: 'Test',
        currentScene: { code: 'test', quality: 50 }
      });
    }

    const stats = architect.getStats();
    assert.strictEqual(stats.totalExecutions, 3);
    assert.ok(stats.totalTimeMs >= 0); // Can be 0 for very fast tests
  });

  // Test 8: Parallel execution
  await test('Execute full workflow in parallel', async () => {
    const coordinator = createWorkflowCoordinator(mockLLM);
    
    const result = await coordinator.executeWorkflow({
      scenePrompt: 'Complex scene',
      currentScene: { code: 'const scene = new THREE.Scene();', quality: 70 }
    }, {
      parallel: true
    });

    assert.ok(result);
    assert.strictEqual(result.agentsExecuted, 5);
    assert.ok(result.durationMs > 0);
  });

  // Test 9: Agent mock fallback
  await test('Agents fall back to mock when LLM unavailable', async () => {
    const coordinator = createWorkflowCoordinator(null); // No LLM
    const architect = coordinator.registry.getAgent('architect');
    
    const analysis = await architect.analyze({
      scenePrompt: 'Test',
      currentScene: { code: 'test', quality: 50 }
    });

    assert.ok(analysis);
    assert.ok(analysis.findings.length > 0);
  });

  // Test 10: Workflow history
  await test('Workflow history tracking', async () => {
    const coordinator = createWorkflowCoordinator(mockLLM);
    
    assert.strictEqual(coordinator.getHistory().length, 0);
    
    await coordinator.executeWorkflow({
      scenePrompt: 'Test 1',
      currentScene: { code: 'test', quality: 50 }
    });
    
    assert.strictEqual(coordinator.getHistory().length, 1);
    
    await coordinator.executeWorkflow({
      scenePrompt: 'Test 2',
      currentScene: { code: 'test', quality: 60 }
    });
    
    assert.strictEqual(coordinator.getHistory().length, 2);
  });

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Tests Passed: ${passed}`);
  console.log(`Tests Failed: ${failed}`);
  console.log(`Total Tests: ${passed + failed}`);
  console.log('='.repeat(50) + '\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('✅ All agent execution tests passed!');
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
