# GVE Implementation Plan

## Purpose
Convert the architecture into an execution-ready plan with concrete phases, actionable tasks, dependencies, and exit criteria.

## Scope
- In scope: backend orchestration, skill runtime integration, state synchronization, API contracts, frontend integration, reliability, and observability.
- Out of scope (MVP): third-party skill marketplace, advanced collaboration conflict-free merges, multi-region deployment.

## Delivery Model
- Timeline target: 8 weeks MVP.
- Cadence: weekly phase gates with demo + acceptance checks.
- Workstreams:
  - WS1 Contracts and Safety
  - WS2 Backend Orchestration
  - WS3 Sandbox and Skills
  - WS4 State and Sync
  - WS5 Frontend Product UX
  - WS6 Reliability and Operations

---

## Phase 0 - Architecture Lock (Week 1)
Goal: lock decisions that unblock implementation sequencing.

### Tasks
- GVE-0001: Finalize backend framework choice and service boundaries.
  - Output: ADR-001 Backend Framework Decision.
  - Depends on: none.
- GVE-0002: Freeze API contracts for generate/modify/sessions/tasks.
  - Output: OpenAPI 3.0 draft + websocket event contract.
  - Depends on: GVE-0001.
- GVE-0003: Define non-functional targets.
  - Output: SLO doc (latency, error rate, sandbox startup).
  - Depends on: none.
- GVE-0004: Define MVP scope boundary.
  - Output: feature checklist with explicit defer list.
  - Depends on: GVE-0001, GVE-0002.

### Exit Criteria
- Backend framework selected and documented.
- API/event contracts approved.
- MVP defer list agreed.

---

## Phase 1 - Core Contracts (Week 1-2)
Goal: formalize the three highest-risk architecture contracts.

### Tasks
- GVE-1001: Intent parser contract spec.
  - Define schema for intentType, targetDomain, entities, constraints, confidence.
  - Include ambiguity handling flow and clarification prompts.
  - Depends on: GVE-0002.
- GVE-1002: Skill selection scoring spec.
  - Define weighted formula, tie-break rules, and fallback path.
  - Add deterministic behavior constraints.
  - Depends on: GVE-1001.
- GVE-1003: Code safety validator policy.
  - AST rules, disallowed operations, API whitelist per skill, resource/network/file rules.
  - Depends on: GVE-0003.
- GVE-1004: Error envelope and error taxonomy alignment.
  - Map all runtime errors to stable API error codes.
  - Depends on: GVE-0002, GVE-1003.

### Exit Criteria
- Contract tests written for parser, selector, and validator.
- Safety policy enforceable in code (not just prose).

---

## Phase 2 - Backend Skeleton (Week 2-3)
Goal: deliver a runnable orchestration API with task planning/execution endpoints.

### Tasks
- GVE-2001: Scaffold backend service.
  - Create server, DI container, health endpoint, config loader.
  - Depends on: GVE-0001.
- GVE-2002: Implement /api/v1/tasks/plan.
  - Convert user query into ordered executable tasks with dependencies.
  - Depends on: GVE-1001, GVE-1002.
- GVE-2003: Implement /api/v1/tasks/execute.
  - Execute one task idempotently and return status/output/artifacts.
  - Depends on: GVE-2002, GVE-1004.
- GVE-2004: Implement /api/v1/generate as orchestration wrapper.
  - Internally runs plan + execute pipeline.
  - Depends on: GVE-2002, GVE-2003.
- GVE-2005: Structured logging and request correlation IDs.
  - Depends on: GVE-2001.

### Exit Criteria
- Endpoints return typed payloads matching contracts.
- API integration tests pass for success and failure paths.

---

## Phase 3 - Skill Runtime and Sandbox Integration (Week 3-4)
Goal: connect backend orchestration to isolated skill execution.

### Tasks
- GVE-3001: Skill registry + capability index.
  - CRUD and capability lookups.
  - Depends on: GVE-1002.
- GVE-3002: Sandbox pool manager.
  - Warm pool, active pool, acquire/release, recycle.
  - Depends on: GVE-0003.
- GVE-3003: Skill loader implementation.
  - Dependency install, template mount, runtime startup checks.
  - Depends on: GVE-3001, GVE-3002.
- GVE-3004: Runtime execution guardrails.
  - Timeout, memory/cpu caps, execution logs.
  - Depends on: GVE-1003, GVE-3002.

### Exit Criteria
- First skill runs end-to-end in sandbox with policy enforcement.
- Sandbox leak check passes after repeated execution.

---

