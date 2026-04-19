/**
 * Test: Multi-Agent Framework with LLM Provider Pool
 *
 * Verifies that all 5 agents can analyze code using any provider
 * from the existing LLM provider pool (Kimi, DeepSeek, Groq, etc.)
 * 
 * Tests provider-agnostic operation with automatic failover
 */

import "./env.js";
import { createWorkflowCoordinator, listAvailableAgents } from "./multi-agent-framework.js";
import { createPoolBasedProvider } from "./pool-based-llm-provider.js";
import { getPool } from "./llm-pool.js";

// ─── Test Context ───────────────────────────────────────────────────

const TEST_SCENE = {
  scenePrompt: "A glowing pyramid with rotating animation",
  currentScene: {
    code: `
      import * as THREE from 'three';

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
      const renderer = new THREE.WebGLRenderer();

      renderer.setSize(window.innerWidth, window.innerHeight);
      document.body.appendChild(renderer.domElement);

      // Create pyramid mesh
      const geometry = new THREE.ConeGeometry(1, 2, 4);
      const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      camera.position.z = 5;

      function animate() {
        requestAnimationFrame(animate);
        mesh.rotation.x += 0.01;
        mesh.rotation.y += 0.01;
        renderer.render(scene, camera);
      }

      animate();
    `,
    quality: 60
  }
};

// ─── Helper: Format Duration ────────────────────────────────────────

function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ─── Helper: Print Results ──────────────────────────────────────────

function printAnalysis(agentName, analysis) {
  console.log(`\n📊 ${agentName}`);
  console.log(`   Confidence: ${(analysis.confidence * 100).toFixed(0)}%`);
  console.log(`   Duration: ${formatDuration(analysis.executionTimeMs)}`);
  console.log(`   Findings: ${analysis.findings?.join(", ") ?? "N/A"}`);

  if (analysis.recommendations) {
    console.log(`   Recommendations:`);
    Object.entries(analysis.recommendations).forEach(([key, value]) => {
      console.log(`     • ${key}: ${value}`);
    });
  }
}

// ─── Main Test ──────────────────────────────────────────────────────

async function main() {
  console.log("╔════════════════════════════════════════════════════════════════════╗");
  console.log("║    Multi-Agent Framework + Provider Pool Integration Test         ║");
  console.log("╚════════════════════════════════════════════════════════════════════╝\n");

  // Check pool status
  const pool = getPool();
  const poolStatus = pool.getStatus();

  console.log("📊 LLM Provider Pool Status:");
  console.log(`   Total providers: ${poolStatus.providers.length}`);
  console.log(`   Enabled providers: ${poolStatus.providers.filter(p => p.state !== 'disabled').length}`);
  
  const healthyProviders = poolStatus.providers.filter(p => p.state === 'healthy');
  if (healthyProviders.length === 0) {
    console.error("\n❌ No healthy providers available");
    console.error("   Please configure at least one LLM provider:");
    console.error("   - MOONSHOT_API_KEY for Kimi K2.5");
    console.error("   - DEEPSEEK_API_KEY for DeepSeek");
    console.error("   - Or any other supported provider");
    process.exit(1);
  }

  console.log("\n✅ Available providers:");
  healthyProviders.forEach(p => {
    console.log(`   • ${p.name} (${p.id}) - ${p.state}`);
  });

  // Create pool-based provider adapter
  console.log("\n📡 Creating pool-based LLM provider adapter...");
  const llmProvider = createPoolBasedProvider({
    mode: "thinking",  // Use thinking mode for better analysis
    requireCodeGen: true  // Require code generation capability
  });

  const adapterStatus = llmProvider.status();
  console.log(`✅ Adapter ready`);

  // Create coordinator with pool-based provider
  console.log("\n🔧 Initializing multi-agent framework...");
  const coordinator = createWorkflowCoordinator(llmProvider);

  // List available agents
  const agents = listAvailableAgents();
  console.log(`\n✅ Agents available: ${agents.length}`);
  agents.forEach(agent => {
    console.log(`   • ${agent.name} (${agent.id})`);
  });

  // Execute workflow
  console.log("\n🚀 Executing multi-agent analysis...\n");
  console.log(`📝 Scene: "${TEST_SCENE.scenePrompt}"`);
  console.log(`📊 Current quality: ${TEST_SCENE.currentScene.quality}/100`);

  try {
    const startMs = Date.now();

    const result = await coordinator.executeWorkflow(TEST_SCENE, {
      parallel: true,
      agents: ['architect', 'materialDesigner', 'animator', 'optimizer', 'tester']
    });

    const durationMs = Date.now() - startMs;

    // Print results
    console.log(`\n╔════════════════════════════════════════════════════════════════════╗`);
    console.log(`║                         ANALYSIS RESULTS                          ║`);
    console.log(`╚════════════════════════════════════════════════════════════════════╝`);

    // Print each agent's analysis
    Object.entries(result.results || {}).forEach(([agentId, analysis]) => {
      printAnalysis(agentId, analysis);
    });

    // Print summary
    console.log(`\n📈 Summary`);
    console.log(`   Total execution time: ${formatDuration(durationMs)}`);
    console.log(`   Agents analyzed: ${Object.keys(result.results || {}).length}`);

    if (result.recommendations) {
      console.log(`   Recommendations: ${result.recommendations.length}`);
      console.log(`   Potential improvement: ${result.totalPotentialImprovement ?? "N/A"} points`);
    }

    // Print adapter stats
    console.log(`\n📊 Provider Adapter Stats`);
    const updatedStatus = llmProvider.status();
    console.log(`   Total requests: ${updatedStatus.stats.totalRequests}`);
    console.log(`   Success rate: ${updatedStatus.stats.successRate}`);
    console.log(`   Avg latency: ${updatedStatus.stats.avgLatencyMs}ms`);
    console.log(`   Providers used: ${Object.keys(updatedStatus.stats.providerUsage).join(", ")}`);

    console.log("\n✅ Multi-agent analysis with provider pool completed successfully!");

  } catch (error) {
    console.error("\n❌ Error during analysis:");
    console.error(error instanceof Error ? error.message : String(error));

    if (error instanceof Error && error.message.includes("No LLM providers")) {
      console.error("\n💡 Tip: Make sure at least one LLM provider API key is configured");
    }

    process.exit(1);
  }
}

// Run test
main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
