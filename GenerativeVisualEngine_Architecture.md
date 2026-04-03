# Generative Visual Engine: Technical Architecture

## Executive Summary

This document maps out the complete orchestration and skill-loading architecture for a skill-based generative visual engine. The system uses a **Router → Agent → Skill** hierarchy with dynamic skill loading in Daytona sandboxes.

---

## 1. High-Level Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   React UI   │  │  Code Editor │  │ Scene Viewer │  │  Chat Panel  │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
└─────────┼─────────────────┼─────────────────┼─────────────────┼────────────┘
          │                 │                 │                 │
          └─────────────────┴────────┬────────┴─────────────────┘
                                     │
                              ┌──────▼──────┐
                              │  WebSocket  │
                              │   Gateway   │
                              └──────┬──────┘
                                     │
┌────────────────────────────────────┼────────────────────────────────────────┐
│                         ORCHESTRATION LAYER                                │
│                              │                                             │
│  ┌───────────────────────────▼──────────────────────────────────────────┐  │
│  │                         REQUEST ROUTER                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │   Intent    │  │   Context   │  │   Skill     │  │   Session   │  │  │
│  │  │   Parser    │→ │   Manager   │→ │  Selector   │→ │   Manager   │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │  │
│  └──────────────────────────────────┬───────────────────────────────────┘  │
│                                     │                                       │
│  ┌──────────────────────────────────▼───────────────────────────────────┐  │
│  │                      AGENT ORCHESTRATOR                              │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │   Agent     │  │   Skill     │  │   Code      │  │   State     │  │  │
│  │  │   Factory   │  │   Loader    │  │  Generator  │  │   Sync      │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │  │
│  └──────────────────────────────────┬───────────────────────────────────┘  │
└─────────────────────────────────────┼──────────────────────────────────────┘
                                      │
┌─────────────────────────────────────┼──────────────────────────────────────┐
│                         SKILL EXECUTION LAYER                              │
│                              │                                             │
│  ┌───────────────────────────▼──────────────────────────────────────────┐  │
│  │                    DAYTONA SANDBOX POOL                              │  │
│  │                                                                        │  │
│  │   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐              │  │
│  │   │  Sandbox 1  │    │  Sandbox 2  │    │  Sandbox N  │              │  │
│  │   │  (threejs)  │    │   (p5js)    │    │   (d3js)    │              │  │
│  │   │ ┌─────────┐ │    │ ┌─────────┐ │    │ ┌─────────┐ │              │  │
│  │   │ │  Skill  │ │    │ │  Skill  │ │    │ │  Skill  │ │              │  │
│  │   │ │ Runtime │ │    │ │ Runtime │ │    │ │ Runtime │ │              │  │
│  │   │ │ + Agent │ │    │ │ + Agent │ │    │ │ + Agent │ │              │  │
│  │   │ └─────────┘ │    │ └─────────┘ │    │ └─────────┘ │              │  │
│  │   └─────────────┘    └─────────────┘    └─────────────┘              │  │
│  │                                                                        │  │
│  │   ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │   │                     SKILL REGISTRY                              │  │  │
│  │   │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │  │  │
│  │   │  │threejs  │ │  p5js   │ │  d3js   │ │babylonjs│ │mermaid  │   │  │  │
│  │   │  │  skill  │ │  skill  │ │  skill  │ │  skill  │ │  skill  │   │  │  │
│  │   │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘   │  │  │
│  │   └─────────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Transport semantics
The websocket gateway carries the live session loop. In the current implementation, the browser already subscribes to turn progress, scene updates, and message append events. The next transport step is websocket-first turn submission, which turns the gateway into a true bidirectional channel:

- Client sends session attach, active-turn messages, and abort requests.
- Server returns acknowledgements, orchestration steps, assistant deltas, and terminal turn states.
- HTTP remains available for session bootstrap, transcript replay, and compatibility surfaces.
- Message ids and request ids should remain stable so reconnects can deduplicate live events.

This keeps the architecture aligned with Router → Agent → Skill while reducing the risk of duplicated turn submission paths in the UI.

---

## 2. Core Components Deep Dive

### 2.1 Request Router

The entry point that processes all incoming user requests.

```typescript
interface RequestRouter {
  // Parses natural language into structured intent
  intentParser: IntentParser;
  
  // Maintains conversation and scene context
  contextManager: ContextManager;
  
  // Decides which skill(s) to invoke
  skillSelector: SkillSelector;
  
  // Manages user sessions and sandbox allocation
  sessionManager: SessionManager;
}

interface ParsedIntent {
  rawQuery: string;
  intentType: 'create' | 'modify' | 'explain' | 'animate' | 'query';
  targetDomain: '3d' | '2d' | 'data-viz' | 'diagram' | 'animation';
  entities: Entity[];
  constraints: Constraint[];
  confidence: number;
}
```

**Intent Parsing Logic:**

```
User Query: "Create a rotating 3D cube with blue metallic material"
                    ↓
┌─────────────────────────────────────────────────────────────────┐
│                     INTENT PARSER                               │
├─────────────────────────────────────────────────────────────────┤
│  Intent Type: CREATE                                            │
│  Target Domain: 3D (confidence: 0.95)                           │
│  Entities:                                                      │
│    - Object: cube (primitive)                                   │
│    - Animation: rotation (continuous)                           │
│    - Material: metallic (PBR)                                   │
│    - Color: blue (#0000FF)                                      │
│  Constraints:                                                   │
│    - Real-time rendering required                               │
│    - Interactive camera control expected                        │
└─────────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────────┐
│                    SKILL SELECTOR                               │
├─────────────────────────────────────────────────────────────────┤
│  Primary Match: threejs (score: 0.98)                           │
│  Capabilities Required:                                         │
│    - 3D primitive generation                                    │
│    - PBR material support                                       │
│    - Animation loop                                             │
│    - OrbitControls                                              │
│  Fallback: babylonjs (score: 0.85)                              │
└─────────────────────────────────────────────────────────────────┘
```

---

### 2.2 Agent Orchestrator

Manages the lifecycle of visual generation agents.

