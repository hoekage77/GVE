# Generative Visual Engine Knowledgebase

A comprehensive, browseable documentation of the DOSCO Visual Engine (GVE) project.

## 📚 Knowledgebase Contents

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

## 🚀 Browse the Knowledgebase

### Option 1: Python Server (Recommended)
```bash
cd knowledgebase
python3 serve.py
```
Opens the knowledgebase at http://localhost:8080

### Option 2: Using Node.js
```bash
cd knowledgebase
npx serve -p 8080
```

### Option 3: Direct File Open
Simply open `index.html` in your web browser.

### Option 4: VS Code Live Server
1. Open the `knowledgebase` folder in VS Code
2. Install "Live Server" extension
3. Right-click `index.html` → "Open with Live Server"

## 📊 Project Overview

**Generative Visual Engine (GVE)** is a skill-based visual generation platform that transforms natural language into interactive 3D/2D visualizations.

### Key Features
- **Multi-Skill Support**: Three.js (3D), p5.js (2D), D3.js (data viz), Anime.js (animation)
- **AI-Powered**: LangGraph-based orchestration with intent parsing and code generation
- **Real-Time**: WebSocket-first with streaming updates
- **Secure**: Daytona sandbox execution with circuit breaker protection
- **Version Control**: Artifact-based versioning with undo/redo

### Architecture
```
Client (React) ←→ WebSocket Gateway ←→ Orchestrator (LangGraph) ←→ Sandbox Pool (Daytona)
```

## 🔧 Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript 6, Vite 8, Tailwind CSS 4 |
| Backend | Express 5, WebSocket (ws), LangGraph |
| LLM | Moonshot, DeepSeek, Groq, Gemini, Together |
| Sandboxes | Daytona SDK |
| 3D | Three.js 0.180.0 |

## 📁 Project Structure

```
dosco-visual-engine/
├── apps/
│   ├── web/              # React frontend
│   └── server/           # Express + WebSocket backend
├── packages/
│   ├── sandbox-pool/     # Daytona SDK integration
│   └── shared/           # Shared types & utilities
├── docs/                 # Original documentation
└── knowledgebase/        # This knowledgebase
    ├── index.html
    ├── architecture.html
    ├── api-rest.html
    ├── api-websocket.html
    ├── data-models.html
    ├── skills.html
    ├── configuration.html
    ├── troubleshooting.html
    ├── quickstart.html
    ├── assets/
    │   ├── styles.css
    │   └── navigation.js
    └── serve.py
```

## 🎯 Quick Links

- [Architecture Overview](architecture.html#high-level)
- [REST API Endpoints](api-rest.html)
- [WebSocket Events](api-websocket.html)
- [Data Models](data-models.html)
- [Skill System](skills.html)
- [Environment Variables](configuration.html)
- [Troubleshooting](troubleshooting.html)

## 📝 Generated From Source

This knowledgebase was automatically generated from source code analysis including:
- `apps/server/server/` - Backend modules
- `apps/web/src/` - Frontend components
- `packages/sandbox-pool/src/` - Sandbox management
- `packages/shared/src/` - Type definitions
- `docs/` - Architecture and design documents

## 🤝 Contributing

To update the knowledgebase after code changes:
1. Modify the relevant HTML files
2. Maintain consistent styling with existing pages
3. Test navigation between pages
4. Verify mobile responsiveness

## 📄 License

This knowledgebase is part of the Generative Visual Engine project.

---

**Version**: 1.0.0  
**Last Updated**: 2024-03-26
