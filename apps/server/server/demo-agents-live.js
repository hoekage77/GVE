/**
 * Agent Implementation Demo
 * Shows how to use the 5 actual agents for code analysis
 *
 * Run: node apps/server/server/demo-agents-live.js
 */

import { createWorkflowCoordinator } from './multi-agent-framework.js';

// Mock LLM provider - in production, this would use Kimi K2.5
const mockLLM = {
  generate: async (prompt) => {
    // Simulate different responses based on agent expertise
    if (prompt.includes('architect') || prompt.includes('structure')) {
      return JSON.stringify({
        findings: ['Scene hierarchy is flat', 'No grouping of related objects'],
        suggestions: [
          { 
            action: 'Create THREE.Group() containers for scene organization',
            impact: 12,
            code_snippet: 'const meshGroup = new THREE.Group();\nscene.add(meshGroup);'
          }
        ],
        confidence: 0.88
      });
    }
    if (prompt.includes('material') || prompt.includes('appearance')) {
      return JSON.stringify({
        findings: ['Scene is very dark', 'No specular highlights'],
        suggestions: [
          {
            action: 'Add ambient and directional lighting',
            impact: 18,
            code_snippet: 'const ambient = new THREE.AmbientLight(0xffffff, 0.6);\nscene.add(ambient);'
          },
          {
            action: 'Add glossy material for visual depth',
            impact: 8,
            code_snippet: 'const material = new THREE.MeshStandardMaterial({ metalness: 0.5, roughness: 0.3 });'
          }
        ],
        confidence: 0.92
      });
    }
    if (prompt.includes('animation') || prompt.includes('motion')) {
      return JSON.stringify({
        findings: ['No motion in scene', 'Static geometry'],
        suggestions: [
          {
            action: 'Add rotation animation',
            impact: 10,
            code_snippet: 'mesh.rotation.y += 0.005; // Add to animation loop'
          }
        ],
        confidence: 0.75
      });
    }
    if (prompt.includes('performance') || prompt.includes('optimization')) {
      return JSON.stringify({
        findings: ['High polygon count', 'No LOD implemented'],
        suggestions: [
          {
            action: 'Limit geometry subdivision for better FPS',
            impact: 5,
            code_snippet: 'const geometry = new THREE.IcosahedronGeometry(1, 3); // Reduced detail'
          }
        ],
        confidence: 0.70
      });
    }
    if (prompt.includes('testing') || prompt.includes('validation')) {
      return JSON.stringify({
        findings: ['No error handling', 'Missing null checks'],
        suggestions: [
          {
            action: 'Add try-catch for scene initialization',
            impact: 3,
            code_snippet: 'try { /* scene setup */ } catch(e) { console.error("Scene init failed:", e); }'
          }
        ],
        confidence: 0.81
      });
    }
    return '{}';
  }
};

async function runDemo() {
  console.log('\n' + '='.repeat(70));
  console.log('  🤖 MULTI-AGENT CODE ANALYSIS DEMO');
  console.log('='.repeat(70) + '\n');

  const coordinator = createWorkflowCoordinator(mockLLM);

  // Example scene code
  const sceneCode = `
const scene = new THREE.Scene();
const geometry = new THREE.IcosahedronGeometry(1, 5);
const material = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 2;

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();
  `.trim();

  console.log('📝 Analyzing this Three.js scene:\n');
  console.log('Code:');
  console.log('-'.repeat(70));
  console.log(sceneCode);
  console.log('-'.repeat(70));
  console.log();

  // Execute workflow
  console.log('🔍 Running all 5 agents in parallel...\n');

  const result = await coordinator.executeWorkflow(
    {
      scenePrompt: 'A rotating green sphere',
      currentScene: { code: sceneCode, quality: 65 }
    },
    { parallel: true }
  );

  // Display results from each agent
  console.log('📊 ANALYSIS RESULTS:\n');

  const agentNames = {
    'architect': '🏗️  Architecture',
    'material-designer': '🎨 Material Design',
    'animator': '✨ Animation',
    'optimizer': '⚡ Performance',
    'tester': '✅ Quality'
  };

  for (const [agentId, analysis] of Object.entries(result.results)) {
    const displayName = agentNames[agentId] || agentId;
    
    console.log(`${displayName}`);
    console.log('-'.repeat(70));
    console.log(`Confidence: ${(analysis.confidence * 100).toFixed(0)}%`);
    console.log();
    
    console.log('Findings:');
    for (const finding of analysis.findings) {
      console.log(`  • ${finding}`);
    }
    console.log();
    
    console.log('Suggestions:');
    for (const sugg of analysis.suggestions) {
      console.log(`  ✓ ${sugg.action}`);
      console.log(`    Impact: +${sugg.impact} points`);
      console.log(`    Code: ${sugg.code_snippet.split('\n')[0]}...`);
    }
    console.log();
  }

  // Summary
  console.log('📈 WORKFLOW SUMMARY:');
  console.log('-'.repeat(70));
  console.log(`Agents executed: ${result.agentsExecuted}/5`);
  console.log(`Total analysis time: ${result.durationMs}ms`);
  console.log(`Agents failed: ${result.agentsFailed}`);
  console.log();

  // Show execution sequence
  const history = coordinator.getHistory();
  console.log('📋 EXECUTION HISTORY:');
  console.log('-'.repeat(70));
  for (let i = 0; i < history.length; i++) {
    const exec = history[i];
    console.log(`Execution ${i + 1}:`);
    console.log(`  • Duration: ${exec.durationMs}ms`);
    console.log(`  • Agents: ${Object.keys(exec.results).join(', ')}`);
    console.log();
  }

  // Example: Use agent results to generate patches
  console.log('🔧 SUGGESTED IMPROVEMENTS:');
  console.log('-'.repeat(70));
  
  let totalImpact = 0;
  for (const [agentId, analysis] of Object.entries(result.results)) {
    for (const sugg of analysis.suggestions) {
      totalImpact += sugg.impact;
      console.log(`  ${sugg.action.substring(0, 50)}... (+${sugg.impact}pts)`);
    }
  }
  
  console.log();
  console.log(`💡 Estimated quality improvement: +${totalImpact} points (65 → ${65 + totalImpact})`);
  console.log();

  // Show individual agent capabilities
  console.log('🎯 AGENT CAPABILITIES:');
  console.log('-'.repeat(70));
  
  const agents = coordinator.registry.getAllAgents();
  for (const agent of agents) {
    console.log(`${agent.role.name} (${agent.role.id})`);
    console.log(`  Expertise: ${agent.role.expertise.join(', ')}`);
    console.log(`  Responsibilities:`);
    for (const resp of agent.role.responsibilities) {
      console.log(`    - ${resp}`);
    }
    console.log();
  }

  console.log('✨ Demo complete!');
  console.log('='.repeat(70) + '\n');
}

runDemo().catch(err => {
  console.error('❌ Demo failed:', err);
  process.exit(1);
});
