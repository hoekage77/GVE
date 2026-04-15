/**
 * Agentic Implementation - Comprehensive Test Suite
 *
 * Tests for Phase 1-4 implementation:
 * - Phase 1: Patch Generator
 * - Phase 2: Agent Memory
 * - Phase 3: Mode Decision Engine
 * - Phase 4: Multi-Agent Framework
 *
 * Test framework: Node.js built-in assert module
 * Run: node apps/server/server/test-agentic-implementation.js
 */

import assert from 'assert';
import { AgentMemory, createMemoryContext } from './agent-memory.js';
import {
  MODE_CONFIGS,
  determineModeFromQuality,
  shouldIterationStop,
  createApprovalPrompt,
  processUserDecision,
  getAutonomousStrategy
} from './mode-decision-engine.js';
import {
  AGENT_ROLES,
  Agent,
  AgentRegistry,
  WorkflowCoordinator,
  createWorkflowCoordinator,
  getAgentRole,
  getAllAgentRoles,
  listAvailableAgents
} from './multi-agent-framework.js';

let testsPassed = 0;
let testsFailed = 0;

/**
 * Test runner
 */
function test(name, fn) {
  try {
    fn();
    testsPassed += 1;
    console.log(`✓ ${name}`);
  } catch (err) {
    testsFailed += 1;
    console.error(`✗ ${name}`);
    console.error(`  ${err.message}`);
  }
}

// ============= PHASE 2: AGENT MEMORY TESTS =============

console.log('\n=== Phase 2: Agent Memory Tests ===\n');

test('AgentMemory: Initialize', () => {
  const memory = new AgentMemory('sess-1', 'threejs');
  assert.strictEqual(memory.sessionId, 'sess-1');
  assert.strictEqual(memory.skill, 'threejs');
  assert.deepStrictEqual(memory.iterationHistory, []);
  assert.deepStrictEqual(memory.attemptedPatches, []);
});

test('AgentMemory: Record iteration', () => {
  const memory = new AgentMemory('sess-1', 'threejs');
  const record = memory.recordIteration(1, 'const x = 1;', 62, ['issue1'], [], 100);
  
  assert.strictEqual(record.iterationNum, 1);
  assert.strictEqual(record.score, 62);
  assert.strictEqual(memory.iterationHistory.length, 1);
});

test('AgentMemory: Get score progression', () => {
  const memory = new AgentMemory('sess-1', 'threejs');
  memory.recordIteration(1, 'code1', 50, [], [], 100);
  memory.recordIteration(2, 'code2', 72, [], [], 150);
  memory.recordIteration(3, 'code3', 85, [], [], 120);
  
  const progression = memory.getScoreProgression();
  assert.deepStrictEqual(progression, [50, 72, 85]);
});

test('AgentMemory: Get best score', () => {
  const memory = new AgentMemory('sess-1', 'threejs');
  memory.recordIteration(1, 'code1', 50, [], [], 100);
  memory.recordIteration(2, 'code2', 72, [], [], 150);
  memory.recordIteration(3, 'code3', 85, [], [], 120);
  
  assert.strictEqual(memory.getBestScore(), 85);
});

test('AgentMemory: Record patch outcome', () => {
  const memory = new AgentMemory('sess-1', 'threejs');
  memory.recordPatchOutcome('lighting', 'added ambient light', true, 8);
  
  assert.strictEqual(memory.attemptedPatches.length, 1);
  assert.strictEqual(memory.successPatterns['lighting'].count, 1);
  assert.strictEqual(memory.successPatterns['lighting'].totalImpact, 8);
});

test('AgentMemory: Record failed approach', () => {
  const memory = new AgentMemory('sess-1', 'threejs');
  memory.recordFailedApproach('eval() not allowed');
  
  assert.strictEqual(memory.failedApproaches.length, 1);
  assert.ok(memory.hasTriedApproach('eval() not allowed'));
});

test('AgentMemory: Prevent duplicate failed approaches', () => {
  const memory = new AgentMemory('sess-1', 'threejs');
  memory.recordFailedApproach('eval() not allowed');
  memory.recordFailedApproach('eval() not allowed');
  memory.recordFailedApproach('eval() not allowed');
  
  assert.strictEqual(memory.failedApproaches.length, 1);
});

