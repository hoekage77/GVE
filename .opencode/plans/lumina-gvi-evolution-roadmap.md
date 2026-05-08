# Lumina GVI — Platform Evolution Roadmap

> **Status:** Foundation (Phases 1–6) complete. Phase A in design. Phases B–D planned.
>
> **Date:** 2025-05-06
> **Context:** This document captures the architectural decisions and implementation plan for evolving Lumina GVI from a backend-sandbox execution model to a client-first, streaming, vision-augmented generative visual platform.

---

## Executive Summary

The current Lumina GVI pipeline sends all generated code — including browser-native JavaScript (Three.js, p5.js, D3.js) — through a backend Node.js VM that mocks `document`, WebGL, Canvas, and `requestAnimationFrame`. This is architecturally backwards: the browser is the native runtime, and mocking it in a sandbox produces inaccurate quality signals, wastes compute, and adds unnecessary latency.

This roadmap proposes:

1. **Remove the backend sandbox entirely for JS skills.** Make the client browser the sole execution authority.
2. **Streaming generation.** Stream code to the client as the LLM generates it, executing incrementally for real-time visual feedback.
3. **Asset pipeline.** Integrate generated textures, curated 3D models, fonts, and audio.
4. **Vision-in-the-loop.** Capture rendered frames, send them to a vision model, and use actual visual assessment instead of regex-based quality scoring.

---

## Part 1: Architecture Today

### 1.1 Pipeline Flow

```
[User Message] → WebSocket → executeChatTurn → generationGraph.invoke
  → parse_intent → select_skill → build_prompt → generate_code
    → code:stream (to client for display only)
    → validate_code
    → execute_code
      → executeSkillRuntimeWithQualityDecision
        → QualityLoopRunner
          → SkillRuntime.acquire (Daytona/Docker sandbox)
          → SkillRuntime.execute
            → JavaScriptSceneAdapter
              → runner-script.js (Node.js VM with mocked browser APIs)
          → analyzeQuality (static + runtime + visual + semantic)
          → [patch] → re-execute → ...
    → build_response
  → scene:update + turn:complete (to client)
```

### 1.2 The Sandbox Problem

For JavaScript skills, `runner-script.js` (`/packages/sandbox-pool/src/runner-script.js`, 1154 lines) creates a `node:vm` context and injects:

- **Mock `THREE`** — `Vector3`, `Scene`, `WebGLRenderer`, `Mesh`, etc. `renderer.render()` increments a counter. No actual GPU.
- **Mock `p5`** — Procedural drawing API. Records `ellipse()`/`rect()` calls. No actual Canvas.
- **Mock `d3`** — Fluent chainable API. No actual SVG.
- **Mock `anime`** — Timeline/stagger functions. No actual DOM animation.

The sandbox then runs user code via `new Script(code).runInContext(context)`, pumps a fake `requestAnimationFrame` queue up to `maxFrames` (default 48), and returns:

```json
{
  "success": true,
  "renderCount": 3,
  "frameCount": 48,
  "logs": ["[warn] THREE.WebGLRenderer: ..."],
  "summary": { "childCount": 5, "types": ["Mesh", "Light"] },
  "error": null
}
```

**Why this is wrong:**
- **Accuracy gap:** Mock WebGL ≠ real WebGL. Driver bugs, shader compilation differences, and performance characteristics are invisible.
- **Latency tax:** ~500–2000ms to acquire, prepare, execute, and release a sandbox for code that will run in the browser anyway.
- **Resource waste:** Docker/VM spawning to fake a browser environment.
- **False signals:** A scene that "renders" 48 frames in the sandbox might fail on a real Intel iGPU due to shader precision issues.

### 1.3 Quality Loop Dependency

The `QualityLoopRunner` (`/apps/server/server/sandbox/runtime/quality-loop.ts`) runs:

```
for iter = 1..maxIterations:
  staticValidation = validateCode(code)          // AST + regex
  runtimeResult    = sandbox.execute(code)        // Node.js VM
  qualitySignals   = analyzeQuality(code, prompt, runtimeResult)
  if qualitySignals.composite >= threshold: break
  patchGoals       = generatePatchGoals(qualitySignals)
  code             = PatchGenerator(patchGoals)   // LLM
```