```typescript
interface AgentOrchestrator {
  // Creates agents on-demand
  agentFactory: AgentFactory;
  
  // Loads skills into sandboxes
  skillLoader: SkillLoader;
  
  // Generates executable code
  codeGenerator: CodeGenerator;
  
  // Synchronizes state across components
  stateSync: StateSynchronizer;
}

interface AgentInstance {
  id: string;
  skillId: string;
  sandboxId: string;
  status: 'initializing' | 'ready' | 'generating' | 'error';
  context: AgentContext;
  createdAt: Date;
  lastActive: Date;
}
```

---

### 2.3 Skill Registry

Central repository of all available skills.

```typescript
interface SkillRegistry {
  // All registered skills
  skills: Map<string, SkillDefinition>;
  
  // Capability index for quick lookup
  capabilityIndex: Map<string, string[]>;
  
  // Register a new skill
  register(skill: SkillDefinition): void;
  
  // Find skills by capability
  findByCapability(capability: string): SkillDefinition[];
  
  // Get skill by ID
  get(skillId: string): SkillDefinition | undefined;
}

interface SkillDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  
  // What this skill can do
  capabilities: Capability[];
  
  // Runtime requirements
  runtime: RuntimeRequirements;
  
  // Template configuration
  templates: TemplateConfig;
  
  // Example prompts for few-shot learning
  examples: SkillExample[];
}

interface Capability {
  name: string;
  description: string;
  parameters: ParameterSchema;
}

interface RuntimeRequirements {
  // Docker image or base environment
  baseImage: string;
  
  // NPM packages to install
  dependencies: string[];
  
  // Environment variables
  envVars: Record<string, string>;
  
  // Resource limits
  resources: ResourceLimits;
  
  // Port requirements
  ports: number[];
  
  // File system access
  filesystem: FilesystemConfig;
}
```

**Example Skill Definition (threejs):**

```typescript
const threejsSkill: SkillDefinition = {
  id: 'threejs',
  name: 'Three.js Renderer',
  version: '0.160.0',
  description: '3D scene generation using Three.js',
  
  capabilities: [
    {
      name: 'primitive',
      description: 'Create basic 3D primitives (cube, sphere, cylinder, etc.)',
      parameters: {
        type: 'object',
        properties: {
          shape: { enum: ['cube', 'sphere', 'cylinder', 'cone', 'torus'] },
          size: { type: 'number' },
          position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
          color: { type: 'string' }
        }
      }
    },
    {
      name: 'material',
      description: 'Apply PBR materials (metallic, roughness, etc.)',
      parameters: {
        type: 'object',
        properties: {
          type: { enum: ['basic', 'standard', 'physical'] },
          color: { type: 'string' },
          metalness: { type: 'number', minimum: 0, maximum: 1 },
          roughness: { type: 'number', minimum: 0, maximum: 1 }
        }
      }
    },
    {
      name: 'lighting',
      description: 'Add lighting (ambient, directional, point, spot)',
      parameters: {
        type: 'object',
        properties: {
          type: { enum: ['ambient', 'directional', 'point', 'spot'] },
          color: { type: 'string' },
          intensity: { type: 'number' },
          position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }
        }
      }
    },
    {
      name: 'animation',
      description: 'Add animations (rotation, translation, scaling)',
      parameters: {
        type: 'object',
        properties: {
          type: { enum: ['rotation', 'translation', 'scaling'] },
          target: { type: 'string' },
          duration: { type: 'number' },
          loop: { type: 'boolean' }
        }
      }
    },
    {
      name: 'camera',
      description: 'Camera controls and positioning',
      parameters: {
        type: 'object',
        properties: {
          type: { enum: ['perspective', 'orthographic'] },
          position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
          lookAt: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
          controls: { type: 'boolean' }
        }
      }
    }
  ],
  
  runtime: {
    baseImage: 'node:20-alpine',
    dependencies: [
      'three@0.160.0',
      '@types/three@0.160.0'
    ],
    envVars: {
      NODE_ENV: 'production'
    },
    resources: {
      memory: '512MB',
      cpu: '1',
      timeout: 30000
    },
    ports: [3000],
    filesystem: {
      readOnly: ['/skills/threejs'],
      readWrite: ['/tmp', '/output']
    }
  },
  
  templates: {
    entryPoint: 'index.js',
    files: [
      'templates/scene.js',
      'templates/primitives.js',
      'templates/materials.js',
      'templates/animation.js'
    ],
    schema: 'templates/schema.json'
  },
  
  examples: [
    {
      prompt: 'Create a red spinning cube',
      code: `
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        const cube = new THREE.Mesh(geometry, material);
        scene.add(cube);
        
        function animate() {
          requestAnimationFrame(animate);
          cube.rotation.x += 0.01;
          cube.rotation.y += 0.01;
          renderer.render(scene, camera);
        }
        animate();
      `
    }
  ]
};
```

---

## 3. Skill Loading Mechanism

