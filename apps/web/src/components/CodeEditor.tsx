import { useState, useEffect } from "react";
import { Play, Copy, Check, RotateCcw, FileCode, Loader2 } from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
import { cn } from "../lib/utils";

interface CodeEditorProps {
  code: string | null;
  skill: string | null;
  readOnly?: boolean;
  onChange?: (code: string) => void;
  onRun?: (code: string) => void;
  runPending?: boolean;
}

export default function CodeEditor({ code, skill, readOnly, onRun, runPending = false }: CodeEditorProps) {
  const [localCode, setLocalCode] = useState(code ?? "");
  const [copied, setCopied] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const isPythonSkill = skill === "manim";
  const fileExtension = isPythonSkill ? "py" : skill === "threejs" ? "tsx" : "js";
  const highlightLanguage = isPythonSkill ? "python" : skill === "threejs" ? "tsx" : "javascript";

  useEffect(() => {
    setLocalCode(code ?? "");
    setIsDirty(false);
  }, [code]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(localCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  };

  const handleReset = () => {
    setLocalCode(code ?? "");
    setIsDirty(false);
  };

  const handleRun = () => {
    if (runPending) {
      return;
    }

    onRun?.(localCode);
  };

  const lineCount = localCode.split("\n").length;
  const editorTheme = themes.vsDark ?? themes.github;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[28px] border border-white/10 bg-[#050507] shadow-[0_0_0_1px_#000,0_30px_90px_-30px_#000]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(59,130,246,0.16),transparent_45%),radial-gradient(circle_at_88%_20%,rgba(236,72,153,0.1),transparent_55%)]" />
      </div>

      <div className="relative z-10 flex h-full flex-col">
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-white/10 bg-black/45 px-4 backdrop-blur-md">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>

          <div className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/35 px-3 py-1.5">
            <span className="block truncate font-mono text-[11px] text-white/55">{`scene.${fileExtension}`}</span>
          </div>

          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.14em] text-white/55 sm:inline-flex">
            <FileCode className="h-3.5 w-3.5" />
            <span>{lineCount} lines</span>
            {isDirty && <span className="text-amber-300">modified</span>}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/15 bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white"
              onClick={handleCopy}
              title="Copy code"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>

            {isDirty && (
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/15 bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white"
                onClick={handleReset}
                title="Reset changes"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}

            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-cyan-300/35 bg-cyan-300/12 px-2.5 text-[11px] text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-45"
              onClick={handleRun}
              disabled={runPending || !localCode.trim()}
            >
              {runPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {runPending ? "Running..." : "Run"}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-black/35">
          <Highlight
            theme={editorTheme}
            code={localCode}
            language={highlightLanguage}
          >
            {({ className, style, tokens, getLineProps, getTokenProps }) => (
              <pre className={cn(className, "m-0 min-h-full p-4 font-mono text-[12px] leading-6")} style={style}>
                <code>
                  {tokens.map((line, i) => (
                    <div key={i} {...getLineProps({ line })} className="flex">
                      <span className="w-11 select-none pr-3 text-right text-white/25">{i + 1}</span>
                      <span className="flex-1 text-white/90">
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

        <div className="flex h-8 shrink-0 items-center justify-between border-t border-white/10 bg-black/40 px-3 text-[11px] text-white/55">
          <span className="font-mono uppercase tracking-[0.14em]">{(skill || "runtime").toUpperCase()}</span>
          <span>{readOnly ? "Read-only view" : "Editable"}</span>
        </div>
      </div>
    </div>
  );
}