`analyzeQuality()` weights four dimensions:

| Dimension | Weight | Source | If Sandbox Removed |
|---|---|---|---|
| Static | 0.15 | AST + regex on code | Unchanged |
| Runtime | 0.25 | Sandbox logs, fps, errors, duration | **Lost** — needs client telemetry |
| Visual | 0.35 | Regex on code (material/light counts) | Unchanged (but inaccurate) |
| Semantic | 0.25 | Prompt keyword matching | Unchanged |

Without runtime signals, the maximum achievable score drops from 100 to ~75, making the quality threshold (75 for standard, 85 for high) impossible to reach.

---

## Part 2: Phase A — Client-First Execution

### 2.1 Principle

For JS skills (`threejs`, `p5js`, `d3js`, `animejs`), the client browser is the sole execution environment. The backend generates code, streams it to the client, and receives execution telemetry back. The backend sandbox is bypassed entirely.

Python/Manim skills continue using the backend sandbox (they genuinely need server-side rendering to produce MP4 video).

### 2.2 New Data Flow

```
[User Message] → WebSocket → executeChatTurn → generationGraph.invoke
  → parse_intent → select_skill → build_prompt → generate_code
    → code:stream (to client — execute immediately as it arrives)
    → validate_code (static only)
    → execute_code [JS skills]
      → SKIP sandbox entirely
      → Return optimistic result: status = "client-rendered"
      → QualityLoopRunner uses static + visual + semantic only
      → Runtime score populated from client-validation-cache
    → build_response
  → scene:update + turn:complete (to client)

[Client Browser]
  → Receives code via code:stream / generation:complete
  → SceneViewer iframe executes with real WebGL/Canvas
  → Captures: renderCount, frameCount, fps, console.errors, console.warns
  → Sends client:validation_result via WebSocket
  → Server stores in client-validation-cache
```

### 2.3 Files to Modify

#### Backend

| File | Change |
|---|---|
| `sandbox/runtime/quality-loop.ts` | Short-circuit `runtime.execute()` for JS skills. Still run static validation, visual analysis, semantic analysis. Read runtime data from `client-validation-cache`. |
| `pipeline/graph/nodes/execute-code.ts` | Bypass `executeSkillRuntimeWithQualityDecision` for JS skills. Set `execution.success = true` with `status: "client-rendered"`. |
| `pipeline/runtime-executor.ts` | `executeSkillRuntimeWithQualityDecision` returns immediately for JS skills. No `QualityLoopRunner` instantiation. |
| `sandbox/runtime/client-rendering-runtime.ts` | Expand to return full runtime metrics from cache (fps, memory, errors, warnings, renderCount, frameCount, durationMs). |
| `sandbox/runtime/client-validation-cache.ts` | Expand schema: add `fps`, `memoryMb`, `warningCount`, `deviceInfo`. |
| `sandbox/runtime/index.ts` | Make `ClientRenderingRuntime` the default for JS skills. Remove `CLIENT_RENDERING_ENABLED` toggle — it's the only path. |
| `quality/analyzer.ts` | `analyzeRuntimeQuality()` should accept client-provided structured metrics directly instead of scraping fps from log strings. |
| `sandbox/skill-runtime.ts` | JS skill paths become dead code. Either delete or guard behind `skillId === "manim"`. |
| `sandbox/adapters/javascript-adapter.ts` | Unused for JS skills. Can be deleted or kept as reference. |
| `packages/sandbox-pool/src/runner-script.js` | JS mock sections (Three.js, p5.js, D3, anime) become dead code. Keep Python/Manim sections. |
| `pipeline/graph/recovery/runtime-recovery.ts` | `attemptRuntimeAgentRecovery` relies on sandbox execution to test fixes. For JS skills, recovery must be deferred: store failed code + error context, and re-run generation on the next user turn using cached client errors. |

#### Client

| File | Change |
|---|---|
| `lib/client-skill-runner.ts` | Expand telemetry capture: compute FPS from `requestAnimationFrame` delta timing, capture `performance.memory` (Chrome), count `console.warn`, measure `performance.now()` execution duration. |
| `hooks/useClientSkillValidation.ts` | Always enabled for JS skills. Remove debounce — run immediately on code arrival. Send results as soon as execution stabilizes (e.g., after 500ms of no new errors). |
| `components/SceneViewer.tsx` | Already executes real code. Add `postMessage` telemetry reporting in addition to error reporting. Send structured scene summary (child count, types) back to parent. |
| `stores/chat/infraSlice.ts` | Handle `client:validation_complete` events from server to update UI with quality scores. |

