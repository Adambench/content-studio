import { Check, RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { directionText, type Direction, type PieceDirections } from '@shared/direction';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient } from '@/lib/queries';
import type { PieceDetail } from '@/lib/types';
import { sendToVideoChat } from '@/lib/ui-state';
import { cn } from '@/lib/utils';

/** Personal and business pages: Claude pitches 2–3 directions for the video; the pick starts the script and edit in its chat. */
export function DirectionPanel({ piece }: { piece: PieceDetail }) {
  const state: PieceDirections | null | undefined = piece.directions;
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const pitching = state?.status === 'pitching';
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.piece(piece.id) });

  async function pitch(text: string) {
    setBusy(true);
    try {
      await api(`/pieces/${piece.id}/directions`, { method: 'POST', body: { request: text } });
      setRequest('');
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function choose(d: Direction) {
    try {
      await api(`/pieces/${piece.id}/directions/choose`, { method: 'POST', body: { optionId: d.id } });
      refresh();
      sendToVideoChat(
        piece.id,
        `I pick this direction. Write the script to it if there isn't one yet, then build the edit with it (use the moves it names, keep it to what the footage allows), and tell me in a line what you did.\n\n${directionText(d)}`,
      );
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <section className="space-y-3" aria-label="Direction">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Direction</h2>
        {!state && (
          <Button size="sm" variant="outline" onClick={() => pitch('')} disabled={busy}>
            {busy ? <Spinner /> : <Sparkles />} Pitch directions
          </Button>
        )}
      </div>
      {!state && <p className="text-sm text-muted-foreground">Claude pitches 2–3 ways this video could look and feel; you pick or mix, then the script and edit are built to it.</p>}
      {pitching && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Claude is thinking up directions…
        </p>
      )}
      {state?.status === 'failed' && <p className="text-sm text-destructive">Couldn’t pitch directions: {state.error || 'try again'}</p>}
      {state && !pitching && state.options.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {state.options.map((d) => {
            const picked = state.chosen?.id === d.id && state.chosen.name === d.name;
            return (
              <article key={d.id} className={cn('flex flex-col gap-2 rounded-xl border bg-card p-3 text-sm', picked && 'border-primary')}>
                <h3 className="font-medium">{d.name}</h3>
                <p>
                  <span className="text-muted-foreground">Hook · </span>
                  {d.hook}
                </p>
                {d.structure && <p className="whitespace-pre-line text-muted-foreground">{d.structure}</p>}
                {d.look && (
                  <p>
                    <span className="text-muted-foreground">Look · </span>
                    {d.look}
                  </p>
                )}
                {d.pacing && (
                  <p>
                    <span className="text-muted-foreground">Pace · </span>
                    {d.pacing}
                  </p>
                )}
                {d.moves.length > 0 && <p className="text-xs text-muted-foreground">{d.moves.map((m) => m.split(':')[1]).join(' · ')}</p>}
                <Button size="sm" variant={picked ? 'secondary' : 'default'} className="mt-auto" onClick={() => choose(d)}>
                  {picked ? <Check /> : null} {picked ? 'Picked: build it again' : 'Build it this way'}
                </Button>
              </article>
            );
          })}
        </div>
      )}
      {state && !pitching && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            pitch(request);
          }}
        >
          <Input value={request} onChange={(e) => setRequest(e.target.value)} placeholder="Mix them, or ask for something else (e.g. the first one, but faster)" aria-label="Change the directions" />
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            {busy ? <Spinner /> : <RefreshCw />} Pitch again
          </Button>
        </form>
      )}
    </section>
  );
}
