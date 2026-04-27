/**
 * Multi-Agent Framework — Typed TypeScript implementation
 *
 * Provides the base architecture for specialized agent roles and
 * parallel workflow coordination. Each agent runs real LLM calls
 * through the PoolBasedLLMProvider interface and returns structured
 * analysis that feeds the quality loop in sandbox-execution.ts.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentRoleDefinition {
  id: string;
  name: string;
  expertise: string[];
  responsibilities: string[];
  dependencies: string[];
}

export interface AgentSuggestion {
  action: string;
  impact: number;
  code_snippet: string | null;
  category?: string;
}

export interface AgentAnalysis {
  agentId: string;
  confidence: number;
  findings: string[];
  suggestions: AgentSuggestion[];
  executionTimeMs: number;
  error?: string;
}

export interface WorkflowContext {
  scenePrompt: string;
  currentScene: {
    code?: string;
    quality?: number | string;
  };
  startTime?: number;
}

export interface WorkflowOptions {
  parallel?: boolean;
  timeout?: number;
  agents?: string[];
}

export interface SynthesizedRecommendation {
  agent: string;
  action: string;
  impact: number;
  confidence: number;
  code_snippet: string | null;
  category: string;
}

export interface WorkflowResult {
  startTime: number;
  endTime: number;
  durationMs: number;
  agentsExecuted: number;
  agentsFailed: number;
  results: Record<string, AgentAnalysis>;
  errors: Record<string, string> | null;
  recommendations: SynthesizedRecommendation[];
  totalPotentialImprovement: number;
}

/** Minimal interface required from an LLM provider by this framework. */
export interface LLMProvider {
  generate(prompt: string, options?: Record<string, unknown>): Promise<string>;
}

// ─── Agent Role Registry ──────────────────────────────────────────────────────

export const AGENT_ROLES: Record<string, AgentRoleDefinition> = {
  architect: {
    id: "architect",
    name: "Scene Architect",
    expertise: ["three.js", "p5.js", "babylon.js", "structure", "composition"],
    responsibilities: [
      "High-level structure and layout",
      "Camera placement and framing",
      "Primary lighting setup",
      "Scene organization and hierarchy",
      "Composition and rule of thirds",
    ],
    dependencies: [],
  },

  materialDesigner: {
    id: "material-designer",
    name: "Material Designer",
    expertise: ["shaders", "pbr", "textures", "post-processing", "color"],
    responsibilities: [
      "Material richness and complexity",
      "Custom shader effects",
      "Texture and lighting quality",
      "Color grading and harmony",
      "Post-processing effects",
    ],
    dependencies: ["architect"],
  },

  animator: {
    id: "animator",
    name: "Motion Animator",
    expertise: ["animation", "easing", "gsap", "timeline", "math"],
    responsibilities: [
      "Motion design and choreography",
      "Easing curves and timing",
      "Animation timeline coordination",
      "Motion continuity and smoothness",
      "Performance optimization for animation",
    ],
    dependencies: ["architect", "material-designer"],
  },

  optimizer: {
    id: "optimizer",
    name: "Performance Optimizer",
    expertise: ["performance", "lod", "culling", "bundling", "memory"],
    responsibilities: [
      "FPS stability and performance",
      "Memory usage optimization",
      "Level of detail (LOD) strategies",
      "Bundle size reduction",
      "Load time improvement",
    ],
    dependencies: ["architect", "animator"],
  },

  tester: {
    id: "tester",
    name: "Quality Tester",
    expertise: ["testing", "edge-cases", "cross-browser", "stress-test"],
    responsibilities: [
      "Edge case detection",
      "Cross-browser compatibility",
      "Stress testing and limits",
      "Security and safety review",
      "Accessibility compliance",
    ],
    dependencies: ["architect", "animator", "optimizer"],
  },
} as const;

// ─── JSON Response Parser ─────────────────────────────────────────────────────

/**
 * Robustly extract and parse a JSON object from an LLM response string.
 * Strategy: ```json fence → generic fence → outermost balanced brace pair.
 * Throws with a descriptive message if no valid JSON object can be found.
 */
