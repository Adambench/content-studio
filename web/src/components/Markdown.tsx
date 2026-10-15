import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

/** Compact markdown for chat replies and notes. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('space-y-2 text-sm leading-relaxed break-words', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h3 className="mt-3 font-semibold" {...p} />,
          h2: (p) => <h3 className="mt-3 font-semibold" {...p} />,
          h3: (p) => <h4 className="mt-2 font-medium" {...p} />,
          ul: (p) => <ul className="list-disc space-y-1 pl-5" {...p} />,
          ol: (p) => <ol className="list-decimal space-y-1 pl-5" {...p} />,
          a: ({ href, ...p }) => <a href={href} target="_blank" rel="noreferrer" className="text-brand underline underline-offset-2" {...p} />,
          code: ({ className: c, ...p }) => <code className={cn('rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]', c)} {...p} />,
          pre: (p) => <pre className="overflow-x-auto rounded-md bg-muted p-3 [&_code]:bg-transparent [&_code]:p-0" {...p} />,
          blockquote: (p) => <blockquote className="border-l-2 pl-3 text-muted-foreground" {...p} />,
          table: (p) => (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs [&_td]:border-t [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1" {...p} />
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
