/**
 * Multi-Agent Framework - Foundation for specialized agent roles
 *
 * This module provides the base architecture for multi-agent workflows.
 * Each agent specializes in a domain while maintaining coordination
 * through a shared orchestrator.
 *
 * Phases:
 * - Phase 4a: Agent registry and role definitions
 * - Phase 4b: Workflow coordinator (parallel agent execution)
 * - Phase 4c: Individual agent implementations
 */

/**
 * @typedef {Object} AgentRole
 * @property {string} id - Unique agent identifier
 * @property {string} name - Human-readable name
 * @property {Array<string>} expertise - Technical areas
 * @property {Array<string>} responsibilities - What this agent handles
 * @property {Array<string>} dependencies - Agents this depends on
 */

/**
 * @typedef {Object} AgentAnalysis
 * @property {string} agentId - Which agent performed analysis
 * @property {number} confidence - 0-1 confidence score
 * @property {Array<string>} findings - Key findings
 * @property {Object} recommendations - Suggested changes
 * @property {number} executionTimeMs - How long analysis took
 */

/**
 * @typedef {Object} WorkflowContext
 * @property {string} scenePrompt - User's scene description
 * @property {Object} currentScene - Parsed scene structure
 * @property {Object} quality - Quality metrics
 * @property {Map<string, AgentAnalysis>} agentResults - Results from each agent
 * @property {Array<string>} appliedPatches - Patches applied so far
 */

/**
 * Agent role definitions
 */
export const AGENT_ROLES = {
  architect: {
    id: 'architect',
    name: 'Scene Architect',
    expertise: ['three.js', 'p5.js', 'babylon.js', 'structure', 'composition'],
    responsibilities: [
      'High-level structure and layout',
      'Camera placement and framing',
      'Primary lighting setup',
      'Scene organization and hierarchy',
      'Composition and rule of thirds'
    ],
    dependencies: []
  },

  materialDesigner: {
    id: 'material-designer',
    name: 'Material Designer',
    expertise: ['shaders', 'pbr', 'textures', 'post-processing', 'color'],
    responsibilities: [
      'Material richness and complexity',
      'Custom shader effects',
      'Texture and lighting quality',
      'Color grading and harmony',
      'Post-processing effects'
    ],
    dependencies: ['architect']
  },

  animator: {
    id: 'animator',
    name: 'Motion Animator',
    expertise: ['animation', 'easing', 'gsap', 'timeline', 'math'],
    responsibilities: [
      'Motion design and choreography',
      'Easing curves and timing',
      'Animation timeline coordination',
      'Motion continuity and smoothness',
      'Performance optimization for animation'
    ],
    dependencies: ['architect', 'material-designer']
  },

  optimizer: {
    id: 'optimizer',
    name: 'Performance Optimizer',
    expertise: ['performance', 'lod', 'culling', 'bundling', 'memory'],
    responsibilities: [
      'FPS stability and performance',
      'Memory usage optimization',
      'Level of detail (LOD) strategies',
      'Bundle size reduction',
      'Load time improvement'
    ],
    dependencies: ['architect', 'animator']
  },

  tester: {
    id: 'tester',
    name: 'Quality Tester',
    expertise: ['testing', 'edge-cases', 'cross-browser', 'stress-test'],
    responsibilities: [
      'Edge case detection',
      'Cross-browser compatibility',
      'Stress testing and limits',
      'Security and safety review',
      'Accessibility compliance'
    ],
    dependencies: ['architect', 'animator', 'optimizer']
  }
};

/**
 * Base Agent class
 * All specific agents extend this
 */
export class Agent {
  constructor(roleId, llmProvider) {
    this.roleId = roleId;
    this.role = AGENT_ROLES[roleId];
    this.llm = llmProvider;
    this.executionCount = 0;
    this.totalExecutionTimeMs = 0;

    if (!this.role) {
      throw new Error(`Unknown agent role: ${roleId}`);
    }
  }

  /**
   * Analyze scene and produce recommendations
   * @param {WorkflowContext} context
   * @returns {Promise<AgentAnalysis>}
   */
  async analyze(context) {
    throw new Error('analyze() must be implemented by subclass');
  }

  /**
   * Apply recommendations to code
   * @param {string} code - Current code
   * @param {AgentAnalysis} analysis - Analysis from this agent
   * @returns {Promise<string>} - Modified code
   */
  async apply(code, analysis) {
    throw new Error('apply() must be implemented by subclass');
  }

