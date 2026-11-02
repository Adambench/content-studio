import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, Copy, GripVertical, Plus, ScanFace, Scissors, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  EDIT_FORMATS,
  TRANSITION_INFO,
  TRANSITION_MAX,
  TRANSITION_MIN,
  TRANSITIONS,
  clipAt,
  clipLength,
  clipStarts,
  editDuration,
  clipGeometry,
  newEditId,
  splitClipAt,
  type ClipTransition,
  type EditClip,
  type TransitionType,
} from '@shared/edit';
import { CLIP_MOTION_INFO, CLIP_MOTIONS, FILTER_LOOK_INFO, FILTER_LOOKS, type FilterLook } from '@shared/looks';
import { RECIPE_INFO, type RecipeKind } from '@shared/recipe';
import { builtinSfx, builtinSfxId } from '@shared/sfx';
import { useWorkspaceContext } from '@/components/WorkspaceLayout';
import { exampleRecipe } from './ScriptPanel';
import { MediaIcon } from '@/components/MediaCard';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { api, errorMessage, mediaThumbUrl } from '@/lib/api';
import type { Media } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useStudio } from './context';
import { ChoiceSelect, Field, PanelEmpty, preciseClock, SecondsField, SliderField } from './controls';
import { MediaPicker } from './MediaPicker';

export const clipFromMedia = (m: Media): EditClip => ({
  id: newEditId(),
  mediaId: m.id,
  in: 0,
  out: m.kind === 'image' ? 3 : Math.max(0.5, (m.durationMs ?? 3000) / 1000),
  focusX: 0.5,
  focusY: 0.5,
  zoom: 1,
  fit: 'fill',
  volume: 1,
  transition: null,
  motion: 'none',
  filter: null,
});

