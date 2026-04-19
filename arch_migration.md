# Server Architecture Refactoring & TypeScript Migration Handoff

> **For: Agent Haiku** | **From: Lead Orchestrator**
> **Project:** GVE — `apps/server` (Express + WebSocket + LangGraph)
> **Current:** 34 plain `.js` files, ~20,800 lines, zero TypeScript
> **Target:** Modular TypeScript codebase with strict types

---

## 1. MONOREPO STRUCTURE

```
/home/kage/visualruntime/
├── package.json              # npm workspaces: apps/*, packages/*
├── apps/
│   ├── server/               # Express + WS backend (THIS WORKSTREAM)
│   │   ├── package.json      # @visual-runtime/server, ESM, node --watch
│   │   └── server/           # All 34 JS source files live here (flat)
│   └── web/                  # React frontend (separate workstream)
├── packages/
│   ├── shared/               # @visual-runtime/shared — already .ts (index.ts, 43KB)
│   └── sandbox-pool/         # @visual-runtime/sandbox-pool — JS, Daytona SDK
```

**Dependencies:** Express 5, ws 8, @langchain/core + langgraph, Zod, acorn, cors
**Runtime:** Node ESM (`"type": "module"`), `node --watch server/index.js`
**No tsconfig.json exists yet** for the server package.

---

## 2. COMPLETE FILE INVENTORY

### 2A. Production Files (30 files, ~18,200 lines)

| File | Lines | Domain | Role |
|---|---|---|---|
| **orchestrator.js** | 4,824 | Core | GOD FILE — intent, generation, modification, quality loops, narration, failover |
| **index.js** | 2,569 | Core | GOD FILE — HTTP routes, WS handler, chat turns, streaming, metrics |
| **sandbox-execution.js** | 957 | Runtime | Quality loop executor, sandbox file ops |
| **multi-agent-framework.js** | 900 | Agent | DEAD MODULE — 5 agent roles, never wired in |
| **skill-runtime.js** | 885 | Runtime | Skill execution, sandbox pool integration |
| **session-state.js** | 877 | State | Session/artifact/revision CRUD, persistence |
| **quality-analyzer.js** | 686 | Quality | Code quality scoring (structure, animation, lighting) |
| **sandbox-manager.js** | 588 | Runtime | Sandbox lifecycle, workspace provisioning |
| **tool-registry.js** | 566 | Agent | Tool definitions for agentic loops |
| **code-validator.js** | 527 | Quality | AST-based code validation via acorn |
| **prompt-manager.js** | 526 | LLM | System/user prompt construction |
| **agent-runner.js** | 525 | Agent | Self-debug loop, runtime debug loop |
| **patch-generator.js** | 507 | Quality | Code patching from quality feedback |
| **mode-decision-engine.js** | 416 | Core | Quality tier routing (draft/standard/high) |
| **agent-tools.js** | 396 | Agent | Tool implementations (validate, fix, execute) |
| **llm-pool.js** | 384 | LLM | Provider pool health tracking, acquire/release |
| **pool-based-llm-provider.js** | 374 | LLM | fetchChatCompletion with pool integration |
| **agent-memory.js** | 351 | Agent | Pattern memory across iterations |
| **skill-registry.js** | 337 | Skills | Skill catalog, intent→skill mapping |
| **thought-generator.js** | 284 | LLM | Thinking analysis streaming |
| **llm-provider.js** | 264 | LLM | Provider definitions (7 providers), resolution |
| **media-artifacts.js** | 225 | Media | Media file streaming endpoints |
| **asset-resolver.js** | 205 | Assets | Asset plan resolution |
| **file-store.js** | 190 | State | JSON file persistence for sessions |
| **agent-integration.js** | 163 | Agent | Glue between agent framework and orchestrator |
| **cache-manager.js** | 128 | Cache | Generation cache (get/set/stats) |
| **skill-loader.js** | 108 | Skills | Dynamic skill module loading |
| **env.js** | 101 | Config | Environment variable loading, dotenv |
| **agent-implementation-summary.js** | ~50 | Agent | Documentation/summary (dead code) |
| **demo-agents-live.js** | ~50 | Agent | Demo script (dead code) |

### 2B. Test Files (4 files, ~1,700 lines) — Move to `__tests__/`

| File | Lines |
|---|---|
| test-agentic-implementation.js | 604 |
| test-agents-live.js | 322 |
| test-agents-pool.js | 186 |
| test-agent-execution.js | ~100 |

---

## 3. ARCHITECTURE PROBLEMS & DECOMPOSITION PLAN

