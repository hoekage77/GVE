import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Copy, Check, RotateCcw, Monitor, ChevronRight, Plug2, WandSparkles } from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
import { cn } from "../lib/utils";

interface CodeEditorProps {
  code: string | null;
  skill: string | null;
  readOnly?: boolean;
  onChange?: (code: string) => void;
  onRun?: (code: string) => void;
}

const SKILL_LABELS: Record<string, string> = {
  threejs: "JavaScript — Three.js",
  p5js: "JavaScript — p5.js",
  d3js: "JavaScript — D3.js",
  animejs: "JavaScript — Anime.js"
};

function getLineCount(text: string): number {
  return text.split("\n").length;
}

export default function CodeEditor({ code, skill, readOnly, onChange, onRun }: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const codeBlockRef = useRef<HTMLDivElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const [localCode, setLocalCode] = useState(code ?? "");
  const [copied, setCopied] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isFormatting, setIsFormatting] = useState(false);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);

  useEffect(() => {
    setLocalCode(code ?? "");
    setIsDirty(false);
    setFormatError(null);
  }, [code]);

  const syncLineNumberScroll = useCallback((scrollTop: number) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = scrollTop;
    }
  }, []);

  const syncEditorScroll = useCallback(() => {
    if (textareaRef.current) {
      syncLineNumberScroll(textareaRef.current.scrollTop);
    }
  }, [syncLineNumberScroll]);

  const syncCodeBlockScroll = useCallback(() => {
    if (codeBlockRef.current) {
      syncLineNumberScroll(codeBlockRef.current.scrollTop);
    }
  }, [syncLineNumberScroll]);

  const handleChange = (value: string) => {
    setLocalCode(value);
    setIsDirty(value !== (code ?? ""));
    if (formatError) {
      setFormatError(null);
    }
    onChange?.(value);
  };

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
    onRun?.(localCode);
  };

  const handleFormat = async () => {
    if (!localCode.trim()) {
      return;
    }

    setFormatError(null);
    setIsFormatting(true);
    try {
      const prettier = await import("prettier/standalone");
      const pluginBabelMod = await import("prettier/plugins/babel");
      const pluginEstreeMod = await import("prettier/plugins/estree");

      const pluginBabel = (pluginBabelMod as { default?: unknown }).default ?? pluginBabelMod;
      const pluginEstree = (pluginEstreeMod as { default?: unknown }).default ?? pluginEstreeMod;

      const formatted = await prettier.format(localCode, {
        parser: "babel",
        plugins: [pluginBabel, pluginEstree],
        semi: true,
        singleQuote: true,
        trailingComma: "es5",
        printWidth: 100
      });

      const normalized = formatted.endsWith("\n") ? formatted : `${formatted}\n`;
      setLocalCode(normalized);
      setIsDirty(normalized !== (code ?? ""));
      onChange?.(normalized);
    } catch {
      setFormatError("Could not format this code. Fix syntax and try again.");
    } finally {
      setIsFormatting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const newValue = localCode.substring(0, start) + "  " + localCode.substring(end);
      handleChange(newValue);
      requestAnimationFrame(() => {
        target.selectionStart = start + 2;
        target.selectionEnd = start + 2;
      });
    }

    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleRun();
    }
  };

  const lineCount = getLineCount(localCode);
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);
  const skillLabel = skill ? skill.toUpperCase() : "CODE";
  const focusLabel = code ? `${skillLabel} source` : "No code yet";
  const statusLabel = code ? "Code is ready for edits" : "Waiting for generated code";
  const canEdit = !readOnly;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden font-mono">
      <div className="border-b border-black/10 bg-white/92 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-black/10 bg-white text-black/75"
              aria-hidden="true"
            >
              <Monitor className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="m-0 text-[13px] font-semibold tracking-[0.01em] text-black/95">dosco</p>
              <p className="m-0.5 flex items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-black/65">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.16)]" aria-hidden="true" />
                <span>Code Editor</span>
                <span className="h-3 w-px bg-black/20" aria-hidden="true" />
                <span className="overflow-hidden text-ellipsis text-black/75">{focusLabel}</span>
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
              </p>
            </div>
          </div>
        </div>
        <div className="my-2 h-px bg-black/10" />
        <p className="m-0 flex items-center gap-1.5 text-[11px] text-black/75">
          <Plug2 className="h-3.5 w-3.5" aria-hidden="true" />
          {statusLabel}
        </p>
      </div>

      {!code ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-8 text-center">
          <div className="mb-1 text-4xl text-black/25">◇</div>
          <p className="m-0 text-sm font-medium text-black/70">Generated code will appear here</p>
          <p className="m-0 text-xs text-black/45">Run a generation request to open live source code in this editor</p>
        </div>
      ) : (
        <>
      <div className="flex items-center justify-between gap-2 border-b border-black/10 bg-black/[0.02] px-3 py-1.5 font-sans">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-black/60">
          {SKILL_LABELS[skill ?? ""] ?? "JavaScript"}
          {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-black/85" />}
        </span>
        <div className="flex items-center gap-1">
          {isDirty && (
            <button
              type="button"
              className="inline-flex h-6 items-center justify-center gap-1 rounded-md border border-black/15 bg-white px-1.5 text-[11px] font-semibold text-black/75 transition hover:bg-white hover:text-black"
              onClick={handleReset}
              aria-label="Reset code"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            className={cn(
              "inline-flex h-6 min-w-[3.1rem] items-center justify-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold transition",
              isEditMode
                ? "border-black/30 bg-black/10 text-black"
                : "border-black/15 bg-white text-black/75 hover:bg-white hover:text-black"
            )}
            onClick={() => setIsEditMode((prev) => !prev)}
            aria-label={isEditMode ? "Switch to code block view" : "Switch to edit mode"}
            disabled={!canEdit}
            title={canEdit ? (isEditMode ? "View code block" : "Edit code") : "Read-only mode"}
          >
            <span>{isEditMode ? "View" : "Edit"}</span>
          </button>
          <button
            type="button"
            className="inline-flex h-6 items-center justify-center gap-1 rounded-md border border-black/15 bg-white px-1.5 text-[11px] font-semibold text-black/75 transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleFormat}
            disabled={isFormatting || localCode.trim().length === 0}
            aria-label="Format code"
          >
            <WandSparkles className="h-3.5 w-3.5" />
            <span>{isFormatting ? "Formatting" : "Format"}</span>
          </button>
          <button
            type="button"
            className="inline-flex h-6 items-center justify-center gap-1 rounded-md border border-black/15 bg-white px-1.5 text-[11px] font-semibold text-black/75 transition hover:bg-white hover:text-black"
            onClick={handleCopy}
            aria-label="Copy code"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          {onRun && (
            <button
              type="button"
              className="inline-flex h-6 items-center justify-center gap-1 rounded-md border border-black/30 bg-black/10 px-1.5 text-[11px] font-semibold text-black transition hover:bg-black/15"
              onClick={handleRun}
              aria-label="Run code (Ctrl+Enter)"
            >
              <Play className="h-3.5 w-3.5" />
              <span>Run</span>
            </button>
          )}
        </div>
      </div>

      {formatError ? <p className="border-b border-rose-200 bg-rose-50 px-3 py-1 text-[11px] text-rose-700">{formatError}</p> : null}

      <div className={cn("flex min-h-0 flex-1 overflow-hidden", !isEditMode && "bg-slate-950 text-slate-100")}>
        <div
          className={cn(
            "w-12 shrink-0 overflow-hidden py-2 text-right select-none",
            isEditMode ? "border-r border-black/10 bg-black/[0.02]" : "border-r border-slate-500/35 bg-slate-900"
          )}
          ref={lineNumbersRef}
          aria-hidden="true"
        >
          {lineNumbers.map(n => (
            <div
              key={n}
              className={cn(
                "px-2 text-[11px] leading-6",
                isEditMode ? "text-black/35" : "text-slate-400"
              )}
            >
              {n}
            </div>
          ))}
        </div>
        {isEditMode ? (
          <textarea
            ref={textareaRef}
            className="h-full min-h-0 flex-1 resize-none overflow-auto bg-transparent px-3 py-2 text-[13px] leading-6 text-foreground outline-none [tab-size:2]"
            value={localCode}
            onChange={(e) => handleChange(e.target.value)}
            onScroll={syncEditorScroll}
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            wrap="off"
          />
        ) : (
          <div ref={codeBlockRef} className="min-h-0 flex-1 overflow-auto" onScroll={syncCodeBlockScroll}>
            <Highlight code={localCode} language="javascript" theme={themes.vsDark}>
              {({ style, tokens, getLineProps, getTokenProps }) => (
                <pre
                  className="m-0 min-h-full bg-transparent px-3 py-2 text-[13px] leading-6 [tab-size:2]"
                  style={{ ...style, background: "transparent" }}
                >
                  {tokens.map((line, lineIndex) => {
                    const lineProps = getLineProps({ line, key: lineIndex });
                    return (
                      <div key={lineIndex} {...lineProps}>
                        {line.length === 1 && line[0].empty ? <span> </span> : null}
                        {line.map((token, tokenIndex) => (
                          <span key={tokenIndex} {...getTokenProps({ token, key: tokenIndex })} />
                        ))}
                      </div>
                    );
                  })}
                </pre>
              )}
            </Highlight>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