  /**
   * Log execution for metrics
   * @private
   */
  _logExecution(timeMs) {
    this.executionCount += 1;
    this.totalExecutionTimeMs += timeMs;
  }

  /**
   * Get execution statistics
   * @returns {Object}
   */
  getStats() {
    return {
      agentId: this.roleId,
      totalExecutions: this.executionCount,
      averageTimeMs: this.executionCount > 0
        ? Math.round(this.totalExecutionTimeMs / this.executionCount)
        : 0,
      totalTimeMs: this.totalExecutionTimeMs
    };
  }
}

/**
 * Architect Agent - Analyzes structure and composition
 */
class ArchitectAgent extends Agent {
  constructor(llmProvider) {
    super('architect', llmProvider);
  }

  async analyze(context) {
    const startTime = Date.now();

    const prompt = `You are a 3D scene architect. Analyze this scene code for structure and composition issues.

Scene request: "${context.scenePrompt}"
Current quality score: ${context.currentScene?.quality || 'unknown'}

Code:
\`\`\`
${context.currentScene?.code || 'No code'}
\`\`\`

Analyze and provide:
1. FINDINGS: Key structural issues (array of strings)
2. SUGGESTIONS: Specific improvements with impact scores (0-20)
3. CONFIDENCE: How confident you are (0-1)

Format as JSON: {
  "findings": ["issue1", "issue2"],
  "suggestions": [{"action": "...", "impact": 10, "code_snippet": "..."}],
  "confidence": 0.85
}`;

    try {
      // Mock analysis if no real LLM
      if (!this.llm || !this.llm.generate) {
        return this._mockAnalysis('Architecture is basic, needs more organization');
      }

      const response = await this.llm.generate(prompt);
      const parsed = this._parseResponse(response);

      this._logExecution(Date.now() - startTime);

      return {
        agentId: this.roleId,
        confidence: parsed.confidence || 0.7,
        findings: parsed.findings || ['Basic structure detected'],
        suggestions: parsed.suggestions || [],
        executionTimeMs: Date.now() - startTime
      };
    } catch (err) {
      console.error(`[Architect] Analysis failed: ${err.message}`);
      return this._mockAnalysis('Architecture analysis unavailable');
    }
  }

  _parseResponse(response) {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      return {};
    }
  }

  _mockAnalysis(issue) {
    return {
      agentId: this.roleId,
      confidence: 0.6,
      findings: [issue],
      suggestions: [{
        action: 'Add scene group for better hierarchy',
        impact: 8,
        code_snippet: 'const sceneGroup = new THREE.Group();'
      }],
      executionTimeMs: 50
    };
  }
}

/**
 * Material Designer Agent - Analyzes materials and appearance
 */
class MaterialDesignerAgent extends Agent {
  constructor(llmProvider) {
    super('materialDesigner', llmProvider);
  }

  async analyze(context) {
    const startTime = Date.now();

    const prompt = `You are a 3D material and appearance specialist. Analyze this scene for visual quality issues.

Scene request: "${context.scenePrompt}"

Code:
\`\`\`
${context.currentScene?.code || 'No code'}
\`\`\`

Analyze for:
1. Material richness and complexity
2. Lighting quality and color
3. Visual appeal and polish
4. Shader effects and post-processing

Provide JSON: {
  "findings": ["issue1", "issue2"],
  "suggestions": [{"action": "...", "impact": 15, "code_snippet": "..."}],
  "confidence": 0.8
}`;

    try {
      if (!this.llm || !this.llm.generate) {
        return this._mockAnalysis('Materials are basic');
      }

      const response = await this.llm.generate(prompt);
      const parsed = this._parseResponse(response);

      this._logExecution(Date.now() - startTime);

      return {
        agentId: this.roleId,
        confidence: parsed.confidence || 0.75,
        findings: parsed.findings || ['Basic materials'],
        suggestions: parsed.suggestions || [],
        executionTimeMs: Date.now() - startTime
      };
    } catch (err) {
      console.error(`[MaterialDesigner] Analysis failed: ${err.message}`);
      return this._mockAnalysis('Material analysis unavailable');
    }
  }

  _parseResponse(response) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      return {};
    }
  }

  _mockAnalysis(issue) {
    return {
      agentId: this.roleId,
      confidence: 0.65,
      findings: [issue],
      suggestions: [{
        action: 'Add ambient lighting for better visibility',
        impact: 12,
        code_snippet: 'const light = new THREE.AmbientLight(0xffffff, 0.6);'
      }],
      executionTimeMs: 50
    };
  }
}

