import { ChevronDown, Clapperboard, Image as ImageIcon, Shapes, Sparkles, Trash2, Type } from 'lucide-react';
import { useEffect, useState } from 'react';
import { editDuration, GRAPHIC_INFO, GRAPHICS, newEditId, OVERLAY_ANIMATIONS, type EditOverlay, type GraphicOverlay, type GraphicTemplate, type OverlayAnimation } from '@shared/edit';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useStudio } from './context';
import { ChoiceSelect, Field, PanelEmpty, preciseClock, SecondsField, SliderField } from './controls';
import { MediaPicker } from './MediaPicker';

const ANIMATION_LABELS: Record<OverlayAnimation, string> = { pop: 'Pop in', fade: 'Fade in', slide: 'Slide up', none: 'None' };

/** What a row in the list says about an overlay. */
export function overlayName(o: EditOverlay, mediaName: (id: string) => string | undefined) {
  if (o.type === 'text') return o.text;
  if (o.type === 'graphic') return `${GRAPHIC_INFO[o.template].label}${o.text ? `: ${o.text.replace(/\*/g, '')}` : ''}`;
  return mediaName(o.mediaId) ?? 'Missing file';
}

const OVERLAY_ICONS = { text: Type, image: ImageIcon, broll: Clapperboard, graphic: Shapes } as const;