export function ClipsPanel() {
  const { edit, spec, update, serverAction, time, seek, selection, select, media, footage, showTab } = useStudio();
  const { workspace } = useWorkspaceContext();
  const [picking, setPicking] = useState(false);
  const [tightening, setTightening] = useState(false);
  const starts = clipStarts(spec);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const usable = footage.filter((m) => (m.kind === 'video' || m.kind === 'image') && m.source !== 'render');
  const ofPiece = usable.filter((m) => m.pieceId === edit.pieceId);

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    update((s) => {
      const from = s.clips.findIndex((c) => c.id === e.active.id);
      const to = s.clips.findIndex((c) => c.id === e.over!.id);
      return { ...s, clips: arrayMove(s.clips, from, to) };
    });
  }

  async function tighten(preset: 'natural' | 'tight') {
    setTightening(true);
    try {
      const r = await serverAction(() => api<{ removedSeconds: number; clips: number }>(`/edits/${edit.id}/tighten`, { body: { preset } }));
      if (r) toast.success(r.removedSeconds ? `Cut ${r.removedSeconds} s of pauses` : 'Nothing to cut', { description: `${r.clips} clips now — undo from History.` });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setTightening(false);
    }
  }

  const [reframing, setReframing] = useState(false);
  async function followSpeaker() {
    setReframing(true);
    try {
      await serverAction(() => api(`/edits/${edit.id}/reframe`, { body: {} }));
      toast('Finding the shots and who’s talking…', { description: 'A minute or so; it’s saved as a new version (undo from History).' });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setReframing(false);
    }
  }

  const hit = clipAt(spec, time);
  const canSplit = !!hit && time - hit.start > 0.1 && hit.start + clipLength(hit.clip) - time > 0.1;
  const selected = selection?.kind === 'clip' ? spec.clips.find((c) => c.id === selection.id) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">
          {spec.clips.length} clip{spec.clips.length === 1 ? '' : 's'} · {preciseClock(editDuration(spec))}
        </p>
        <Button size="sm" variant="ghost" disabled={!canSplit} onClick={() => update((s) => splitClipAt(s, time))}>
          <Scissors /> Split
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={!spec.clips.length || tightening}>
              {tightening ? <Spinner /> : <Wand2 />} Tighten <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Cuts pauses using the transcript (or silence, for untranscribed clips)</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => tighten('natural')}>
              <div>
                <p>Natural</p>
                <p className="text-xs text-muted-foreground">Keeps breathing room; cuts pauses over 0.7 s</p>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => tighten('tight')}>
              <div>
                <p>Tight</p>
                <p className="text-xs text-muted-foreground">Cuts every pause and “um”, punches in on jump cuts</p>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="sm"
          variant="outline"
          disabled={!spec.clips.some((c) => media.get(c.mediaId)?.kind === 'video') || reframing}
          onClick={followSpeaker}
          title="Split the footage into shots and keep whoever is talking in frame"
        >
          {reframing ? <Spinner /> : <ScanFace />} Follow the speaker
        </Button>
        <Button size="sm" onClick={() => setPicking(true)}>
          <Plus /> Footage
        </Button>
      </div>

      {spec.clips.length ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={spec.clips.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <ol className="space-y-1">
              {spec.clips.map((c, i) => (
                <ClipRow
                  key={c.id}
                  clip={c}
                  index={i}
                  media={media.get(c.mediaId)}
                  active={selected?.id === c.id}
                  onSelect={() => {
                    select({ kind: 'clip', id: c.id });
                    seek(starts[i] + 0.01);
                  }}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      ) : (
        <PanelEmpty>No clips yet. Add the footage you filmed — it plays back to back, and you can trim, reorder and tighten it.</PanelEmpty>
      )}

      {!spec.recipe && !spec.clips.length && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-medium">Or make it from words</p>
          <p className="text-xs text-muted-foreground">No filming: write it (or ask Claude), and voices made on this computer read it over background footage.</p>
          <div className="grid gap-2">
            {(Object.keys(RECIPE_INFO) as RecipeKind[]).map((kind) => (
              <Button
                key={kind}
                variant="outline"
                className="h-auto justify-start py-2 text-left whitespace-normal"
                onClick={() => {
                  update((s) => ({ ...s, recipe: exampleRecipe(kind, workspace.name) }));
                  showTab('script');
                }}
              >
                <div>
                  <p>{RECIPE_INFO[kind].label}</p>
                  <p className="text-xs font-normal text-muted-foreground">{RECIPE_INFO[kind].hint}</p>
                </div>
              </Button>
            ))}
          </div>
        </div>
      )}

      {selected && <ClipEditor key={selected.id} clip={selected} start={starts[spec.clips.indexOf(selected)]} />}

      <MediaPicker
        open={picking}
        onOpenChange={setPicking}
        title="Add footage"
        description="Added clips go to the end of the edit."
        first={ofPiece}
        rest={usable}
        multiple
        onPick={(ids) => update((s) => ({ ...s, clips: [...s.clips, ...ids.flatMap((id) => (media.get(id) ? [clipFromMedia(media.get(id)!)] : []))] }))}
      />
    </div>
  );
}

function ClipRow({ clip, index, media, active, onSelect }: { clip: EditClip; index: number; media: Media | undefined; active: boolean; onSelect: () => void }) {
  const comesIn = index > 0 && clip.transition ? TRANSITION_INFO[clip.transition.type].label : null;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: clip.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('flex items-center gap-2 rounded-lg border bg-card p-1.5 pr-2', active && 'border-brand/60 bg-brand-soft', isDragging && 'z-10 shadow-lg')}
    >
      <button type="button" className="cursor-grab touch-none px-0.5 text-muted-foreground active:cursor-grabbing" aria-label={`Reorder clip ${index + 1}`} {...attributes} {...listeners}>
        <GripVertical className="size-4" />
      </button>
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded bg-muted">
          {media?.hasThumb ? <img src={mediaThumbUrl(media.id)} alt="" className="size-full object-cover" /> : <MediaIcon media={media ?? { kind: 'other', assetType: null }} className="size-4 text-muted-foreground" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{media?.originalName ?? 'Missing file'}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {media?.kind === 'image' ? 'Photo' : `${preciseClock(clip.in)} – ${preciseClock(clip.out)}`}
            {clip.zoom > 1.001 && ` · ${clip.zoom.toFixed(2)}×`}
            {clip.volume === 0 && ' · muted'}
            {comesIn && ` · ${comesIn} in`}
          </p>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{clipLength(clip).toFixed(1)}s</span>
      </button>
    </li>
  );
}

