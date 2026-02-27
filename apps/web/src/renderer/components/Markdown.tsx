import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders markdown content with GFM support (tables, strikethrough, task lists, autolinks).
 * Styled for the dark terminal-like UI used in AgentExecutionView and ResponseView.
 */
export function Markdown({ children }: { children: string }): React.JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Headings
        h1: ({ children }) => <h1 className="text-base font-bold mt-3 mb-1">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-bold mt-2.5 mb-1">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-0.5">{children}</h3>,
        h4: ({ children }) => <h4 className="text-xs font-semibold mt-1.5 mb-0.5">{children}</h4>,

        // Paragraphs — tight spacing
        p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,

        // Lists
        ul: ({ children }) => <ul className="list-disc pl-4 mb-1.5 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-1.5 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,

        // Inline code
        code: ({ className, children, ...props }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <code
                className="block bg-zinc-900 border border-zinc-800 rounded px-3 py-2 my-1.5 text-[11px] font-mono text-zinc-300 whitespace-pre-wrap break-words overflow-auto max-h-64"
                {...props}
              >
                {children}
              </code>
            );
          }
          return (
            <code className="bg-zinc-800 text-amber-300 rounded px-1 py-0.5 text-[11px] font-mono" {...props}>
              {children}
            </code>
          );
        },

        // Code blocks (pre wraps code)
        pre: ({ children }) => <pre className="my-1.5">{children}</pre>,

        // Links
        a: ({ href, children }) => (
          <a href={href} className="text-blue-400 underline underline-offset-2 hover:text-blue-300" target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),

        // Bold / emphasis
        strong: ({ children }) => <strong className="font-semibold text-zinc-200">{children}</strong>,
        em: ({ children }) => <em className="italic text-zinc-300">{children}</em>,

        // Blockquote
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-zinc-600 pl-3 my-1.5 text-zinc-400 italic">{children}</blockquote>
        ),

        // Horizontal rule
        hr: () => <hr className="border-zinc-800 my-2" />,

        // Tables
        table: ({ children }) => (
          <div className="overflow-auto my-1.5">
            <table className="text-xs border-collapse">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-zinc-700 px-2 py-1 bg-zinc-900 text-left font-semibold text-zinc-300">{children}</th>
        ),
        td: ({ children }) => (
          <td className="border border-zinc-800 px-2 py-1 text-zinc-400">{children}</td>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