### 2.4 Runtime Telemetry Schema (Client → Server)

```typescript
interface ClientRuntimeTelemetry {
  sessionId: string;
  skillId: string;
  
  // Execution
  success: boolean;
  status: "completed" | "error" | "timeout";
  durationMs: number;        // performance.now() delta
  
  // Rendering
  renderCount: number;       // e.g. renderer.render() calls
  frameCount: number;        // rAF callbacks executed
  fps: number;                // average over validation window
  
  // Memory (Chrome only)
  memoryMb?: number;         // performance.memory.usedJSHeapSize / 1e6
  
  // Errors / Warnings
  errorCount: number;
  warningCount: number;
  logs: { level: "log" | "warn" | "error"; message: string; timestamp: string }[];
  
  // Scene graph
  summary: {
    childCount: number;
    types: string[];          // e.g. ["Mesh", "PointLight", "PerspectiveCamera"]
  };
  
  // Device context (for normalizing scores)
  deviceInfo?: {
    hardwareConcurrency: number;
    gpuRenderer?: string;      // gl.getParameter(GL_RENDERER)
    devicePixelRatio: number;
  };
}
```

### 2.5 Quality Loop with Client Telemetry

```
for iter = 1..maxIterations:
  staticValidation = validateCode(code)           // Server-side AST
  
  // For JS skills: runtime data comes from cache, not sandbox
  clientResult = getLatestClientValidationResult(sessionId, skillId)
  runtimeResult = clientResult ?? { score: 0, ... }  // fallback if no telemetry yet
  
  visualResult = analyzeVisualQuality(code, skill)    // Regex (unchanged)
  semanticResult = analyzeSemanticQuality(code, prompt, skill)  // Keyword match (unchanged)
  
  qualitySignals = { static, runtime: runtimeResult, visual, semantic }
  composite = calculateCompositeScore(qualitySignals)
  
  if composite >= threshold: break
  patchGoals = generatePatchGoals(qualitySignals)
  code = PatchGenerator(patchGoals)
  
  // Code is streamed to client; client executes and reports back
  // Next iteration reads updated client-validation-cache
```

**Important timing note:** On the *first* turn for a session, there is no cached client telemetry. The quality loop runs with runtime score = 0 (or a conservative default). After the client renders and reports back, subsequent turns in the same session use real telemetry. For iterative quality-loop patching *within* a single turn, we may need to:
- Stream patched code immediately to the client
- Wait for client telemetry (with a timeout)
- Continue the loop

This adds latency to the quality loop, but eliminates the sandbox overhead entirely.

### 2.6 Security Considerations

Currently the client iframe runs with `sandbox="allow-scripts allow-pointer-lock"`. User-generated code executes in the same origin as the app.

**Hardening:**
- **Separate origin:** Serve the iframe from `sandbox.lumina.app` (subdomain). `postMessage` is the only communication channel. User code cannot access `localStorage`, cookies, or the parent DOM.
- **CSP:** `script-src 'self'` inside the iframe. Block `eval` and `new Function` from user code (the platform itself uses `new Function` to execute; this is acceptable because the platform controls the injected code).
- **Resource limits:** Cap `requestAnimationFrame` pumping in the validation iframe (already done at 48 frames). Limit WebGL texture sizes to prevent GPU memory exhaustion.

### 2.7 Fallback Strategy

If client telemetry is unavailable (e.g., user on a headless browser, WebGL disabled, or ad-blocker preventing WebSocket), degrade gracefully:
- Server falls back to static-only quality scoring (max ~75 composite)
- Set `warning: "Client rendering unavailable; quality assessment limited"`
- Do NOT fall back to backend sandbox — the sandbox is being removed.

---

## Part 3: Phase B — Streaming Generation

### 3.1 Current State

Code is generated fully by the LLM, then broadcast as `code:stream` chunks to the client. The client only *displays* the code; execution happens after the full payload arrives.

