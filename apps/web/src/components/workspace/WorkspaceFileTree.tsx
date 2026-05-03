import { FolderOpen, Folder, File, ChevronRight, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useChatStore } from "../../stores";

interface TreeNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  children: TreeNode[];
}

function buildTree(filePaths: string[]): TreeNode[] {
  const root: Record<string, TreeNode> = {};
  for (const filePath of filePaths) {
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
          kind: isFile ? "file" : "directory",
          children: [],
        };
      }
      if (isFile) {
        currentMap[part].kind = "file";
        currentMap[part].path = filePath;
      }
      currentMap = currentMap[part].children.reduce((acc, child) => {
        acc[child.name] = child;
        return acc;
      }, {} as Record<string, TreeNode>);
    }
  }
  return Object.values(root).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function fileIconForExtension(name: string) {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  switch (ext) {
    case "js": case "jsx": case "ts": case "tsx":
      return { cls: "text-yellow-400/80", label: "JS" };
    case "py":
      return { cls: "text-blue-400/80", label: "PY" };
    case "css": case "scss":
      return { cls: "text-purple-400/80", label: "CSS" };
    case "json":
      return { cls: "text-orange-400/80", label: "{}" };
    case "md":
      return { cls: "text-white/60", label: "MD" };
    case "html":
      return { cls: "text-red-400/80", label: "<>" };
    default:
      return null;
  }
}

function TreeEntry({ node, depth, selectedPath, onSelect }: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const extInfo = node.kind === "file" ? fileIconForExtension(node.name) : null;

  if (node.kind === "file") {
    const isSelected = selectedPath === node.path;
    return (
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        className={"flex w-full items-center gap-1.5 px-2 py-0.5 text-left transition " +
          (isSelected ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/5 hover:text-white/80")}
        style={{ paddingLeft: depth * 14 + 8 }}
      >
        {extInfo ? (
          <span className={"flex h-4 w-4 items-center justify-center rounded text-[7px] font-bold " + extInfo.cls}>
            {extInfo.label}
          </span>
        ) : (
          <File className="h-3.5 w-3.5 shrink-0 text-white/30" />
        )}
        <span className="truncate text-[11px] font-mono leading-5">{node.name}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1 px-2 py-0.5 text-left text-white/55 transition hover:bg-white/5 hover:text-white/80"
        style={{ paddingLeft: depth * 14 + 8 }}
      >
        {expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-white/40" /> : <ChevronRight className="h-3 w-3 shrink-0 text-white/40" />}
        {expanded ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-white/45" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-white/35" />}
        <span className="truncate text-[11px] font-semibold leading-5">{node.name}</span>
      </button>
      {expanded &&
        node.children
          .sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
            return a.name.localeCompare(b.name);
          })
          .map((child) => (
            <TreeEntry
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
    </div>
  );
}

export default function WorkspaceFileTree() {
  const { workspaceRecord, selectedWorkspaceFile, selectWorkspaceFile } = useChatStore();

  const tree = useMemo(() => {
    if (!workspaceRecord) return [];
    return buildTree(Object.keys(workspaceRecord.files));
  }, [workspaceRecord]);

  if (!workspaceRecord || tree.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center">
        <Folder className="mb-2 h-8 w-8 text-white/15" />
        <p className="text-[12px] text-white/40">No workspace files yet</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-white/5 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/50">Files</span>
        <span className="rounded-full bg-white/8 px-1.5 py-0.5 text-[9px] text-white/35">
          {Object.keys(workspaceRecord.files).length}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {tree.map((node) => (
          <TreeEntry key={node.path} node={node} depth={0} selectedPath={selectedWorkspaceFile} onSelect={selectWorkspaceFile} />
        ))}
      </div>
    </div>
  );
}