/**
 * Animator Agent - Analyzes motion and animations
 */
class AnimatorAgent extends Agent {
  constructor(llmProvider) {
    super('animator', llmProvider);
  }

  async analyze(context) {
    const startTime = Date.now();

    const prompt = `You are a motion design specialist. Analyze this scene for animation opportunities.

Scene request: "${context.scenePrompt}"

Code:
\`\`\`
${context.currentScene?.code || 'No code'}
\`\`\`

Analyze for:
1. Motion design and choreography
2. Animation smoothness and timing
3. Easing curves and transitions
4. Interactive motion opportunities

Provide JSON: {
  "findings": ["issue1"],
  "suggestions": [{"action": "...", "impact": 10}],
  "confidence": 0.7
}`;

    try {
      if (!this.llm || !this.llm.generate) {
        return this._mockAnalysis('No animations detected');
      }

      const response = await this.llm.generate(prompt);
      const parsed = this._parseResponse(response);

      this._logExecution(Date.now() - startTime);

      return {
        agentId: this.roleId,
        confidence: parsed.confidence || 0.7,
        findings: parsed.findings || ['Static scene'],
        suggestions: parsed.suggestions || [],
        executionTimeMs: Date.now() - startTime
      };
    } catch (err) {
      console.error(`[Animator] Analysis failed: ${err.message}`);
      return this._mockAnalysis('Animation analysis unavailable');
    }
  }

  _parseResponse(response) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      return {};
    }
  }

  _mockAnalysis(issue) {
    return {
      agentId: this.roleId,
      confidence: 0.6,
      findings: [issue],
      suggestions: [{
        action: 'Add rotation animation for visual interest',
        impact: 8,
        code_snippet: 'mesh.rotation.y += 0.01;'
      }],
      executionTimeMs: 50
    };
  }
}

/**
 * Optimizer Agent - Analyzes performance
 */
class OptimizerAgent extends Agent {
  constructor(llmProvider) {
    super('optimizer', llmProvider);
  }

  async analyze(context) {
    const startTime = Date.now();

    const prompt = `You are a performance optimization specialist. Analyze this scene for performance issues.

Scene request: "${context.scenePrompt}"

Code:
\`\`\`
${context.currentScene?.code || 'No code'}
\`\`\`

Analyze for:
1. Polygon count and geometry optimization
2. Memory usage and asset loading
3. Rendering efficiency and batching
4. Bundle size and load time

Provide JSON: {
  "findings": ["issue1"],
  "suggestions": [{"action": "...", "impact": 5}],
  "confidence": 0.75
}`;

    try {
      if (!this.llm || !this.llm.generate) {
        return this._mockAnalysis('Performance not optimized');
      }

      const response = await this.llm.generate(prompt);
      const parsed = this._parseResponse(response);

      this._logExecution(Date.now() - startTime);

      return {
        agentId: this.roleId,
        confidence: parsed.confidence || 0.7,
        findings: parsed.findings || ['Potential performance issues'],
        suggestions: parsed.suggestions || [],
        executionTimeMs: Date.now() - startTime
      };
    } catch (err) {
      console.error(`[Optimizer] Analysis failed: ${err.message}`);
      return this._mockAnalysis('Performance analysis unavailable');
    }
  }

  _parseResponse(response) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      return {};
    }
  }

  _mockAnalysis(issue) {
    return {
      agentId: this.roleId,
      confidence: 0.65,
      findings: [issue],
      suggestions: [{
        action: 'Use LOD (Level of Detail) for complex objects',
        impact: 5,
        code_snippet: 'const lod = new THREE.LOD(); lod.addLevel(mesh, 100);'
      }],
      executionTimeMs: 50
    };
  }
}

/**
 * Tester Agent - Analyzes validation and safety
 */
class TesterAgent extends Agent {
  constructor(llmProvider) {
    super('tester', llmProvider);
  }