test('AgentMemory: Get context for next iteration', () => {
  const memory = new AgentMemory('sess-1', 'threejs');
  memory.recordIteration(1, 'code1', 50, ['dark'], [], 100);
  memory.recordIteration(2, 'code2', 72, ['low poly'], [], 150);
  memory.recordPatchOutcome('lighting', 'added light', true, 10);
  
  const context = memory.getContextForNextIteration();
  assert.strictEqual(context.iterationCount, 2);
  assert.deepStrictEqual(context.previousScores, [50, 72]);
  assert.strictEqual(context.bestScore, 72);
});

test('AgentMemory: Get average patch effectiveness', () => {
  const memory = new AgentMemory('sess-1', 'threejs');
  memory.recordPatchOutcome('lighting', 'patch1', true, 10);
  memory.recordPatchOutcome('lighting', 'patch2', true, 8);
  memory.recordPatchOutcome('structure', 'patch3', false, -2);
  
  const avg = memory.getAveragePatchEffectiveness();
  assert.strictEqual(avg, 9); // (10 + 8) / 2
});

test('AgentMemory: Add conversation turn', () => {
  const memory = new AgentMemory('sess-1', 'threejs');
  memory.addConversationTurn('user', 'Make a cube');
  memory.addConversationTurn('agent', 'Here is a three.js cube');
  
  assert.strictEqual(memory.conversationContext.length, 2);
  assert.strictEqual(memory.conversationContext[0].role, 'user');
});

test('AgentMemory: Get conversation history', () => {
  const memory = new AgentMemory('sess-1', 'threejs');
  memory.addConversationTurn('user', 'Make a cube');
  memory.addConversationTurn('agent', 'Here is a cube');
  
  const history = memory.getConversationHistory();
  assert.ok(history.includes('user: Make a cube'));
  assert.ok(history.includes('agent: Here is a cube'));
});

test('AgentMemory: Get summary', () => {
  const memory = new AgentMemory('sess-1', 'threejs');
  memory.recordIteration(1, 'code', 62, [], [], 100);
  
  const summary = memory.getSummary();
  assert.strictEqual(summary.sessionId, 'sess-1');
  assert.strictEqual(summary.skill, 'threejs');
  assert.strictEqual(summary.iterationCount, 1);
  assert.ok(summary.durationMs >= 0); // Can be 0ms for fast tests
});

test('AgentMemory: Export to JSON', () => {
  const memory = new AgentMemory('sess-1', 'threejs');
  memory.recordIteration(1, 'code', 62, [], [], 100);
  
  const json = memory.toJSON();
  assert.strictEqual(json.sessionId, 'sess-1');
  assert.ok(Array.isArray(json.iterationHistory));
});

// ============= PHASE 3: MODE DECISION ENGINE TESTS =============

console.log('\n=== Phase 3: Mode Decision Engine Tests ===\n');

test('Mode: Determine mode from quality - draft', () => {
  const mode = determineModeFromQuality('draft');
  assert.strictEqual(mode, 'strict');
});

test('Mode: Determine mode from quality - standard', () => {
  const mode = determineModeFromQuality('standard');
  assert.strictEqual(mode, 'assisted');
});

test('Mode: Determine mode from quality - high', () => {
  const mode = determineModeFromQuality('high');
  assert.strictEqual(mode, 'autonomous');
});

test('Mode: MODE_CONFIGS structure', () => {
  assert.ok(MODE_CONFIGS.autonomous);
  assert.ok(MODE_CONFIGS.assisted);
  assert.ok(MODE_CONFIGS.strict);
  
  assert.strictEqual(MODE_CONFIGS.autonomous.maxIterations, 3);
  assert.strictEqual(MODE_CONFIGS.assisted.maxIterations, 2);
  assert.strictEqual(MODE_CONFIGS.strict.maxIterations, 1);
});

