# Lumina Knowledgebase

A comprehensive, browsable documentation of the Lumina AI STEM Tutoring Platform.

## Contents

### Core Documentation
- **[index.html](index.html)** - Main entry point with project overview
- **[architecture.html](architecture.html)** - System architecture, data flows, and component interactions
- **[quickstart.html](quickstart.html)** - 5-minute setup guide

### API Reference
- **[api-rest.html](api-rest.html)** - REST API endpoints and request/response formats
- **[api-websocket.html](api-websocket.html)** - WebSocket events and message protocols

### Data & Models
- **[data-models.html](data-models.html)** - Complete data structure reference
- **[skills.html](skills.html)** - Skill system and registry documentation

### Operations
- **[configuration.html](configuration.html)** - Environment variables and deployment
- **[troubleshooting.html](troubleshooting.html)** - Common issues and solutions

## Browse

```bash
cd knowledgebase
python3 serve.py
```

Opens at http://localhost:8080

## Project Overview

**Lumina** is an AI STEM tutoring platform that helps users learn concepts through a visual-first paradigm.

### Key Features
- **Multi-Skill Support**: Three.js (3D), p5.js (2D), D3.js (data viz)
- **Multi-Agent Swarm**: Conductor, Planner, Diagnosis, Pedagogy, Content, Visual agents
- **Real-Time**: WebSocket-first with streaming updates
- **Secure**: Daytona sandbox execution with circuit breaker protection

### Architecture
```
Client (React) ←→ WebSocket Gateway ←→ Swarm Orchestrator ←→ Sandbox Pool (Daytona)
```

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript 6, Vite 8, Tailwind CSS 4 |
| Backend | Express 5, WebSocket (ws), LangGraph |
| LLM | Moonshot, DeepSeek, Groq, Gemini, Together |
| Sandboxes | Daytona SDK |
| 3D | Three.js 0.180.0 |

## Project Structure

```
lumina/
├── apps/
│   ├── web/              # React frontend
│   └── server/           # Express + WebSocket backend
├── packages/
│   ├── sandbox-pool/    # Daytona SDK integration
│   └── shared/          # Shared types & utilities
├── docs/                # Architecture documents
├── knowledgebase/       # This knowledgebase
└── sdp/              # System design document
```

## License

Part of the Lumina project.