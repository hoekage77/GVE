import { FileCode2, Copy, Check } from "lucide-react";
import { useMemo, useState } from "react";
import { useChatStore } from "../../stores";
import { Highlight, themes } from "prism-react-renderer";

export default function WorkspaceFileViewer() {
  const { workspaceRecord, selectedWorkspaceFile } = useChatStore();
  const [copied, setCopied] = useState(false);

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

  const handleCopy = async () => {
    if (!selectedEntry) return;
    try {
      await navigator.clipboard.writeText(selectedEntry.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable
    }
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
        <button
          type="button"
          onClick={handleCopy}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded border border-white/10 bg-white/5 text-white/50 transition hover:text-white"
        >
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-black/30">
        <Highlight
          theme={themes.vsDark}
          code={selectedEntry.content}
          language={highlightLanguage}
        >
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre
              className={
                className + " m-0 min-h-full p-3 font-mono text-[11px] leading-5"
              }
              style={style}
            >
              <code>
                {tokens.map((line, i) => (
                  <div key={i} {...getLineProps({ line })} className="flex">
                    <span className="w-8 select-none pr-2 text-right text-white/20">
                      {i + 1}
                    </span>
                    <span className="flex-1 text-white/85">
                      {line.map((token, key) => (
                        <span key={key} {...getTokenProps({ token })} />
                      ))}
                    </span>
                  </div>
                ))}
              </code>
            </pre>
          )}
        </Highlight>
      </div>
    </div>
  );
}
