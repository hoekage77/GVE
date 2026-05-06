import { FileCode2, Copy, Check, History, ArrowLeft, Clock, GitCommit } from "lucide-react";
import { useMemo, useState } from "react";
import { useChatStore } from "../../stores";
import { Highlight, themes } from "prism-react-renderer";
import type { FileRevision } from "../../api";

type Tab = "content" | "history";

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function actionLabel(action: FileRevision["agentAction"]): string {
  switch (action) {
    case "generate": return "Generated";
    case "patch": return "Patched";
    case "user-edit": return "Edited";
    default: return String(action);
  }
}

function actionColor(action: FileRevision["agentAction"]): string {
  switch (action) {
    case "generate": return "text-emerald-300/80";
    case "patch": return "text-amber-300/80";
    case "user-edit": return "text-sky-300/80";
    default: return "text-white/50";
  }
}

function simpleDiff(oldText: string, newText: string): { line: number; type: "added" | "removed"; text: string }[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: { line: number; type: "added" | "removed"; text: string }[] = [];
  let oi = 0, ni = 0;
  while (oi < oldLines.length || ni < newLines.length) {
    if (oi >= oldLines.length) {
      result.push({ line: ni + 1, type: "added", text: newLines[ni] });
      ni++;
    } else if (ni >= newLines.length) {
      result.push({ line: oi + 1, type: "removed", text: oldLines[oi] });
      oi++;
    } else if (oldLines[oi] === newLines[ni]) {
      oi++; ni++;
    } else {
      // Simple heuristic: if next old matches next new, this is an insertion
      if (ni + 1 < newLines.length && oldLines[oi] === newLines[ni + 1]) {
        result.push({ line: ni + 1, type: "added", text: newLines[ni] });
        ni++;
      } else if (oi + 1 < oldLines.length && oldLines[oi + 1] === newLines[ni]) {
        result.push({ line: oi + 1, type: "removed", text: oldLines[oi] });
        oi++;
      } else {
        // Treat as replacement: removed old, added new
        result.push({ line: oi + 1, type: "removed", text: oldLines[oi] });
        result.push({ line: ni + 1, type: "added", text: newLines[ni] });
        oi++; ni++;
      }
    }
  }
  return result;
}