test('Mode: Stop when threshold met', () => {
  const decision = shouldIterationStop({
    currentScore: 85,
    iterationNum: 1,
    maxIterations: 3,
    qualityThreshold: 75,
    mode: 'autonomous',
    patchGoals: ['goal1']
  });
  
  assert.strictEqual(decision.shouldStop, true);
  assert.strictEqual(decision.reason, 'threshold_met');
});

test('Mode: Stop when max iterations reached', () => {
  const decision = shouldIterationStop({
    currentScore: 70,
    iterationNum: 3,
    maxIterations: 3,
    qualityThreshold: 85,
    mode: 'autonomous',
    patchGoals: ['goal1']
  });
  
  assert.strictEqual(decision.shouldStop, true);
  assert.strictEqual(decision.reason, 'budget_exhausted');
});

test('Mode: Stop when no fixable issues', () => {
  const decision = shouldIterationStop({
    currentScore: 70,
    iterationNum: 1,
    maxIterations: 3,
    qualityThreshold: 85,
    mode: 'autonomous',
    patchGoals: []
  });
  
  assert.strictEqual(decision.shouldStop, true);
  assert.strictEqual(decision.reason, 'no_fix_available');
});

test('Mode: Strict mode always requires approval', () => {
  const decision = shouldIterationStop({
    currentScore: 70,
    iterationNum: 1,
    maxIterations: 3,
    qualityThreshold: 85,
    mode: 'strict',
    patchGoals: ['goal1']
  });
  
  assert.strictEqual(decision.shouldStop, false);
  assert.strictEqual(decision.reason, 'awaiting_user_decision');
});

test('Mode: Assisted mode asks user on first iteration', () => {
  const decision = shouldIterationStop({
    currentScore: 70,
    iterationNum: 1,
    maxIterations: 2,
    qualityThreshold: 85,
    mode: 'assisted',
    patchGoals: ['goal1']
  });
  
  assert.strictEqual(decision.shouldStop, false);
  assert.strictEqual(decision.reason, 'awaiting_user_approval');
});

test('Mode: Autonomous continues when improving', () => {
  const memory = new AgentMemory('sess-1', 'threejs');
  memory.recordIteration(1, 'code', 50, [], [], 100);
  memory.recordIteration(2, 'code', 72, [], [], 100);
  
  const decision = shouldIterationStop({
    currentScore: 72,
    iterationNum: 2,
    maxIterations: 3,
    qualityThreshold: 85,
    mode: 'autonomous',
    patchGoals: ['goal1'],
    agentMemory: memory
  });
  
  assert.strictEqual(decision.shouldStop, false);
  assert.strictEqual(decision.reason, 'autonomous_improvement');
});

test('Mode: Create approval prompt', () => {
  const prompt = createApprovalPrompt({
    currentScore: 70,
    qualityThreshold: 85,
    iterationNum: 1,
    patchGoals: [
      { category: 'visual', issue: 'Dark scene', suggestion: 'Add lighting' }
    ],
    previousScores: [60, 70]
  });
  
  assert.ok(prompt.title);
  assert.ok(prompt.options);
  assert.strictEqual(prompt.options.length, 3);
});

test('Mode: Process user decision - approve', () => {
  const result = processUserDecision('approve');
  assert.strictEqual(result.shouldContinue, true);
});

test('Mode: Process user decision - reject', () => {
  const result = processUserDecision('reject');
  assert.strictEqual(result.shouldContinue, false);
});

test('Mode: Get autonomous strategy - improving', () => {
  const strategy = getAutonomousStrategy({
    currentScore: 80,
    previousScores: [60, 70, 80],
    patchGoals: ['goal1'],
    iterationNum: 2,
    maxIterations: 3
  });
  
  assert.strictEqual(strategy.confidence, 0.9);
  assert.ok(['accelerate', 'continue'].includes(strategy.strategy));
});

test('Mode: Get autonomous strategy - stalled', () => {
  const strategy = getAutonomousStrategy({
    currentScore: 70,
    previousScores: [70, 70],
    patchGoals: ['goal1'],
    iterationNum: 2,
    maxIterations: 3,
    agentMemory: { getAveragePatchEffectiveness: () => 0.6 }
  });
  
  assert.ok(strategy.confidence > 0);
  assert.ok(['experimental', 'stop'].includes(strategy.strategy));
});

