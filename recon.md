# Kortix Agent Platform — Architecture Deep Dive & Adoption Guide

> **Purpose**: Comprehensive technical reconnaissance of the Kortix (Dosco.live / Suna) backend architecture for adoption in an animation-generation AI use case (Three.js, p5.js, anime.js, Manim).

---

## 1. Executive Summary

Kortix is a production-grade, sandbox-native AI agent execution platform built in Python/FastAPI. Its defining characteristic is that **all tool execution happens inside ephemeral Daytona sandboxes**, not on the host server. This makes it ideal for code-generation agents (like animation generators) because:

- Each user/project gets an isolated Linux container with Node.js, Python, Chrome, and a full filesystem.
- The agent can write code, install packages, run servers, and preview results via auto-exposed ports.
- A sophisticated **stateless execution pipeline** handles conversation context compression, auto-continuation, tool parallelization, and failure recovery.
- An **auto-discovering tool system** eliminates manual registration -- new tools self-document via Python decorators.

**Core Design Philosophy**: The LLM is a planner/orchestrator. It decides *what* to do. Tools are the *doers* that run in a real, sandboxed computer. The system mediates between them with streaming, state management, and resilience.

---

## 2. System Architecture at 30,000ft

### 2.1 Request Flow

```
User (Chat UI)
       |
       v
FastAPI API
       |
       v
StatelessCoordinator (core/agents/pipeline)
       |
       +----------------+-----------------+
       |                |                 |
       v                v                 v
ThreadManager    LLMExecutor      ToolExecutor
(conversation    (LiteLLM/        (Parallel/
 history)        Anthropic)       Sequential)
       |                |                 |
       |                |                 v
       |                |          Daytona Sandbox
       |                |          (User N)
       |                |                 |
       |                |                 v
       |                |          Port 8080 Preview URL
       |                |          /workspace files
       v                v
Supabase DB      LangFuse Trace
```

### 2.2 Key Layers

| Layer | Responsibility | Primary Files |
|-------|---------------|---------------|
| **API Layer** | HTTP endpoints, auth, streaming SSE | `api.py`, `core/endpoints/` |
| **Agent Orchestration** | Pipeline execution, state machine, recovery | `core/agents/pipeline/stateless/coordinator/` |
| **Thread Management** | Conversation history, message persistence, context compression | `core/agentpress/thread_manager/`, `core/threads/` |
| **Tool System** | Auto-discovery, registration, execution, tier restrictions | `core/agentpress/tool.py`, `core/utils/tool_discovery.py`, `core/tools/` |
| **Sandbox Integration** | Daytona lifecycle, file operations, shell execution, health checks | `core/sandbox/sandbox.py`, `core/sandbox/api.py`, `core/sandbox/tool_base.py` |
| **LLM Abstraction** | Multi-provider routing, token counting, prompt caching | `core/ai_models/`, `core/services/llm.py` |
| **Data Layer** | Supabase (PostgreSQL), Redis caching, Langfuse tracing | `core/services/supabase.py`, `core/cache/` |

---

## 3. Daytona Sandbox Integration (Deep Dive)

This is the **most critical subsystem** for an animation-generation agent. All code generation, rendering, and previewing happens inside these sandboxes.

### 3.1 What Is a Sandbox?

A sandbox is a Docker container provisioned via the **Daytona SDK**. It is an isolated Linux environment with:

- **Python 3.11** + pip packages (Playwright, Pillow, Pytesseract, etc.)
- **Node.js 20** + npm/pnpm (for running/building JS-based animations)
- **Chrome** + Playwright (for browser automation, screenshotting, PDF export)
- **VNC + noVNC** (for visual remote access to the desktop)
- **A web server** (port 8080, serving files from `/workspace`)
- **Supervisord** (manages Chrome, VNC, file watcher, and the web server inside the container)
- **Full sudo access** and persistent filesystem at `/workspace`

**Default Image**: `kortix/suna:0.1.3.30` (defined in `core/utils/config.py`)

### 3.2 Sandbox Lifecycle