### 3.2 Target State (v0.dev / Bolt.new style)

Stream code to the client *as the LLM generates it*. The client compiles and executes incrementally. The user sees the scene build in real-time.

### 3.3 Architecture

```
[LLM token stream] → Server buffers → AST-valid chunks → WebSocket code:stream
  → Client receives chunk
    → Attempts to execute in iframe
    → If syntax error: keep previous valid state, wait for next chunk
    → If success: scene updates visibly
  → Repeat until LLM stream ends
```

### 3.4 Implementation

#### Server Side

1. **Buffering strategy:** Instead of sending raw tokens, accumulate until we have a syntactically valid JS construct (a statement, function declaration, or closing brace). Use `acorn.parseExpressionAt` or a lightweight tokenizer to detect completeness.

2. **Chunk boundaries:** Send chunks at natural breakpoints:
   - After a complete function declaration
   - After a `new THREE.Mesh(...)` constructor call
   - After a `renderer.render()` call
   - Never mid-string-literal

3. **WebSocket streaming:** Reuse existing `code:stream` event type. The client already consumes `reset`, `delta`, `done` flags. We just need to send deltas more frequently and start sending *before* the LLM completes.

#### Client Side

1. **Incremental execution:**
   ```typescript
   let validCode = "";
   let lastExecutedCode = "";
   
   function onCodeDelta(delta: string) {
     validCode += delta;
     
     // Try to execute
     try {
       // For Three.js: we can safely re-run the whole script
       // because Three.js objects are re-created each time
       executeInIframe(validCode);
       lastExecutedCode = validCode;
     } catch (e) {
       // Syntax error — likely incomplete. Revert to last known good.
       validCode = lastExecutedCode;
       // Silently wait for next chunk
     }
   }
   ```

2. **Debounced re-execution:** Don't execute on every token. Debounce by 150ms of idle streaming. This batches rapid deltas into a single execution attempt.

3. **State preservation:** For some skills (e.g., D3.js with data binding), full re-execution clears existing DOM. Use a diffing strategy:
   - Compare new code AST with previous AST
   - Only re-execute changed functions
   - For Three.js, this is less critical because the scene is rebuilt quickly

### 3.5 Challenges

| Challenge | Mitigation |
|---|---|
| Incomplete syntax mid-stream | Buffer until AST-valid; use Acorn recovery mode |
| Variable references before declaration | Most LLMs generate top-down; if not, buffer until declaration is complete |
| Flickering / full re-renders | Debounce 150ms; diff AST changes |
| WebGL context loss from rapid re-init | Reuse canvas/context; dispose old geometries/materials selectively |
| Performance on low-end devices | Skip execution if `fps < 10` on last attempt; show code-only until stream ends |

---

## Part 4: Phase C — Asset Pipeline Integration

### 4.1 Current State

All assets are procedural. A prompt like "a rusty metal sphere with wood floor" generates code that creates `MeshStandardMaterial` with procedurally generated colors. No actual textures or external models.

### 4.2 Target State

The LLM can reference and embed external assets: generated textures, curated 3D models, fonts, and audio.

### 4.3 Components

#### 4.3.1 Texture Generation

- **Engine:** Stable Diffusion XL / Flux via API (Replicate, Fal.ai, or self-hosted)
- **Prompt construction:** Extract material descriptions from user prompt via LLM, then send to image generation
  - Input: "a rusty metal sphere"
  - Material prompt: "seamless PBR rust texture, high detail, 1024x1024, tileable"
- **Maps generated:**
  - Albedo/Diffuse (base color)
  - Normal map (surface detail)
  - Roughness map
  - Metalness map
  - AO (ambient occlusion)
- **Delivery:** Generated textures stored at CDN edge with key `hash(skillId + materialPrompt)` → reusable across sessions
- **Client integration:** Three.js `TextureLoader` loads from CDN URL; code generator injects the URLs

#### 4.3.2 3D Model CDN

- **Source:** Curated CC0 assets (Poly Pizza, Sketchfab, Khronos glTF samples)
- **Indexing:** Each model tagged with categories: `human`, `animal`, `vehicle`, `furniture`, `nature`, `architecture`
- **LLM selection:** When user prompt implies a specific object ("a car", "a tree", "a chair"), the LLM selects the closest model by tag + description embedding similarity
- **Format:** GLB/GLTF with Draco compression
- **Loading:** `GLTFLoader` in generated code; CDN base URL injected by platform

