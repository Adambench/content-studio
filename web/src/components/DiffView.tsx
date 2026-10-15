import { diffWords } from 'diff';
import { DRAFT_FIELDS, type DraftContent } from '@shared/types';

/** A word diff of two texts: additions green, removals struck through. */
export function TextDiff({ before, after }: { before: string; after: string }) {
  return (
    <p className="rounded-md border bg-card p-2.5 text-sm leading-relaxed whitespace-pre-wrap">
      {diffWords(before, after).map((part, i) =>
        part.added ? (
          <ins key={i} className="rounded-sm bg-emerald-500/20 text-emerald-200 no-underline">
            {part.value}
          </ins>
        ) : part.removed ? (
          <del key={i} className="rounded-sm bg-red-500/15 text-red-300/80">
            {part.value}
          </del>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </p>
  );
}

/** Field-by-field word diff between two drafts. */
export function DiffView({ before, after }: { before: DraftContent; after: DraftContent }) {
  const changed = DRAFT_FIELDS.filter((f) => f.get(before) !== f.get(after));
  if (!changed.length) return <p className="text-sm text-muted-foreground">No differences.</p>;
  return (
    <div className="space-y-4">
      {changed.map((f) => (
        <div key={f.key} className="space-y-1">
          <h4 className="text-xs font-medium text-muted-foreground">{f.label}</h4>
          <TextDiff before={f.get(before)} after={f.get(after)} />
        </div>
      ))}
    </div>
  );
}