  async analyze(context) {
    const startTime = Date.now();

    const prompt = `You are a quality assurance specialist. Analyze this scene for validation and safety issues.

Scene request: "${context.scenePrompt}"

Code:
\`\`\`
${context.currentScene?.code || 'No code'}
\`\`\`

Analyze for:
1. Edge case handling and error handling
2. Cross-browser compatibility
3. Accessibility compliance
4. Security and injection vulnerabilities

Provide JSON: {
  "findings": ["issue1"],
  "suggestions": [{"action": "...", "impact": 3}],
  "confidence": 0.8
}`;

    try {
      if (!this.llm || !this.llm.generate) {
        return this._mockAnalysis('Validation needed');
      }

      const response = await this.llm.generate(prompt);
      const parsed = this._parseResponse(response);

      this._logExecution(Date.now() - startTime);

      return {
        agentId: this.roleId,
        confidence: parsed.confidence || 0.75,
        findings: parsed.findings || ['Basic validation'],
        suggestions: parsed.suggestions || [],
        executionTimeMs: Date.now() - startTime
      };
    } catch (err) {
      console.error(`[Tester] Analysis failed: ${err.message}`);
      return this._mockAnalysis('Testing analysis unavailable');
    }
  }

  _parseResponse(response) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      return {};
    }
  }

  _mockAnalysis(issue) {
    return {
      agentId: this.roleId,
      confidence: 0.7,
      findings: [issue],
      suggestions: [{
        action: 'Add error handling for scene initialization',
        impact: 3,
        code_snippet: 'try { /* scene code */ } catch(e) { console.error(e); }'
      }],
      executionTimeMs: 50
    };
  }
}

/**
 * Agent Registry
 * Manages all available agents
 */
export class AgentRegistry {
  constructor(llmProvider) {
    this.llm = llmProvider;
    this.agents = new Map();
    this._initializeAgents();
  }

  /**
   * Initialize all available agents
   * @private
   */
  _initializeAgents() {
    // Create instances of each agent type
    const agentClasses = [
      ArchitectAgent,
      MaterialDesignerAgent,
      AnimatorAgent,
      OptimizerAgent,
      TesterAgent
    ];

    for (const AgentClass of agentClasses) {
      const agent = new AgentClass(this.llm);
      this.agents.set(agent.roleId, agent);
    }
  }

  /**
   * Get agent by role ID
   * @param {string} roleId
   * @returns {Agent}
   */
  getAgent(roleId) {
    const agent = this.agents.get(roleId);
    if (!agent) {
      throw new Error(`Agent not found: ${roleId}`);
    }
    return agent;
  }

  /**
   * Get all available agents
   * @returns {Array<Agent>}
   */
  getAllAgents() {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents for a specific expertise
   * @param {string} expertise
   * @returns {Array<Agent>}
   */
  getAgentsByExpertise(expertise) {
    const results = [];
    for (const [, agent] of this.agents) {
      if (agent.role.expertise.includes(expertise)) {
        results.push(agent);
      }
    }
    return results;
  }
}

/**
 * Workflow Coordinator
 * Orchestrates multi-agent execution
 */
export class WorkflowCoordinator {
  constructor(agentRegistry) {
    this.registry = agentRegistry;
    this.workflowHistory = [];
  }

  /**
   * Execute multi-agent workflow
   * Runs agents in dependency order with coordination
   * @param {WorkflowContext} context
   * @param {Object} [options] - Execution options
   * @returns {Promise<Object>} - Combined workflow results
   */
  async executeWorkflow(context, options = {}) {
    const {
      parallel = false,
      timeout = 120000,
      agents = Object.keys(AGENT_ROLES)
    } = options;

    const startTime = Date.now();
    context.startTime = startTime; // Add to context for agent timeout checks
    
    const results = new Map();
    const errors = new Map();

    // Build execution order based on dependencies
    const executionOrder = this._topologicalSort(agents);

    // Execute agents
    if (parallel) {
      // Parallel with dependency tracking
      await this._executeParallel(executionOrder, context, results, errors, timeout);
    } else {
      // Sequential execution
      await this._executeSequential(executionOrder, context, results, errors, timeout);
    }

    // Compile results
    const workflow = {
      startTime,
      endTime: Date.now(),
      durationMs: Date.now() - startTime,
      agentsExecuted: results.size,
      agentsFailed: errors.size,
      results: Object.fromEntries(results),
      errors: errors.size > 0 ? Object.fromEntries(errors) : null,
      recommendations: this._synthesizeRecommendations(results)
    };

    this.workflowHistory.push(workflow);

    return workflow;
  }