function parseJsonResponse(response: string): Record<string, unknown> {
  const text = String(response ?? "").trim();

  // 1. Try ```json ... ``` code fence
  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (fencedMatch) {
    return JSON.parse(fencedMatch[1]!.trim()) as Record<string, unknown>;
  }

  // 2. Try ``` ... ``` code fence (language-agnostic)
  const genericFenceMatch = text.match(/```\s*([\s\S]*?)```/);
  if (genericFenceMatch) {
    try {
      return JSON.parse(genericFenceMatch[1]!.trim()) as Record<string, unknown>;
    } catch {
      // fall through to brace matching
    }
  }

  // 3. Find the outermost balanced brace pair to handle nested JSON correctly
  const first = text.indexOf("{");
  if (first === -1) throw new Error("No JSON object found in LLM response");

  let depth = 0;
  let last = -1;
  for (let i = first; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        last = i;
        break;
      }
    }
  }

  if (last === -1) throw new Error("Unbalanced JSON object in LLM response");
  return JSON.parse(text.slice(first, last + 1)) as Record<string, unknown>;
}

// ─── Agent Statistics ─────────────────────────────────────────────────────────

export interface AgentStats {
  agentId: string;
  totalExecutions: number;
  averageTimeMs: number;
  totalTimeMs: number;
}

// ─── Base Agent ───────────────────────────────────────────────────────────────

export abstract class Agent {
  readonly roleId: string;
  readonly role: AgentRoleDefinition;
  protected readonly llm: LLMProvider;

  private executionCount = 0;
  private totalExecutionTimeMs = 0;

  constructor(roleId: string, llmProvider: LLMProvider) {
    const role = AGENT_ROLES[roleId];
    if (!role) throw new Error(`Unknown agent role: ${roleId}`);
    this.roleId = roleId;
    this.role = role;
    this.llm = llmProvider;
  }

  abstract analyze(context: WorkflowContext): Promise<AgentAnalysis>;

  protected _logExecution(timeMs: number): void {
    this.executionCount += 1;
    this.totalExecutionTimeMs += timeMs;
  }

  getStats(): AgentStats {
    return {
      agentId: this.roleId,
      totalExecutions: this.executionCount,
      averageTimeMs:
        this.executionCount > 0
          ? Math.round(this.totalExecutionTimeMs / this.executionCount)
          : 0,
      totalTimeMs: this.totalExecutionTimeMs,
    };
  }
}

// ─── Agent Implementations ───────────────────────────────────────────────────

class ArchitectAgent extends Agent {
  constructor(llmProvider: LLMProvider) {
    super("architect", llmProvider);
  }

  async analyze(context: WorkflowContext): Promise<AgentAnalysis> {
    const startTime = Date.now();

    const prompt = `You are a 3D scene architect. Analyze this scene code for structure and composition issues.

Scene request: "${context.scenePrompt}"
Current quality score: ${context.currentScene?.quality ?? "unknown"}

Code:
\`\`\`
${context.currentScene?.code ?? "No code"}
\`\`\`

Analyze and provide a JSON object with these exact keys:
{
  "findings": ["issue1", "issue2"],
  "suggestions": [{"action": "...", "impact": 10, "code_snippet": "..."}],
  "confidence": 0.85
}

Return ONLY the JSON object, no other text.`;

    const response = await this.llm.generate(prompt);
    const parsed = parseJsonResponse(response);
    this._logExecution(Date.now() - startTime);

    return {
      agentId: this.roleId,
      confidence: typeof parsed["confidence"] === "number" ? (parsed["confidence"] as number) : 0.7,
      findings: Array.isArray(parsed["findings"]) ? (parsed["findings"] as string[]) : [],
      suggestions: Array.isArray(parsed["suggestions"]) ? (parsed["suggestions"] as AgentSuggestion[]) : [],
      executionTimeMs: Date.now() - startTime,
    };
  }
}

class MaterialDesignerAgent extends Agent {
  constructor(llmProvider: LLMProvider) {
    super("materialDesigner", llmProvider);
  }

