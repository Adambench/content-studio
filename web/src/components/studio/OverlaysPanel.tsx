import { ChevronDown, Clapperboard, Image as ImageIcon, Shapes, Sparkles, Trash2, Type, WandSparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  EDIT_FORMATS,
  editDuration,
  GRAPHIC_INFO,
  GRAPHICS,
  newEditId,
  OVERLAY_ANIMATIONS,
  type EditOverlay,
  type GraphicOverlay,
  type GraphicTemplate,
  type OverlayAnimation,
  type SceneOverlay,
} from '@shared/edit';
import { BROLL_LAYOUT_INFO, BROLL_LAYOUTS, OVERLAY_ANIMATION_INFO } from '@shared/looks';
import { libraryScene, SCENE_LIBRARY, SCENE_PRESETS, sceneSeconds, type ScenePreset, type SceneFill } from '@shared/scene-library';
import type { QuranPassage } from '@shared/quran';
import { api, errorMessage } from '@/lib/api';
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

const ANIMATION_LABELS = Object.fromEntries(OVERLAY_ANIMATIONS.map((a) => [a, OVERLAY_ANIMATION_INFO[a].label])) as Record<OverlayAnimation, string>;

/** What a row in the list says about an overlay. */
export function overlayName(o: EditOverlay, mediaName: (id: string) => string | undefined) {
  if (o.type === 'text') return o.text;
  if (o.type === 'graphic') return `${GRAPHIC_INFO[o.template].label}${o.text ? `: ${o.text.replace(/\*/g, '')}` : ''}`;
  if (o.type === 'scene') return `Scene: ${o.name}`;
  return mediaName(o.mediaId) ?? 'Missing file';
}

export const OVERLAY_ICONS = { text: Type, image: ImageIcon, broll: Clapperboard, graphic: Shapes, scene: WandSparkles } as const;

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
  const newScene = (preset: ScenePreset): SceneOverlay => {
    const ex = SCENE_LIBRARY[preset].example;
    const fill: SceneFill = { text: ex.text ?? '', sub: ex.sub ?? '', items: ex.items ?? [] };
    const { problems: _, ...scene } = libraryScene(preset, fill, { W: EDIT_FORMATS[spec.format].width, H: EDIT_FORMATS[spec.format].height, color: spec.captions.highlight });
    return { id: newEditId(), type: 'scene', ...scene, ...span(sceneSeconds(preset, fill)) };
  };

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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <WandSparkles /> Scene <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-96 w-72 overflow-y-auto">
            {SCENE_PRESETS.map((p) => (
              <DropdownMenuItem key={p} onSelect={() => add(newScene(p))}>
                <div>
                  <p>{SCENE_LIBRARY[p].label}</p>
                  <p className="text-xs text-muted-foreground">{SCENE_LIBRARY[p].hint}</p>
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
        <h3 className="mr-auto truncate text-sm font-medium">
          {overlay.type === 'text' ? 'Text' : overlay.type === 'image' ? 'Image' : overlay.type === 'broll' ? 'B-roll' : overlay.type === 'graphic' ? GRAPHIC_INFO[overlay.template].label : overlay.name}
        </h3>
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
              <ChoiceSelect label="Layout" value={overlay.layout} onChange={(layout) => set({ layout })} options={BROLL_LAYOUTS.map((l) => ({ value: l, label: BROLL_LAYOUT_INFO[l].label }))} />
            </Field>
            {media.get(overlay.mediaId)?.kind === 'video' && <SecondsField label="Start in clip at" value={overlay.in} onChange={(v) => set({ in: v })} max={(media.get(overlay.mediaId)?.durationMs ?? 0) / 1000 || undefined} />}
          </div>
          <SliderField label="Subject across" value={overlay.focusX} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(focusX) => set({ focusX })} />
        </>
      )}

      {overlay.type === 'graphic' && <GraphicFields overlay={overlay} set={set} />}
      {overlay.type === 'scene' && <SceneFields overlay={overlay} set={set} />}

      {(overlay.type === 'text' || overlay.type === 'image') && (
        <Field label="Animation">
          <ChoiceSelect label="Animation" value={overlay.animation} onChange={(animation) => set({ animation })} options={OVERLAY_ANIMATIONS.map((a) => ({ value: a, label: ANIMATION_LABELS[a] }))} />
        </Field>
      )}
    </section>
  );
}