export function OverlaysPanel() {
  const { spec, update, time, seek, selection, select, media, footage, assets, piece } = useStudio();
  const [picking, setPicking] = useState<'image' | 'broll' | null>(null);
  const duration = editDuration(spec);
  const hook = piece?.branches.find((b) => b.id === piece.activeBranchId)?.working.hook.trim();
  const add = (o: EditOverlay) => {
    update((s) => ({ ...s, overlays: [...s.overlays, o].sort((a, b) => a.start - b.start) }));
    select({ kind: 'overlay', id: o.id });
  };
  const at = Math.min(time, Math.max(0, duration - 0.5));
  const span = (len: number) => ({ start: Math.round(at * 100) / 100, end: Math.round(Math.min(Math.max(at + len, at + 0.5), Math.max(duration, at + 0.5)) * 100) / 100 });
  const selected = selection?.kind === 'overlay' ? spec.overlays.find((o) => o.id === selection.id) : undefined;
  const images = [...assets.filter((m) => m.kind === 'image'), ...footage.filter((m) => m.kind === 'image')];
  const newGraphic = (template: GraphicTemplate): GraphicOverlay => {
    const info = GRAPHIC_INFO[template];
    // A progress bar runs the whole video; the rest start at the playhead.
    const when = template === 'progress' ? { start: 0, end: Math.max(duration, 0.5) } : span(info.seconds);
    return { id: newEditId(), type: 'graphic', template, text: info.example.text ?? '', sub: info.example.sub ?? '', items: info.example.items ?? [], x: 0.5, y: 0.45, position: info.position ?? 'center', sound: template !== 'progress', ...when };
  };
  const broll = footage.filter((m) => (m.kind === 'video' || m.kind === 'image') && m.source !== 'render');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => add({ id: newEditId(), type: 'text', text: 'Your text', style: 'title', position: 'top', animation: 'pop', ...span(2.5) })}>
          <Type /> Text
        </Button>
        {hook && (
          <Button size="sm" variant="outline" onClick={() => add({ id: newEditId(), type: 'text', text: hook, style: 'title', position: 'top', animation: 'pop', start: 0, end: Math.min(3, Math.max(duration, 0.5)) })}>
            <Sparkles className="text-brand" /> Hook as text
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setPicking('image')}>
          <ImageIcon /> Image
        </Button>
        <Button size="sm" variant="outline" onClick={() => setPicking('broll')}>
          <Clapperboard /> B-roll
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <Shapes /> Motion graphic <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            {GRAPHICS.map((g) => (
              <DropdownMenuItem key={g} onSelect={() => add(newGraphic(g))}>
                <div>
                  <p>{GRAPHIC_INFO[g].label}</p>
                  <p className="text-xs text-muted-foreground">{GRAPHIC_INFO[g].hint}</p>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {spec.overlays.length ? (
        <ol className="space-y-1">
          {spec.overlays.map((o) => {
            const Icon = OVERLAY_ICONS[o.type];
            return (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    select({ kind: 'overlay', id: o.id });
                    seek(o.start + 0.01);
                  }}
                  className={cn('flex w-full items-center gap-2.5 rounded-lg border bg-card px-2.5 py-2 text-left', selected?.id === o.id && 'border-brand/60 bg-brand-soft')}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{overlayName(o, (id) => media.get(id)?.originalName)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {preciseClock(o.start)}–{preciseClock(o.end)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <PanelEmpty>On-screen text, motion graphics, logos, stickers and cutaway footage go here. New ones start at the playhead.</PanelEmpty>
      )}

      {selected && <OverlayEditor key={selected.id} overlay={selected} />}

      <MediaPicker
        open={picking === 'image'}
        onOpenChange={(o) => !o && setPicking(null)}
        title="Add an image"
        description="A logo, sticker or photo on top of the video."
        first={assets.filter((m) => m.kind === 'image')}
        rest={images}
        onPick={([id]) => add({ id: newEditId(), type: 'image', mediaId: id, x: 0.5, y: 0.3, width: 0.4, animation: 'pop', ...span(2.5) })}
      />
      <MediaPicker
        open={picking === 'broll'}
        onOpenChange={(o) => !o && setPicking(null)}
        title="Add b-roll"
        description="Cutaway footage over the main track — the voice keeps playing."
        rest={broll}
        onPick={([id]) => add({ id: newEditId(), type: 'broll', mediaId: id, in: 0, layout: 'full', focusX: 0.5, focusY: 0.5, ...span(Math.min(3, (media.get(id)?.durationMs ?? 3000) / 1000)) })}
      />
    </div>
  );
}

function OverlayEditor({ overlay }: { overlay: EditOverlay }) {
  const { spec, update, time, select, media } = useStudio();
  const duration = editDuration(spec);
  const set = (patch: Partial<EditOverlay>) =>
    update((s) => ({ ...s, overlays: s.overlays.map((o) => (o.id === overlay.id ? ({ ...o, ...patch } as EditOverlay) : o)).sort((a, b) => a.start - b.start) }));
  const [text, setText] = useState(overlay.type === 'text' ? overlay.text : '');
  useEffect(() => setText(overlay.type === 'text' ? overlay.text : ''), [overlay]);

  return (
    <section className="space-y-4 rounded-lg border p-3" aria-label="Selected overlay">
      <div className="flex items-center gap-2">
        <h3 className="mr-auto text-sm font-medium">{overlay.type === 'text' ? 'Text' : overlay.type === 'image' ? 'Image' : overlay.type === 'broll' ? 'B-roll' : GRAPHIC_INFO[overlay.template].label}</h3>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          aria-label="Remove"
          onClick={() => {
            update((s) => ({ ...s, overlays: s.overlays.filter((o) => o.id !== overlay.id) }));
            select(null);
          }}
        >
          <Trash2 />
        </Button>
      </div>

      {overlay.type === 'text' && (
        <div className="space-y-1">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() && text !== overlay.text && set({ text: text.trim() })} rows={2} aria-label="Text" />
          <p className="text-xs text-muted-foreground">Put *stars* around a word to show it in the accent colour.</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <SecondsField label="From" value={overlay.start} max={overlay.end - 0.1} onChange={(start) => set({ start })} onPlayhead={() => set({ start: Math.min(time, overlay.end - 0.1) })} />
        <SecondsField label="Until" value={overlay.end} min={overlay.start + 0.1} max={Math.max(duration, overlay.start + 0.1)} onChange={(end) => set({ end })} onPlayhead={() => set({ end: Math.max(time, overlay.start + 0.1) })} />
      </div>

      {overlay.type === 'text' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Style">
            <ChoiceSelect label="Style" value={overlay.style} onChange={(style) => set({ style })} options={[{ value: 'title', label: 'Title' }, { value: 'label', label: 'Label' }, { value: 'note', label: 'Note' }]} />
          </Field>
          <Field label="Where">
            <ChoiceSelect label="Where" value={overlay.position} onChange={(position) => set({ position })} options={[{ value: 'top', label: 'Top' }, { value: 'center', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} />
          </Field>
        </div>
      )}

      {overlay.type === 'image' && (
        <>
          <p className="truncate text-xs text-muted-foreground">{media.get(overlay.mediaId)?.originalName}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <SliderField label="Across" value={overlay.x} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(x) => set({ x })} />
            <SliderField label="Down" value={overlay.y} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(y) => set({ y })} />
            <SliderField label="Size" value={overlay.width} min={0.05} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(width) => set({ width })} />
          </div>
        </>
      )}

      {overlay.type === 'broll' && (
        <>
          <p className="truncate text-xs text-muted-foreground">{media.get(overlay.mediaId)?.originalName}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Layout">
              <ChoiceSelect label="Layout" value={overlay.layout} onChange={(layout) => set({ layout })} options={[{ value: 'full', label: 'Full screen' }, { value: 'top', label: 'Top half' }, { value: 'pip', label: 'Picture in picture' }]} />
            </Field>
            {media.get(overlay.mediaId)?.kind === 'video' && <SecondsField label="Start in clip at" value={overlay.in} onChange={(v) => set({ in: v })} max={(media.get(overlay.mediaId)?.durationMs ?? 0) / 1000 || undefined} />}
          </div>
          <SliderField label="Subject across" value={overlay.focusX} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(focusX) => set({ focusX })} />
        </>
      )}

      {overlay.type === 'graphic' && <GraphicFields overlay={overlay} set={set} />}

      {(overlay.type === 'text' || overlay.type === 'image') && (
        <Field label="Animation">
          <ChoiceSelect label="Animation" value={overlay.animation} onChange={(animation) => set({ animation })} options={OVERLAY_ANIMATIONS.map((a) => ({ value: a, label: ANIMATION_LABELS[a] }))} />
        </Field>
      )}
    </section>
  );
}


/** A template's own words and settings; each template uses only some of them (GRAPHIC_INFO). */
function GraphicFields({ overlay, set }: { overlay: GraphicOverlay; set: (patch: Partial<GraphicOverlay>) => void }) {
  const info = GRAPHIC_INFO[overlay.template];
  const [text, setText] = useState(overlay.text);
  const [sub, setSub] = useState(overlay.sub);
  const [items, setItems] = useState(overlay.items.join('\n'));
  useEffect(() => {
    setText(overlay.text);
    setSub(overlay.sub);
    setItems(overlay.items.join('\n'));
  }, [overlay]);
  return (
    <>
      <p className="text-xs text-muted-foreground">{info.hint}. Put *stars* around a word for the accent colour.</p>
      {info.fields.sub && overlay.template === 'chapter' && (
        <Field label={info.fields.sub}>
          <Input value={sub} onChange={(e) => setSub(e.target.value)} onBlur={() => sub !== overlay.sub && set({ sub: sub.trim() })} className="h-8" />
        </Field>
      )}
      {info.fields.text && (
        <Field label={info.fields.text}>
          {overlay.template === 'quote' || overlay.template === 'kinetic' ? (
            <Textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== overlay.text && set({ text: text.trim() })} rows={2} />
          ) : (
            <Input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== overlay.text && set({ text: text.trim() })} className="h-8" />
          )}
        </Field>
      )}
      {info.fields.sub && overlay.template !== 'chapter' && (
        <Field label={info.fields.sub}>
          <Input value={sub} onChange={(e) => setSub(e.target.value)} onBlur={() => sub !== overlay.sub && set({ sub: sub.trim() })} className="h-8" />
        </Field>
      )}
      {info.fields.items && (
        <Field label={info.fields.items}>
          <Textarea
            value={items}
            onChange={(e) => setItems(e.target.value)}
            onBlur={() => set({ items: items.split('\n').map((i) => i.trim()).filter(Boolean).slice(0, 6) })}
            rows={4}
          />
        </Field>
      )}
      {info.fields.point && (
        <div className="grid gap-4 sm:grid-cols-2">
          <SliderField label="Points at, across" value={overlay.x} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(x) => set({ x })} />
          <SliderField label="Points at, down" value={overlay.y} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(y) => set({ y })} />
        </div>
      )}
      {info.position && (
        <Field label="Where">
          <ChoiceSelect
            label="Where"
            value={overlay.position}
            onChange={(position) => set({ position })}
            options={
              overlay.template === 'progress'
                ? [
                    { value: 'top', label: 'Top edge' },
                    { value: 'bottom', label: 'Bottom edge' },
                  ]
                : [
                    { value: 'top', label: 'Top' },
                    { value: 'center', label: 'Middle' },
                    { value: 'bottom', label: 'Bottom' },
                  ]
            }
          />
        </Field>
      )}
      {overlay.template !== 'progress' && (
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`gsound-${overlay.id}`} className="text-xs">
            Its sound effects <span className="font-normal text-muted-foreground">(pops, a swish — never music)</span>
          </Label>
          <Switch id={`gsound-${overlay.id}`} checked={overlay.sound} onCheckedChange={(sound) => set({ sound })} />
        </div>
      )}
    </>
  );
}
