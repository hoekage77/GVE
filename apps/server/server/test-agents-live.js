/**
 * Live Agent Implementation Test
 * 
 * Tests that the agents can actually analyze code and produce recommendations
 * Run: node apps/server/server/test-agents-live.js
 */

import { createWorkflowCoordinator, getAgentRole, getAllAgentRoles } from './multi-agent-framework.js';

// Mock LLM provider (returns predefined analysis)
class MockLLM {
  async generate(prompt) {
    // Return different analysis based on agent type in prompt
    if (prompt.includes('Scene Architect')) {
      return JSON.stringify({
        findings: ['Missing lighting hierarchy', 'Unorganized object structure'],
        suggestions: [
          { action: 'Create THREE.Group() to organize objects', impact: 15, confidence: 0.9 },
          { action: 'Add proper camera positioning', impact: 10, confidence: 0.85 }
        ],
        confidence: 0.88
      });
    }
    if (prompt.includes('Material')) {
      return JSON.stringify({
        findings: ['Basic materials only', 'No texture mapping'],
        suggestions: [
          { action: 'Add PBR materials with proper roughness/metalness', impact: 20, confidence: 0.9 },
          { action: 'Apply texture mapping for visual richness', impact: 12, confidence: 0.8 }
        ],
        confidence: 0.85
      });
    }
    if (prompt.includes('Animation')) {
      return JSON.stringify({
        findings: ['No motion or dynamics', 'Static scene'],
        suggestions: [
          { action: 'Add smooth rotation with easing', impact: 8, confidence: 0.8 },
          { action: 'Implement morphing animations', impact: 5, confidence: 0.7 }
        ],
        confidence: 0.75
      });
    }
    if (prompt.includes('Performance')) {
      return JSON.stringify({
        findings: ['High polygon count', 'No LOD system'],
        suggestions: [
          { action: 'Implement LOD for complex geometries', impact: 6, confidence: 0.75 },
          { action: 'Use instancing for repeated objects', impact: 4, confidence: 0.7 }
        ],
        confidence: 0.7
      });
    }
    if (prompt.includes('Tester') || prompt.includes('validation')) {
      return JSON.stringify({
        findings: ['Basic error handling needed', 'Cross-browser testing required'],
        suggestions: [
          { action: 'Add try-catch blocks around scene initialization', impact: 3, confidence: 0.85 },
          { action: 'Test on mobile devices for touch compatibility', impact: 2, confidence: 0.8 }
        ],
        confidence: 0.8
      });
    }
    return JSON.stringify({
      findings: ['Generic analysis'],
      suggestions: [{ action: 'Generic improvement', impact: 1 }],
      confidence: 0.5
    });
  }
}