### 3A. DECOMPOSE `orchestrator.js` (4,824 lines → 6 modules)

**Current exports (10 functions):**
- `generateThinkingAnalysis` (line 1932)
- `generatePostTurnNarration` (line 2032)
- `parseIntentFromQuery` (line 2544)
- `resolveChatTurn` (line 2657) — the main entry point
- `isValidationPassable` (line 3953)
- `planTasks` (line 4111)
- `executeTask` (line 4122)
- `generateVisual` (line 4138)
- `modifyVisual` (line 4151)
- `generateFromImage` (line 4554)

**Current imports consumed by this file:**
```
@langchain/langgraph (Annotation, END, START, StateGraph)
zod
./prompt-manager.js, ./skill-runtime.js, ./sandbox-execution.js
./skill-registry.js, ./code-validator.js, ./mode-decision-engine.js
./cache-manager.js, ./agent-runner.js, ./agent-tools.js
./llm-pool.js, ./asset-resolver.js
```

**Target decomposition:**

| New Module | Source Lines (approx) | Exports | Description |
|---|---|---|---|
| `pipeline/intent-classifier.ts` | ~600 | `parseIntentFromQuery`, `isGreetingQuery`, `hasActionIntent`, `isModifyRequest`, etc. | All 10+ regex-based intent heuristics scattered as free functions |
| `pipeline/code-generator.ts` | ~800 | `generateVisual`, `generateFromImage`, `streamCodeGeneration` | Code generation flow, LLM calls, code extraction |
| `pipeline/code-modifier.ts` | ~600 | `modifyVisual`, `computeDiff`, `detectNoopModification` | Modify flow, diff computation |
| `pipeline/runtime-executor.ts` | ~500 | `executeSkillRuntimeWithQualityDecision`, `resolveIterationConfig` | Runtime execution, quality loop dispatch |
| `pipeline/conversation.ts` | ~400 | `resolveChatTurn`, `generateThinkingAnalysis`, `generatePostTurnNarration` | Conversation routing, narration |
| `pipeline/failover.ts` | ~200 | `executeWithProviderFailover` | LLM provider rotation, retry logic, 429 handling |
| `orchestrator.ts` | ~300 | Re-exports from pipeline modules + `planTasks`, `executeTask` | Thin facade preserving existing API |

**Rules:**
- The `orchestrator.ts` facade MUST re-export the same function signatures so `index.js` doesn't break
- `parseBooleanEnv`, `parseRetryDelays`, `sleep`, `truncateDiagnostic` → extract to `lib/utils.ts`
- The LangGraph `StateGraph` + `Annotation` setup stays in the facade or a dedicated `pipeline/graph.ts`
- Hardcoded `moonshotBaseUrl`/`moonshotApiKey` constants → move to provider config

### 3B. DECOMPOSE `index.js` (2,569 lines → 5 modules)

**Current structure (all inline):**
- Lines 1-50: Imports + Express/WS setup
- Lines 50-100: Metrics object, module-scoped state
- Lines 100-600: HTTP REST routes (sessions, versions, skills, health, metrics)
- Lines 600-1200: WebSocket message handler (350-line async IIFE)
- Lines 1200-2000: `executeChatTurn()` — 500+ line async function
- Lines 2000-2400: Thought/code streaming, post-turn narration
- Lines 2400-2569: Server startup, shutdown, upgrade handler

**Target decomposition:**

| New Module | Description |
|---|---|
| `routes/api.ts` | REST endpoints: sessions, versions, skills, health, metrics, media |
| `routes/chat.ts` | `executeChatTurn()` function and helpers |
| `ws/handler.ts` | WebSocket message dispatcher, connection lifecycle |
| `ws/streaming.ts` | Thought streaming, code streaming, progress events |
| `index.ts` | Thin entry: Express app, HTTP server, WS upgrade, startup/shutdown |

**Rules:**
- `index.ts` should be <200 lines
- `executeChatTurn` must be extracted intact — it's the critical path
- The `wsClients` Set and `broadcast` helper → `ws/handler.ts`
- Metrics object → `lib/metrics.ts`

### 3C. FIX `agent-runner.js` — BYPASSES LLM POOL

**Problem:** `agent-runner.js` calls `fetchAgentCompletion()` which hardcodes Moonshot API credentials directly, bypassing the `LLMProviderPool` failover system. If Moonshot is rate-limited (429), the self-debug loop fails immediately.