  /**
   * Execute agents sequentially
   * @private
   */
  async _executeSequential(executionOrder, context, results, errors, timeout) {
    for (const agentId of executionOrder) {
      try {
        const agent = this.registry.getAgent(agentId);
        const agentStartTime = Date.now();

        // Check timeout
        if (Date.now() - context.startTime > timeout) {
          errors.set(agentId, 'Timeout exceeded');
          continue;
        }

        const analysis = await agent.analyze(context);
        results.set(agentId, analysis);

        console.log(`[Workflow] Agent ${agentId} completed (${Date.now() - agentStartTime}ms)`);
      } catch (err) {
        errors.set(agentId, err.message);
        console.error(`[Workflow] Agent ${agentId} failed: ${err.message}`);
      }
    }
  }

  /**
   * Execute agents in parallel with dependency tracking
   * @private
   */
  async _executeParallel(executionOrder, context, results, errors, timeout) {
    const pending = new Map();

    // Group by dependency level
    const dependencyLevels = this._groupByDependencyLevel(executionOrder);

    for (const level of dependencyLevels) {
      const promises = level.map(agentId =>
        this._executeAgent(agentId, context, results, errors)
          .catch(err => errors.set(agentId, err.message))
      );

      await Promise.all(promises);

      // Check timeout
      if (Date.now() - context.startTime > timeout) {
        break;
      }
    }
  }

  /**
   * Execute single agent
   * @private
   */
  async _executeAgent(agentId, context, results, errors) {
    const agent = this.registry.getAgent(agentId);
    const startTime = Date.now();

    try {
      const analysis = await agent.analyze(context);
      results.set(agentId, analysis);
      console.log(`[Workflow] ${agent.role.name} analysis completed in ${Date.now() - startTime}ms`);
    } catch (err) {
      errors.set(agentId, err.message);
      console.error(`[Workflow] ${agent.role.name} failed: ${err.message}`);
    }
  }

  /**
   * Topological sort for dependency ordering
   * @private
   */
  _topologicalSort(agents) {
    const sorted = [];
    const visited = new Set();

    const visit = (agentId) => {
      if (visited.has(agentId)) return;
      visited.add(agentId);

      const role = AGENT_ROLES[agentId];
      if (role?.dependencies) {
        for (const dep of role.dependencies) {
          if (agents.includes(dep)) {
            visit(dep);
          }
        }
      }

      sorted.push(agentId);
    };

    for (const agentId of agents) {
      visit(agentId);
    }

    return sorted;
  }

  /**
   * Group agents by dependency level
   * @private
   */
  _groupByDependencyLevel(agents) {
    const levels = [];
    const processed = new Set();

    while (processed.size < agents.length) {
      const level = [];

      for (const agentId of agents) {
        if (processed.has(agentId)) continue;

        const role = AGENT_ROLES[agentId];
        const allDepsProcessed = role?.dependencies?.every(dep =>
          !agents.includes(dep) || processed.has(dep)
        ) ?? true;

        if (allDepsProcessed) {
          level.push(agentId);
        }
      }

      if (level.length === 0) break; // Circular dependency

      levels.push(level);
      level.forEach(a => processed.add(a));
    }

    return levels;
  }

  /**
   * Synthesize recommendations from all agents
   * @private
   */
  _synthesizeRecommendations(results) {
    const synthesis = {
      priority: [],
      experimental: [],
      conflicting: []
    };

    // This would analyze agent results and merge recommendations
    // For Phase 4a skeleton, return empty

    return synthesis;
  }

  /**
   * Get workflow history
   * @returns {Array<Object>}
   */
  getHistory() {
    return this.workflowHistory;
  }
}

/**
 * Create workflow coordinator
 * Factory function for easy setup
 * @param {Object} llmProvider
 * @returns {WorkflowCoordinator}
 */
export function createWorkflowCoordinator(llmProvider) {
  const registry = new AgentRegistry(llmProvider);
  return new WorkflowCoordinator(registry);
}

/**
 * Get agent role by ID
 * @param {string} roleId
 * @returns {AgentRole}
 */
export function getAgentRole(roleId) {
  return AGENT_ROLES[roleId];
}

/**
 * Get all agent roles
 * @returns {Object} - Map of role IDs to roles
 */
export function getAllAgentRoles() {
  return AGENT_ROLES;
}

/**
 * List available agent roles with descriptions
 * @returns {Array<Object>}
 */
export function listAvailableAgents() {
  return Object.entries(AGENT_ROLES).map(([id, role]) => ({
    id,
    name: role.name,
    expertise: role.expertise,
    responsibilities: role.responsibilities
  }));
}
