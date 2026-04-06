import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Highlight, themes } from "prism-react-renderer";

interface MarkdownMessageProps {
  content: string;
  className?: string;
}

// Custom code block component with syntax highlighting
const CodeBlock = ({ language, value }: { language: string; value: string }) => {
  const lang = language || "javascript";
  
  return (
    <Highlight
      theme={themes.nightOwl}
      code={value}
      language={lang as any}
    >
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre className={className} style={{ ...style, margin: 0, padding: "0.75rem", borderRadius: "0.5rem", fontSize: "0.82rem", overflowX: "auto" }}>
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })}>
              {line.map((token, key) => (
                <span key={key} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
};

export function MarkdownMessage({ content, className = "" }: MarkdownMessageProps) {
  const components = useMemo(() => ({
    code({ node, inline, className: codeClassName, children, ...props }: any) {
      const match = /language-(\w+)/.exec(codeClassName || "");
      const value = String(children).replace(/\n$/, "");
      
      if (!inline && match) {
        return <CodeBlock language={match[1]} value={value} />;
      }
      
      return (
        <code 
          className={codeClassName} 
          style={{
            fontFamily: '"SF Mono", Monaco, "Cascadia Code", monospace',
            fontSize: "0.85em",
            padding: "0.15rem 0.4rem",
            background: "rgba(30, 41, 59, 0.08)",
            borderRadius: "0.3rem",
            color: "#db2777"
          }}
          {...props}
        >
          {children}
        </code>
      );
    },
    // Custom link renderer to open in new tab
    a({ children, href, ...props }: any) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      );
    },
    // Custom heading styles
    h1({ children, ...props }: any) {
      return <h1 style={{ margin: "0.8rem 0 0.4rem 0", color: "#0f172a", fontWeight: 600, fontSize: "1.15rem" }} {...props}>{children}</h1>;
    },
    h2({ children, ...props }: any) {
      return <h2 style={{ margin: "0.8rem 0 0.4rem 0", color: "#0f172a", fontWeight: 600, fontSize: "1.05rem" }} {...props}>{children}</h2>;
    },
    h3({ children, ...props }: any) {
      return <h3 style={{ margin: "0.6rem 0 0.3rem 0", color: "#0f172a", fontWeight: 600, fontSize: "0.95rem" }} {...props}>{children}</h3>;
    },
    // Custom paragraph
    p({ children, ...props }: any) {
      return <p style={{ margin: "0 0 0.5rem 0", lineHeight: 1.5 }} {...props}>{children}</p>;
    },
    // Custom list
    ul({ children, ...props }: any) {
      return <ul style={{ margin: "0.5rem 0", paddingLeft: "1.2rem" }} {...props}>{children}</ul>;
    },
    ol({ children, ...props }: any) {
      return <ol style={{ margin: "0.5rem 0", paddingLeft: "1.2rem" }} {...props}>{children}</ol>;
    },
    li({ children, ...props }: any) {
      return <li style={{ margin: "0.25rem 0" }} {...props}>{children}</li>;
    },
    // Custom blockquote
    blockquote({ children, ...props }: any) {
      return (
        <blockquote 
          style={{ 
            margin: "0.75rem 0", 
            padding: "0.5rem 0.75rem", 
            borderLeft: "3px solid #3b82f6",
            background: "rgba(59, 130, 246, 0.08)",
            borderRadius: "0 0.5rem 0.5rem 0"
          }} 
          {...props}
        >
          {children}
        </blockquote>
      );
    },
    // Custom table
    table({ children, ...props }: any) {
      return (
        <table 
          style={{ 
            width: "100%", 
            margin: "0.75rem 0", 
            borderCollapse: "collapse",
            fontSize: "0.85rem"
          }} 
          {...props}
        >
          {children}
        </table>
      );
    },
    th({ children, ...props }: any) {
      return (
        <th 
          style={{ 
            padding: "0.4rem 0.6rem", 
            border: "1px solid rgba(148, 163, 184, 0.3)",
            textAlign: "left",
            background: "rgba(30, 41, 59, 0.05)",
            fontWeight: 600
          }} 
          {...props}
        >
          {children}
        </th>
      );
    },
    td({ children, ...props }: any) {
      return (
        <td 
          style={{ 
            padding: "0.4rem 0.6rem", 
            border: "1px solid rgba(148, 163, 184, 0.3)",
            textAlign: "left"
          }} 
          {...props}
        >
          {children}
        </td>
      );
    },
    // Custom hr
    hr({ ...props }: any) {
      return <hr style={{ margin: "0.75rem 0", border: "none", height: "1px", background: "rgba(148, 163, 184, 0.3)" }} {...props} />;
    },
    // Custom strong
    strong({ children, ...props }: any) {
      return <strong style={{ fontWeight: 700, color: "#0f172a" }} {...props}>{children}</strong>;
    },
    // Custom em
    em({ children, ...props }: any) {
      return <em style={{ fontStyle: "italic" }} {...props}>{children}</em>;
    }
  }), []);

  return (
    <div className={`markdown-message ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
