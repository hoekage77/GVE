# Lumina GVI Engine

Lumina is a generative visual intelligence engine that creates complex 3D scenes from natural language prompts.

## What It Does

Transform plain English descriptions into interactive 3D visualizations:

- "Show me how a neural network processes data"
- "Visualize the solar system with accurate orbits"
- "Demonstrate Brownian motion in particles"

Lumina understands your intent, selects the appropriate skill, generates executable code, and renders the result in real-time.

## How It Works

1. **Parse** - Understand the natural language goal
2. **Select** - Choose the right visualization skill
3. **Generate** - Create working Three.js/p5.js code
4. **Validate** - Check syntax and runtime safety
5. **Execute** - Run in isolated Daytona sandboxes
6. **Sync** - Stream results back to your workspace

## Features

- **Natural Language to 3D**: Describe what you want, get a working scene
- **Multi-Skill Pipeline**: Three.js (3D), p5.js (2D), D3.js (data viz)
- **Real-Time Streaming**: Watch code generate and render live
- **Secure Execution**: Code runs in isolated sandboxes
- **Version Control**: Save, compare, and restore scene versions

## Quick Start

```bash
npm install
```

Configure `apps/server/server/.env`:

```bash
DAYTONA_API_KEY=your_daytona_api_key
MOONSHOT_API_KEY=your_moonshot_api_key
```

Run:

```bash
npm run dev:server
npm run dev:web
```

Open http://localhost:5173

## Architecture

```
User Prompt → Router → Agent → Skill → Daytona Sandbox → 3D Scene
```

- **Router**: Parses intent, manages context, selects skills
- **Agent**: Builds prompts, generates code, validates output
- **Skill**: Three.js, p5.js, D3.js, anime.js definitions
- **Sandbox**: Daytona-backed isolated execution

## Repository Layout

- apps/server: Express + WebSocket backend
- apps/web: React + Vite frontend
- packages/sandbox-pool: Daytona SDK integration
- packages/shared: Shared types

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | React, TypeScript, Vite, Tailwind |
| Backend | Express, WebSocket, LangGraph |
| 3D | Three.js |
| Sandbox | Daytona |
| LLM | Moonshot, DeepSeek, Groq, Gemini |

## License

MIT