import { useState, useEffect } from "react";
import { Play, Copy, Check, RotateCcw, FileCode } from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
import { cn } from "../lib/utils";

interface CodeEditorProps {
  code: string | null;
  skill: string | null;
  readOnly?: boolean;
  onChange?: (code: string) => void;
  onRun?: (code: string) => void;
}

export default function CodeEditor({ code, skill, readOnly, onChange, onRun }: CodeEditorProps) {
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

  const handleChange = (value: string) => {
    setLocalCode(value);
    setIsDirty(value !== (code ?? ""));
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

  const lineCount = localCode.split("\n").length;

  return (
    <div className="code-editor">
      {/* Simple Header */}
      <div className="code-editor-toolbar">
        <div className="code-editor-info">
          <FileCode className="h-4 w-4" />
          <span>scene.{fileExtension}</span>
          <span className="code-editor-meta">{lineCount} lines</span>
          {isDirty && <span className="code-editor-dirty">Modified</span>}
        </div>
        
        <div className="code-editor-actions">
          <button
            type="button"
            className="code-editor-btn"
            onClick={handleCopy}
            title="Copy code"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
          
          {isDirty && (
            <button
              type="button"
              className="code-editor-btn"
              onClick={handleReset}
              title="Reset changes"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          
          <button
            type="button"
            className="code-editor-btn code-editor-btn--primary"
            onClick={handleRun}
            disabled={!localCode.trim()}
          >
            <Play className="h-4 w-4" />
            Run
          </button>
        </div>
      </div>

      {/* Code Display */}
      <div className="code-editor-body">
        <Highlight
          theme={themes.github}
          code={localCode}
          language={highlightLanguage}
        >
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre className={cn(className, "code-pre")} style={style}>
              <code>
                {tokens.map((line, i) => (
                  <div key={i} {...getLineProps({ line })} className="code-line">
                    <span className="code-line-number">{i + 1}</span>
                    <span className="code-line-content">
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