#### 4.3.3 Font Pipeline

- Google Fonts API integration
- LLM selects font family based on scene mood ("futuristic" → `Orbitron`, "elegant" → `Playfair Display`)
- Three.js `FontLoader` for 3D text; CSS `@import` for HTML overlays

#### 4.3.4 Audio Pipeline

- Web Audio API synthesis for procedural sound (oscillators, noise buffers)
- Optional: ElevenLabs or similar for voiceover if user requests narration
- Audio triggered by scene events (animation completion, interaction)

### 4.4 Caching Strategy

```
Cache Key = SHA256(skillId + normalizedAssetPrompt + qualityParams)

TTL:
  - Generated textures: 30 days (immutable by generation params)
  - 3D models: 1 year (curated assets don't change)
  - Fonts: 1 year (Google Fonts are stable)
  
Storage:
  - Hot: CDN edge (Cloudflare R2 / AWS CloudFront)
  - Warm: Platform blob storage
  - Cold: Re-generate on demand
```

### 4.5 Code Generator Changes

The `build_prompt` graph node needs a new step: **asset resolution**.

```
build_prompt:
  1. Parse user intent
  2. Detect asset needs (textures? models? fonts?)
  3. Query asset index / generate textures
  4. Inject asset URLs into the system prompt
  5. LLM generates code referencing those URLs
```

Example system prompt addition:

```
Available assets for this scene:
- texture_roughness: "https://cdn.lumina.app/tex/sha256..._roughness.jpg"
- texture_albedo: "https://cdn.lumina.app/tex/sha256..._albedo.jpg"
- model_tree: "https://cdn.lumina.app/models/tree_oak.glb"

Use these URLs in your Three.js code.
```

---

## Part 5: Phase D — Vision-in-the-Loop

### 5.1 Current State

Quality scoring is regex-based:
- `materialRichness` = count of `/new THREE\.\w*Material/g` matches
- `lightingComplexity` = count of `/new THREE\.\w*Light/g` matches
- `motionContinuity` = count of `requestAnimationFrame` matches

This is fast but blind. It cannot detect:
- "The cube is pink, not red"
- "The bloom effect is too strong"
- "The camera is inside the object"
- "The text is unreadable against the background"

### 5.2 Target State

Render a frame, screenshot it, send to a vision model (GPT-4o, Claude 3.5 Sonnet, or Gemini Pro Vision), and ask: *"Does this match the user's prompt? Rate 1-10. List specific issues."*

### 5.3 Architecture

```
[Client Browser]
  → Scene renders successfully (frameCount > 0, no errors)
  → canvas.toDataURL('image/jpeg', 0.85)  // ~50-150KB at 720p
  → WebSocket: type = "client:screenshot"
     payload: { sessionId, skillId, imageBase64, prompt, iteration }

[Server]
  → Receives screenshot
  → Deduplicate: skip if identical to last screenshot (perceptual hash)
  → Send to Vision Model:
     "User asked for: '{prompt}'. Rate how well this rendered image matches the request.
      Score 1-10. List specific visual issues (color accuracy, composition, lighting, missing elements)."
  → Receive: { score: 7, issues: ["Sphere is grey instead of red", "Background is too dark"] }
  → Convert to PatchGoals:
     - { category: "Visual", severity: "warning", description: "Change sphere color to red (#ff0000)" }
     - { category: "Visual", severity: "suggestion", description: "Increase ambient light intensity" }
  → Store in client-validation-cache or feed directly into next quality loop iteration
```

### 5.4 Integration Points

1. **Quality loop trigger:** Vision analysis runs after `client:validation_result` reports `success = true` and `frameCount > 0`. It runs asynchronously — it doesn't block the pipeline.

2. **Patch goal injection:** Vision-derived issues are merged with regex-derived `patchGoals` before sending to `PatchGenerator`. Vision issues take priority (higher severity).

3. **Scoring:** Vision score feeds into `SemanticScore.intentFulfillment` and could add a new `VisualScore.screenshotScore` dimension.

### 5.5 Cost and Performance