### 3.1 Dynamic Skill Loading Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SKILL LOADING SEQUENCE                                │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌──────────────┐
  │ Skill Request │
  │   (threejs)   │
  └──────┬───────┘
         │
         ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ 1. CHECK SKILL REGISTRY                                                │
  │    ✓ Skill "threejs" found                                             │
  │    ✓ Version: 0.160.0                                                  │
  │    ✓ Capabilities: [primitive, material, lighting, animation, camera]  │
  └────────────────────────────────────────────────────────────────────────┘
         │
         ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ 2. CHECK SANDBOX POOL                                                  │
  │    ┌────────────────────────────────────────────────────────────────┐  │
  │    │ Warm Pool: 3 sandboxes available                               │  │
  │    │ - sandbox-001: idle (node:20-alpine)                          │  │
  │    │ - sandbox-002: idle (node:20-alpine) ← SELECTED               │  │
  │    │ - sandbox-003: idle (python:3.11)                             │  │
  │    └────────────────────────────────────────────────────────────────┘  │
  │    ✓ Compatible sandbox found: sandbox-002                             │
  └────────────────────────────────────────────────────────────────────────┘
         │
         ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ 3. INSTALL SKILL DEPENDENCIES                                          │
  │    ┌────────────────────────────────────────────────────────────────┐  │
  │    │ Executing in sandbox-002:                                      │  │
  │    │ $ npm install three@0.160.0 @types/three@0.160.0              │  │
  │    │                                                                │  │
  │    │ added 15 packages in 2.3s                                     │  │
  │    └────────────────────────────────────────────────────────────────┘  │
  │    ✓ Dependencies installed                                            │
  └────────────────────────────────────────────────────────────────────────┘
         │
         ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ 4. MOUNT SKILL TEMPLATES                                               │
  │    ┌────────────────────────────────────────────────────────────────┐  │
  │    │ Mounting skill files:                                          │  │
  │    │ /skills/threejs/templates/scene.js → /app/templates/          │  │
  │    │ /skills/threejs/templates/primitives.js → /app/templates/     │  │
  │    │ /skills/threejs/templates/materials.js → /app/templates/      │  │
  │    │ /skills/threejs/templates/animation.js → /app/templates/      │  │
  │    │ /skills/threejs/templates/schema.json → /app/templates/       │  │
  │    └────────────────────────────────────────────────────────────────┘  │
  │    ✓ Templates mounted                                                 │
  └────────────────────────────────────────────────────────────────────────┘
         │
         ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ 5. INITIALIZE SKILL RUNTIME                                            │
  │    ┌────────────────────────────────────────────────────────────────┐  │
  │    │ Starting skill runtime server...                               │  │
  │    │                                                                │  │
  │    │ > node /app/runtime/server.js                                 │  │
  │    │ Skill runtime ready on port 3000                              │  │
  │    │ Health check: OK                                              │  │
  │    └────────────────────────────────────────────────────────────────┘  │
  │    ✓ Runtime initialized                                               │
  └────────────────────────────────────────────────────────────────────────┘
         │
         ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ 6. AGENT INITIALIZATION                                                │
  │    ┌────────────────────────────────────────────────────────────────┐  │
  │    │ Creating agent instance...                                     │  │
  │    │ Agent ID: agent-7f3a9d2e                                       │  │
  │    │ Skill: threejs                                                 │  │
  │    │ Sandbox: sandbox-002                                           │  │
  │    │ Status: ready                                                  │  │
  │    └────────────────────────────────────────────────────────────────┘  │
  │    ✓ Agent ready for code generation                                   │
  └────────────────────────────────────────────────────────────────────────┘
         │
         ▼
  ┌──────────────┐
  │   AGENT      │
  │   READY      │
  │  (threejs)   │
  └──────────────┘
```

### 3.2 Skill Loader Implementation

```typescript
class SkillLoader {
  private registry: SkillRegistry;
  private sandboxPool: SandboxPool;
  private cache: Map<string, LoadedSkill>;
  
  constructor(registry: SkillRegistry, sandboxPool: SandboxPool) {
    this.registry = registry;
    this.sandboxPool = sandboxPool;
    this.cache = new Map();
  }
  
  async load(skillId: string, context: LoadContext): Promise<LoadedSkill> {
    // 1. Check cache
    const cacheKey = this.getCacheKey(skillId, context);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }
    
    // 2. Get skill definition
    const skill = this.registry.get(skillId);
    if (!skill) {
      throw new SkillNotFoundError(skillId);
    }
    
    // 3. Acquire compatible sandbox
    const sandbox = await this.sandboxPool.acquire({
      baseImage: skill.runtime.baseImage,
      resources: skill.runtime.resources
    });
    
    // 4. Install dependencies
    await this.installDependencies(sandbox, skill.runtime.dependencies);
    
    // 5. Mount skill templates
    await this.mountTemplates(sandbox, skill.templates);
    
    // 6. Start skill runtime
    const runtime = await this.startRuntime(sandbox, skill);
    
    // 7. Create loaded skill instance
    const loadedSkill: LoadedSkill = {
      skill,
      sandbox,
      runtime,
      createdAt: new Date()
    };
    
    // 8. Cache for reuse
    this.cache.set(cacheKey, loadedSkill);
    