  async analyze(context: WorkflowContext): Promise<AgentAnalysis> {
    const startTime = Date.now();

    const prompt = `You are a 3D material and appearance specialist. Analyze this scene for visual quality issues.

Scene request: "${context.scenePrompt}"

Code:
\`\`\`
${context.currentScene?.code ?? "No code"}
\`\`\`

Analyze for material richness, lighting quality, visual appeal, and shader effects.

Return ONLY a JSON object:
{
  "findings": ["issue1", "issue2"],
  "suggestions": [{"action": "...", "impact": 15, "code_snippet": "..."}],
  "confidence": 0.8
}`;

    const response = await this.llm.generate(prompt);
    const parsed = parseJsonResponse(response);
    this._logExecution(Date.now() - startTime);

    return {
      agentId: this.roleId,
      confidence: typeof parsed["confidence"] === "number" ? (parsed["confidence"] as number) : 0.75,
      findings: Array.isArray(parsed["findings"]) ? (parsed["findings"] as string[]) : [],
      suggestions: Array.isArray(parsed["suggestions"]) ? (parsed["suggestions"] as AgentSuggestion[]) : [],
      executionTimeMs: Date.now() - startTime,
    };
  }
}

class AnimatorAgent extends Agent {
  constructor(llmProvider: LLMProvider) {
    super("animator", llmProvider);
  }

  async analyze(context: WorkflowContext): Promise<AgentAnalysis> {
    const startTime = Date.now();

    const prompt = `You are a motion design specialist. Analyze this scene for animation opportunities.

Scene request: "${context.scenePrompt}"

Code:
\`\`\`
${context.currentScene?.code ?? "No code"}
\`\`\`

Analyze for motion design, animation smoothness, easing curves, and interactive motion.

Return ONLY a JSON object:
{
  "findings": ["issue1"],
  "suggestions": [{"action": "...", "impact": 10, "code_snippet": "..."}],
  "confidence": 0.7
}`;

    const response = await this.llm.generate(prompt);
    const parsed = parseJsonResponse(response);
    this._logExecution(Date.now() - startTime);

    return {
      agentId: this.roleId,
      confidence: typeof parsed["confidence"] === "number" ? (parsed["confidence"] as number) : 0.7,
      findings: Array.isArray(parsed["findings"]) ? (parsed["findings"] as string[]) : [],
      suggestions: Array.isArray(parsed["suggestions"]) ? (parsed["suggestions"] as AgentSuggestion[]) : [],
      executionTimeMs: Date.now() - startTime,
    };
  }
}

class OptimizerAgent extends Agent {
  constructor(llmProvider: LLMProvider) {
    super("optimizer", llmProvider);
  }

  async analyze(context: WorkflowContext): Promise<AgentAnalysis> {
    const startTime = Date.now();

    const prompt = `You are a performance optimization specialist. Analyze this scene for performance issues.

Scene request: "${context.scenePrompt}"

Code:
\`\`\`
${context.currentScene?.code ?? "No code"}
\`\`\`

Analyze for polygon count, memory usage, rendering efficiency, and load time.

Return ONLY a JSON object:
{
  "findings": ["issue1"],
  "suggestions": [{"action": "...", "impact": 5, "code_snippet": "..."}],
  "confidence": 0.75
}`;

    const response = await this.llm.generate(prompt);
    const parsed = parseJsonResponse(response);
    this._logExecution(Date.now() - startTime);

    return {
      agentId: this.roleId,
      confidence: typeof parsed["confidence"] === "number" ? (parsed["confidence"] as number) : 0.7,
      findings: Array.isArray(parsed["findings"]) ? (parsed["findings"] as string[]) : [],
      suggestions: Array.isArray(parsed["suggestions"]) ? (parsed["suggestions"] as AgentSuggestion[]) : [],
      executionTimeMs: Date.now() - startTime,
    };
  }
}

class TesterAgent extends Agent {
  constructor(llmProvider: LLMProvider) {
    super("tester", llmProvider);
  }

