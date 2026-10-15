import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '@/lib/utils';

export function TagInput({ value, onChange, suggestions = [], className }: { value: string[]; onChange: (tags: string[]) => void; suggestions?: string[]; className?: string }) {
  const [text, setText] = useState('');
  const listId = useId();
  const add = (raw: string) => {
    const tag = raw.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-');
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setText('');
  };
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {value.map((t) => (
        <span key={t} className="inline-flex h-6 items-center gap-0.5 rounded-md bg-muted pr-0.5 pl-2 text-xs">
          #{t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label={`Remove ${t}`}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={text}
        list={listId}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => text && add(text)}
        placeholder={value.length ? '' : 'Add tags'}
        className="h-6 w-24 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        aria-label="Add tag"
      />
      <datalist id={listId}>
        {suggestions.filter((s) => !value.includes(s)).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}