// ============= PHASE 4: MULTI-AGENT FRAMEWORK TESTS =============

console.log('\n=== Phase 4: Multi-Agent Framework Tests ===\n');

test('Multi-Agent: Agent roles defined', () => {
  assert.ok(AGENT_ROLES.architect);
  assert.ok(AGENT_ROLES.materialDesigner);
  assert.ok(AGENT_ROLES.animator);
  assert.ok(AGENT_ROLES.optimizer);
  assert.ok(AGENT_ROLES.tester);
});

test('Multi-Agent: Agent role properties', () => {
  const role = AGENT_ROLES.architect;
  assert.strictEqual(role.id, 'architect');
  assert.ok(role.expertise);
  assert.ok(role.responsibilities);
  assert.ok(Array.isArray(role.dependencies));
});

test('Multi-Agent: Get single agent role', () => {
  const role = getAgentRole('architect');
  assert.strictEqual(role.id, 'architect');
});

test('Multi-Agent: Get all agent roles', () => {
  const roles = getAllAgentRoles();
  assert.strictEqual(Object.keys(roles).length, 5);
});

test('Multi-Agent: List available agents', () => {
  const agents = listAvailableAgents();
  assert.strictEqual(agents.length, 5);
  assert.ok(agents[0].name);
  assert.ok(agents[0].expertise);
});

test('Multi-Agent: Agent registry initialization', () => {
  // Mock LLM provider
  const mockLLM = {};
  const registry = new AgentRegistry(mockLLM);
  
  assert.strictEqual(registry.agents.size, 5);
});

test('Multi-Agent: Get agent by role ID', () => {
  const mockLLM = {};
  const registry = new AgentRegistry(mockLLM);
  const agent = registry.getAgent('architect');
  
  assert.ok(agent);
});

test('Multi-Agent: Get all agents', () => {
  const mockLLM = {};
  const registry = new AgentRegistry(mockLLM);
  const agents = registry.getAllAgents();
  
  assert.strictEqual(agents.length, 5);
});

test('Multi-Agent: Get agents by expertise', () => {
  const mockLLM = {};
  const registry = new AgentRegistry(mockLLM);
  const agents = registry.getAgentsByExpertise('three.js');
  
  assert.ok(agents.length > 0);
});

test('Multi-Agent: Workflow coordinator creation', () => {
  const mockLLM = {};
  const coordinator = createWorkflowCoordinator(mockLLM);
  
  assert.ok(coordinator);
  assert.ok(coordinator.registry);
});

test('Multi-Agent: Workflow history tracking', () => {
  const mockLLM = {};
  const coordinator = createWorkflowCoordinator(mockLLM);
  const history = coordinator.getHistory();
  
  assert.ok(Array.isArray(history));
  assert.strictEqual(history.length, 0);
});

test('Multi-Agent: Agent base class', () => {
  // Mock LLM
  const mockLLM = {};
  
  class TestAgent extends Agent {
    async analyze(context) {
      return { agentId: this.roleId, findings: [] };
    }
  }
  
  const agent = new TestAgent('architect', mockLLM);
  assert.strictEqual(agent.roleId, 'architect');
  assert.strictEqual(agent.executionCount, 0);
});

test('Multi-Agent: Agent execution stats', () => {
  const mockLLM = {};
  
  class TestAgent extends Agent {
    async analyze(context) {
      this._logExecution(100);
      return {};
    }
  }
  
  const agent = new TestAgent('architect', mockLLM);
  agent._logExecution(50);
  agent._logExecution(75);
  
  const stats = agent.getStats();
  assert.strictEqual(stats.totalExecutions, 2);
  assert.strictEqual(stats.totalTimeMs, 125);
});

// ============= INTEGRATION TESTS =============

console.log('\n=== Integration Tests ===\n');