  async analyze(context: WorkflowContext): Promise<AgentAnalysis> {
    const startTime = Date.now();

    const prompt = `You are a quality assurance specialist. Analyze this scene for validation and safety issues.

Scene request: "${context.scenePrompt}"

Code:
\`\`\`
${context.currentScene?.code ?? "No code"}
\`\`\`

Analyze for edge case handling, cross-browser compatibility, accessibility, and security.

Return ONLY a JSON object:
{
  "findings": ["issue1"],
  "suggestions": [{"action": "...", "impact": 3, "code_snippet": "..."}],
  "confidence": 0.8
}`;

    const response = await this.llm.generate(prompt);
    const parsed = parseJsonResponse(response);
    this._logExecution(Date.now() - startTime);

    return {
      agentId: this.roleId,
      confidence: typeof parsed["confidence"] === "number" ? (parsed["confidence"] as number) : 0.75,
      findings: Array.isArray(parsed["findings"]) ? (parsed["findings"] as string[]) : [],
      suggestions: Array.isArray(parsed["suggestions"]) ? (parsed["suggestions"] as AgentSuggestion[]) : [],
      executionTimeMs: Date.now() - startTime,
    };
  }
}

// ─── Agent Registry ───────────────────────────────────────────────────────────

type AgentConstructor = new (llm: LLMProvider) => Agent;

export class AgentRegistry {
  private readonly agents: Map<string, Agent> = new Map();

  constructor(llmProvider: LLMProvider) {
    const agentClasses: AgentConstructor[] = [
      ArchitectAgent,
      MaterialDesignerAgent,
      AnimatorAgent,
      OptimizerAgent,
      TesterAgent,
    ];

    for (const AgentClass of agentClasses) {
      const agent = new AgentClass(llmProvider);
      this.agents.set(agent.roleId, agent);
    }
  }

  getAgent(roleId: string): Agent {
    const agent = this.agents.get(roleId);
    if (!agent) throw new Error(`Agent not found: ${roleId}`);
    return agent;
  }

  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  getAgentsByExpertise(expertise: string): Agent[] {
    return Array.from(this.agents.values()).filter((a) =>
      a.role.expertise.includes(expertise)
    );
  }
}

// ─── Workflow Coordinator ─────────────────────────────────────────────────────

export class WorkflowCoordinator {
  private readonly registry: AgentRegistry;
  private readonly workflowHistory: WorkflowResult[] = [];

  constructor(registry: AgentRegistry) {
    this.registry = registry;
  }

  async executeWorkflow(
    context: WorkflowContext,
    options: WorkflowOptions = {}
  ): Promise<WorkflowResult> {
    const {
      parallel = false,
      timeout = 120_000,
      agents = Object.keys(AGENT_ROLES),
    } = options;

    const startTime = Date.now();
    context.startTime = startTime;

    const results = new Map<string, AgentAnalysis>();
    const errors = new Map<string, string>();

    const executionOrder = this._topologicalSort(agents);

    if (parallel) {
      await this._executeParallel(executionOrder, context, results, errors, timeout);
    } else {
      await this._executeSequential(executionOrder, context, results, errors, timeout);
    }

    const synthesis = this._synthesizeRecommendations(results);

    const workflow: WorkflowResult = {
      startTime,
      endTime: Date.now(),
      durationMs: Date.now() - startTime,
      agentsExecuted: results.size,
      agentsFailed: errors.size,
      results: Object.fromEntries(results),
      errors: errors.size > 0 ? Object.fromEntries(errors) : null,
      recommendations: synthesis.recommendations,
      totalPotentialImprovement: synthesis.totalPotentialImprovement,
    };

    this.workflowHistory.push(workflow);
    return workflow;
  }