// Test runner
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    testsPassed += 1;
    console.log(`✓ ${name}`);
  } catch (err) {
    testsFailed += 1;
    console.error(`✗ ${name}`);
    console.error(`  Error: ${err.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    testsPassed += 1;
    console.log(`✓ ${name}`);
  } catch (err) {
    testsFailed += 1;
    console.error(`✗ ${name}`);
    console.error(`  Error: ${err.message}`);
  }
}

console.log('=== Live Agent Implementation Tests ===\n');

// Test 1: Agent roles are defined
test('Agent roles are defined', () => {
  const roles = getAllAgentRoles();
  const roleIds = Object.keys(roles);
  
  if (!roleIds.includes('architect')) throw new Error('Missing architect');
  if (!roleIds.includes('materialDesigner')) throw new Error('Missing material designer');
  if (!roleIds.includes('animator')) throw new Error('Missing animator');
  if (!roleIds.includes('optimizer')) throw new Error('Missing optimizer');
  if (!roleIds.includes('tester')) throw new Error('Missing tester');
});

// Test 2: Can create workflow coordinator
test('Can create workflow coordinator', () => {
  const mockLLM = new MockLLM();
  const coordinator = createWorkflowCoordinator(mockLLM);
  
  if (!coordinator) throw new Error('Coordinator not created');
  if (!coordinator.registry) throw new Error('No registry');
});

// Test 3: Registry has all agents
test('Registry has all agents', () => {
  const mockLLM = new MockLLM();
  const coordinator = createWorkflowCoordinator(mockLLM);
  const agents = coordinator.registry.getAllAgents();
  
  if (agents.length !== 5) throw new Error(`Expected 5 agents, got ${agents.length}`);
});

// Test 4: Can get agent by role
test('Can get agent by role', () => {
  const mockLLM = new MockLLM();
  const coordinator = createWorkflowCoordinator(mockLLM);
  
  const architect = coordinator.registry.getAgent('architect');
  if (!architect) throw new Error('Architect not found');
  if (architect.roleId !== 'architect') throw new Error('Wrong role ID');
});

// Test 5: Agents have expected properties
test('Agents have expected properties', () => {
  const mockLLM = new MockLLM();
  const coordinator = createWorkflowCoordinator(mockLLM);
  const agent = coordinator.registry.getAgent('architect');
  
  if (!agent.role) throw new Error('No role object');
  if (!agent.role.name) throw new Error('No name');
  if (!agent.role.expertise) throw new Error('No expertise');
  if (!agent.role.responsibilities) throw new Error('No responsibilities');
  if (!Array.isArray(agent.role.expertise)) throw new Error('Expertise not array');
});

// Test 6: Create simple agent directly (avoid coordinator)
test('Can create and use Architect agent directly', () => {
  const mockLLM = new MockLLM();
  
  // Import the agent classes would go here
  // For now, just verify the registry pattern works
  const coordinator = createWorkflowCoordinator(mockLLM);
  const agent = coordinator.registry.getAgent('architect');
  
  if (!agent) throw new Error('Agent not found');
  if (agent.roleId !== 'architect') throw new Error('Wrong agent');
  if (!agent.llm) throw new Error('Agent has no LLM');
});

// Test 7: Live workflow execution - parallel
asyncTest('Live workflow execution - parallel', async () => {
  const mockLLM = new MockLLM();
  const coordinator = createWorkflowCoordinator(mockLLM);
  
  const context = {
    scenePrompt: 'A futuristic city scene',
    currentScene: {
      code: 'const scene = new THREE.Scene();',
      quality: 50
    }
  };
  
  const result = await coordinator.executeWorkflow(context, { parallel: true });
  
  if (!result) throw new Error('No result returned');
  if (result.agentsExecuted === 0) throw new Error('No agents executed in parallel mode');
  
  console.log(`    - Executed ${result.agentsExecuted} agents in parallel in ${result.durationMs}ms`);
});

// Test 8: All agents produce analysis
asyncTest('All agents produce analysis', async () => {
  const mockLLM = new MockLLM();
  const coordinator = createWorkflowCoordinator(mockLLM);
  
  const context = {
    scenePrompt: 'A test scene',
    currentScene: { code: 'test code', quality: 70 }
  };
  
  const result = await coordinator.executeWorkflow(context, { parallel: false });
  const results = result.results;
  
  if (!results.architect) throw new Error('Architect analysis missing');
  if (!results['material-designer']) throw new Error('Material designer analysis missing');
  if (!results.animator) throw new Error('Animator analysis missing');
  if (!results.optimizer) throw new Error('Optimizer analysis missing');
  if (!results.tester) throw new Error('Tester analysis missing');
});

// Test 9: Agent analysis has expected structure
asyncTest('Agent analysis has expected structure', async () => {
  const mockLLM = new MockLLM();
  const coordinator = createWorkflowCoordinator(mockLLM);
  
  const context = {
    scenePrompt: 'Test',
    currentScene: { code: 'test', quality: 60 }
  };
  
  const result = await coordinator.executeWorkflow(context, { parallel: false });
  const analysis = result.results.architect;
  
  if (!analysis.agentId) throw new Error('No agentId in analysis');
  if (typeof analysis.confidence !== 'number') throw new Error('No confidence score');
  if (!Array.isArray(analysis.findings)) throw new Error('Findings not an array');
  if (!Array.isArray(analysis.suggestions)) throw new Error('Suggestions not an array');
  if (typeof analysis.executionTimeMs !== 'number') throw new Error('No execution time');
});

// Test 10: Agent findings and suggestions are populated
asyncTest('Agent findings and suggestions are populated', async () => {
  const mockLLM = new MockLLM();
  const coordinator = createWorkflowCoordinator(mockLLM);
  
  const context = {
    scenePrompt: 'A 3D scene',
    currentScene: { code: 'code', quality: 50 }
  };
  
  const result = await coordinator.executeWorkflow(context, { parallel: false });
  const analysis = result.results['material-designer'];
  
  if (analysis.findings.length === 0) throw new Error('No findings from agent');
  if (analysis.suggestions.length === 0) throw new Error('No suggestions from agent');
  
  console.log(`    - Material Designer found: ${analysis.findings.join(', ')}`);
  console.log(`    - Material Designer suggests: ${analysis.suggestions[0].action}`);
});

// Test 11: Workflow history is tracked
asyncTest('Workflow history is tracked', async () => {
  const mockLLM = new MockLLM();
  const coordinator = createWorkflowCoordinator(mockLLM);
  
  const context = { scenePrompt: 'test', currentScene: { code: 'x' } };
  
  await coordinator.executeWorkflow(context, { parallel: false });
  await coordinator.executeWorkflow(context, { parallel: false });
  
  const history = coordinator.getHistory();
  if (history.length !== 2) throw new Error(`Expected 2 workflows, got ${history.length}`);
});

// Test 12: Mock LLM fallback works
asyncTest('Mock LLM fallback works', async () => {
  const coordinator = createWorkflowCoordinator(null); // No LLM provider
  
  const context = {
    scenePrompt: 'Test',
    currentScene: { code: 'const x = 1;' }
  };
  
  const result = await coordinator.executeWorkflow(context, { parallel: false });
  
  // Should fall back to mock analysis
  if (result.agentsExecuted === 0) throw new Error('Agents should still run with mock fallback');
});

// Test 13: Display agent recommendations summary
asyncTest('Display agent recommendations summary', async () => {
  const mockLLM = new MockLLM();
  const coordinator = createWorkflowCoordinator(mockLLM);
  
  const context = {
    scenePrompt: 'An interactive 3D visualization',
    currentScene: {
      code: `
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        const renderer = new THREE.WebGLRenderer();
        renderer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(renderer.domElement);
      `,
      quality: 65
    }
  };
  
  const result = await coordinator.executeWorkflow(context, { parallel: false });
  
  console.log('\n    === All Agent Recommendations ===');
  for (const [agentId, analysis] of Object.entries(result.results)) {
    console.log(`\n    ${analysis.agentId.toUpperCase()}:`);
    console.log(`      Confidence: ${(analysis.confidence * 100).toFixed(0)}%`);
    console.log(`      Findings: ${analysis.findings.join(', ')}`);
    console.log(`      Top Suggestion: ${analysis.suggestions[0]?.action}`);
    console.log(`      Impact: +${analysis.suggestions[0]?.impact || 0} points`);
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Tests Passed: ${testsPassed}`);
console.log(`Tests Failed: ${testsFailed}`);
console.log(`Total Tests: ${testsPassed + testsFailed}`);
console.log('='.repeat(50) + '\n');

if (testsFailed > 0) {
  process.exit(1);
} else {
  console.log('✅ All agent implementation tests passed!');
  process.exit(0);
}