function ClipEditor({ clip, start }: { clip: EditClip; start: number }) {
  const { spec, update, time, seek, select, media } = useStudio();
  const m = media.get(clip.mediaId);
  const set = (patch: Partial<EditClip>) => update((s) => ({ ...s, clips: s.clips.map((c) => (c.id === clip.id ? { ...c, ...patch } : c)) }));
  const sourceMax = m?.durationMs ? m.durationMs / 1000 : undefined;
  // The playhead, in this clip's source time (only meaningful while it's over the clip).
  const playheadSource = time >= start && time <= start + clipLength(clip) ? clip.in + (time - start) : null;
  const box = EDIT_FORMATS[spec.format];
  const mismatch = m?.width && m?.height ? Math.abs(m.width / m.height - box.width / box.height) > 0.02 : false;

  return (
    <section className="space-y-4 rounded-lg border p-3" aria-label="Selected clip">
      <div className="flex items-center gap-2">
        <h3 className="mr-auto truncate text-sm font-medium">{m?.originalName ?? 'Missing file'}</h3>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Duplicate clip"
          onClick={() =>
            update((s) => {
              const i = s.clips.findIndex((c) => c.id === clip.id);
              const clips = [...s.clips];
              clips.splice(i + 1, 0, { ...clip, id: newEditId() });
              return { ...s, clips };
            })
          }
        >
          <Copy />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          aria-label="Remove clip"
          onClick={() => {
            update((s) => ({ ...s, clips: s.clips.filter((c) => c.id !== clip.id) }));
            select(null);
          }}
        >
          <Trash2 />
        </Button>
      </div>

      {m?.kind === 'image' ? (
        <SecondsField label="Shows for" value={clipLength(clip)} min={0.3} max={60} onChange={(v) => set({ in: 0, out: v })} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <SecondsField label="Starts at" value={clip.in} max={clip.out - 0.1} onChange={(v) => set({ in: v })} onPlayhead={playheadSource !== null ? () => set({ in: Math.min(playheadSource, clip.out - 0.1) }) : undefined} />
          <SecondsField label="Ends at" value={clip.out} min={clip.in + 0.1} max={sourceMax} onChange={(v) => set({ out: v })} onPlayhead={playheadSource !== null ? () => set({ out: Math.max(playheadSource, clip.in + 0.1) }) : undefined} />
        </div>
      )}

      {m?.kind === 'video' && mismatch && (
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="clip-whole" className="flex-col items-start gap-0.5 text-xs">
            Show the whole picture
            <span className="font-normal text-muted-foreground">For a game or a screen: nothing cropped, a blurred copy behind</span>
          </Label>
          <Switch id="clip-whole" checked={clip.fit === 'whole'} onCheckedChange={(on) => set({ fit: on ? 'whole' : 'fill' })} />
        </div>
      )}
      {m && ((mismatch && clip.fit === 'fill') || clip.zoom > 1) && <FocusPicker media={m} clip={clip} onChange={(focusX, focusY) => set({ focusX, focusY })} />}

      <SliderField label="Zoom" value={clip.zoom} min={1} max={2} step={0.01} format={(v) => `${v.toFixed(2)}×`} onChange={(zoom) => set({ zoom })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Camera move" hint={CLIP_MOTION_INFO[clip.motion].hint}>
          <ChoiceSelect label="Camera move" value={clip.motion} onChange={(motion) => set({ motion })} options={CLIP_MOTIONS.map((v) => ({ value: v, label: CLIP_MOTION_INFO[v].label }))} />
        </Field>
        <Field label="Colour look" hint={clip.filter ? FILTER_LOOK_INFO[clip.filter].hint : 'Same as the whole video (Look tab)'}>
          <ChoiceSelect
            label="Colour look"
            value={clip.filter ?? VIDEO_LOOK}
            onChange={(v) => set({ filter: v === VIDEO_LOOK ? null : (v as FilterLook) })}
            options={[{ value: VIDEO_LOOK, label: 'The video’s look' }, ...FILTER_LOOKS.map((v) => ({ value: v, label: FILTER_LOOK_INFO[v].label }))]}
          />
        </Field>
      </div>
      {m?.kind === 'video' && <SliderField label="Clip sound" value={clip.volume} min={0} max={2} step={0.05} format={(v) => (v === 0 ? 'Muted' : `${Math.round(v * 100)}%`)} onChange={(volume) => set({ volume })} />}

      {spec.clips[0]?.id !== clip.id && (
        <TransitionEditor
          value={clip.transition}
          onChange={(transition) => {
            set({ transition });
            // Show it: from just before the cut.
            if (transition) seek(Math.max(0, start - transition.duration / 2 - 0.4));
          }}
          onAll={() =>
            update((s) => ({ ...s, clips: s.clips.map((c, i) => (i === 0 ? c : { ...c, transition: clip.transition })) }))
          }
        />
      )}
    </section>
  );
}

const CUT = 'cut';
const VIDEO_LOOK = 'video';

/** How the clip comes in from the one before: a straight cut or a transition, its length and its sound. */
function TransitionEditor({ value, onChange, onAll }: { value: ClipTransition | null; onChange: (t: ClipTransition | null) => void; onAll: () => void }) {
  return (
    <div className="space-y-3 border-t pt-3">
      <Field label="Comes in with" hint={value ? TRANSITION_INFO[value.type].hint : 'Straight cut'}>
        <div className="flex gap-2">
          <Select
            value={value?.type ?? CUT}
            onValueChange={(v) =>
              onChange(v === CUT ? null : { type: v as TransitionType, duration: TRANSITION_INFO[v as TransitionType].duration, sound: value?.sound ?? true })
            }
          >
            <SelectTrigger size="sm" className="w-full min-w-0" aria-label="Transition">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CUT}>Cut</SelectItem>
              {TRANSITIONS.map((t) => (
                <SelectItem key={t} value={t}>
                  {TRANSITION_INFO[t].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" onClick={onAll} title="Use this on every cut of the edit">
            Use on every cut
          </Button>
        </div>
      </Field>
      {value && (
        <>
          <SliderField
            label="Length"
            value={value.duration}
            min={TRANSITION_MIN}
            max={TRANSITION_MAX}
            step={0.01}
            format={(v) => `${v.toFixed(2)} s`}
            onChange={(duration) => onChange({ ...value, duration })}
          />
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="transition-sound" className="text-xs">
              Sound effect <span className="font-normal text-muted-foreground">({builtinSfx(builtinSfxId(TRANSITION_INFO[value.type].sound))?.label.toLowerCase()})</span>
            </Label>
            <Switch id="transition-sound" checked={value.sound} onCheckedChange={(sound) => onChange({ ...value, sound })} />
          </div>
        </>
      )}
    </div>
  );
}

/** Click where the subject is; the outline shows what stays in the frame. */
function FocusPicker({ media, clip, onChange }: { media: Media; clip: EditClip; onChange: (x: number, y: number) => void }) {
  const { spec } = useStudio();
  const box = EDIT_FORMATS[spec.format];
  const w = media.width ?? box.width;
  const h = media.height ?? box.height;
  const g = clipGeometry(clip, w, h, box.width, box.height);
  // The part of the picture inside the frame.
  const vl = Math.max(0, -g.left) / g.width;
  const vt = Math.max(0, -g.top) / g.height;
  const view = { left: vl, top: vt, width: Math.min(1 - vl, box.width / g.width), height: Math.min(1 - vt, box.height / g.height) };
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">Reframe</p>
      <button
        type="button"
        className="relative block w-full max-w-64 cursor-crosshair overflow-hidden rounded-md bg-muted"
        style={{ aspectRatio: `${w} / ${h}` }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onChange(Math.round(((e.clientX - r.left) / r.width) * 1000) / 1000, Math.round(((e.clientY - r.top) / r.height) * 1000) / 1000);
        }}
        aria-label="Click where the subject is"
      >
        {media.hasThumb && <img src={mediaThumbUrl(media.id)} alt="" className="size-full object-cover opacity-60" />}
        <span
          className="absolute rounded-sm border-2 border-brand shadow-[0_0_0_999px_rgba(0,0,0,0.45)]"
          style={{ left: `${view.left * 100}%`, top: `${view.top * 100}%`, width: `${view.width * 100}%`, height: `${view.height * 100}%` }}
        />
      </button>
      <p className="text-xs text-muted-foreground">Click where the subject is.</p>
    </div>
  );
}
