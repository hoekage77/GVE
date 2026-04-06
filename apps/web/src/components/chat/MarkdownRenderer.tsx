import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check } from 'lucide-react';
import { useState } from 'react';
import type { ComponentPropsWithoutRef } from 'react';

interface MarkdownRendererProps {
  content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="markdown-h1">{children}</h1>,
          h2: ({ children }) => <h2 className="markdown-h2">{children}</h2>,
          h3: ({ children }) => <h3 className="markdown-h3">{children}</h3>,
          h4: ({ children }) => <h4 className="markdown-h4">{children}</h4>,
          p: ({ children }) => <p className="markdown-p">{children}</p>,
          ul: ({ children }) => <ul className="markdown-ul">{children}</ul>,
          ol: ({ children }) => <ol className="markdown-ol">{children}</ol>,
          li: ({ children }) => <li className="markdown-li">{children}</li>,
          code: CodeBlock,
          a: ({ href, children }) => (
            <a href={href} className="markdown-link" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          blockquote: ({ children }) => <blockquote className="markdown-blockquote">{children}</blockquote>,
          table: ({ children }) => <table className="markdown-table">{children}</table>,
          thead: ({ children }) => <thead className="markdown-thead">{children}</thead>,
          tbody: ({ children }) => <tbody className="markdown-tbody">{children}</tbody>,
          tr: ({ children }) => <tr className="markdown-tr">{children}</tr>,
          th: ({ children }) => <th className="markdown-th">{children}</th>,
          td: ({ children }) => <td className="markdown-td">{children}</td>,
          hr: () => <hr className="markdown-hr" />,
          strong: ({ children }) => <strong className="markdown-strong">{children}</strong>,
          em: ({ children }) => <em className="markdown-em">{children}</em>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// Code block component with copy button
interface CodeBlockProps {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}

function CodeBlock({ inline, className, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const language = match?.[1] || 'text';
  const code = String(children).replace(/\n$/, '');

  if (inline || !className) {
    return <code className="markdown-inline-code">{children}</code>;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  };

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">{language}</span>
        <button
          type="button"
          className="markdown-code-copy"
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <SyntaxHighlighter
        style={vscDarkPlus}
        language={language}
        PreTag="div"
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
