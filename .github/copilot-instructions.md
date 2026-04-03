# Project Instructions: Generative Visual Engine

## Working Style

1. Analyze first before writing code.
2. Map every requested change to the architecture in `GenerativeVisualEngine_Architecture.md`.
3. Explain how the change fits existing modules and contracts before implementation.
4. Propose at least one preferred solution and one fallback when risk is non-trivial.
5. Implement only after approach alignment, then validate with build/runtime checks.

## Analysis-First Delivery Format

For non-trivial tasks, respond in this order:

1. Context and current behavior.
2. Architectural fit (Router -> Agent -> Skill, state sync, API contracts).
3. Proposed solution.
4. Risks and mitigations.
5. Implementation plan.
6. Code changes and verification results.

## Architecture Guardrails

- Preserve the orchestration pipeline stages: parse, select, build, generate, validate, execute, sync.
- Keep request/response contracts backward-compatible unless explicitly approved.
- Prefer extending existing endpoints and event types before adding new primitives.
- Ensure WebSocket event emissions remain consistent with task and generation lifecycle states.
- Add validation at boundaries (request schema, execution safety, response shape).

## AI Model Policy

Use Moonshot Kimi K2.5 as the default model for code generation and modification flows.

- Provider: Moonshot
- Model preference: Kimi K2.5
- Runtime config via env:
  - `MOONSHOT_API_KEY`
  - `MOONSHOT_MODEL` (set to your Kimi K2.5 model identifier)
  - `MOONSHOT_BASE_URL` (optional override)

If Kimi is unavailable, use deterministic local fallback and explicitly report fallback usage.

## Quality Gates

Before marking work complete:

1. Run build checks (`npm run build`).
2. Verify backend health and key API paths.
3. Validate WebSocket connectivity and event flow for affected features.
4. Confirm frontend behavior on desktop and mobile layouts.

## UI/UX Expectations

- Keep visual design minimalist yet artistic.
- Prioritize readability, spacing rhythm, and interaction clarity.
- Ensure generated output is visible immediately after execution.
- Maintain responsive behavior and touch-friendly controls.

## Change Management

- Keep patches small and architecture-aligned.
- Avoid unrelated refactors.
- Document significant design decisions in `docs/` when introducing new patterns.