**Fix:**
1. Import `getPool` from `./llm-pool.js`
2. Replace `fetchAgentCompletion(messages, tools)` with:
```ts
const pool = getPool();
const provider = pool.acquire({ capability: 'codeGeneration' });
const response = await fetchChatCompletion(provider, { messages, tools });
pool.release(provider);
```
3. Remove the hardcoded `MOONSHOT_API_KEY` / `MOONSHOT_BASE_URL` usage

### 3D. DEAD CODE REMOVAL

| File | Lines | Reason | Action |
|---|---|---|---|
| `multi-agent-framework.js` | 900 | Never imported by orchestrator, uses wrong LLM API pattern, all agents fall back to mock | **DELETE** or move to `_archived/` |
| `agent-implementation-summary.js` | ~50 | Documentation artifact, not code | **DELETE** |
| `demo-agents-live.js` | ~50 | Demo script | **DELETE** |
| `test-*.js` (4 files) | ~1,700 | Test files in production directory | **MOVE** to `__tests__/` |

### 3E. SESSION STATE CLEANUP

**Problem:** `session-state.js` has 3 overlapping pointer systems (`versions`, `sceneVersions`, `revisions`) and calls `normalizeArtifacts()` on every read — O(n) normalization per access.

**Fix:**
1. Normalize ONCE on load/mutation, not on every read
2. Consolidate naming: use only `revisions` (drop `versions`, `sceneVersions` as primary)
3. Keep backward-compat by computing `versions`/`sceneVersions` as derived getters in `cloneSessionState()`
4. Add proper deep-clone for nested objects (current shallow clone leaks mutations)

### 3F. DUPLICATE UTILITY EXTRACTION

These functions appear in multiple files — extract to `lib/utils.ts`:

| Function | Found In |
|---|---|
| `parseBooleanEnv()` | `orchestrator.js`, `index.js` |
| `sleep()` | `orchestrator.js`, `agent-runner.js`, `sandbox-execution.js` |
| `truncateDiagnostic()` | `orchestrator.js`, `agent-runner.js` |
| `parseTemperature()` | `orchestrator.js` |

---

## 4. TYPESCRIPT MIGRATION PLAN

### 4A. SETUP

1. **Create `apps/server/tsconfig.json`:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./server",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["server/**/*.ts"],
  "exclude": ["node_modules", "dist", "server/__tests__"]
}
```

2. **Add dev dependencies to `apps/server/package.json`:**
```json
"devDependencies": {
  "typescript": "^6.0.2",
  "tsx": "^4.19.0",
  "@types/node": "^22.0.0",
  "@types/express": "^5.0.0",
  "@types/cors": "^2.8.17",
  "@types/ws": "^8.18.0"
}
```

3. **Update scripts:**
```json
"scripts": {
  "dev": "tsx --watch server/index.ts",
  "build": "tsc",
  "start": "node dist/index.js",
  "typecheck": "tsc --noEmit"
}
```

### 4B. MIGRATION ORDER (dependency-first)

Migrate bottom-up — leaf modules with zero internal imports first, then work up the dependency tree.

```
Phase 1: Leaf utilities (zero internal deps)
  1. env.js → env.ts
  2. lib/utils.ts (NEW — extracted duplicates)
  3. file-store.js → file-store.ts
  4. cache-manager.js → cache-manager.ts

Phase 2: LLM layer
  5. llm-provider.js → llm/provider.ts
  6. llm-pool.js → llm/pool.ts
  7. pool-based-llm-provider.js → llm/fetch.ts

Phase 3: Skills & Sandbox
  8. skill-loader.js → skills/loader.ts
  9. skill-registry.js → skills/registry.ts
  10. sandbox-manager.js → sandbox/manager.ts
  11. skill-runtime.js → sandbox/skill-runtime.ts
  12. sandbox-execution.js → sandbox/execution.ts

Phase 4: Quality & Validation
  13. code-validator.js → quality/validator.ts
  14. quality-analyzer.js → quality/analyzer.ts
  15. patch-generator.js → quality/patcher.ts
  16. mode-decision-engine.js → quality/mode-engine.ts

Phase 5: Agent system
  17. agent-tools.js → agents/tools.ts
  18. agent-memory.js → agents/memory.ts
  19. agent-runner.js → agents/runner.ts
  20. agent-integration.js → agents/integration.ts
  21. tool-registry.js → agents/tool-registry.ts

Phase 6: Pipeline (from decomposed orchestrator)
  22. prompt-manager.js → pipeline/prompts.ts
  23. asset-resolver.js → pipeline/assets.ts
  24. thought-generator.js → pipeline/thoughts.ts
  25. pipeline/intent-classifier.ts (NEW)
  26. pipeline/code-generator.ts (NEW)
  27. pipeline/code-modifier.ts (NEW)
  28. pipeline/runtime-executor.ts (NEW)
  29. pipeline/conversation.ts (NEW)
  30. pipeline/failover.ts (NEW)
  31. orchestrator.ts (facade)

