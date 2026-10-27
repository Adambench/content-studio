import { Plus, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { editDuration, LOUDNESS_TARGET, NASHEED_DEFAULTS, newEditId, type EditAudio, type NasheedTrack, type SfxCue } from '@shared/edit';
import { builtinSfxId } from '@shared/sfx';
import { motionSounds } from '@shared/sound-design';
import { mediaFileUrl } from '@/lib/api';
import { sfxUrl } from '@/lib/sfx';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useStudio } from './context';
import { Field, ListenButton, MediaSelect, SecondsField, SfxSelect, SliderField } from './controls';

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
  const setNasheed = (patch: Partial<NasheedTrack>) => a.nasheed && set({ nasheed: { ...a.nasheed, ...patch } });
  const nasheeds = assets.filter((m) => m.assetType === 'nasheed');
  const sfx = assets.filter((m) => m.assetType === 'sfx' && m.kind === 'audio');
  const duration = editDuration(spec);
  const auto = useMemo(() => motionSounds({ ...spec, audio: { ...spec.audio, autoSfx: true } }).length, [spec]);
  const wsAssets = `/w/${edit.workspaceId}/assets`;

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className="text-sm font-medium">Voice</h3>
        <SliderField label="Clip sound" value={a.voiceVolume} min={0} max={2} step={0.05} format={pct} onChange={(voiceVolume) => set({ voiceVolume })} />
        <Toggle id="enhance" label="Clean up voice" hint="Cuts rumble, evens out levels, adds presence" checked={a.enhanceVoice} onChange={(enhanceVoice) => set({ enhanceVoice })} />
      </section>

      <section className="space-y-4 border-t pt-4">
        <div>
          <h3 className="text-sm font-medium">Nasheed</h3>
          <p className="text-xs text-muted-foreground">Vocal only, no instruments. Optional, and yours to add: Claude can’t put one on.</p>
        </div>
        <div className="flex items-end gap-1.5">
          <Field label="Track" hint={nasheeds.length ? undefined : 'None imported'} className="min-w-0 flex-1">
            <MediaSelect value={a.nasheed?.mediaId ?? null} onChange={(id) => set({ nasheed: id ? { ...NASHEED_DEFAULTS, ...a.nasheed, mediaId: id } : null })} options={nasheeds} noneLabel="No nasheed" />
          </Field>
          <ListenButton src={a.nasheed ? mediaFileUrl(a.nasheed.mediaId) : null} volume={a.nasheed?.volume} label="Listen to the nasheed" />
        </div>
        {!nasheeds.length && (
          <p className="text-xs text-muted-foreground">
            Import vocal-only nasheeds in{' '}
            <Link to={wsAssets} className="underline underline-offset-2">
              Brand assets → Nasheeds
            </Link>
            .
          </p>
        )}
        {a.nasheed && (
          <>
            <SliderField label="Nasheed level" value={a.nasheed.volume} min={0} max={1} step={0.01} format={pct} onChange={(volume) => setNasheed({ volume })} />
            <Toggle id="duck" label="Duck under speech" hint="It dips whenever someone talks" checked={a.nasheed.duck} onChange={(duck) => setNasheed({ duck })} />
            <SecondsField label="Start the nasheed at" value={a.nasheed.start} onChange={(start) => setNasheed({ start })} />
          </>
        )}
      </section>

      <section className="space-y-3 border-t pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Sound effects</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const last = a.sfx.at(-1)?.mediaId;
              const cue = { id: newEditId(), mediaId: last ?? builtinSfxId('whoosh-fast'), at: Math.round(Math.min(time, Math.max(0, duration - 0.1)) * 100) / 100, volume: 0.8 };
              set({ sfx: [...a.sfx, cue].sort((x, y) => x.at - y.at) });
              select({ kind: 'sfx', id: cue.id });
            }}
          >
            <Plus /> At playhead
          </Button>
        </div>
        <Toggle
          id="auto-sfx"
          label="Sound on every move"
          hint={auto ? `${auto} move${auto === 1 ? '' : 's'} get a pop, swish, hit or typing on their frame` : 'Pops, swishes and hits on the frame of each move, once something moves'}
          checked={a.autoSfx}
          onChange={(autoSfx) => set({ autoSfx })}
        />
        {!a.sfx.length && (
          <p className="text-xs text-muted-foreground">
            Whooshes, pops, hits, risers and dings: the app has its own, and yours from{' '}
            <Link to={wsAssets} className="underline underline-offset-2">
              Brand assets → Sound effects
            </Link>{' '}
            join them.
          </p>
        )}
        {a.sfx.map((c) => (
          <div key={c.id} className={cn('space-y-3 rounded-lg border p-2.5', selection?.kind === 'sfx' && selection.id === c.id && 'border-brand/60')}>
            <div className="flex items-center gap-1">
              <SfxSelect value={c.mediaId} onChange={(mediaId) => setCue(c.id, { mediaId })} brand={sfx} />
              <ListenButton src={sfxUrl(c.mediaId)} volume={c.volume} label="Listen to this sound" />
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