export default function WorkspaceFileViewer() {
  const { workspaceRecord, selectedWorkspaceFile, setWorkspaceRecord } = useChatStore();
  const [tab, setTab] = useState<Tab>("content");
  const [copied, setCopied] = useState(false);
  const [selectedRevision, setSelectedRevision] = useState<FileRevision | null>(null);

  const selectedEntry = useMemo(() => {
    if (!workspaceRecord || !selectedWorkspaceFile) return null;
    return workspaceRecord.files[selectedWorkspaceFile] ?? null;
  }, [workspaceRecord, selectedWorkspaceFile]);

  const highlightLanguage = useMemo(() => {
    if (!selectedEntry) return "javascript";
    const skill = selectedEntry.skill.toLowerCase();
    if (skill === "manim") return "python";
    if (skill === "threejs") return "tsx";
    return "javascript";
  }, [selectedEntry]);

  const lineCount = selectedEntry
    ? selectedEntry.content.split("\n").length
    : 0;

  const history = selectedEntry?.history ?? [];

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable
    }
  };

  const handleRevert = (revision: FileRevision) => {
    if (!workspaceRecord || !selectedWorkspaceFile) return;
    const next = {
      ...workspaceRecord,
      files: {
        ...workspaceRecord.files,
        [selectedWorkspaceFile]: {
          ...workspaceRecord.files[selectedWorkspaceFile],
          content: revision.content,
        },
      },
    };
    setWorkspaceRecord(next);
    setSelectedRevision(null);
    setTab("content");
  };

  if (!selectedEntry) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center">
        <FileCode2 className="mb-2 h-8 w-8 text-white/15" />
        <p className="text-[12px] text-white/40">
          Select a file to view its contents
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/5 px-3 py-1.5">
        <FileCode2 className="h-3.5 w-3.5 text-white/50" />
        <span className="truncate text-[11px] font-mono text-white/70">
          {selectedEntry.path}
        </span>
        <span className="text-[10px] text-white/30">{lineCount} lines</span>
        <span className="rounded-full bg-white/8 px-1.5 py-0.5 text-[9px] text-white/40">
          {selectedEntry.skill}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => { setTab("content"); setSelectedRevision(null); }}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${tab === "content" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}
          >
            Code
          </button>
          <button
            type="button"
            onClick={() => { setTab("history"); setSelectedRevision(null); }}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition ${tab === "history" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}
          >
            <History className="h-3 w-3" />
            History
            {history.length > 0 && (
              <span className="rounded-full bg-white/10 px-1 text-[9px]">{history.length}</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => handleCopy(selectedEntry.content)}
            className="ml-1 flex h-6 w-6 items-center justify-center rounded border border-white/10 bg-white/5 text-white/50 transition hover:text-white"
            title="Copy"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-black/30">
        {tab === "content" ? (
          selectedRevision ? (
            <div className="flex h-full flex-col">
              <div className="flex shrink-0 items-center gap-2 border-b border-white/5 bg-white/5 px-3 py-1">
                <button
                  type="button"
                  onClick={() => setSelectedRevision(null)}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white/60 transition hover:bg-white/10 hover:text-white"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back
                </button>
                <span className="text-[10px] text-white/40">
                  Version {selectedRevision.version} — {actionLabel(selectedRevision.agentAction)} at {formatDateTime(selectedRevision.createdAt)}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleCopy(selectedRevision.content)}
                    className="flex h-5 w-5 items-center justify-center rounded border border-white/10 bg-white/5 text-white/50 transition hover:text-white"
                    title="Copy"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRevert(selectedRevision)}
                    className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300 transition hover:bg-emerald-500/25"
                  >
                    Restore
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <Highlight theme={themes.vsDark} code={selectedRevision.content} language={highlightLanguage}>
                  {({ className, style, tokens, getLineProps, getTokenProps }) => (
                    <pre className={className + " m-0 min-h-full p-3 font-mono text-[11px] leading-5"} style={style}>
                      <code>
                        {tokens.map((line, i) => (
                          <div key={i} {...getLineProps({ line })} className="flex">
                            <span className="w-8 select-none pr-2 text-right text-white/20">{i + 1}</span>
                            <span className="flex-1 text-white/85">
                              {line.map((token, key) => <span key={key} {...getTokenProps({ token })} />)}
                            </span>
                          </div>
                        ))}
                      </code>
                    </pre>
                  )}
                </Highlight>
              </div>
            </div>
          ) : (
            <Highlight theme={themes.vsDark} code={selectedEntry.content} language={highlightLanguage}>
              {({ className, style, tokens, getLineProps, getTokenProps }) => (
                <pre className={className + " m-0 min-h-full p-3 font-mono text-[11px] leading-5"} style={style}>
                  <code>
                    {tokens.map((line, i) => (
                      <div key={i} {...getLineProps({ line })} className="flex">
                        <span className="w-8 select-none pr-2 text-right text-white/20">{i + 1}</span>
                        <span className="flex-1 text-white/85">
                          {line.map((token, key) => <span key={key} {...getTokenProps({ token })} />)}
                        </span>
                      </div>
                    ))}
                  </code>
                </pre>
              )}
            </Highlight>
          )
        ) : (
          <div className="flex h-full flex-col">
            {history.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
                <Clock className="mb-2 h-7 w-7 text-white/15" />
                <p className="text-[12px] text-white/40">No history for this file yet</p>
              </div>
            ) : selectedRevision ? (
              <div className="flex h-full flex-col">
                <div className="flex shrink-0 items-center gap-2 border-b border-white/5 bg-white/5 px-3 py-1">
                  <button
                    type="button"
                    onClick={() => setSelectedRevision(null)}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white/60 transition hover:bg-white/10 hover:text-white"
                  >
                    <ArrowLeft className="h-3 w-3" />
                    Back
                  </button>
                  <span className="text-[10px] text-white/40">
                    Diff: Version {selectedRevision.version} vs Current
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleRevert(selectedRevision)}
                      className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300 transition hover:bg-emerald-500/25"
                    >
                      Restore
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto bg-[#0c0c0e]">
                  {(() => {
                    const diff = simpleDiff(selectedRevision.content, selectedEntry.content);
                    return (
                      <pre className="m-0 min-h-full p-3 font-mono text-[11px] leading-5">
                        <code>
                          {diff.length === 0 ? (
                            <div className="text-white/30 italic">No differences</div>
                          ) : diff.map((d, i) => (
                            <div key={i} className={`flex ${d.type === "added" ? "bg-emerald-500/10" : d.type === "removed" ? "bg-red-500/10" : ""}`}>
                              <span className={`w-6 select-none pr-2 text-right text-[10px] ${d.type === "added" ? "text-emerald-400/60" : d.type === "removed" ? "text-red-400/60" : "text-white/20"}`}>
                                {d.line}
                              </span>
                              <span className={`flex-1 ${d.type === "added" ? "text-emerald-300/90" : d.type === "removed" ? "text-red-300/90" : "text-white/85"}`}>
                                {d.type === "added" ? "+ " : d.type === "removed" ? "- " : "  "}
                                {d.text || " "}
                              </span>
                            </div>
                          ))}
                        </code>
                      </pre>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto py-1">
                {history.map((rev) => (
                  <button
                    key={rev.version}
                    type="button"
                    onClick={() => setSelectedRevision(rev)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-white/5"
                  >
                    <GitCommit className={`h-3.5 w-3.5 shrink-0 ${actionColor(rev.agentAction)}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium text-white/70">Version {rev.version}</span>
                        <span className={`text-[10px] ${actionColor(rev.agentAction)}`}>{actionLabel(rev.agentAction)}</span>
                      </div>
                      <div className="text-[10px] text-white/30">{formatDateTime(rev.createdAt)}</div>
                    </div>
                    <span className="text-[10px] text-white/25">{rev.content.split("\n").length} lines</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
