import { Check, Globe, X } from 'lucide-react';
import type { ChatPart } from '@shared/types';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { Markdown } from './Markdown';

function ToolChip({ part }: { part: Extract<ChatPart, { type: 'tool' }> }) {
  const web = part.name === 'WebSearch' || part.name === 'WebFetch';
  return (
    <div className={cn('flex max-w-full items-center gap-1.5 text-xs text-muted-foreground', part.status === 'error' && 'text-destructive/90')} title={part.detail}>
      {part.status === 'running' ? (
        <Spinner className="size-3" />
      ) : part.status === 'error' ? (
        <X className="size-3" />
      ) : web ? (
        <Globe className="size-3" />
      ) : (
        <Check className="size-3 text-emerald-400" />
      )}
      <span className="truncate">{part.label}</span>
    </div>
  );
}

export function AssistantParts({ parts, streaming }: { parts: ChatPart[]; streaming?: boolean }) {
  const last = parts[parts.length - 1];
  return (
    <div className="space-y-2">
      {parts.map((p, i) =>
        p.type === 'text' ? (
          p.text.trim() && <Markdown key={i}>{p.text}</Markdown>
        ) : (
          <ToolChip key={p.id} part={p} />
        ),
      )}
      {streaming && (!last || last.type === 'tool') && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3" /> Thinking…
        </div>
      )}
    </div>
  );
}
