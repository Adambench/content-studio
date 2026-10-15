import { Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router';
import { editDuration, LOUDNESS_TARGET, newEditId, type EditAudio, type SfxCue } from '@shared/edit';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useStudio } from './context';
import { Field, MediaSelect, SecondsField, SliderField } from './controls';

const pct = (v: number) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`);

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function SoundPanel() {
  const { edit, spec, update, time, selection, select, assets } = useStudio();
  const a = spec.audio;
  const set = (patch: Partial<EditAudio>) => update((s) => ({ ...s, audio: { ...s.audio, ...patch } }));
  const setCue = (id: string, patch: Partial<SfxCue>) => set({ sfx: a.sfx.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const music = assets.filter((m) => m.assetType === 'music');
  const sfx = assets.filter((m) => m.assetType === 'sfx');
  const duration = editDuration(spec);
  const wsAssets = `/w/${edit.workspaceId}/assets`;

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className="text-sm font-medium">Voice</h3>
        <SliderField label="Clip sound" value={a.voiceVolume} min={0} max={2} step={0.05} format={pct} onChange={(voiceVolume) => set({ voiceVolume })} />
        <Toggle id="enhance" label="Clean up voice" hint="Cuts rumble, evens out levels, adds presence" checked={a.enhanceVoice} onChange={(enhanceVoice) => set({ enhanceVoice })} />
      </section>

      <section className="space-y-4 border-t pt-4">
        <h3 className="text-sm font-medium">Music</h3>
        <Field label="Track" hint={music.length ? undefined : 'No music yet'}>
          <MediaSelect value={a.musicMediaId} onChange={(musicMediaId) => set({ musicMediaId })} options={music} noneLabel="No music" />
        </Field>
        {!music.length && (
          <p className="text-xs text-muted-foreground">
            Import tracks you have the rights to in{' '}
            <Link to={wsAssets} className="underline underline-offset-2">
              Brand assets
            </Link>{' '}
            — platforms mute copyrighted music.
          </p>
        )}
        {a.musicMediaId && (
          <>
            <SliderField label="Music level" value={a.musicVolume} min={0} max={1} step={0.01} format={pct} onChange={(musicVolume) => set({ musicVolume })} />
            <Toggle id="duck" label="Duck under speech" hint="Music dips whenever someone talks" checked={a.duck} onChange={(duck) => set({ duck })} />
            <SecondsField label="Start the track at" value={a.musicStart} onChange={(musicStart) => set({ musicStart })} />
          </>
        )}
      </section>

      <section className="space-y-3 border-t pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Sound effects</h3>
          <Button
            size="sm"
            variant="outline"
            disabled={!sfx.length}
            onClick={() => {
              const cue = { id: newEditId(), mediaId: sfx[0].id, at: Math.round(Math.min(time, Math.max(0, duration - 0.1)) * 100) / 100, volume: 0.8 };
              set({ sfx: [...a.sfx, cue].sort((x, y) => x.at - y.at) });
              select({ kind: 'sfx', id: cue.id });
            }}
          >
            <Plus /> At playhead
          </Button>
        </div>
        {!sfx.length && (
          <p className="text-xs text-muted-foreground">
            Whooshes and pops live in{' '}
            <Link to={wsAssets} className="underline underline-offset-2">
              Brand assets → Sound effects
            </Link>
            .
          </p>
        )}
        {a.sfx.map((c) => (
          <div key={c.id} className={cn('space-y-3 rounded-lg border p-2.5', selection?.kind === 'sfx' && selection.id === c.id && 'border-brand/60')}>
            <div className="flex items-center gap-2">
              <MediaSelect value={c.mediaId} onChange={(id) => id && setCue(c.id, { mediaId: id })} options={sfx} noneLabel="—" />
              <Button size="icon-sm" variant="ghost" className="text-destructive hover:text-destructive" aria-label="Remove sound effect" onClick={() => set({ sfx: a.sfx.filter((x) => x.id !== c.id) })}>
                <Trash2 />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <SecondsField label="At" value={c.at} max={duration} onChange={(at) => setCue(c.id, { at })} onPlayhead={() => setCue(c.id, { at: Math.round(time * 100) / 100 })} />
              <SliderField label="Level" value={c.volume} min={0} max={2} step={0.05} format={pct} onChange={(volume) => setCue(c.id, { volume })} />
            </div>
          </div>
        ))}
      </section>

      <section className="border-t pt-4">
        <Toggle id="normalize" label="Platform loudness" hint={`Levels the final mix to ${LOUDNESS_TARGET} LUFS, what TikTok, Reels and Shorts play at`} checked={a.normalize} onChange={(normalize) => set({ normalize })} />
      </section>
    </div>
  );
}