```
User sends message
       |
       v
+---------------+
|resolve_sandbox|  (core/sandbox/resolver.py)
|  - Check DB   |  Looks up if project already has a sandbox resource
|  - Create?    |  If not, calls create_sandbox()
|  - Start?     |  If STOPPED/ARCHIVED, calls get_or_start_sandbox()
+---------------+
       |
       v
+---------------+
|   AsyncSandbox|  (Daytona SDK object)
|  - .fs.upload()|  File operations
|  - .process.  |  Shell commands
|    exec()     |
|  - .process.  |  Interactive shell with streaming
|    create_pty |
+---------------+
       |
       v
+---------------+
|   Health Check|  GET {sandbox_url}/health
| Unified Status|  LIVE / STARTING / OFFLINE / FAILED / UNKNOWN
+---------------+
```

### 3.3 Key Code: Sandbox Creation

From `core/sandbox/sandbox.py`:

```python
from daytona_sdk import AsyncDaytona, DaytonaConfig, CreateSandboxFromSnapshotParams, SandboxState

daytona_config = DaytonaConfig(
    api_key=config.DAYTONA_API_KEY,
    api_url=config.DAYTONA_SERVER_URL,
    target=config.DAYTONA_TARGET,
)
daytona = AsyncDaytona(daytona_config)

async def create_sandbox(password: str, project_id: str = None) -> AsyncSandbox:
    params = CreateSandboxFromSnapshotParams(
        snapshot="kortix/suna:0.1.3.30",
        public=True,
        labels={'id': project_id} if project_id else None,
        env_vars={
            "CHROME_PERSISTENT_SESSION": "true",
            "RESOLUTION": "1048x768x24",
            "VNC_PASSWORD": password,
            # ... more env vars
        },
        auto_stop_interval=15,      # Auto-stop after 15 min idle
        auto_archive_interval=30,   # Auto-archive after 30 min stopped
    )
    sandbox = await daytona.create(params)
    await start_supervisord_session(sandbox)  # Start internal services
    return sandbox
```

### 3.4 Unified Status System

The system defines its own status abstraction on top of Daytona's raw states:

| Status | Meaning | Daytona State |
|--------|---------|---------------|
| `LIVE` | Ready to accept tool calls | `STARTED` + in-container services healthy |
| `STARTING` | Provisioning or warming up | `STARTED` but health check pending, or `ARCHIVING` |
| `OFFLINE` | Intentionally stopped | `STOPPED` / `ARCHIVED` |
| `FAILED` | Container up but services dead | `STARTED` + health check reports unhealthy |
| `UNKNOWN` | Cannot determine | Any other condition |

**Implementation**: `core/sandbox/api.py::derive_sandbox_status()` polls both the Daytona API and the sandbox's internal `/health` endpoint.

### 3.5 Sandbox Tools Base Pattern

All tools that run code inside the sandbox inherit from `SandboxToolsBase` (`core/sandbox/tool_base.py`):

```python
class SandboxToolsBase(Tool):
    def __init__(self, project_id: str, thread_manager: ThreadManager):
        self.project_id = project_id
        self.thread_manager = thread_manager
        self.workspace_path = "/workspace"
        self._sandbox_info = None

    async def _ensure_sandbox(self) -> AsyncSandbox:
        """Lazy-loads the sandbox. Creates/starts it if needed."""
        if self._sandbox_info is None:
            sandbox_info = await resolve_sandbox(
                project_id=self.project_id,
                account_id=account_id,
                db_client=client,
                require_started=True
            )
            self._sandbox_info = sandbox_info
        return self._sandbox_info.sandbox

    @property
    def sandbox(self) -> AsyncSandbox:
        return self._sandbox_info.sandbox
```

**For your animation agent**: Every animation tool (write Three.js code, render p5.js, export Manim video) will inherit from this base. The `_ensure_sandbox()` call guarantees a running container before any operation.

### 3.6 File System & Preview URLs

The sandbox's internal web server (running inside the container on port 8080) serves files from `/workspace`. When the agent creates an HTML file:

1. Tool calls `sandbox.fs.upload_file(html_bytes, "/workspace/animation/index.html")`
2. Daytona auto-exposes port 8080 with a public URL like `https://abc123.daytona.io:8080`
3. The preview URL becomes `https://abc123.daytona.io:8080/animation/index.html`
4. The user sees the live animation instantly.

**This is the primary output mechanism for animation agents.**

---

## 4. Tool System Architecture (Deep Dive)

### 4.1 Philosophy: Self-Documenting, Auto-Discovered Tools

The system eliminated ~2,040 lines of manual tool registration. Tools declare their own schemas and metadata via Python decorators. The system discovers them automatically at startup.

