import { AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { CAPTION_PRESET_DEFAULTS, CAPTION_PRESET_LABELS, CAPTION_PRESETS, timelineWords, type CaptionPreset, type CaptionSettings, type EditClip } from '@shared/edit';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useStudio } from './context';
import { ColorField, Field, MediaSelect, SliderField } from './controls';

const PRESET_LOOK: Record<CaptionPreset, string> = {
  bold: 'font-black uppercase tracking-tight [-webkit-text-stroke:1px_black]',
  karaoke: 'font-extrabold uppercase',
  clean: 'font-semibold rounded bg-black/70 px-1.5',
  subtitle: 'font-medium text-xs',
};

export function CaptionsPanel() {
  const { edit, spec, update, assets } = useStudio();
  const c = spec.captions;
  const set = (patch: Partial<CaptionSettings>) => update((s) => ({ ...s, captions: { ...s.captions, ...patch } }));
  const fonts = assets.filter((m) => m.assetType === 'font');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor="captions-on">Captions</Label>
          <p className="text-xs text-muted-foreground">Made from what’s said in your clips, word by word.</p>
        </div>
        <Switch id="captions-on" checked={c.enabled} onCheckedChange={(enabled) => set({ enabled })} />
      </div>

      {c.enabled && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {CAPTION_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => set({ preset: p, ...(p !== c.preset ? CAPTION_PRESET_DEFAULTS[p] : {}) })}
                className={cn('rounded-lg border p-2.5 text-left transition-colors hover:bg-accent/60', c.preset === p && 'border-brand/60 bg-brand-soft')}
              >
                <span className={cn('text-sm', PRESET_LOOK[p])} style={{ color: p === 'bold' || p === 'karaoke' ? c.highlight : undefined }}>
                  {CAPTION_PRESET_LABELS[p].label}
                </span>
                <p className="mt-1 text-xs text-muted-foreground">{CAPTION_PRESET_LABELS[p].hint}</p>
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SliderField label="Position" value={c.position} min={0.05} max={0.95} format={(v) => (v < 0.35 ? 'Top' : v > 0.75 ? 'Bottom' : 'Middle')} onChange={(position) => set({ position })} />
            <SliderField label="Size" value={c.size} min={0.6} max={1.6} format={(v) => `${Math.round(v * 100)}%`} onChange={(size) => set({ size })} />
            <SliderField label="Words at once" value={c.maxWords} min={1} max={8} step={1} format={(v) => String(v)} onChange={(maxWords) => set({ maxWords })} />
            <div className="flex items-center justify-between gap-3 self-end pb-1">
              <Label htmlFor="captions-caps" className="text-xs">
                Capitals
              </Label>
              <Switch id="captions-caps" checked={c.uppercase} onCheckedChange={(uppercase) => set({ uppercase })} />
            </div>
            <ColorField label="Text" value={c.color} onChange={(color) => set({ color })} />
            <ColorField label="Accent" value={c.highlight} onChange={(highlight) => set({ highlight })} />
          </div>

          <Field label="Font" hint={fonts.length ? undefined : 'Import fonts in Brand assets'}>
            <MediaSelect value={c.fontMediaId} onChange={(fontMediaId) => set({ fontMediaId })} options={fonts} noneLabel="The style’s font" />
          </Field>
        </>
      )}

      <Words key={edit.id} />
    </div>
  );
}

/** Transcript status per clip, and a place to fix what Whisper misheard. */
function Words() {
  const { spec, edit, media } = useStudio();
  const words = timelineWords(spec, edit.transcripts);
  const videos = spec.clips.filter((c) => media.get(c.mediaId)?.kind === 'video');
  const missing = [...new Set(videos.map((c) => c.mediaId))].filter((id) => !edit.transcripts[id]);
  if (!videos.length) return null;

  return (
    <section className="space-y-3 border-t pt-4" aria-label="Caption words">
      <div>
        <h3 className="text-sm font-medium">Words</h3>
        <p className="text-xs text-muted-foreground">Fix anything misheard — it updates the transcript, so search gets it too.</p>
      </div>
      {missing.map((id) => (
        <MissingTranscript key={id} mediaId={id} />
      ))}
      {spec.clips.map(
        (c, i) => edit.transcripts[c.mediaId] && <ClipWords key={c.id} clip={c} index={i} text={words.filter((w) => w.clipId === c.id).map((w) => w.text).join(' ')} />,
      )}
    </section>
  );
}

function ClipWords({ clip, index, text }: { clip: EditClip; index: number; text: string }) {
  const { media } = useStudio();
  const [value, setValue] = useState(text);
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(text), [text]);
  if (!text) return null;

  async function save() {
    if (value.trim() === text.trim() || !value.trim()) return setValue(text);
    setSaving(true);
    try {
      await api(`/media/${clip.mediaId}/transcript/range`, { method: 'PUT', body: { start: clip.in, end: clip.out, text: value.trim() } });
      toast.success('Words updated');
    } catch (err) {
      toast.error(errorMessage(err));
      setValue(text);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Field label={`Clip ${index + 1}`} hint={saving ? 'Saving…' : media.get(clip.mediaId)?.originalName}>
      <Textarea value={value} onChange={(e) => setValue(e.target.value)} onBlur={save} rows={2} className="text-sm" />
    </Field>
  );
}

function MissingTranscript({ mediaId }: { mediaId: string }) {
  const { media } = useStudio();
  const m = media.get(mediaId);
  const [busy, setBusy] = useState(false);
  if (!m) return null;
  const status = m.transcriptStatus;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-400" />
      <div className="min-w-0 flex-1">
        <p className="truncate">{m.originalName}</p>
        <p className="text-xs text-muted-foreground">
          {status === 'queued' || status === 'running'
            ? 'Transcribing — captions appear when it’s done.'
            : status === 'unavailable'
              ? 'Speech-to-text isn’t installed, so this clip has no captions.'
              : status === 'error'
                ? 'Transcription failed.'
                : 'Not transcribed, so no captions.'}
        </p>
      </div>
      {status === 'unavailable' ? (
        <Button size="sm" variant="outline" asChild>
          <Link to="/settings">Install</Link>
        </Button>
      ) : status === 'queued' || status === 'running' ? (
        <Spinner className="mt-0.5 size-4" />
      ) : (
        m.kind === 'video' && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await api(`/media/${mediaId}/transcribe`, { body: {} }).catch((err) => toast.error(errorMessage(err)));
              setBusy(false);
            }}
          >
            Transcribe
          </Button>
        )
      )}
    </div>
  );
}