Phase 7: Server entry (from decomposed index.js)
  32. media-artifacts.js → routes/media.ts
  33. session-state.js → state/session.ts
  34. routes/api.ts (NEW)
  35. routes/chat.ts (NEW)
  36. ws/handler.ts (NEW)
  37. ws/streaming.ts (NEW)
  38. index.ts (entry)
```

### 4C. KEY TYPES TO DEFINE

Create `types/` directory with shared interfaces:

**`types/session.ts`:**
```ts
export interface SceneVersion {
  versionId: string;
  version: number;
  artifactId: string;
  artifactVersion: number;
  source: 'generate' | 'modify' | 'image-to-code' | 'fallback';
  sceneId: string;
  code: string | null;
  previewUrl: string | null;
  skill: string | null;
  outputKind: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Artifact {
  artifactId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revisions: SceneVersion[];
  revisionPointer: number;
}

export interface SessionState {
  sessionId: string;
  status: 'idle' | 'generating' | 'modifying' | 'error';
  artifacts: Artifact[];
  artifactPointer: number;
  currentScene: SceneVersion | null;
  messages: SessionMessage[];
  orchestrationTrace: TraceEntry[];
  createdAt: string;
  updatedAt: string;
}
```

**`types/llm.ts`:**
```ts
export interface ProviderDefinition {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  priority: number;
  capabilities: { codeGeneration: boolean; thinking: boolean; vision: boolean; streaming: boolean };
  limits: { rpm: number; concurrency: number };
  cooldownMs: number;
  payloadTransform: ((payload: any, options?: any) => any) | null;
}

export interface ResolvedProvider extends ProviderDefinition {
  apiKey: string;
  hasApiKey: boolean;
}

export type QualityTier = 'draft' | 'standard' | 'high';
export type SkillId = 'threejs' | 'p5js' | 'd3js' | 'animejs' | 'manim' | 'auto';
```

**`types/orchestrator.ts`:**
```ts
export interface ChatTurnRequest {
  sessionId: string;
  query: string;
  quality?: QualityTier;
  skill?: SkillId;
  imageData?: string;
}

export interface ChatTurnResult {
  intent: string;
  reply: string;
  sceneVersion?: SceneVersion;
  error?: string;
}
```

### 4D. PER-FILE MIGRATION RULES

1. **Rename `.js` → `.ts`** and fix all import paths (add `.js` extension for NodeNext resolution)
2. **Add explicit types** to all function parameters and return types
3. **Replace `/** @param` JSDoc** with TypeScript signatures
4. **Use `unknown` over `any`** — cast explicitly where needed
5. **Zod schemas** already exist in orchestrator — convert to `z.infer<typeof schema>` types
6. **Keep the same export API** — downstream consumers must not break
7. **Module-scoped mutable state** (e.g., `const sessions = new Map()` in session-state) → type the Map generic: `Map<string, SessionState>`

---

## 5. TARGET DIRECTORY STRUCTURE

```
apps/server/
├── tsconfig.json
├── package.json
└── server/
    ├── index.ts                    # Thin entry (~200 lines)
    ├── env.ts                      # Environment loading
    ├── orchestrator.ts             # Facade re-exporting pipeline modules
    │
    ├── types/
    │   ├── session.ts
    │   ├── llm.ts
    │   └── orchestrator.ts
    │
    ├── lib/
    │   ├── utils.ts                # parseBooleanEnv, sleep, truncate
    │   └── metrics.ts              # In-memory metrics
    │
    ├── llm/
    │   ├── provider.ts             # Provider definitions
    │   ├── pool.ts                 # LLMProviderPool class
    │   └── fetch.ts                # fetchChatCompletion
    │
    ├── pipeline/
    │   ├── intent-classifier.ts
    │   ├── code-generator.ts
    │   ├── code-modifier.ts
    │   ├── runtime-executor.ts
    │   ├── conversation.ts
    │   ├── failover.ts
    │   ├── prompts.ts
    │   ├── thoughts.ts
    │   └── assets.ts
    │
    ├── quality/
    │   ├── validator.ts
    │   ├── analyzer.ts
    │   ├── patcher.ts
    │   └── mode-engine.ts
    │
    ├── agents/
    │   ├── runner.ts
    │   ├── tools.ts
    │   ├── tool-registry.ts
    │   ├── memory.ts
    │   └── integration.ts
    │
    ├── sandbox/
    │   ├── manager.ts
    │   ├── skill-runtime.ts
    │   └── execution.ts
    │
    ├── skills/
    │   ├── loader.ts
    │   └── registry.ts
    │
    ├── state/
    │   ├── session.ts
    │   └── file-store.ts
    │
    ├── routes/
    │   ├── api.ts
    │   ├── chat.ts
    │   └── media.ts
    │
    ├── ws/
    │   ├── handler.ts
    │   └── streaming.ts
    │
    └── __tests__/
        ├── test-agentic-implementation.ts
        ├── test-agents-live.ts
        ├── test-agents-pool.ts
        └── test-agent-execution.ts
```

---

## 6. EXECUTION ORDER

```
Phase A: Setup (non-breaking)
  1. Create tsconfig.json
  2. Add TypeScript + tsx dev dependencies
  3. Create types/ directory with interfaces
  4. Create lib/utils.ts (extract duplicated functions)
  5. Move test files to __tests__/
  6. Delete dead code (multi-agent-framework, demo files, summary file)

Phase B: Leaf module migration (can be parallel)
  7. env.js → env.ts
  8. file-store.js → state/file-store.ts
  9. cache-manager.js → cache-manager.ts (or lib/cache.ts)
  10. llm-provider.js → llm/provider.ts

Phase C: LLM + Skills layer
  11. llm-pool.js → llm/pool.ts
  12. pool-based-llm-provider.js → llm/fetch.ts
  13. skill-loader.js → skills/loader.ts
  14. skill-registry.js → skills/registry.ts

Phase D: Sandbox + Quality
  15. sandbox-manager.js → sandbox/manager.ts
  16. skill-runtime.js → sandbox/skill-runtime.ts
  17. sandbox-execution.js → sandbox/execution.ts
  18. code-validator.js → quality/validator.ts
  19. quality-analyzer.js → quality/analyzer.ts
  20. patch-generator.js → quality/patcher.ts
  21. mode-decision-engine.js → quality/mode-engine.ts

Phase E: Agent system
  22. agent-tools.js → agents/tools.ts
  23. agent-memory.js → agents/memory.ts
  24. agent-runner.js → agents/runner.ts (+ fix pool bypass)
  25. agent-integration.js → agents/integration.ts
  26. tool-registry.js → agents/tool-registry.ts

Phase F: Orchestrator decomposition
  27. prompt-manager.js → pipeline/prompts.ts
  28. asset-resolver.js → pipeline/assets.ts
  29. thought-generator.js → pipeline/thoughts.ts
  30. Decompose orchestrator.js → 6 pipeline modules + facade
  31. media-artifacts.js → routes/media.ts
  32. session-state.js → state/session.ts

Phase G: Server entry decomposition
  33. Decompose index.js → routes/api.ts + routes/chat.ts + ws/*.ts + index.ts

Phase H: Verification
  34. npx tsc --noEmit passes
  35. Server starts and accepts WS connections
  36. Full chat turn completes successfully
  37. Undo/redo/version navigation works
```

---

## 7. CRITICAL CONSTRAINTS

1. **DO NOT break the WebSocket contract.** The frontend expects specific message types (`scene_update`, `code_update`, `thought_stream`, `progress`, etc.). Preserve all message shapes exactly.
2. **DO NOT change REST API routes.** `/api/sessions`, `/api/sessions/:id/versions`, `/api/health`, etc. must remain identical.
3. **The `@visual-runtime/shared` package is already TypeScript.** Import its types directly.
4. **The `@visual-runtime/sandbox-pool` is still JS.** Don't migrate it in this workstream — just add a `.d.ts` declaration if needed.
5. **LangGraph integration:** The orchestrator uses `@langchain/langgraph` `StateGraph` + `Annotation`. These have good TypeScript support — use their generic types.
6. **Preserve the `orchestrator.ts` facade** — `index.ts` imports from `./orchestrator.js` with a specific set of named exports. The facade must re-export the exact same names.

---

## 8. VERIFICATION CHECKLIST

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] `tsx server/index.ts` starts the server on port 8000
- [ ] WebSocket connection from frontend establishes
- [ ] A full chat turn ("Create a rotating cube") completes end-to-end
- [ ] Scene version undo/redo works
- [ ] LLM provider failover triggers correctly on 429
- [ ] No `.js` files remain in `server/` (except generated dist)
- [ ] All test files are in `__tests__/`
- [ ] No dead code files remain
- [ ] `lib/utils.ts` contains all previously-duplicated functions
- [ ] `orchestrator.ts` facade re-exports match the old API surface exactly