| Factor | Estimate |
|---|---|
| Vision model latency | 1–3 seconds |
| Vision model cost | $0.005–$0.03 per image (GPT-4o mini is cheaper) |
| Screenshot size | 720p JPEG at quality 0.85 = ~50–150KB |
| Frequency | Only on quality-loop iteration boundaries, not every frame |
| Caching | Perceptual hash of screenshot → skip re-analysis for identical frames |

**Optimization:** Use GPT-4o-mini or Gemini Flash for the vision pass. Reserve GPT-4o / Claude 3.5 Sonnet for the actual code generation.

### 5.6 Fallback

If vision model is unavailable (rate limit, cost threshold, no API key):
- Fall back to regex-based visual scoring (current behavior)
- Log a metric: `vision_fallback_count++`

---

## Part 6: Implementation Order

### Phase A: Client-First Execution (Estimated: 2–3 days)

1. Expand `client-skill-runner.ts` telemetry (fps, memory, deviceInfo)
2. Expand `client-validation-cache.ts` schema
3. Modify `ClientRenderingRuntime` to return full metrics
4. Short-circuit `QualityLoopRunner` for JS skills
5. Bypass `execute-code.ts` sandbox call for JS skills
6. Update `analyzeRuntimeQuality` to accept structured client metrics
7. Test: 61 existing tests + new client-rendering tests
8. Remove dead code: `JavaScriptSceneAdapter`, `runner-script.js` JS mocks, `skill-runtime.ts` JS paths

### Phase B: Streaming Generation (Estimated: 3–5 days)

1. Server: Buffer LLM tokens into AST-valid chunks
2. Server: Send `code:stream` deltas as tokens arrive (not after full generation)
3. Client: Incremental execution with debouncing
4. Client: Syntax error recovery (revert to last valid state)
5. Client: State preservation / diffing for D3.js and DOM-based skills
6. UX: Show "building scene..." with live preview during generation

### Phase C: Asset Pipeline (Estimated: 5–7 days)

1. Set up texture generation service (Stable Diffusion / Flux API)
2. Build asset CDN with cache keys
3. Curate 3D model library with tags and embeddings
4. Add asset resolution step to `build_prompt` graph node
5. Modify code generator prompts to include asset URLs
6. Client: `TextureLoader` / `GLTFLoader` integration in generated code templates
7. Test with real scenes: "a rusty car on a wet street"

### Phase D: Vision-in-the-Loop (Estimated: 3–4 days)

1. Client: `canvas.toDataURL` screenshot capture after successful render
2. WebSocket protocol: `client:screenshot` message type
3. Server: Vision model API integration
4. Server: Perceptual hash deduplication
5. Server: Convert vision model output to `PatchGoal` objects
6. Integrate vision score into `analyzeQuality`
7. Test: "a red cube" → vision detects pink → patch changes color

---