    return loadedSkill;
  }
  
  private async installDependencies(
    sandbox: Sandbox, 
    dependencies: string[]
  ): Promise<void> {
    const installCmd = `npm install ${dependencies.join(' ')}`;
    await sandbox.exec(installCmd, { timeout: 60000 });
  }
  
  private async mountTemplates(
    sandbox: Sandbox,
    templates: TemplateConfig
  ): Promise<void> {
    for (const file of templates.files) {
      const sourcePath = `/skills/${templates.skillId}/${file}`;
      const targetPath = `/app/${file}`;
      await sandbox.mount(sourcePath, targetPath, { readOnly: true });
    }
  }
  
  private async startRuntime(
    sandbox: Sandbox,
    skill: SkillDefinition
  ): Promise<SkillRuntime> {
    const runtimeConfig: RuntimeConfig = {
      entryPoint: skill.templates.entryPoint,
      port: skill.runtime.ports[0],
      envVars: skill.runtime.envVars
    };
    
    return await sandbox.startRuntime(runtimeConfig);
  }
  
  async unload(loadedSkill: LoadedSkill): Promise<void> {
    // Stop runtime
    await loadedSkill.runtime.stop();
    
    // Release sandbox back to pool
    await this.sandboxPool.release(loadedSkill.sandbox);
    
    // Remove from cache
    const cacheKey = this.getCacheKey(
      loadedSkill.skill.id, 
      loadedSkill.context
    );
    this.cache.delete(cacheKey);
  }
}
```

---

## 4. Agent Code Generation Flow

### 4.1 Code Generation Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      CODE GENERATION PIPELINE                                │
└─────────────────────────────────────────────────────────────────────────────┘

  User Query: "Create a solar system with 8 planets orbiting the sun"

                              ↓

  ┌────────────────────────────────────────────────────────────────────────┐
  │ 1. INTENT ANALYSIS                                                     │
  │    ┌────────────────────────────────────────────────────────────────┐  │
  │    │ Parsed Intent:                                                   │  │
  │    │ - Action: CREATE                                                 │  │
  │    │ - Subject: solar system                                          │  │
  │    │ - Objects: sun, 8 planets                                        │  │
  │    │ - Behavior: orbital motion                                       │  │
  │    │ - Domain: 3D astronomy visualization                             │  │
  │    └────────────────────────────────────────────────────────────────┘  │
  └────────────────────────────────────────────────────────────────────────┘
                              ↓

  ┌────────────────────────────────────────────────────────────────────────┐
  │ 2. SKILL CONTEXT BUILDING                                              │
  │    ┌────────────────────────────────────────────────────────────────┐  │
  │    │ Skill: threejs                                                   │  │
  │    │                                                                  │  │
  │    │ Available Capabilities:                                          │  │
  │    │ ✓ primitive (sphere for planets/sun)                            │  │
  │    │ ✓ material (different colors/textures)                          │  │
  │    │ ✓ lighting (sun as point light)                                 │  │
  │    │ ✓ animation (orbital rotation)                                  │  │
  │    │ ✓ camera (overview perspective)                                 │  │
  │    │                                                                  │  │
  │    │ Relevant Examples:                                               │  │
  │    │ - "Create a rotating sphere"                                    │  │
  │    │ - "Add multiple objects to scene"                               │  │
  │    └────────────────────────────────────────────────────────────────┘  │
  └────────────────────────────────────────────────────────────────────────┘
                              ↓

  ┌────────────────────────────────────────────────────────────────────────┐
  │ 3. PROMPT CONSTRUCTION                                                 │
  │    ┌────────────────────────────────────────────────────────────────┐  │
  │    │ System Prompt:                                                   │  │
  │    │ "You are a Three.js expert. Generate valid JavaScript code..."  │  │
  │    │                                                                  │  │
  │    │ User Prompt:                                                     │  │
  │    │ "Create a solar system with 8 planets orbiting the sun.         │  │
  │    │  Use spheres for celestial bodies.                              │  │
  │    │  Each planet should orbit at different speeds.                  │  │
  │    │  Use realistic relative sizes (not to scale).                   │  │
  │    │  Add the sun as a glowing yellow sphere with point light."      │  │
  │    │                                                                  │  │
  │    │ Context:                                                         │  │
  │    │ - Scene is already initialized                                  │  │
  │    │ - Camera and renderer are set up                                │  │
  │    │ - Use the provided template functions                           │  │
  │    └────────────────────────────────────────────────────────────────┘  │
  └────────────────────────────────────────────────────────────────────────┘
                              ↓

  ┌────────────────────────────────────────────────────────────────────────┐
  │ 4. LLM CODE GENERATION                                                 │
  │    ┌────────────────────────────────────────────────────────────────┐  │
  │    │ Model: Claude 3.5 Sonnet / GPT-4                                │  │
  │    │ Temperature: 0.2 (deterministic)                                │  │
  │    │ Max Tokens: 4000                                                │  │
  │    │                                                                  │  │
  │    │ Generated Code:                                                  │  │
  │    │ ```javascript                                                    │  │
  │    │ // Create the Sun                                                │  │
  │    │ const sunGeometry = new THREE.SphereGeometry(2, 32, 32);        │  │
  │    │ const sunMaterial = new THREE.MeshBasicMaterial({               │  │
  │    │   color: 0xffff00                                               │  │
  │    │ });                                                              │  │
  │    │ const sun = new THREE.Mesh(sunGeometry, sunMaterial);           │  │
  │    │ scene.add(sun);                                                  │  │
  │    │                                                                  │  │
  │    │ // Add sun light                                                 │  │
  │    │ const sunLight = new THREE.PointLight(0xffffff, 2, 100);        │  │
  │    │ sunLight.position.set(0, 0, 0);                                 │  │
  │    │ scene.add(sunLight);                                             │  │
  │    │                                                                  │  │
  │    │ // Planet data                                                   │  │
  │    │ const planets = [                                                │  │
  │    │   { name: 'Mercury', size: 0.3, distance: 4, speed: 0.02 },     │  │
  │    │   { name: 'Venus', size: 0.5, distance: 6, speed: 0.015 },      │  │
  │    │   // ... more planets                                           │  │
  │    │ ];                                                               │  │
  │    │                                                                  │  │
  │    │ // Create planets with orbits                                    │  │
  │    │ planets.forEach(planet => {                                     │  │
  │    │   const geometry = new THREE.SphereGeometry(planet.size, 32, 32);│  │
  │    │   const material = new THREE.MeshStandardMaterial({             │  │
  │    │     color: getPlanetColor(planet.name)                          │  │
  │    │   });                                                            │  │
  │    │   const mesh = new THREE.Mesh(geometry, material);              │  │
  │    │                                                                  │  │
  │    │   // Create orbit container                                      │  │
  │    │   const orbit = new THREE.Object3D();                           │  │
  │    │   orbit.add(mesh);                                               │  │
  │    │   mesh.position.x = planet.distance;                            │  │
  │    │   scene.add(orbit);                                              │  │
  │    │                                                                  │  │
  │    │   // Animation                                                   │  │
  │    │   function animatePlanet() {                                    │  │
  │    │     orbit.rotation.y += planet.speed;                           │  │
  │    │   }                                                              │  │
  │    │   animationCallbacks.push(animatePlanet);                       │  │
  │    │ });                                                              │  │
  │    │ ```                                                              │  │
  │    └────────────────────────────────────────────────────────────────┘  │
  └────────────────────────────────────────────────────────────────────────┘
                              ↓

  ┌────────────────────────────────────────────────────────────────────────┐
  │ 5. CODE VALIDATION                                                     │
  │    ┌────────────────────────────────────────────────────────────────┐  │
  │    │ Syntax Check: ✓ Pass                                             │  │
  │    │ - No syntax errors detected                                     │  │
  │    │                                                                  │  │
  │    │ Security Check: ✓ Pass                                           │  │
  │    │ - No dangerous operations (eval, Function constructor)          │  │
  │    │ - No network requests                                           │  │
  │    │                                                                  │  │
  │    │ API Validation: ✓ Pass                                           │  │
  │    │ - All Three.js APIs are valid                                   │  │
  │    │ - Required objects (scene, camera, renderer) are referenced     │  │
  │    │                                                                  │  │
  │    │ Schema Validation: ✓ Pass                                        │  │
  │    │ - Output matches expected skill schema                          │  │
  │    └────────────────────────────────────────────────────────────────┘  │
  └────────────────────────────────────────────────────────────────────────┘
                              ↓

  ┌────────────────────────────────────────────────────────────────────────┐
  │ 6. CODE EXECUTION                                                      │
  │    ┌────────────────────────────────────────────────────────────────┐  │
  │    │ Sandbox: sandbox-002                                             │  │
  │    │                                                                  │  │
  │    │ Execution:                                                       │  │
  │    │ $ node /app/executor.js                                         │  │
  │    │                                                                  │  │
  │    │ Result:                                                          │  │
  │    │ ✓ Code executed successfully                                    │  │
  │    │ ✓ Scene rendered                                                │  │
  │    │ ✓ Animation running                                             │  │
  │    │                                                                  │  │
  │    │ Output:                                                          │  │
  │    │ - Scene state: serialized                                       │  │
  │    │ - Preview URL: /preview/sandbox-002/scene.html                  │  │
  │    └────────────────────────────────────────────────────────────────┘  │
  └────────────────────────────────────────────────────────────────────────┘
                              ↓

  ┌────────────────────────────────────────────────────────────────────────┐
  │ 7. STATE SYNCHRONIZATION                                               │
  │    ┌────────────────────────────────────────────────────────────────┐  │
  │    │ Client Update:                                                   │  │
  │    │ {                                                                │  │
  │    │   type: 'scene_update',                                         │  │
  │    │   sceneId: 'scene-9f2c8d1a',                                    │  │
  │    │   previewUrl: '/preview/sandbox-002/scene.html',                │  │
  │    │   code: '<generated code>',                                     │  │
  │    │   editable: true                                                │  │
  │    │ }                                                                │  │
  │    └────────────────────────────────────────────────────────────────┘  │
  └────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Agent Implementation

```typescript
interface VisualAgent {
  id: string;
  skill: LoadedSkill;
  context: AgentContext;
  