## Phase 4 - State and Synchronization (Week 4-5)
Goal: persist and broadcast scene state transitions safely.

### Tasks
- GVE-4001: Session + scene + version schema.
  - Database migrations and retention policy.
  - Depends on: GVE-0002.
- GVE-4002: State synchronizer service.
  - Apply diffs, version commits, rollback support.
  - Depends on: GVE-4001.
- GVE-4003: Websocket gateway for events.
  - generation:progress, generation:complete, generation:error, scene:update.
  - Depends on: GVE-4002.
- GVE-4004: Consistency and conflict strategy (MVP).
  - Single-editor lock or last-write-wins with warnings.
  - Depends on: GVE-4002.

### Exit Criteria
- Scene version history works with undo/redo baseline.
- Two clients receive synchronized updates.

---

## Phase 5 - Frontend Integration and UX (Week 5-6)
Goal: wire frontend to executable task pipeline with a polished, usable UX.

### Tasks
- GVE-5001: Task plan viewer UI.
  - Show phase, task status, dependencies, outputs.
  - Depends on: GVE-2002.
- GVE-5002: Task runner UI controls.
  - Run next, run all, retry failed task.
  - Depends on: GVE-2003.
- GVE-5003: Generate result + code panel.
  - Preview artifact links, code output, explanation.
  - Depends on: GVE-2004.
- GVE-5004: Error UX and recovery hints.
  - Map server error codes to actionable user prompts.
  - Depends on: GVE-1004, GVE-5002.

### Exit Criteria
- User can plan and execute tasks from UI without manual backend calls.
- Failed tasks are recoverable via guided actions.

---

## Phase 6 - Reliability and Performance (Week 6-7)
Goal: stabilize runtime behavior under load and failures.

### Tasks
- GVE-6001: Retry/backoff policy by error class.
  - Depends on: GVE-1004.
- GVE-6002: Caching strategy implementation.
  - Generation cache, skill cache, scene cache with TTL.
  - Depends on: GVE-2004, GVE-4002.
- GVE-6003: Metrics and dashboards.
  - Queue depth, p95 latency, sandbox utilization, failure rate.
  - Depends on: GVE-2005.
- GVE-6004: Load and soak tests.
  - Depends on: GVE-3002, GVE-6003.

### Exit Criteria
- SLO targets met for MVP load profile.
- No critical leak or crash in soak test window.

---

## Phase 7 - Release Readiness (Week 8)
Goal: finalize docs, runbooks, and launch checklist.

### Tasks
- GVE-7001: Production runbook and incident playbooks.
- GVE-7002: Security review and policy verification.
- GVE-7003: End-to-end UAT against MVP scenarios.
- GVE-7004: Release checklist sign-off.

### Exit Criteria
- All launch blockers resolved.
- Stakeholder sign-off complete.

---

## Task Execution Model for Engine

### Task Object
```json
{
  "id": "GVE-2002",
  "title": "Implement /api/v1/tasks/plan",
  "phase": "Phase 2",
  "status": "pending",
  "dependsOn": ["GVE-1001", "GVE-1002"],
  "owner": "backend",
  "artifact": "tasks-plan-endpoint",
  "acceptance": [
    "returns ordered tasks",
    "includes dependency graph",
    "idempotent for same input"
  ]
}
```

### Execution Rules
1. Only execute tasks whose dependencies are completed.
2. Block phase close if any task in phase is failed or pending.
3. Emit status transitions: pending -> running -> completed or failed.
4. Require acceptance checks to pass before completed status.

---

## Backend Framework Decision: JavaScript + LangGraph

### Recommendation
Use JavaScript backend with Express for API transport and LangGraph for orchestration.

### Why
- The architecture flow is naturally graph-shaped, and LangGraph represents it directly.
- JavaScript keeps orchestration close to existing frontend and skill runtime patterns.
- Express offers fast API delivery while LangGraph manages stateful execution steps.
- The task model (plan -> execute -> sync) maps cleanly to graph nodes and edges.

### Why LangGraph here
1. Encodes orchestration stages as explicit nodes.
2. Supports future conditional branches for error recovery and fallback skills.
3. Keeps workflow state explicit for debugging and observability.

### When to revisit
- If backend workload becomes heavily Python/ML-native, split orchestration and worker planes.
- If operational complexity requires separate workflow service boundaries.

---

## Immediate Next Steps
1. Review and approve this plan.
2. Confirm backend choice: Express + LangGraph (recommended).
3. Start with Phase 1 tasks GVE-1001, GVE-1002, GVE-1003 before any new feature coding.
