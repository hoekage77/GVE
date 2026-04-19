import sys
import re

def slice_file(lines, start_re, end_re=None, include_end=False):
    start_idx = -1
    end_idx = -1
    for i, line in enumerate(lines):
        if start_idx == -1 and re.search(start_re, line):
            start_idx = i
        if start_idx != -1 and end_re and re.search(end_re, line) and i > start_idx:
            end_idx = i
            break
            
    if start_idx == -1: return []
    if end_idx == -1: end_idx = len(lines)
    
    return lines[start_idx:end_idx + (1 if include_end else 0)]

def extract_funcs(lines, funcs):
    out = []
    for fn in funcs:
        start_idx = -1
        for i, line in enumerate(lines):
            if line.startswith(f"function {fn}(") or line.startswith(f"async function {fn}("):
                start_idx = i
                break
        if start_idx == -1: continue
        
        open_brackets = 0
        started = False
        end_idx = -1
        for i in range(start_idx, len(lines)):
            line = lines[i]
            open_brackets += line.count('{')
            open_brackets -= line.count('}')
            if '{' in line: started = True
            if started and open_brackets == 0:
                end_idx = i
                break
        if end_idx != -1:
            out.extend(lines[start_idx:end_idx+1])
            out.append("")
    return out

def main():
    with open("index.ts", "r") as f:
        lines = f.read().splitlines()
        
    # 1. ws/handler.ts
    handler_lines = [
        "// @ts-nocheck",
        'import { executeChatTurn } from "../routes/chat.js";',
        'import { executeSceneCommandMutation } from "../routes/chat.js";',
        'import { buildAgentActivity } from "./streaming.js";',
        'import { sendSocketPayload, sendSocketEvent, replayEventsSince, broadcastEvent } from "./streaming.js";'
    ]
    # wsServer.on("connection") up to server.on("upgrade")
    handler_lines.extend(slice_file(lines, r'wsServer\.on\("connection"', r'server\.on\("upgrade"'))
    # also add wsClients Set
    handler_lines.insert(1, "export const wsClients = new Set();")
    
    with open("ws/handler.ts", "w") as f:
        f.write("\n".join(handler_lines))
        
    # 2. ws/streaming.ts
    streaming_lines = [
        "// @ts-nocheck",
        'import { wsClients } from "./handler.js";',
        'import { eventMatchesSession } from "../lib/utils.js"; // assume moved'
    ]
    streaming_funcs = [
        "sendSocketPayload", "sendSocketEvent", "eventMatchesSession", "replayEventsSince",
        "broadcastEvent", "broadcastThought", "broadcastCodeStream"
    ]
    streaming_lines.extend(extract_funcs(lines, streaming_funcs))
    
    with open("ws/streaming.ts", "w") as f:
        f.write("\n".join(streaming_lines))
        
    # 3. routes/api.ts
    api_lines = [
        "// @ts-nocheck",
        'import { Router } from "express";',
        'export const apiRouter = Router();'
    ]
    # Replace app. with apiRouter.
    api_block = slice_file(lines, r'app\.get\("/healthz"', r'server\.listen')
    api_block = [line.replace('app.', 'apiRouter.') for line in api_block]
    api_lines.extend(api_block)
    
    with open("routes/api.ts", "w") as f:
        f.write("\n".join(api_lines))
        
    # 4. routes/chat.ts
    chat_lines = [
        "// @ts-nocheck",
        'import { broadcastThought, broadcastCodeStream, broadcastEvent } from "../ws/streaming.js";'
    ]
    chat_funcs = [
        "executeChatTurn", "executeSceneCommandMutation", "buildStructuredTurnError",
        "extractErrorDiagnostics", "truncateDiagnosticText", "mapAgentActivityText", "buildAgentActivity",
        "buildTurnResultSummary", "buildTurnLifecyclePayload", "compactModifyDiff"
    ]
    chat_lines.extend(extract_funcs(lines, chat_funcs))
    
    with open("routes/chat.ts", "w") as f:
        f.write("\n".join(chat_lines))

if __name__ == "__main__":
    main()
