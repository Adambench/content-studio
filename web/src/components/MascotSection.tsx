import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { MASCOT_INFO, MASCOTS, mascotPicture, POSE_INFO, type MascotId } from '@shared/mascots';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient } from '@/lib/queries';
import type { Workspace } from '@/lib/types';
import { cn } from '@/lib/utils';

const picture = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

/** The page's mascot: pick one of the drawn ones, see its poses. Scenes and Claude use it in videos. */
export function MascotSection({ workspace }: { workspace: Workspace }) {
  const [busy, setBusy] = useState(false);
  const current = workspace.mascot;
  const idle = useMemo(() => Object.fromEntries(MASCOTS.map((m) => [m, picture(mascotPicture(m))])) as Record<MascotId, string>, []);
  const poses = useMemo(() => (current ? MASCOT_INFO[current].poses.map((p) => ({ pose: p, src: picture(mascotPicture(current, p)) })) : []), [current]);

  async function choose(mascot: MascotId | null) {
    if (mascot === current || busy) return;
    setBusy(true);
    try {
      await api(`/workspaces/${workspace.id}`, { method: 'PATCH', body: { mascot } });
      await Promise.all([queryClient.invalidateQueries({ queryKey: keys.workspace(workspace.id) }), queryClient.invalidateQueries({ queryKey: keys.workspaces })]);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="assets-mascot">
      <div>
        <h2 id="assets-mascot" className="text-sm font-medium">
          Mascot
        </h2>
        <p className="text-xs text-muted-foreground">Drawn, not generated. Scenes move it from pose to pose; Claude puts it in this page’s videos.</p>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3">
        {MASCOTS.map((m) => (
          <button
            key={m}
            type="button"
            disabled={busy}
            aria-pressed={current === m}
            onClick={() => void choose(m)}
            className={cn('rounded-xl border p-2 text-left transition-colors hover:border-foreground/40', current === m && 'border-brand/60 bg-brand-soft hover:bg-brand-soft')}
          >
            <img src={idle[m]} alt="" className="aspect-[6/5] w-full rounded-lg bg-neutral-200 object-contain p-1" />
            <span className="mt-1.5 block text-xs leading-snug">{MASCOT_INFO[m].label}</span>
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          aria-pressed={!current}
          onClick={() => void choose(null)}
          className={cn('flex min-h-24 items-center justify-center rounded-xl border p-2 text-xs text-muted-foreground transition-colors hover:border-foreground/40', !current && 'border-brand/60 bg-brand-soft hover:bg-brand-soft')}
        >
          No mascot
        </button>
      </div>
      {current && (
        <div className="space-y-2 rounded-xl border bg-card/50 p-3">
          <p className="text-xs text-muted-foreground">{MASCOT_INFO[current].look}.</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-9">
            {poses.map(({ pose, src }) => (
              <figure key={pose} title={POSE_INFO[pose].hint}>
                <img src={src} alt={POSE_INFO[pose].label} className="aspect-[5/6] w-full rounded-lg bg-neutral-200 object-contain p-1" />
                <figcaption className="mt-1 text-center text-[11px] text-muted-foreground">{POSE_INFO[pose].label}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