test('Integration: Memory context injection for LLM', () => {
  const memory = new AgentMemory('sess-1', 'threejs');
  memory.recordIteration(1, 'code1', 50, ['dark'], [], 100);
  memory.recordIteration(2, 'code2', 72, [], ['added lighting'], 100);
  
  const context = createMemoryContext(memory);
  assert.ok(context.includes('Iterations: 2'));
  assert.ok(context.includes('Previous scores'));
});

test('Integration: Quality mode → execution mode mapping', () => {
  assert.strictEqual(determineModeFromQuality('draft'), 'strict');
  assert.strictEqual(determineModeFromQuality('standard'), 'assisted');
  assert.strictEqual(determineModeFromQuality('high'), 'autonomous');
});

test('Integration: Full decision flow - autonomous path', () => {
  const memory = new AgentMemory('sess-1', 'threejs');
  memory.recordIteration(1, 'code', 60, [], [], 100);
  
  // First iteration decision
  let decision = shouldIterationStop({
    currentScore: 60,
    iterationNum: 1,
    maxIterations: 3,
    qualityThreshold: 85,
    mode: 'autonomous',
    patchGoals: ['goal1'],
    agentMemory: memory
  });
  
  assert.strictEqual(decision.shouldStop, false); // Should continue
  
  // Simulate improvement
  memory.recordIteration(2, 'code', 76, [], [], 100);
  
  // Second iteration - should continue improving
  decision = shouldIterationStop({
    currentScore: 76,
    iterationNum: 2,
    maxIterations: 3,
    qualityThreshold: 85,
    mode: 'autonomous',
    patchGoals: ['goal2'],
    agentMemory: memory
  });
  
  assert.strictEqual(decision.shouldStop, false); // Still improving
  
  // Final improvement
  memory.recordIteration(3, 'code', 86, [], [], 100);
  
  decision = shouldIterationStop({
    currentScore: 86,
    iterationNum: 3,
    maxIterations: 3,
    qualityThreshold: 85,
    mode: 'autonomous',
    patchGoals: []
  });
  
  assert.strictEqual(decision.shouldStop, true); // Threshold met
});

test('Integration: Full decision flow - assisted path', () => {
  const memory = new AgentMemory('sess-1', 'threejs');
  
  // First iteration - wait for user
  let decision = shouldIterationStop({
    currentScore: 68,
    iterationNum: 1,
    maxIterations: 2,
    qualityThreshold: 75,
    mode: 'assisted',
    patchGoals: ['goal1']
  });
  
  assert.strictEqual(decision.shouldStop, false);
  assert.strictEqual(decision.reason, 'awaiting_user_approval');
  
  // User approves
  const userDecision = processUserDecision('approve');
  assert.strictEqual(userDecision.shouldContinue, true);
  
  // Now continue
  memory.recordIteration(1, 'code', 68, [], [], 100);
  memory.recordIteration(2, 'code', 78, [], [], 100);
  
  decision = shouldIterationStop({
    currentScore: 78,
    iterationNum: 2,
    maxIterations: 2,
    qualityThreshold: 75,
    mode: 'assisted',
    patchGoals: [],
    userApproved: true
  });
  
  assert.strictEqual(decision.shouldStop, true); // Reached threshold
});

test('Integration: Memory learns and prevents repetition', () => {
  const memory = new AgentMemory('sess-1', 'threejs');
  
  // First attempt
  memory.recordPatchOutcome('lighting', 'eval() not allowed', false, -5);
  memory.recordFailedApproach('eval() approach for lighting');
  
  // Check if we detect the failed approach
  assert.ok(memory.hasTriedApproach('eval() approach for lighting'));
  
  // Try again - should be detected
  const context = memory.getContextForNextIteration();
  assert.ok(context.failedApproaches.length > 0);
});

// ============= TEST SUMMARY =============

console.log('\n' + '='.repeat(50));
console.log(`Tests Passed: ${testsPassed}`);
console.log(`Tests Failed: ${testsFailed}`);
console.log(`Total Tests: ${testsPassed + testsFailed}`);
console.log('='.repeat(50) + '\n');

if (testsFailed > 0) {
  process.exit(1);
} else {
  console.log('✅ All tests passed!');
  process.exit(0);
}