  private async _executeSequential(
    executionOrder: string[],
    context: WorkflowContext,
    results: Map<string, AgentAnalysis>,
    errors: Map<string, string>,
    timeout: number
  ): Promise<void> {
    for (const agentId of executionOrder) {
      if (Date.now() - context.startTime! > timeout) {
        errors.set(agentId, "Timeout exceeded");
        continue;
      }

      const agentStartTime = Date.now();
      try {
        const agent = this.registry.getAgent(agentId);
        const analysis = await agent.analyze(context);
        results.set(agentId, analysis);
        console.log(`[Workflow] Agent ${agentId} completed (${Date.now() - agentStartTime}ms)`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.set(agentId, msg);
        console.error(`[Workflow] Agent ${agentId} failed: ${msg}`);
      }
    }
  }

  private async _executeParallel(
    executionOrder: string[],
    context: WorkflowContext,
    results: Map<string, AgentAnalysis>,
    errors: Map<string, string>,
    timeout: number
  ): Promise<void> {
    const dependencyLevels = this._groupByDependencyLevel(executionOrder);

    for (const level of dependencyLevels) {
      await Promise.all(
        level.map((agentId) =>
          this._executeAgent(agentId, context, results, errors).catch(
            (err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              errors.set(agentId, msg);
            }
          )
        )
      );

      if (Date.now() - context.startTime! > timeout) break;
    }
  }

  private async _executeAgent(
    agentId: string,
    context: WorkflowContext,
    results: Map<string, AgentAnalysis>,
    errors: Map<string, string>
  ): Promise<void> {
    const agent = this.registry.getAgent(agentId);
    const startTime = Date.now();
    try {
      const analysis = await agent.analyze(context);
      results.set(agentId, analysis);
      console.log(`[Workflow] ${agent.role.name} analysis completed in ${Date.now() - startTime}ms`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.set(agentId, msg);
      console.error(`[Workflow] ${agent.role.name} failed: ${msg}`);
    }
  }

  private _topologicalSort(agents: string[]): string[] {
    const sorted: string[] = [];
    const visited = new Set<string>();

    const visit = (agentId: string): void => {
      if (visited.has(agentId)) return;
      visited.add(agentId);
      const role = AGENT_ROLES[agentId];
      for (const dep of role?.dependencies ?? []) {
        if (agents.includes(dep)) visit(dep);
      }
      sorted.push(agentId);
    };

    for (const agentId of agents) visit(agentId);
    return sorted;
  }

  private _groupByDependencyLevel(agents: string[]): string[][] {
    const levels: string[][] = [];
    const processed = new Set<string>();

    while (processed.size < agents.length) {
      const level: string[] = [];

      for (const agentId of agents) {
        if (processed.has(agentId)) continue;
        const role = AGENT_ROLES[agentId];
        const allDepsProcessed =
          role?.dependencies?.every(
            (dep) => !agents.includes(dep) || processed.has(dep)
          ) ?? true;
        if (allDepsProcessed) level.push(agentId);
      }

      if (level.length === 0) break; // guard against circular dependencies
      levels.push(level);
      level.forEach((a) => processed.add(a));
    }

    return levels;
  }

  private _synthesizeRecommendations(results: Map<string, AgentAnalysis>): {
    recommendations: SynthesizedRecommendation[];
    totalPotentialImprovement: number;
  } {
    const allSuggestions: SynthesizedRecommendation[] = [];

    for (const [agentId, analysis] of results) {
      if (!analysis || analysis.error) continue;
      for (const suggestion of analysis.suggestions ?? []) {
        allSuggestions.push({
          agent: agentId,
          action: suggestion.action ?? "",
          impact: typeof suggestion.impact === "number" ? suggestion.impact : 0,
          confidence: typeof analysis.confidence === "number" ? analysis.confidence : 0.5,
          code_snippet: suggestion.code_snippet ?? null,
          category: suggestion.category ?? agentId,
        });
      }
    }

    allSuggestions.sort((a, b) => b.impact - a.impact);
    const totalPotentialImprovement = allSuggestions.reduce((sum, s) => sum + s.impact, 0);

    return { recommendations: allSuggestions, totalPotentialImprovement };
  }

  getHistory(): WorkflowResult[] {
    return this.workflowHistory;
  }
}

// ─── Factory & Utility Exports ────────────────────────────────────────────────

export function createWorkflowCoordinator(llmProvider: LLMProvider): WorkflowCoordinator {
  const registry = new AgentRegistry(llmProvider);
  return new WorkflowCoordinator(registry);
}

export function getAgentRole(roleId: string): AgentRoleDefinition | undefined {
  return AGENT_ROLES[roleId];
}

export function getAllAgentRoles(): Record<string, AgentRoleDefinition> {
  return AGENT_ROLES;
}

export function listAvailableAgents(): Array<{
  id: string;
  name: string;
  expertise: string[];
  responsibilities: string[];
}> {
  return Object.entries(AGENT_ROLES).map(([id, role]) => ({
    id,
    name: role.name,
    expertise: role.expertise,
    responsibilities: role.responsibilities,
  }));
}
