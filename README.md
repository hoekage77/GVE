# Generative Visual Engine (GVE)

Generative Visual Engine (GVE) is an open-source project toward AGI.

GVE focuses on grounded intelligence loops: understand intent, choose the right skill, generate executable code, validate and execute it safely, then sync outcomes back to users in real time.

## Vision

We treat visual generation as a practical path toward more general intelligence:

- Reason over natural language goals and constraints.
- Select tools and strategies dynamically.
- Produce and revise working artifacts.
- Execute inside isolated runtimes and learn from outcomes.
- Keep humans in the loop through transparent chat and task traces.

## Architecture

GVE follows a Router -> Agent -> Skill architecture:

- Router: parses intent, manages context, selects skills, manages sessions.
- Agent: builds prompts, generates code, validates output, handles retries/fallbacks.
- Skill Runtime: executes skill code in Daytona-backed sandbox environments.

Pipeline contract:

1. parse
2. select
3. build
4. generate
5. validate
6. execute
7. sync

Runtime progress events currently emit these stage names:

- parse_intent
- select_skill
- build_prompt
- generate_code
- validate_code
- execute_code
- sync_state

## Repository Layout

- apps/server: Express + WebSocket orchestration backend.
- apps/web: React + Vite chat-first frontend and scene workspace.
- packages/sandbox-pool: sandbox acquisition/warmup/release runtime package.
- packages/shared: shared contracts/types used by server and web.
- docs: architecture, contracts, implementation plans.
- knowledgebase: browsable project documentation site.

## Prerequisites

- Node.js 20+
- npm 10+
- Daytona account and credentials
- At least one LLM API key (Moonshot, DeepSeek, Groq, Gemini, or Together)

## Quick Start

1. Install dependencies.

```bash
npm install
```

2. Configure server environment in apps/server/server/.env.

Minimum recommended environment:

```bash
# Required for sandbox runtime
DAYTONA_API_KEY=your_daytona_api_key

# Required for default model path
MOONSHOT_API_KEY=your_moonshot_api_key

# Optional overrides
MOONSHOT_MODEL=kimi-k2.5
MOONSHOT_BASE_URL=https://api.moonshot.ai/v1
PORT=8000
```

If using Daytona JWT auth instead of API key, also provide an organization id:

```bash
DAYTONA_JWT=your_daytona_jwt
DAYTONA_ORGANIZATION_ID=your_org_id
```

3. Start backend and frontend in separate terminals.

```bash
npm run dev:server
npm run dev:web
```

4. Open the web app (default Vite URL):

- http://localhost:5173

5. Check backend health:

```bash
curl http://localhost:8000/healthz
```

## Build And Run

```bash
npm run build
npm run start:server
npm run start:web
```

## Server Test Scripts

From the repository root:

```bash
npm run test:sandbox:direct --workspace=@visual-runtime/server
npm run test:sandbox:runtime --workspace=@visual-runtime/server
npm run test:sandbox:soak --workspace=@visual-runtime/server
npm run test:ws:direct --workspace=@visual-runtime/server
npm run test:ws:runtime --workspace=@visual-runtime/server
npm run test:ws:soak --workspace=@visual-runtime/server
npm run test:routing:regression --workspace=@visual-runtime/server
npm run test:threejs:deepdive --workspace=@visual-runtime/server
```

## Model Policy

- Default model path: Moonshot Kimi K2.5.
- Runtime config keys: MOONSHOT_API_KEY, MOONSHOT_MODEL, MOONSHOT_BASE_URL.
- If providers are unavailable or overloaded, server-side local fallback paths keep turns recoverable.

## Documentation

- Architecture deep dive: docs/GenerativeVisualEngine_Architecture.md
- Engineering guardrails: docs/GVE_Engineering_Playbook.md
- Contracts: docs/contracts/
- Knowledgebase site: knowledgebase/README.md

## Contributing

Contributions are welcome. Please keep changes architecture-aligned:

- Preserve pipeline ordering and stage semantics.
- Keep WebSocket event contracts backward-compatible.
- Add validation at request/runtime/response boundaries.
- Keep patches focused and test affected flows.

## License

This repository currently has no root LICENSE file.
Add a project license before redistributing or using this code outside development/research collaboration.