/** Templates whose main words are a sentence or more, edited in a text box rather than a one-line field. */
const LONG_TEXT = new Set<GraphicTemplate>(['quote', 'kinetic', 'comment', 'question', 'highlight', 'reveal', 'versus']);

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
          {LONG_TEXT.has(overlay.template) ? (
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

/** A scene Claude designed: its words can be fixed here; the design is Claude's to change (ask in the panel). */
function SceneFields({ overlay, set }: { overlay: SceneOverlay; set: (patch: Partial<SceneOverlay>) => void }) {
  if (overlay.preset && overlay.fill && overlay.preset in SCENE_LIBRARY) return <LibrarySceneFields overlay={overlay} preset={overlay.preset as ScenePreset} fill={overlay.fill} set={set} />;
  const texts = overlay.elements.filter((e) => e.kind === 'text');
  return (
    <>
      <p className="text-xs text-muted-foreground">
        A motion graphic Claude designed ({overlay.elements.length} parts, {overlay.tweens.length} moves). Fix its words here; ask Claude to change the design or the motion.
      </p>
      {texts.map((e) => (
        <SceneText
          key={e.id}
          label={e.id}
          value={e.text ?? ''}
          onChange={(text) => set({ elements: overlay.elements.map((x) => (x.id === e.id ? { ...x, text } : x)) })}
        />
      ))}
    </>
  );
}

/** A library scene: its words and what's behind it; it's built again from them (and its length) as they change. */
function LibrarySceneFields({ overlay, preset, fill, set }: { overlay: SceneOverlay; preset: ScenePreset; fill: SceneFill; set: (patch: Partial<SceneOverlay>) => void }) {
  const info = SCENE_LIBRARY[preset];
  const [text, setText] = useState(fill.text);
  const [sub, setSub] = useState(fill.sub);
  const [items, setItems] = useState(fill.items.join('\n'));
  useEffect(() => {
    setText(fill.text);
    setSub(fill.sub);
    setItems(fill.items.join('\n'));
  }, [fill]);
  const [arabic, setArabic] = useState(fill.arabic ?? '');
  useEffect(() => setArabic(fill.arabic ?? ''), [fill]);
  const save = (patch: Partial<SceneFill>) => set({ fill: { ...fill, ...patch } });
  // An ayah is filled in from the Quran text by its reference, never typed.
  const ayah = preset === 'ayah';
  async function lookUp(ref: string) {
    try {
      const p = await api<QuranPassage>(`/quran?ref=${encodeURIComponent(ref)}`);
      save({ sub: p.citation, text: p.meaning, arabic: p.arabic });
    } catch (err) {
      toast.error(errorMessage(err));
      setSub(fill.sub);
    }
  }
  const wants = sceneSeconds(preset, fill);
  const len = overlay.end - overlay.start;
  const solid = overlay.background !== 'none' && overlay.background !== 'dim';
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {info.hint}. Put *stars* around a word for the accent colour. It's redrawn from these words; ask Claude to redesign it.
        {len < wants - 0.05 && ` Shorter than its ${wants} s, so it plays faster.`}
      </p>
      {ayah && info.fields.sub && (
        <Field label={info.fields.sub}>
          <Input value={sub} onChange={(e) => setSub(e.target.value)} onBlur={() => sub !== fill.sub && void lookUp(sub)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className="h-8" />
        </Field>
      )}
      {ayah && (
        <div className="space-y-2 rounded-lg border bg-card/50 p-2.5">
          <p dir="rtl" lang="ar" className="text-right text-lg leading-loose" style={{ fontFamily: "'Noto Naskh Arabic', serif" }}>
            {fill.arabic}
          </p>
          <p className="text-xs italic text-muted-foreground">{fill.text}</p>
          <p className="text-[11px] text-muted-foreground">From the Quran text (Tanzil) and the Saheeh International translation. Check it before posting.</p>
        </div>
      )}
      {!ayah && info.fields.text && (
        <Field label={info.fields.text}>
          <Input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== fill.text && save({ text: text.trim() })} className="h-8" />
        </Field>
      )}
      {!ayah && info.fields.sub && (
        <Field label={info.fields.sub}>
          <Input value={sub} onChange={(e) => setSub(e.target.value)} onBlur={() => sub !== fill.sub && save({ sub: sub.trim() })} className="h-8" />
        </Field>
      )}
      {!ayah && info.fields.arabic && (
        <Field label={info.fields.arabic}>
          <Textarea dir="rtl" lang="ar" value={arabic} onChange={(e) => setArabic(e.target.value)} onBlur={() => arabic !== (fill.arabic ?? '') && save({ arabic: arabic.trim() })} rows={3} />
        </Field>
      )}
      {info.fields.items && (
        <Field label={info.fields.items}>
          <Textarea value={items} onChange={(e) => setItems(e.target.value)} onBlur={() => save({ items: items.split('\n').map((i) => i.trim()).filter(Boolean).slice(0, 8) })} rows={4} />
        </Field>
      )}
      <Field label="Behind it">
        <ChoiceSelect
          label="Behind it"
          value={solid ? 'solid' : overlay.background}
          onChange={(v) => set({ background: v === 'solid' ? (info.solid ?? '#0b0c10') : v })}
          options={[
            { value: 'none', label: 'The video' },
            { value: 'dim', label: 'The video, darkened' },
            { value: 'solid', label: info.solid ? 'Plain colour' : 'Plain dark' },
          ]}
        />
      </Field>
    </>
  );
}

function SceneText({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Field label={label}>
      <Input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && onChange(text)} className="h-8" />
    </Field>
  );
}