### 4.2 Base Classes

From `core/agentpress/tool.py`:

```python
from dataclasses import dataclass
from abc import ABC
from typing import Dict, Any, List, Optional

class Tool(ABC):
    def __init__(self):
        self._schemas: Dict[str, List[ToolSchema]] = {}
        self._metadata: Optional[ToolMetadata] = None
        self._method_metadata: Dict[str, MethodMetadata] = {}
        self._register_metadata()
        self._register_schemas()

    def get_schemas(self) -> Dict[str, List[ToolSchema]]:
        return self._schemas

    def get_metadata(self) -> Optional[ToolMetadata]:
        return self._metadata

    def success_response(self, data) -> ToolResult:
        return ToolResult(success=True, output=json.dumps(data) if isinstance(data, (dict, list)) else str(data))

    def fail_response(self, msg: str) -> ToolResult:
        return ToolResult(success=False, output=msg)
```

### 4.3 Decorators

```python
from core.agentpress.tool import tool_metadata, method_metadata, openapi_schema

@tool_metadata(
    display_name="File Operations",
    description="Create, read, edit, and manage files",
    icon="FolderOpen",
    color="bg-blue-100 dark:bg-blue-800/50",
    is_core=True,       # Always enabled; cannot be disabled by user
    weight=20,          # Sort order in UI (lower = higher priority)
    visible=True,       # Show in frontend UI
    usage_guide="""Detailed instructions loaded on-demand by the LLM..."""
)
class SandboxFilesTool(Tool):

    @method_metadata(
        display_name="Create File",
        description="Create new files with content"
    )
    @openapi_schema({
        "type": "function",
        "function": {
            "name": "create_file",
            "description": "Writes a file to the workspace...",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "Path relative to /workspace"},
                    "file_contents": {"type": "string"},
                    "permissions": {"type": "string", "default": "644"}
                },
                "required": ["file_path", "file_contents"]
            }
        }
    })
    async def create_file(self, file_path: str, file_contents: str, permissions: str = "644") -> ToolResult:
        # ... implementation ...
        return self.success_response(f"File '{file_path}' created.")
```

### 4.4 Auto-Discovery & Caching

`core/utils/tool_discovery.py` handles everything:

```python
def warm_up_tools_cache():
    """Called once at worker/API startup."""
    tools_map = discover_tools()  # Imports all Tool subclasses
    for tool_name, tool_class in tools_map.items():
        _SCHEMA_CACHE[tool_class] = _precompute_schemas_for_class(tool_class)
        if tool_name in STATELESS_TOOLS:
            _STATELESS_TOOL_INSTANCES[tool_class] = tool_class()
```

**Adding a new tool requires ZERO registration code.** Just create the class, decorate it, and place it in `core/tools/`. The `tool_registry.py` lists it, and discovery handles the rest.

### 4.5 Tool Registry Categories

From `core/tools/tool_registry.py`:

| Category | Tools | Purpose |
|----------|-------|---------|
| **Core** | `expand_msg_tool`, `message_tool`, `task_list_tool`, `sb_git_sync` | Always loaded; messaging & task tracking |
| **Sandbox** | `sb_shell_tool`, `sb_files_tool`, `sb_file_reader_tool`, `sb_expose_tool`, `sb_vision_tool`, `sb_image_edit_tool`, `sb_kb_tool`, `sb_presentation_tool`, `sb_canvas_tool`, `sb_spreadsheet_tool`, `sb_upload_file_tool` | Execute inside Daytona sandbox |
| **Search** | `web_search_tool`, `image_search_tool`, `people_search_tool`, `company_search_tool`, `paper_search_tool` | External search APIs (Tavily, Serper, etc.) |
| **Utility** | `browser_tool`, `vapi_voice_tool`, `reality_defender_tool`, `apify_tool`, `composio_upload_tool` | Browser automation, voice, deepfake detection |
| **Agent Builder** | `agent_config_tool`, `agent_creation_tool`, `mcp_search_tool`, `credential_profile_tool`, `trigger_tool` | Meta-tools for creating/configuring other agents |

### 4.6 Tool Execution Strategies

Two modes, configurable via `AGENT_TOOL_EXECUTION_STRATEGY`:

1. **Parallel** (default): The LLM can call multiple independent tools in one turn. `ToolExecutor` spawns `asyncio.Task` for each and waits for all to complete.
2. **Sequential**: Tools execute one at a time. Slower but deterministic.