## Part 7: Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Client telemetry arrives too late for quality loop | Medium | High | Cache telemetry per session; first turn uses static-only scoring; subsequent turns use cached data |
| Low-end GPUs produce false "poor quality" signals | Medium | Medium | Normalize scores by `deviceInfo.gpuRenderer`; flag known-weak GPUs |
| Streaming code has syntax errors mid-stream | High | Low | Buffer until AST-valid; debounce execution; silent failure recovery |
| Vision model API costs spiral | Low | Medium | Use GPT-4o-mini; cache by perceptual hash; limit to 1 screenshot per turn |
| Asset generation latency blocks pipeline | Medium | Medium | Async asset generation (don't block code generation); show placeholders |
| Security: user code escapes iframe | Low | High | Separate origin iframe; strict CSP; no `allow-same-origin` if possible |
| Regression in Manim/Python path | Low | High | Keep Daytona/Docker path untouched for non-JS skills; comprehensive tests |

---

## Part 8: Metrics to Track

After each phase, measure:

| Metric | Baseline (Today) | Target (After Phase A) | Target (After Phase D) |
|---|---|---|---|
| JS skill turn latency | ~3000ms (sandbox acquire + execute + analyze) | ~1500ms (skip sandbox) | ~1500ms (vision async, doesn't block) |
| Sandbox acquire failures | 5–10% (Daytona pool exhaustion) | 0% for JS skills | 0% for JS skills |
| Quality loop iterations | 2.0 avg (standard mode) | 1.5 avg (faster feedback) | 1.2 avg (vision catches issues early) |
| Composite score accuracy | ~65% (regex blind to visual reality) | ~65% (still regex) | ~85% (vision validates reality) |
| User satisfaction (proxy: re-prompt rate) | High re-prompt for color/lighting issues | Slight improvement | Significant drop |
| Cost per JS skill turn | $0.02 (sandbox compute + LLM) | $0.015 (no sandbox) | $0.025 (+ vision model) |

---

## Part 9: Open Decisions

1. **Quality loop location:** Should the entire quality loop run on the client? This would eliminate server round-trips for patching entirely, but requires shipping the patch generator (LLM calls) to the client or making additional WebSocket requests.

2. **Streaming chunk strategy:** Raw LLM tokens (lower latency, broken syntax) vs AST-validated chunks (higher latency, always executable)?

3. **Vision model choice:** GPT-4o (best quality, highest cost) vs Gemini Flash (fast, cheap, slightly lower quality) vs self-hosted vision model (fixed cost, setup overhead)?

4. **Asset ownership:** Who owns generated textures? If generated via a third-party API (Replicate), do we store them indefinitely or regenerate on cache miss?

5. **Cross-session learning:** Should high-quality client telemetry improve skill scoring globally (via `metrics-store.ts`), or remain session-local?

---

## Appendix A: Glossary

- **LangGraph:** The orchestration framework used for the pipeline graph (nodes, edges, conditional routing).
- **Quality Loop:** The iterative cycle: `generate → execute → analyze → patch → re-generate` until quality threshold is met.
- **SkillRuntime:** Abstract interface over sandbox backends. Implementations: `DaytonaSkillRuntime`, `DockerSkillRuntime`, `ClientRenderingRuntime`.
- **runner-script.js:** The Node.js VM-based mock browser runtime in the sandbox pool package.
- **client-validation-cache:** Server-side session-scoped cache that stores browser-reported execution telemetry.
- **SceneViewer:** React component that renders an iframe with real Three.js/p5.js/D3.js execution.
- **Edge Rendering:** Executing code at the network edge (the user's browser) instead of a central server.

---

## Appendix B: File Index

### Backend (apps/server/server/)

| File | Purpose | Phase A Action |
|---|---|---|
| `pipeline/graph/nodes/execute-code.ts` | Graph node that triggers sandbox execution | Bypass for JS skills |
| `pipeline/runtime-executor.ts` | `executeSkillRuntimeWithQualityDecision` | Return immediately for JS |
| `sandbox/runtime/quality-loop.ts` | Iterative quality loop | Short-circuit JS runtime.execute |
| `sandbox/runtime/client-rendering-runtime.ts` | Client runtime adapter | Expand metrics from cache |
| `sandbox/runtime/client-validation-cache.ts` | Session cache for client telemetry | Expand schema |
| `sandbox/runtime/index.ts` | Runtime factory | Make client default for JS |
| `quality/analyzer.ts` | Quality scoring algorithm | Accept structured client metrics |
| `sandbox/skill-runtime.ts` | Core sandbox execution | Remove JS paths |
| `sandbox/adapters/javascript-adapter.ts` | JS adapter for sandbox | Remove or deprecate |
| `ws/handler.ts` | WebSocket message handler | Handle `client:validation_result` |
| `ws/streaming.ts` | Event broadcasting | Add `client:validation_complete` |

### Client (apps/web/src/)

| File | Purpose | Phase A Action |
|---|---|---|
| `lib/client-skill-runner.ts` | Invisible iframe validation | Expand telemetry |
| `hooks/useClientSkillValidation.ts` | React hook for validation | Always-on for JS |
| `components/SceneViewer.tsx` | Visible iframe rendering | Send telemetry postMessage |
| `stores/chat/infraSlice.ts` | WebSocket message routing | Handle server ack events |

### Sandbox Pool (packages/sandbox-pool/src/)

| File | Purpose | Phase A Action |
|---|---|---|
| `runner-script.js` | Node.js VM mock runtime | Remove JS mock sections |
| `index.js` | Pool manager | Unchanged (still used for Manim) |

---

*End of document.*
