import { useState, useRef, useCallback } from "react";
import {
  Folder,
  FileCode,
  FileJson,
  FileText,
  FileType,
  File as FileIcon,
  Monitor,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Terminal,
  CheckCircle2,
  XCircle,
  Loader2,
  SlidersHorizontal,
} from "lucide-react";
import { useChatStore } from "../../stores";
import type { AgentFileEntry, AgentToolLogEntry } from "../../stores/chat/types";

function fileIconForName(name: string) {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  switch (ext) {
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
      return <FileCode className="h-3 w-3 text-yellow-400/80" />;
    case "py":
      return <FileCode className="h-3 w-3 text-blue-400/80" />;
    case "css":
    case "scss":
      return <FileText className="h-3 w-3 text-purple-400/80" />;
    case "json":
      return <FileJson className="h-3 w-3 text-orange-400/80" />;
    case "md":
      return <FileText className="h-3 w-3 text-white/60" />;
    case "html":
      return <FileType className="h-3 w-3 text-red-400/80" />;
    default:
      return <FileIcon className="h-3 w-3 text-white/40" />;
  }
}

function buildCompactTree(paths: string[]) {
  const root: Record<string, { name: string; path: string; kind: "file" | "dir"; children: Record<string, any> }> = {};
  for (const filePath of paths) {
    const parts = filePath.split("/");
    let currentMap = root;
    let accumulatedPath = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      accumulatedPath = accumulatedPath ? accumulatedPath + "/" + part : part;
      const isFile = i === parts.length - 1;
      if (!currentMap[part]) {
        currentMap[part] = {
          name: part,
          path: accumulatedPath,
          kind: isFile ? "file" : "dir",
          children: {},
        };
      }
      if (isFile) {
        currentMap[part].kind = "file";
        currentMap[part].path = filePath;
      }
      currentMap = currentMap[part].children;
    }
  }
  return Object.values(root).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function TreeNode({
  node,
  depth = 0,
}: {
  node: {
    name: string;
    path: string;
    kind: "file" | "dir";
    children: Record<string, any>;
  };
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const indent = depth * 12;

  if (node.kind === "file") {
    return (
      <div
        className="flex items-center gap-1.5 py-0.5 text-white/60"
        style={{ paddingLeft: indent + 4 }}
      >
        {fileIconForName(node.name)}
        <span className="truncate text-[11px] font-mono">{node.name}</span>
      </div>
    );
  }

  const childNodes = Object.values(node.children).sort((a: any, b: any) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1 py-0.5 text-left text-white/50 transition hover:text-white/70"
        style={{ paddingLeft: indent + 4 }}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <Folder className="h-3 w-3 shrink-0 text-white/40" />
        <span className="text-[11px] font-medium">{node.name}</span>
      </button>
      {expanded &&
        childNodes.map((child: any) => (
          <TreeNode key={child.path} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

function ToolStatusIcon({ status }: { status: AgentToolLogEntry["status"] }) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="h-3 w-3 text-emerald-400/80" />;
    case "error":
      return <XCircle className="h-3 w-3 text-red-400/80" />;
    case "running":
      return <Loader2 className="h-3 w-3 animate-spin text-amber-400/80" />;
  }
}

interface InlineWorkspaceCardProps {
  files: AgentFileEntry[];
  toolLog?: AgentToolLogEntry[];
}

export function InlineWorkspaceCard({ files, toolLog = [] }: InlineWorkspaceCardProps) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(true);
  const [isFilesOpen, setIsFilesOpen] = useState(true);
  const [isToolsOpen, setIsToolsOpen] = useState(true);
  const [isControlsOpen, setIsControlsOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { openWorkspace } = useChatStore();

  if (files.length === 0 && toolLog.length === 0) return null;

  const paths = files.map((f) => f.path);
  const tree = buildCompactTree(paths);
  const htmlFile = files.find((f) => f.path.endsWith(".html"));
  const previewUrl = htmlFile?.previewUrl ?? null;

  // Interactive controls via postMessage
  const sendControl = useCallback((key: string, value: unknown) => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { source: "visualruntime", type: "control", key, value },
        "*"
      );
    }
  }, []);

  return (
    <div className="card-glass card-glass-accent mt-3 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/[0.04] px-3 py-2">
        <Monitor className="h-3.5 w-3.5 text-white/50" />
        <span className="text-[11px] font-medium text-white/70">Agent Workspace</span>
        <span className="ml-auto rounded-full bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-semibold text-white/40">
          {files.length} file{files.length !== 1 ? "s" : ""}
          {toolLog.length > 0 && ` · ${toolLog.length} tool${toolLog.length !== 1 ? "s" : ""}`}
        </span>
        <button
          type="button"
          onClick={() => openWorkspace()}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-white/40 transition hover:bg-white/[0.04] hover:text-white/70"
        >
          <ExternalLink className="h-3 w-3" />
          Open
        </button>
      </div>

      {/* Preview iframe */}
      {previewUrl && (
        <div className="border-b border-white/[0.04]">
          <button
            type="button"
            onClick={() => setIsPreviewOpen(!isPreviewOpen)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-white/50 transition hover:bg-white/[0.02] hover:text-white/70"
          >
            {isPreviewOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <span>Preview</span>
          </button>
          {isPreviewOpen && (
            <div className="px-3 pb-2">
              <div className="relative overflow-hidden rounded-lg border border-white/[0.06] bg-black/40">
                <iframe
                  ref={iframeRef}
                  src={previewUrl}
                  className="h-[200px] w-full"
                  sandbox="allow-scripts allow-same-origin"
                  title="Agent preview"
                />
              </div>
              {/* Interactive Controls */}
              <button
                type="button"
                onClick={() => setIsControlsOpen(!isControlsOpen)}
                className="mt-1.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[10px] text-white/30 transition hover:bg-white/[0.02] hover:text-white/50"
              >
                <SlidersHorizontal className="h-3 w-3" />
                {isControlsOpen ? "Hide controls" : "Show controls"}
              </button>
              {isControlsOpen && (
                <div className="mt-1 flex flex-wrap gap-2 rounded-md bg-white/[0.02] px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => sendControl("gravity", 9.8)}
                    className="rounded border border-white/[0.06] px-2 py-0.5 text-[10px] text-white/50 transition hover:bg-white/[0.04] hover:text-white/70"
                  >
                    Reset gravity
                  </button>
                  <button
                    type="button"
                    onClick={() => sendControl("pause", true)}
                    className="rounded border border-white/[0.06] px-2 py-0.5 text-[10px] text-white/50 transition hover:bg-white/[0.04] hover:text-white/70"
                  >
                    Pause
                  </button>
                  <button
                    type="button"
                    onClick={() => sendControl("resume", true)}
                    className="rounded border border-white/[0.06] px-2 py-0.5 text-[10px] text-white/50 transition hover:bg-white/[0.04] hover:text-white/70"
                  >
                    Resume
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* File tree */}
      {files.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setIsFilesOpen(!isFilesOpen)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-white/50 transition hover:bg-white/[0.02] hover:text-white/70"
          >
            {isFilesOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <span>Files</span>
          </button>
          {isFilesOpen && (
            <div className="px-3 pb-2 pt-0.5">
              {tree.map((node) => (
                <TreeNode key={node.path} node={node} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tool execution log */}
      {toolLog.length > 0 && (
        <div className="border-t border-white/[0.04]">
          <button
            type="button"
            onClick={() => setIsToolsOpen(!isToolsOpen)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-white/50 transition hover:bg-white/[0.02] hover:text-white/70"
          >
            {isToolsOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <Terminal className="h-3 w-3" />
            <span>Tools</span>
          </button>
          {isToolsOpen && (
            <div className="px-3 pb-2 pt-0.5">
              <div className="flex flex-col gap-1">
                {toolLog.map((entry, idx) => (
                  <div
                    key={`${entry.id}-${idx}`}
                    className="flex items-start gap-2 rounded-md px-2 py-1 text-[11px] text-white/60 hover:bg-white/[0.02]"
                  >
                    <ToolStatusIcon status={entry.status} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">{entry.tool}</span>
                      {entry.output && (
                        <span className="truncate text-[10px] text-white/40">
                          {entry.output}
                        </span>
                      )}
                    </div>
                    {entry.durationMs > 0 && (
                      <span className="shrink-0 text-[10px] tabular-nums text-white/30">
                        {entry.durationMs}ms
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