From `core/agents/pipeline/stateless/coordinator/tool_executor.py`:

```python
class ToolExecutor:
    async def _execute_single_tool(self, name: str, args: str, available_functions: Dict):
        # 1. Check subscription tier access
        access_result = await check_tool_access_for_account(account_id, name)
        if not access_result.allowed:
            return json.dumps({"error": access_result.reason}), False, access_result.reason

        # 2. Parse arguments
        parsed = json.loads(args)
        tool_fn = available_functions.get(name)

        # 3. Execute
        result = await tool_fn(**parsed)
        return result.output, result.success, None
```

---

## 5. Agent Execution Pipeline (Deep Dive)

This is the engine that turns a user message into animated code running in a sandbox.

### 5.1 Entry Point: StatelessCoordinator

`core/agents/pipeline/stateless/coordinator/stateless.py::StatelessCoordinator`

```python
class StatelessCoordinator(BaseCoordinator):
    async def execute(self, ctx: PipelineContext, max_steps: int = 25):
        # 1. Claim ownership (prevent duplicate workers running the same agent run)
        await ownership.claim(ctx.agent_run_id)

        # 2. Initialize managers
        self._thread_manager, self._tool_registry, self._trace = await self._init_managers(ctx)

        # 3. Load system prompt + register tools
        await self._load_prompt_and_tools(ctx)

        # 4. Execution loop (auto-continues up to max_steps)
        async for chunk in self._execution_loop(ctx, execution_engine, max_steps):
            yield chunk   # SSE stream to frontend

        # 5. Cleanup & analytics
        await self._finalize_execution(duration)
```

### 5.2 Execution Loop

```python
async def _execution_loop(self, ctx, execution_engine, max_steps):
    auto_continue_count = 0
    while self._state.should_continue() and should_continue_loop:
        step = self._state.next_step()

        # A. Stream "thinking" status to frontend
        await stream_thinking(ctx.stream_key)

        # B. Execute one LLM turn + tool calls
        async for chunk in execution_engine.execute_step():
            yield chunk
            # AutoContinueChecker decides if the agent should keep going
            cont, term = AutoContinueChecker.check(chunk, auto_continue_count, max_steps)
            if term: force_terminate = True
            if cont: should_auto_continue = True

        # C. Auto-continue if tools were called and not explicitly terminating
        if should_auto_continue:
            auto_continue_count += 1
            logger.debug(f"Auto-continue #{auto_continue_count}")
```

**For animation agents**: A single request like "Make a bouncing ball animation in Three.js" typically triggers:
1. `web_search_tool` -- searches for Three.js bounce physics reference.
2. `create_file` -- writes `scene.html` with Three.js code.
3. `execute_command` -- runs a local HTTP server or verifies the file.
4. `message_tool` -- returns the preview URL to the user.

All of this happens across **multiple auto-continued steps** within the same `execute()` call.

### 5.3 ExecutionEngine: One Step

`core/agents/pipeline/stateless/coordinator/execution.py::ExecutionEngine`

```python
async def execute_step(self):
    # 1. Gather conversation history from ThreadManager
    messages = self._state.get_messages()
    system = self._state.system_prompt

    # 2. Check context window size
    tokens = await self.fast_token_count([system] + messages, self._state.model_name)
    await stream_context_usage(self._state.stream_key, tokens, len(messages))

    # 3. If over threshold, compress / archive / truncate
    messages, tokens, did_compress = await self._check_and_compress_if_needed(
        messages, tokens, system, tools=tools_for_count
    )

    # 4. Repair message structure (tool call pairing validation)
    prepared = self._repair_tool_message_structure([system] + messages)

    # 5. Send to LLM
    executor = LLMExecutor()
    response = await executor.execute(
        prepared_messages=prepared,
        llm_model=self._state.model_name,
        openapi_tool_schemas=self._state.tool_schemas,
        stream=True
    )

    # 6. Stream response, parsing tool calls as they arrive
    async for chunk in self._response_processor.process_response(response):
        yield chunk
```

### 5.4 ResponseProcessor: Streaming Tool Call Execution

`core/agents/pipeline/stateless/coordinator/response_processor.py`

This is where the magic happens. As the LLM streams its response, the processor:

1. **Buffers content**: Accumulates text chunks to show the user in real-time.
2. **Detects tool calls**: Native OpenAI-style `tool_calls` deltas are parsed incrementally.
3. **Executes on stream**: If `AGENT_EXECUTE_ON_STREAM=True`, the moment a tool call JSON is complete, it launches the tool asynchronously **before the LLM finishes speaking**.
4. **Handles finish reasons**:
   - `tool_calls` -- finalize assistant message, execute all pending tools, yield results.
   - `stop` / `end_turn` -- agent is done responding (but may auto-continue if user didn't ask a terminating question).
   - `length` -- hit max tokens; save state and auto-continue.

```python
async def process_response(self, response):
    tool_call_buffer = {}  # Partial tool calls by index
    pending_executions = []  # Async tasks for tool runs

    async for chunk in response:
        # Content chunk -> yield to user
        if delta.content:
            yield build_content_chunk(delta.content)

        # Tool call delta -> buffer it
        if delta.tool_calls:
            self._process_tool_call_deltas(delta.tool_calls, tool_call_buffer)

            # If complete and execute_on_stream, start execution NOW
            if is_tool_call_complete(tool_call_buffer[idx]):
                execution = self._tool_executor.start_tool_execution(tool_call_data, ...)
                pending_executions.append(execution)

        # Finish reason -> finalize
        if finish_reason == "tool_calls":
            # Wait for all pending tool executions
            async for msg in self._wait_and_process_remaining_executions(...):
                yield msg
            # Yield assistant message with all tool calls
            yield build_assistant_complete(...)
```

### 5.5 Context Compression & Archival

Animation generation produces **very long conversations** (HTML code, error logs, iterative edits). The system handles this with a multi-tier compression strategy in `ExecutionEngine`:

#### Tier 1: In-Memory Truncation (Working Memory)
- Tool outputs: truncate to 2,000 chars (last 2 get 3,000).
- User messages: truncate to 4,000 chars.
- Assistant messages: truncate to 2,000 chars.

#### Tier 2: Archival to Sandbox Filesystem
When messages exceed the safety threshold (70% of context window):

```python
# Split into: [old messages to archive] + [recent working memory]
archiver = ContextArchiver(project_id, account_id, thread_id, db_client)
result = await archiver.archive_messages(to_compress, previous_summary, working_memory)
```

- Old messages are written to `/workspace/.kortix/context/messages/batch_NNN/`
- A **summary message** replaces them in the LLM conversation.
- If the agent later needs details from the archive, the system prompt instructs it to use `read_file` or `grep` on the archive files.

#### Tier 3: Emergency Truncation
If still over threshold after archival, aggressive truncation to 1,200 chars per message.

#### Tier 4: Vision Model Auto-Switching
If the user uploads an image mid-conversation, the coordinator automatically switches to a vision-capable model (e.g., Claude Haiku via Bedrock) before the next LLM call.

---

## 6. Context & Memory Management

### 6.1 ThreadManager

`core/agentpress/thread_manager/manager.py::ThreadManager`

- Persists all messages to **Supabase** (PostgreSQL).
- Maintains an **in-memory auto-continue state** across steps.
- Handles billing attribution per message (`llm_response_end` triggers credit deduction).
- Supports **JIT (Just-In-Time) configuration** for dynamic prompt injection.

### 6.2 Prompt Caching (Anthropic)

`core/agentpress/PROMPT_CACHING.md`

For Anthropic Claude models, the system implements **4-block prompt caching**:

```
Block 1: System prompt (cached if >= 1024 tokens)
Block 2-4: Conversation chunks (automatically managed)
```

Thresholds are calculated dynamically based on:
- **Context window size** (200k -> 2M tokens)
- **Conversation stage** (early <=20 msgs, growing <=100, mature <=500, very long 500+)
- **Token density**

**Result**: 70-90% cost reduction and up to 95% latency reduction on long animation iteration threads.

### 6.3 ContextManager

`core/agentpress/context_manager.py`

Validates and repairs tool call pairing in the message history:
- Every `assistant` message with `tool_calls` must have corresponding `tool` result messages.
- Detects orphaned tool results or unanswered tool calls.
- Repairs by stripping invalid pairs or marking them as omitted in the database.

---

## 7. LLM Provider Abstraction

### 7.1 Multi-Provider Routing

The system uses **LiteLLM** as the unified interface, but maintains a provider registry in `core/ai_models/`.

Supported providers:
- **Anthropic** (Claude 3.7 Sonnet, Claude Sonnet 4)
- **OpenAI** (GPT-4o, GPT-5)
- **AWS Bedrock** (Claude via AWS, primary production model)
- **Grok** (xAI)
- **MiniMax**

Configurable via `config.MAIN_LLM` (default: `"bedrock"`).

### 7.2 Dynamic Model Switching

In `StatelessCoordinator._determine_effective_model()`:

```python
if model_manager.supports_vision(self._state.model_name):
    return  # No switch needed

has_images = await ThreadState.check_has_images(ctx.thread_id)
if has_images:
    self._state.model_name = BedrockConfig.get_haiku_arn()  # Switch to vision model
```

**For animation agents**: You might extend this pattern to switch to a stronger coding model (e.g., Claude Opus) when the agent detects it needs to write complex 3D shader code.

---

## 8. Configuration & Extensibility

### 8.1 Configuration System

`core/utils/config.py::Configuration`

- Typed configuration class with automatic env var loading via `python-dotenv`.
- Supports `LOCAL`, `STAGING`, `PRODUCTION` modes.
- Auto-generates admin API keys if missing.
- Validates required fields on startup.

Key flags for tool behavior:

```python
AGENT_XML_TOOL_CALLING = False           # Enable <function_calls> XML format
AGENT_NATIVE_TOOL_CALLING = True         # Enable OpenAI-style function calling
AGENT_EXECUTE_ON_STREAM = True           # Execute tools mid-stream vs. at end
AGENT_TOOL_EXECUTION_STRATEGY = "parallel"  # "parallel" or "sequential"
MAIN_LLM = "bedrock"                     # Provider selector
```

### 8.2 Adding a New Tool (Step-by-Step)

To add an `animation_3js_tool` for your use case:

1. **Create the tool class** in `core/tools/animation_3js_tool.py`:

```python
from core.agentpress.tool import Tool, tool_metadata, method_metadata, openapi_schema, ToolResult
from core.sandbox.tool_base import SandboxToolsBase
from core.agentpress.thread_manager import ThreadManager

@tool_metadata(
    display_name="Three.js Animation",
    description="Generate and preview Three.js animations",
    icon="Box",
    color="bg-orange-100 dark:bg-orange-800/50",
    is_core=False,
    weight=30,
    visible=True,
    usage_guide="""
## Three.js Animation Tool
- create_scene(description): Generates a Three.js HTML file from a text description.
- update_scene(file_path, changes): Edits an existing scene file.
- serve_scene(file_path): Returns the public preview URL.
"""
)
class Animation3jsTool(SandboxToolsBase):
    def __init__(self, project_id: str, thread_manager: ThreadManager):
        super().__init__(project_id, thread_manager)

    @method_metadata(display_name="Create Scene", description="Generate a Three.js HTML scene")
    @openapi_schema({
        "type": "function",
        "function": {
            "name": "create_scene",
            "description": "Creates a Three.js scene HTML file in /workspace/animations/",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_name": {"type": "string", "description": "e.g. 'bounce.html'"},
                    "description": {"type": "string", "description": "What the animation should show"}
                },
                "required": ["file_name", "description"]
            }
        }
    })
    async def create_scene(self, file_name: str, description: str) -> ToolResult:
        await self._ensure_sandbox()
        html = f"""<!DOCTYPE html>
<html><head><script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script></head>
<body><script>
// TODO: LLM generates this code based on {description}
</script></body></html>"""
        path = f"{self.workspace_path}/animations/{file_name}"
        await self.sandbox.fs.upload_file(html.encode(), path)

        # Return preview URL
        preview = f"{self.sandbox_url}/{file_name}"
        return self.success_response({"created": path, "preview_url": preview})
```

2. **Register in `core/tools/tool_registry.py`**:

```python
SANDBOX_TOOLS = [
    # ... existing tools ...
    ('animation_3js_tool', 'core.tools.animation_3js_tool', 'Animation3jsTool'),
]
```

3. **Add to default core tools** in `core/agents/runner/tool_manager.py`:

```python
DEFAULT_CORE_TOOLS = [
    # ... existing ...
    'animation_3js_tool',
]
```

4. **Done.** The auto-discovery system picks it up. The frontend can query `/tools` to see it. The LLM receives its OpenAPI schema automatically.

---

## 9. Testing & Observability

### 9.1 E2E Test Harness

`core/test_harness/`

- **Core Test Mode**: Real LLM calls with full streaming metrics.
- **Stress Test Mode**: Mocked LLM for high-concurrency validation (10,000+ runs).
- **Metrics**: Cold start time, tool call latency, stream chunk intervals, success rates.
- **Storage**: All results stored in Supabase for trend analysis.
- **CI/CD**: GitHub Actions workflow for manual benchmark triggers.

### 9.2 Braintrust Evaluations

`evals/`

- JSON-based test cases (`test_cases.json`) with categories: `math_basic`, `greeting`, `real_world`, `complex`.
- Custom scorers: `AnswerCorrectness`, `TaskCompletionScorer`, `ToolUsageScorer`, `ResponseTimeScorer`.
- LiteLLM callback automatically traces all LLM calls to Braintrust.
- Run via: `uv run python evals/agent_eval.py`

### 9.3 LangFuse Tracing

All LLM calls are traced via LangFuse for:
- Input/output inspection
- Token usage tracking
- Latency analysis
- Tool call chain visualization

---

## 10. Adoption Guide: Animation Generation Agent

This section maps the Kortix architecture directly to an animation-generation use case.

### 10.1 Recommended Sandbox Additions

The current sandbox Dockerfile (`core/sandbox/docker/Dockerfile`) already has Node.js 20. For animation-specific workloads, add to the Dockerfile or install at runtime:

```dockerfile
# Already present: Node.js 20, npm, pnpm, Playwright, Chrome

# Add animation-specific global packages
RUN npm install -g @ ManimGL/manim  # If running Manim via JS bridge, or prefer Python Manim
RUN pip install manim                # Python Manim for video generation
RUN npm install -g vite              # Fast dev server for previewing JS animations
```

**Alternative**: Install packages lazily via `sb_shell_tool` (`npm install three` inside the sandbox on demand). This keeps snapshots smaller.

### 10.2 Tool Design for Animation Workflows

| Tool | Purpose | Inherits From |
|------|---------|--------------|
| `animation_3js_tool` | Create/edit Three.js scenes, return preview URL | `SandboxToolsBase` |
| `animation_p5js_tool` | Create p5.js sketches | `SandboxToolsBase` |
| `animation_animejs_tool` | Inject anime.js animations into existing HTML | `SandboxToolsBase` |
| `animation_manim_tool` | Render Python Manim scenes to MP4 | `SandboxToolsBase` |
| `sb_shell_tool` | Run `vite`, `npm install`, `ffmpeg` | `SandboxToolsBase` (exists) |
| `sb_files_tool` | Read/write animation source files | `SandboxToolsBase` (exists) |

### 10.3 Iterative Animation Workflow

A typical user interaction: *"Make the ball bounce higher and change color on impact"*

```
Step 1: User sends message
        |
Step 2: Coordinator loads thread history
        |
Step 3: ExecutionEngine sends prompt + history to LLM
        |
Step 4: LLM decides:
        |   - read_file("animations/bounce.html")  -> see current code
        |   - edit_file("animations/bounce.html", changes)  -> modify physics & color
        |
Step 5: ResponseProcessor streams thinking to user
        |   \---> ToolExecutor calls read_file (parallel if needed)
        |   \---> ToolExecutor calls edit_file
        |
Step 6: edit_file returns success + updated content
        |
Step 7: LLM sees tool results, generates final response:
        |   "Updated! Preview here: https://abc123.daytona.io:8080/animations/bounce.html"
        |
Step 8: Coordinator auto-continues? No (message_tool terminates).
        \---> Stream ends.
```

### 10.4 Leveraging Existing Patterns

- **File editing**: Use the existing `edit_file` method (calls Morph AI API for intelligent code editing) or `str_replace` for exact replacements. For animation code, `str_replace` is often more reliable.
- **Preview URLs**: The existing `create_file` auto-detects `.html` and appends a preview URL to the tool result. Your animation tools should do the same.
- **Export to video**: Extend `sb_presentation_tool` pattern (HTML-to-PDF via Playwright) to add HTML-to-MP4 via Playwright screen recording or Manim rendering.
- **Context compression**: Long animation codebases will hit context limits fast. The archival system (`/workspace/.kortix/context/`) is perfect for storing previous animation versions while keeping the current iteration in working memory.

### 10.5 Prompt Engineering Recommendations

Add to the system prompt (`core/prompts/`):

```
You are an expert animation developer. You have access to a sandboxed Linux
environment with Node.js, Python, Three.js, p5.js, anime.js, and Manim installed.

When the user asks for an animation:
1. ALWAYS create a self-contained HTML file in /workspace/animations/.
2. Use CDN links for libraries (e.g., https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js)
   so no npm install is needed for simple scenes.
3. For complex projects, use sb_shell_tool to run `npm install` and `vite`.
4. After creating or updating an HTML file, share the preview URL with the user.
5. If the user asks for a video export, use the Manim tool or Playwright screen recording.

Animation Guidelines:
- Prefer Three.js for 3D scenes.
- Prefer p5.js for generative art and 2D sketches.
- Prefer anime.js for UI micro-interactions and timeline sequences.
- Prefer Manim for educational/math animations exported to MP4.
```

---

## 11. Key File Reference Map

| File | Lines | What It Does |
|------|-------|--------------|
| `api.py` | ~29KB | FastAPI entry point. Routes, SSE streaming, dependency injection. |
| `core/agents/pipeline/stateless/coordinator/stateless.py` | 274 | Main execution coordinator. Owns the loop. |
| `core/agents/pipeline/stateless/coordinator/execution.py` | 712 | `ExecutionEngine`. Token counting, context compression, LLM call orchestration. |
| `core/agents/pipeline/stateless/coordinator/response_processor.py` | 543 | Parses streaming LLM response, buffers tool calls, executes on stream. |
| `core/agents/pipeline/stateless/coordinator/tool_executor.py` | 389 | Runs tool functions (parallel/sequential), handles tier restrictions, terminating tools. |
| `core/agentpress/tool.py` | 299 | Base `Tool` class, decorators (`@tool_metadata`, `@method_metadata`, `@openapi_schema`). |
| `core/utils/tool_discovery.py` | 464 | Auto-discovery, schema pre-computation, warm-up caching. |
| `core/tools/tool_registry.py` | 137 | Central list of all tools (name -> module -> class). |
| `core/agents/runner/tool_manager.py` | 269 | Registers tools into `ThreadManager` based on agent config + tier. |
| `core/sandbox/sandbox.py` | 144 | Daytona client init, create/get/start/delete sandboxes. |
| `core/sandbox/api.py` | 1242+ | REST API for sandbox file ops, status, start/stop, health checks. |
| `core/sandbox/tool_base.py` | 83 | `SandboxToolsBase`. Lazy sandbox resolution for all sandbox tools. |
| `core/sandbox/docker/Dockerfile` | 145 | Sandbox image: Python 3.11, Node 20, Chrome, Playwright, VNC, supervisor. |
| `core/agentpress/thread_manager/manager.py` | 262 | `ThreadManager`: message persistence, LLM message retrieval, billing hooks. |
| `core/agentpress/context_manager.py` | -- | Tool call pairing validation and repair. |
| `core/utils/config.py` | 677 | Typed configuration, env loading, validation. |
| `core/ai_models/` | -- | Provider registry, model configs, context window sizes. |
| `core/services/llm.py` | -- | `make_llm_api_call()` wrapper around LiteLLM. |
| `core/cache/runtime_cache.py` | -- | Redis-backed message history cache invalidation. |

---

## 12. Technology Stack Summary

| Layer | Technology |
|-------|-----------|
| **Framework** | FastAPI, Uvicorn, Python 3.11+ |
| **Database** | Supabase (PostgreSQL), Prisma ORM |
| **Cache** | Redis (Upstash for prod) |
| **LLM Router** | LiteLLM |
| **LLM Providers** | Anthropic Claude, OpenAI, AWS Bedrock, Grok, MiniMax |
| **Sandbox** | Daytona SDK (async), Docker, Supervisord |
| **Browser** | Playwright, Stagehand (Browserbase), Chrome |
| **Auth** | PyJWT, FastAPI-SSO, Supabase Auth |
| **Billing** | Stripe, RevenueCat |
| **Monitoring** | LangFuse, Braintrust, Prometheus |
| **Testing** | pytest, pytest-asyncio, E2E test harness |
| **Search** | Tavily, Firecrawl, Exa, Semantic Scholar |
| **Infra** | Docker Compose, Gunicorn, APScheduler |
| **Deployment** | Freestyle |

---

*Document generated from live codebase analysis on 2026-05-07.*
