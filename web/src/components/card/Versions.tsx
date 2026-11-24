import { ago } from '@/lib/format';
import type { CardDetail, Render } from '@shared/types';

export function Versions({ detail, current, onPick }: { detail: CardDetail; current: Render | null; onPick: (renderId: string) => void }) {
  if (detail.versions.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Versions</h3>
      <div className="flex flex-col">
        {detail.versions.map((v) => {
          const renders = detail.renders.filter((r) => r.versionId === v.id);
          const r = renders.find((x) => x.status === 'done') ?? renders[0];
          const active = !!current && current.versionId === v.id;
          return (
            <button
              key={v.id}
              disabled={!r}
              onClick={() => r && onPick(r.id)}
              className={`flex items-baseline gap-2 rounded-lg p-2 text-left text-sm ${active ? 'bg-secondary' : 'hover:bg-accent/50'} disabled:cursor-default`}
            >
              <span className="shrink-0 tabular-nums">v{v.n}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{v.note || (v.author === 'claude' ? 'Claude' : 'Me')}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{r ? (r.status === 'done' ? ago(v.createdAt) : r.status) : 'not rendered'}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