  // Generate code from intent
  generate(intent: ParsedIntent): Promise<GenerationResult>;
  
  // Modify existing code
  modify(currentCode: string, edit: NaturalLanguageEdit): Promise<GenerationResult>;
  
  // Explain the generated code
  explain(code: string): Promise<string>;
  
  // Handle follow-up queries
  followUp(query: string, history: ConversationHistory): Promise<GenerationResult>;
}

class ThreeJSAgent implements VisualAgent {
  id: string;
  skill: LoadedSkill;
  context: AgentContext;
  llm: LLMClient;
  
  constructor(skill: LoadedSkill, llm: LLMClient) {
    this.id = generateId();
    this.skill = skill;
    this.llm = llm;
    this.context = {
      sceneState: null,
      conversationHistory: [],
      generatedCode: null
    };
  }
  
  async generate(intent: ParsedIntent): Promise<GenerationResult> {
    // Build prompt with skill context
    const prompt = this.buildGenerationPrompt(intent);
    
    // Generate code with LLM
    const response = await this.llm.generate({
      model: 'claude-3-5-sonnet',
      messages: [
        { role: 'system', content: this.getSystemPrompt() },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      maxTokens: 4000
    });
    
    // Extract and validate code
    const code = this.extractCode(response.content);
    const validation = await this.validateCode(code);
    
    if (!validation.valid) {
      return this.handleValidationFailure(code, validation.errors);
    }
    
    // Execute in sandbox
    const execution = await this.execute(code);
    
    // Update context
    this.context.generatedCode = code;
    this.context.sceneState = execution.sceneState;
    
    return {
      code,
      previewUrl: execution.previewUrl,
      sceneState: execution.sceneState,
      success: true
    };
  }
  
  private buildGenerationPrompt(intent: ParsedIntent): string {
    const skillContext = this.skill.skill;
    
    return `
You are a Three.js expert. Generate JavaScript code to create a 3D scene based on the user's request.

USER REQUEST: ${intent.rawQuery}

PARSED INTENT:
- Action: ${intent.intentType}
- Target: ${intent.targetDomain}
- Entities: ${JSON.stringify(intent.entities)}
- Constraints: ${JSON.stringify(intent.constraints)}

AVAILABLE CAPABILITIES:
${skillContext.capabilities.map(c => `- ${c.name}: ${c.description}`).join('\n')}

CODE REQUIREMENTS:
1. Use valid Three.js syntax
2. Assume 'scene', 'camera', and 'renderer' are already initialized
3. Use the animation loop pattern provided
4. Include comments explaining key parts
5. Make the code modular and readable

EXAMPLES:
${skillContext.examples.map(e => `Prompt: ${e.prompt}\nCode:\n${e.code}`).join('\n\n')}

Generate the complete JavaScript code:
`;
  }
  
  private async validateCode(code: string): Promise<ValidationResult> {
    const checks = await Promise.all([
      this.checkSyntax(code),
      this.checkSecurity(code),
      this.checkAPIUsage(code)
    ]);
    
    const errors = checks.flatMap(c => c.errors);
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  private async execute(code: string): Promise<ExecutionResult> {
    return await this.skill.runtime.execute({
      code,
      context: this.context.sceneState
    });
  }
}
```

---

## 5. State Management & Synchronization

### 5.1 Scene State Architecture

```typescript
interface SceneState {
  // Unique scene identifier
  id: string;
  
  // Current scene graph
  graph: SceneGraph;
  
  // Generated code
  code: string;
  
  // Version history for undo/redo
  versions: Version[];
  
  // Metadata
  metadata: SceneMetadata;
  
  // User annotations
  annotations: Annotation[];
}

interface SceneGraph {
  nodes: SceneNode[];
  edges: SceneEdge[];
}

interface SceneNode {
  id: string;
  type: 'mesh' | 'light' | 'camera' | 'group' | 'helper';
  name: string;
  properties: Record<string, any>;
  transform: Transform;
  children: string[];
  parent: string | null;
}

interface Transform {
  position: Vector3;
  rotation: Euler;
  scale: Vector3;
}

interface Version {
  id: string;
  timestamp: Date;
  description: string;
  diff: StateDiff;
}
```

### 5.2 State Synchronization Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     STATE SYNCHRONIZATION FLOW                               │
└─────────────────────────────────────────────────────────────────────────────┘

  Client A (Editor)                    Server                      Client B (Viewer)
       │                                  │                               │
       │  1. Code Change                  │                               │
       │  ───────────────────────────────>│                               │
       │                                  │                               │
       │                                  │  2. Validate & Execute        │
       │                                  │  ┌─────────────────────────┐  │
       │                                  │  │ Run in sandbox          │  │
       │                                  │  │ Generate new scene state│  │
       │                                  │  └─────────────────────────┘  │
       │                                  │                               │
       │                                  │  3. Broadcast Update          │
       │  4. Update Preview               │  ────────────────────────────>│
       │  <───────────────────────────────│                               │
       │                                  │                               │
       │                                  │                               │  5. Update Preview
       │                                  │                               │  (synced view)
       │                                  │                               │
       │  6. Edit Request                 │                               │
       │  "Make the sun bigger"           │                               │
       │  ───────────────────────────────>│                               │
       │                                  │                               │
       │                                  │  7. Generate Diff             │
       │                                  │  ┌─────────────────────────┐  │
       │                                  │  │ LLM generates code diff │  │
       │                                  │  │ Apply to existing code  │  │
       │                                  │  └─────────────────────────┘  │
       │                                  │                               │
       │                                  │  8. Execute & Sync            │
       │  9. Show Diff + New Preview      │  ────────────────────────────>│
       │  <───────────────────────────────│                               │
       │                                  │                               │
       │  10. User Accepts                │                               │
       │  ───────────────────────────────>│                               │
       │                                  │                               │
       │                                  │  11. Commit to History        │
       │                                  │  (new version created)        │
       │                                  │                               │
       │                                  │  12. Final Broadcast          │
       │  13. Update UI                   │  ────────────────────────────>│
       │  <───────────────────────────────│                               │
       │                                  │                               │
```

---

## 6. Error Handling & Recovery

### 6.1 Error Classification

```typescript
enum ErrorType {
  // Intent parsing errors
  AMBIGUOUS_INTENT = 'AMBIGUOUS_INTENT',
  UNSUPPORTED_DOMAIN = 'UNSUPPORTED_DOMAIN',
  
  // Skill errors
  SKILL_NOT_FOUND = 'SKILL_NOT_FOUND',
  SKILL_LOAD_FAILED = 'SKILL_LOAD_FAILED',
  SKILL_INCOMPATIBLE = 'SKILL_INCOMPATIBLE',
  
  // Code generation errors
  GENERATION_FAILED = 'GENERATION_FAILED',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  
  // Execution errors
  SYNTAX_ERROR = 'SYNTAX_ERROR',
  RUNTIME_ERROR = 'RUNTIME_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  RESOURCE_EXHAUSTED = 'RESOURCE_EXHAUSTED',
  
  // System errors
  SANDBOX_UNAVAILABLE = 'SANDBOX_UNAVAILABLE',
  NETWORK_ERROR = 'NETWORK_ERROR'
}

interface ErrorRecoveryStrategy {
  type: ErrorType;
  
  // Can this error be recovered from?
  recoverable: boolean;
  
  // Recovery actions to attempt
  actions: RecoveryAction[];
  
  // Fallback behavior if recovery fails
  fallback: FallbackBehavior;
}

const errorStrategies: Map<ErrorType, ErrorRecoveryStrategy> = new Map([
  [ErrorType.AMBIGUOUS_INTENT, {
    type: ErrorType.AMBIGUOUS_INTENT,
    recoverable: true,
    actions: [
      { type: 'CLARIFY', message: 'Could you be more specific about...' },
      { type: 'SUGGEST', options: ['Option A', 'Option B'] }
    ],
    fallback: { type: 'ASK_USER' }
  }],
  
  [ErrorType.SKILL_NOT_FOUND, {
    type: ErrorType.SKILL_NOT_FOUND,
    recoverable: true,
    actions: [
      { type: 'SUGGEST_ALTERNATIVE', findSimilar: true },
      { type: 'FALLBACK_SKILL', defaultSkill: 'canvas2d' }
    ],
    fallback: { type: 'USE_DEFAULT', skill: 'canvas2d' }
  }],
  
  [ErrorType.GENERATION_FAILED, {
    type: ErrorType.GENERATION_FAILED,
    recoverable: true,
    actions: [
      { type: 'RETRY', maxAttempts: 3 },
      { type: 'SIMPLIFY_PROMPT', reduceComplexity: true },
      { type: 'USE_EXAMPLE', fallbackToExample: true }
    ],
    fallback: { type: 'SHOW_ERROR', message: 'Unable to generate visualization' }
  }],
  
  [ErrorType.RUNTIME_ERROR, {
    type: ErrorType.RUNTIME_ERROR,
    recoverable: true,
    actions: [
      { type: 'FIX_CODE', useLLM: true },
      { type: 'ISOLATE_ERROR', runPartial: true }
    ],
    fallback: { type: 'SHOW_PARTIAL', workingCode: true }
  }],
  
  [ErrorType.SANDBOX_UNAVAILABLE, {
    type: ErrorType.SANDBOX_UNAVAILABLE,
    recoverable: true,
    actions: [
      { type: 'WAIT', timeout: 5000 },
      { type: 'SCALE_UP', requestMoreSandboxes: true }
    ],
    fallback: { type: 'QUEUE', notifyWhenReady: true }
  }]
]);
```

### 6.2 Error Recovery Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ERROR RECOVERY FLOW                                    │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────┐
  │  Error Detected │
  │ (Runtime Error) │
  └────────┬────────┘
           │
           ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ 1. CLASSIFY ERROR                                                      │
  │    Error: "Cannot read property 'rotation' of undefined"              │
  │    Type: RUNTIME_ERROR                                                 │
  │    Recoverable: YES                                                    │
  └────────────────────────────────────────────────────────────────────────┘
           │
           ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ 2. ATTEMPT RECOVERY - ACTION 1: Fix Code with LLM                      │
  │    ┌────────────────────────────────────────────────────────────────┐  │
  │    │ Prompt to LLM:                                                   │  │
  │    │ "The following code has an error: [code]                       │  │
  │    │  Error: Cannot read property 'rotation' of undefined           │  │
  │    │  Please fix the code."                                          │  │
  │    └────────────────────────────────────────────────────────────────┘  │
  │    Result: Fixed code generated                                       │
  └────────────────────────────────────────────────────────────────────────┘
           │
           ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ 3. VALIDATE FIX                                                        │
  │    ✓ Syntax check: PASS                                               │
  │    ✓ Security check: PASS                                             │
  │    ? Execution check: RUNNING...                                      │
  └────────────────────────────────────────────────────────────────────────┘
           │
           ├── Success ──► ┌─────────────┐
           │               │   RESUME    │
           │               │  OPERATION  │
           │               └─────────────┘
           │
           └── Failure ──► ┌─────────────────────────────────────────────┐
                           │ 4. ATTEMPT RECOVERY - ACTION 2: Isolate Error│
                           │    ┌──────────────────────────────────────┐  │
                           │    │ Split code into parts:                │  │
                           │    │ - Part 1: Scene setup ✓              │  │
                           │    │ - Part 2: Object creation ✓          │  │
                           │    │ - Part 3: Animation (ERROR) ✗        │  │
                           │    └──────────────────────────────────────┘  │
                           │    Result: Partial code working             │
                           └─────────────────────────────────────────────┘
                                          │
                                          ▼
                           ┌─────────────────────────────────────────────┐
                           │ 5. APPLY FALLBACK                           │
                           │    Show partial result with:                 │
                           │    - Working scene (without animation)       │
                           │    - Error details                           │
                           │    - Suggestion to fix                       │
                           └─────────────────────────────────────────────┘
```

---

## 7. Scaling & Performance

### 7.1 Sandbox Pool Management

```typescript
interface SandboxPool {
  // Warm sandboxes ready to use
  warmPool: Map<string, Sandbox>;
  
  // Active sandboxes with running agents
  activePool: Map<string, Sandbox>;
  
  // Configuration
  config: PoolConfig;
  
  // Metrics
  metrics: PoolMetrics;
}

interface PoolConfig {
  // Minimum warm sandboxes per skill type
  minWarmPerSkill: number;
  
  // Maximum total sandboxes
  maxTotalSandboxes: number;
  
  // Idle timeout before recycling
  idleTimeout: number;
  
  // Scale up threshold
  scaleUpThreshold: number;
  
  // Pre-warmed configurations
  prewarmConfigs: PrewarmConfig[];
}

interface PrewarmConfig {
  skillId: string;
  count: number;
  priority: number;
}

class SandboxPoolManager {
  private pool: SandboxPool;
  private daytona: DaytonaClient;
  
  async initialize(): Promise<void> {
    // Pre-warm sandboxes for high-priority skills
    for (const config of this.pool.config.prewarmConfigs) {
      await this.prewarm(config);
    }
    
    // Start pool monitoring
    this.startMonitoring();
  }
  
  async acquire(requirements: SandboxRequirements): Promise<Sandbox> {
    // 1. Try to find compatible warm sandbox
    const warm = this.findCompatibleWarm(requirements);
    if (warm) {
      this.moveToActive(warm);
      return warm;
    }
    
    // 2. Check if we can create new
    if (this.canCreateNew()) {
      const sandbox = await this.createSandbox(requirements);
      this.moveToActive(sandbox);
      return sandbox;
    }
    
    // 3. Wait for available sandbox
    return this.waitForSandbox(requirements);
  }
  
  async release(sandbox: Sandbox): Promise<void> {
    // Reset sandbox state
    await this.resetSandbox(sandbox);
    
    // Return to warm pool if space available
    if (this.pool.warmPool.size < this.pool.config.maxTotalSandboxes) {
      this.moveToWarm(sandbox);
    } else {
      // Destroy if pool is full
      await this.destroySandbox(sandbox);
    }
  }
  
  private async prewarm(config: PrewarmConfig): Promise<void> {
    const skill = this.registry.get(config.skillId);
    
    for (let i = 0; i < config.count; i++) {
      const sandbox = await this.createSandbox({
        baseImage: skill.runtime.baseImage
      });
      
      // Pre-install common dependencies
      await this.preinstallDependencies(sandbox, skill);
      
      this.pool.warmPool.set(sandbox.id, sandbox);
    }
  }
  
  private startMonitoring(): void {
    setInterval(() => {
      this.checkPoolHealth();
      this.scaleIfNeeded();
      this.cleanupIdle();
    }, 30000);
  }
}
```

### 7.2 Caching Strategy

```typescript
interface CacheStrategy {
  // Code generation cache
  generationCache: LRUCache<string, GenerationResult>;
  
  // Skill loading cache
  skillCache: Map<string, LoadedSkill>;
  
  // Scene state cache
  sceneCache: Map<string, SceneState>;
}

class CacheManager {
  private generationCache: LRUCache<string, GenerationResult>;
  private skillCache: Map<string, LoadedSkill>;
  
  constructor() {
    // Cache code generations by intent hash
    this.generationCache = new LRUCache({
      max: 1000,
      ttl: 1000 * 60 * 60, // 1 hour
      updateAgeOnGet: true
    });
    
    // Cache loaded skills
    this.skillCache = new Map();
  }
  
  // Cache key from intent
  private getCacheKey(intent: ParsedIntent): string {
    return hash({
      query: intent.rawQuery,
      entities: intent.entities,
      skill: intent.targetDomain
    });
  }
  
  async getOrGenerate(
    intent: ParsedIntent,
    generator: () => Promise<GenerationResult>
  ): Promise<GenerationResult> {
    const key = this.getCacheKey(intent);
    
    // Check cache
    const cached = this.generationCache.get(key);
    if (cached) {
      return cached;
    }
    
    // Generate and cache
    const result = await generator();
    this.generationCache.set(key, result);
    
    return result;
  }
}
```

---

## 8. API Design

### 8.1 REST API

```yaml
openapi: 3.0.0
info:
  title: Generative Visual Engine API
  version: 1.0.0

paths:
  /api/v1/generate:
    post:
      summary: Generate visual from natural language
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                query:
                  type: string
                  example: "Create a rotating 3D cube"
                sessionId:
                  type: string
                  description: Optional session for context
                preferences:
                  type: object
                  properties:
                    skill:
                      type: string
                      enum: [threejs, p5js, d3js, auto]
                    quality:
                      type: string
                      enum: [draft, standard, high]
      responses:
        200:
          description: Generation result
          content:
            application/json:
              schema:
                type: object
                properties:
                  sceneId:
                    type: string
                  previewUrl:
                    type: string
                  code:
                    type: string
                  skill:
                    type: string
                  explanation:
                    type: string

  /api/v1/sessions:
    post:
      summary: Create new session
      responses:
        201:
          description: Session created
          content:
            application/json:
              schema:
                type: object
                properties:
                  sessionId:
                    type: string
                  websocketUrl:
                    type: string

  /api/v1/sessions/{sessionId}/modify:
    post:
      summary: Modify existing scene
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                edit:
                  type: string
                  example: "Make the cube red"
      responses:
        200:
          description: Modification result

  /api/v1/skills:
    get:
      summary: List available skills
      responses:
        200:
          description: List of skills
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Skill'

components:
  schemas:
    Skill:
      type: object
      properties:
        id:
          type: string
        name:
          type: string
        description:
          type: string
        capabilities:
          type: array
          items:
            type: string
```

### 8.2 WebSocket Events

```typescript
// Client -> Server
type ClientEvents = {
  // Generate new visual
  'generate': {
    query: string;
    sessionId?: string;
  };
  
  // Modify existing visual
  'modify': {
    sessionId: string;
    edit: string;
  };
  
  // Execute code directly
  'execute': {
    sessionId: string;
    code: string;
  };
  
  // Request explanation
  'explain': {
    sessionId: string;
    target?: string;
  };
  
  // Undo/redo
  'undo': { sessionId: string };
  'redo': { sessionId: string };
  
  // Chat message
  'chat': {
    sessionId: string;
    message: string;
  };
};

// Server -> Client
type ServerEvents = {
  // Generation started
  'generation:started': {
    requestId: string;
    skill: string;
  };
  
  // Generation progress
  'generation:progress': {
    requestId: string;
    stage: 'parsing' | 'selecting' | 'generating' | 'validating' | 'executing';
    message: string;
  };
  
  // Generation completed
  'generation:complete': {
    requestId: string;
    sceneId: string;
    previewUrl: string;
    code: string;
    explanation: string;
  };
  
  // Generation failed
  'generation:error': {
    requestId: string;
    error: string;
    recoverable: boolean;
    suggestions?: string[];
  };
  
  // Scene state update
  'scene:update': {
    sessionId: string;
    sceneState: SceneState;
  };
  
  // Code update (for collaborative editing)
  'code:update': {
    sessionId: string;
    code: string;
    source: 'user' | 'ai';
  };
  
  // Chat response
  'chat:response': {
    sessionId: string;
    message: string;
    actions?: ChatAction[];
  };
};
```

---

## 9. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)
- [ ] Set up Daytona sandbox infrastructure
- [ ] Implement basic sandbox pool management
- [ ] Create skill registry structure
- [ ] Build first skill (Three.js) with templates

### Phase 2: Core Orchestration (Weeks 3-4)
- [ ] Implement request router with intent parsing
- [ ] Build agent factory and lifecycle management
- [ ] Create skill loader with dependency management
- [ ] Implement code generation pipeline

### Phase 3: State & Sync (Weeks 5-6)
- [ ] Build scene state management
- [ ] Implement WebSocket gateway
- [ ] Create state synchronization protocol
- [ ] Add version control for scenes

### Phase 4: Resilience (Weeks 7-8)
- [ ] Implement error classification and recovery
- [ ] Add caching layers
- [ ] Build monitoring and metrics
- [ ] Create auto-scaling for sandbox pool

### Phase 5: Skills Ecosystem (Weeks 9-10)
- [ ] Add p5.js skill
- [ ] Add D3.js skill
- [ ] Create skill SDK for third-party contributions
- [ ] Build skill marketplace structure

### Phase 6: Polish (Weeks 11-12)
- [ ] Collaborative editing features
- [ ] Advanced undo/redo
- [ ] Performance optimizations
- [ ] Documentation and examples

---

## 10. Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React, TypeScript, Monaco Editor, Three.js |
| Backend | Node.js, Fastify, WebSocket (ws) |
| AI/LLM | Claude 3.5 Sonnet / GPT-4 via API |
| Sandboxes | Daytona SDK |
| Database | PostgreSQL (sessions), Redis (cache) |
| Message Queue | Redis Pub/Sub |
| Monitoring | Prometheus, Grafana |

---

## Appendix A: Skill Manifest Format

```json
{
  "id": "threejs",
  "name": "Three.js Renderer",
  "version": "0.160.0",
  "description": "3D scene generation using Three.js",
  "author": "Generative Visual Engine Team",
  "license": "MIT",
  
  "capabilities": [
    {
      "name": "primitive",
      "description": "Create basic 3D primitives",
      "parameters": {
        "type": "object",
        "properties": {
          "shape": { "enum": ["cube", "sphere", "cylinder"] },
          "size": { "type": "number" }
        }
      }
    }
  ],
  
  "runtime": {
    "baseImage": "node:20-alpine",
    "dependencies": ["three@0.160.0"],
    "resources": {
      "memory": "512MB",
      "cpu": "1"
    }
  },
  
  "templates": {
    "entryPoint": "index.js",
    "files": ["scene.js", "primitives.js"]
  },
  
  "examples": [
    {
      "prompt": "Create a red cube",
      "code": "const geometry = new THREE.BoxGeometry(1, 1, 1);..."
    }
  ]
}
```

---

## Appendix B: Directory Structure

```
/
├── apps/
│   ├── web/                    # React frontend
│   ├── api/                    # Fastify backend
│   └── websocket/              # WebSocket server
├── packages/
│   ├── core/                   # Shared types and utilities
│   ├── orchestrator/           # Agent orchestration logic
│   ├── skill-loader/           # Skill loading mechanism
│   └── state-manager/          # Scene state management
├── skills/
│   ├── threejs/                # Three.js skill
│   │   ├── templates/
│   │   ├── examples/
│   │   └── skill.json
│   ├── p5js/                   # p5.js skill
│   └── d3js/                   # D3.js skill
├── infrastructure/
│   ├── docker/                 # Docker configurations
│   ├── terraform/              # Infrastructure as code
│   └── k8s/                    # Kubernetes manifests
└── docs/                       # Documentation
```

---

*Document Version: 1.0*
*Last Updated: 2026-03-26*
