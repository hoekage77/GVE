import { GitBranch, Plus, Minus, ArrowRight, File as FileIcon } from "lucide-react";
import { useMemo } from "react";
import { useChatStore } from "../../stores";

interface FileDiff {
  path: string;
  kind: "add" | "remove" | "modify" | "rename";
  newPath?: string;
  originalContent?: string;
  patchedContent?: string;
}

function DiffBlock({ path, kind }: { path: string; kind: string }) {
  const icon =
    kind === "add" ? (
      <Plus className="h-3 w-3 text-green-400" />
    ) : kind === "remove" ? (
      <Minus className="h-3 w-3 text-red-400" />
    ) : kind === "rename" ? (
      <ArrowRight className="h-3 w-3 text-blue-400" />
    ) : (
      <FileIcon className="h-3 w-3 text-yellow-400" />
    );

  return (
    <div className="border-b border-white/5">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-white/3">
        {icon}
        <span className="text-[10px] font-mono text-white/70">{path}</span>
      </div>
    </div>
  );
}

export default function DiffViewer() {
  const workspaceRecord = useChatStore((s) => s.workspaceRecord);

  const diffs = useMemo(() => {
    const result: FileDiff[] = [];
    if (!workspaceRecord) return result;
    const files = workspaceRecord.files || {};
    for (const [path] of Object.entries(files)) {
      result.push({ path, kind: "modify" });
    }
    return result;
  }, [workspaceRecord]);

  if (!workspaceRecord || diffs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center">
        <GitBranch className="mb-2 h-8 w-8 text-white/15" />
        <p className="text-[12px] text-white/40">
          Select iterations to compare changes
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-white/5 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/50">
          Diffs
        </span>
        <span className="rounded-full bg-white/8 px-1.5 py-0.5 text-[9px] text-white/35">
          {diffs.length} files
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {diffs.map((d) => (
          <DiffBlock key={d.path} path={d.path} kind={d.kind} />
        ))}
      </div>
    </div>
  );
}
