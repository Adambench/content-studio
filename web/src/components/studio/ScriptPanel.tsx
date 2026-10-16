import { Clapperboard, Mic, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  CHARACTERS,
  RECIPE_INFO,
  VOICES,
  recipeNeedsBuild,
  type ChatRecipe,
  type CharacterId,
  type DialogueRecipe,
  type Recipe,
  type RecipeKind,
  type StoryRecipe,
} from '@shared/recipe';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage, fileUrl, mediaThumbUrl } from '@/lib/api';
import { onLiveEvent } from '@/lib/live';
import { useSystemStatus } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useStudio } from './context';
import { Field, ListenButton, SliderField } from './controls';
import { MediaPicker } from './MediaPicker';

/** A recipe to start from: an example of the format, to be rewritten (or written by Claude). */
export function exampleRecipe(kind: RecipeKind, author: string): Recipe {
  const common = { backgrounds: [], builtFrom: null };
  if (kind === 'story')
    return {
      kind,
      title: 'My neighbour kept parking in my spot, so I did something petty',
      text: 'It started three weeks ago. Every morning, the same grey car sat in the space with my flat number painted on it. I left a polite note. Nothing. So on Friday night, I parked my bike, my old sofa and two traffic cones right behind his car. On Saturday he knocked on my door, laughing, and asked if I wanted to split a pizza. We are friends now. He still parks in my spot.',
      author,
      voice: 'am_michael',
      speed: 1.05,
      titleEnd: 0,
      ...common,
    };
  if (kind === 'chat')
    return {
      kind,
      contact: 'Mum',
      voices: { them: 'af_heart', me: 'am_michael' },
      speed: 1.05,
      messages: [
        { from: 'them', text: 'Why is there a goat in the garden?', at: 0, end: 0 },
        { from: 'me', text: 'What goat', at: 0, end: 0 },
        { from: 'them', text: 'The one eating my roses', at: 0, end: 0 },
        { from: 'me', text: 'Ok so funny story', at: 0, end: 0 },
      ],
      ...common,
    };
  return {
    kind,
    cast: [
      { name: 'Sam', look: 'sam', voice: 'am_michael' },
      { name: 'Lina', look: 'lina', voice: 'af_heart' },
    ],
    speed: 1.05,
    lines: [
      { who: 0, text: 'Why does my phone battery die so fast?', at: 0, end: 0 },
      { who: 1, text: 'Because you have forty apps refreshing in the background.', at: 0, end: 0 },
      { who: 0, text: 'Forty? I only use three.', at: 0, end: 0 },
      { who: 1, text: 'Exactly. Turn the rest off and watch what happens.', at: 0, end: 0 },
    ],
    mouth: '',
    ...common,
  };
}

const voiceOptions = VOICES.map((v) => ({ value: v.id, label: `${v.label} — ${v.who}` }));

function VoiceField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { data: st } = useSystemStatus();
  return (
    <Field label={label}>
      <div className="flex gap-1">
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger size="sm" className="w-full min-w-0" aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {voiceOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ListenButton src={st?.tts ? fileUrl(`/tts/voices/${value}.wav`) : null} label={`Listen to ${label.toLowerCase()}`} />
      </div>
    </Field>
  );
}

/** A textarea that hands its text up when you leave it (so typing doesn't rebuild the preview every keystroke). */
function BlurText({ value, onCommit, rows, placeholder, label }: { value: string; onCommit: (v: string) => void; rows: number; placeholder?: string; label: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <Textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && onCommit(text)} rows={rows} placeholder={placeholder} aria-label={label} />;
}

function BlurInput({ value, onCommit, label }: { value: string; onCommit: (v: string) => void; label: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <Input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && onCommit(text.trim())} className="h-8" aria-label={label} />;
}

const chatToText = (r: ChatRecipe) => r.messages.map((m) => `${m.from === 'me' ? 'Me' : r.contact}: ${m.text}`).join('\n');
function textToChat(text: string, r: ChatRecipe): ChatRecipe['messages'] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const m = /^([^:]{1,40}):\s*(.*)$/.exec(line);
      const who = m?.[1].trim().toLowerCase();
      const from: 'me' | 'them' = who === 'me' ? 'me' : 'them';
      const old = r.messages[i];
      const body = m && (who === 'me' || who === 'them' || who === r.contact.toLowerCase()) ? m[2] : line;
      return { from, text: body, at: old?.at ?? 0, end: old?.end ?? 0 };
    })
    .filter((m) => m.text);
}

const dialogueToText = (r: DialogueRecipe) => r.lines.map((l) => `${r.cast[l.who].name}: ${l.text}`).join('\n');
function textToDialogue(text: string, r: DialogueRecipe): DialogueRecipe['lines'] {
  let next: 0 | 1 = 0;
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const m = /^([^:]{1,30}):\s*(.*)$/.exec(line);
      const name = m?.[1].trim().toLowerCase();
      const hit = r.cast.findIndex((c) => c.name.toLowerCase() === name);
      const who = (hit >= 0 ? hit : next) as 0 | 1;
      next = who ? 0 : 1;
      const old = r.lines[i];
      return { who, text: hit >= 0 ? m![2] : line, at: old?.at ?? 0, end: old?.end ?? 0 };
    })
    .filter((l) => l.text);
}

/** Words per second at speed 1, for a rough length before the voice is made. */
const WPS = 2.7;

export function ScriptPanel() {
  const { edit, spec, update, serverAction, media, footage } = useStudio();
  const { data: st } = useSystemStatus();
  const [picking, setPicking] = useState(false);
  const [building, setBuilding] = useState<string | null>(null);
  const r = spec.recipe;

  useEffect(
    () =>
      onLiveEvent((e) => {
        if (e.type !== 'job' || e.jobType !== 'format.build' || e.editId !== edit.id) return;
        setBuilding(e.status === 'running' ? (e.message ?? 'Working…') : null);
      }),
    [edit.id],
  );

  if (!r) return null;
  const set = (patch: Partial<Recipe>) => update((s) => ({ ...s, recipe: s.recipe ? ({ ...s.recipe, ...patch } as Recipe) : s.recipe }));
  const stale = recipeNeedsBuild(r);
  const words = (r.kind === 'story' ? `${r.title} ${r.text}` : r.kind === 'chat' ? r.messages.map((m) => m.text).join(' ') : r.lines.map((l) => l.text).join(' ')).split(/\s+/).filter(Boolean).length;
  const estimate = Math.round(words / (WPS * r.speed));

  async function build() {
    setBuilding('Starting…');
    try {
      await serverAction(() => api(`/edits/${edit.id}/build`, { body: {} }));
    } catch (err) {
      setBuilding(null);
      toast.error(errorMessage(err));
    }
  }

  const backgrounds = r.backgrounds.map((id) => media.get(id)).filter((m) => !!m);
  const pickable = footage.filter((m) => (m.kind === 'video' || m.kind === 'image') && m.source !== 'render' && m.source !== 'tts');

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{RECIPE_INFO[r.kind].label}</h3>
        <p className="text-xs text-muted-foreground">{RECIPE_INFO[r.kind].hint}. The voices are made on this computer; no music, ever.</p>
      </div>

      {r.kind === 'story' && <StoryFields r={r} set={set} />}
      {r.kind === 'chat' && <ChatFields r={r} set={set} />}
      {r.kind === 'dialogue' && <DialogueFields r={r} set={set} />}

      <SliderField label="Reading speed" value={r.speed} min={0.8} max={1.3} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(speed) => set({ speed })} />

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-medium">Background footage</p>
          <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>
            <Clapperboard /> Choose
          </Button>
        </div>
        {backgrounds.length ? (
          <ul className="space-y-1">
            {backgrounds.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
                {m.hasThumb && <img src={mediaThumbUrl(m.id)} alt="" className="size-8 rounded object-cover" />}
                <span className="min-w-0 flex-1 truncate">{m.originalName}</span>
                <Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => set({ backgrounds: r.backgrounds.filter((id) => id !== m.id) })}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Gameplay or other footage you recorded (played muted, from a different point each video). Without any, a slow moving gradient.</p>
        )}
      </div>

      <div className={cn('space-y-2 rounded-lg border p-3', stale && 'border-amber-500/50 bg-amber-500/5')}>
        <p className="text-sm">
          {building ? (
            <span className="flex items-center gap-2">
              <Spinner className="size-3.5" /> {building}
            </span>
          ) : stale ? (
            r.builtFrom ? (
              'The words or voices changed: make the voice again to hear them and re-time the video.'
            ) : (
              `About ${estimate} s once spoken. Make the voice to time the video.`
            )
          ) : (
            `Voice made: ${editLength(spec.clips)} s with the background. Change the words to make it again.`
          )}
        </p>
        <Button size="sm" onClick={build} disabled={!!building || !st?.tts || (!stale && !!r.builtFrom)}>
          <Mic /> {r.builtFrom ? 'Make the voice again' : 'Make the voice'}
        </Button>
        {st && !st.tts && <p className="text-xs text-muted-foreground">Needs the clip tools with their voices: Settings → Clip tools.</p>}
      </div>

      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        onClick={() => update((s) => ({ ...s, recipe: null, audio: { ...s.audio, voiceover: null } }))}
      >
        Stop using the format (keeps the footage)
      </Button>

      <MediaPicker
        open={picking}
        onOpenChange={setPicking}
        title="Background footage"
        description="Played muted under the voice. Use gameplay or footage you recorded yourself."
        rest={pickable}
        multiple
        onPick={(ids) => set({ backgrounds: [...new Set([...r.backgrounds, ...ids])].slice(0, 10) })}
      />
    </div>
  );
}

const editLength = (clips: { in: number; out: number }[]) => clips.reduce((n, c) => n + c.out - c.in, 0).toFixed(1);

function StoryFields({ r, set }: { r: StoryRecipe; set: (p: Partial<StoryRecipe>) => void }) {
  return (
    <>
      <Field label="Title" hint="Read first, on a post card: the hook">
        <BlurText value={r.title} onCommit={(title) => set({ title })} rows={2} label="Title" />
      </Field>
      <Field label="The story">
        <BlurText value={r.text} onCommit={(text) => set({ text })} rows={10} label="The story" placeholder="Short sentences read best." />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Posted by">
          <BlurInput value={r.author} onCommit={(author) => set({ author })} label="Posted by" />
        </Field>
        <VoiceField label="Voice" value={r.voice} onChange={(voice) => set({ voice })} />
      </div>
    </>
  );
}

function ChatFields({ r, set }: { r: ChatRecipe; set: (p: Partial<ChatRecipe>) => void }) {
  return (
    <>
      <Field label="Their name">
        <BlurInput value={r.contact} onCommit={(contact) => set({ contact: contact || 'Unknown' })} label="Their name" />
      </Field>
      <Field label="The conversation" hint="One message per line">
        <BlurText value={chatToText(r)} onCommit={(text) => set({ messages: textToChat(text, r) })} rows={10} label="The conversation" />
      </Field>
      <p className="-mt-3 text-xs text-muted-foreground">Start your own messages with “Me:”; the rest are theirs.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <VoiceField label="Their voice" value={r.voices.them} onChange={(them) => set({ voices: { ...r.voices, them } })} />
        <VoiceField label="Your voice" value={r.voices.me} onChange={(me) => set({ voices: { ...r.voices, me } })} />
      </div>
    </>
  );
}

function DialogueFields({ r, set }: { r: DialogueRecipe; set: (p: Partial<DialogueRecipe>) => void }) {
  const setCast = (k: 0 | 1, patch: Partial<DialogueRecipe['cast'][0]>) => {
    const cast = [...r.cast] as DialogueRecipe['cast'];
    cast[k] = { ...cast[k], ...patch };
    set({ cast });
  };
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {([0, 1] as const).map((k) => (
          <div key={k} className="space-y-2 rounded-lg border p-2.5">
            <div className="flex items-center gap-2">
              <img src={fileUrl(`/studio/characters/${r.cast[k].look}.svg`)} alt="" className="size-12 rounded bg-muted object-contain" />
              <BlurInput value={r.cast[k].name} onCommit={(name) => setCast(k, { name: name || (k ? 'Max' : 'Sam') })} label={`Character ${k + 1} name`} />
            </div>
            <Select value={r.cast[k].look} onValueChange={(look) => setCast(k, { look: look as CharacterId })}>
              <SelectTrigger size="sm" className="w-full" aria-label={`Character ${k + 1} look`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHARACTERS.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label} — {c.hint}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <VoiceField label="Voice" value={r.cast[k].voice} onChange={(voice) => setCast(k, { voice })} />
          </div>
        ))}
      </div>
      <Field label="What they say" hint="One line each">
        <BlurText value={dialogueToText(r)} onCommit={(text) => set({ lines: textToDialogue(text, r) })} rows={10} label="What they say" />
      </Field>
      <p className="-mt-3 text-xs text-muted-foreground">
        Start each line with who says it (“{r.cast[0].name}:” or “{r.cast[1].name}:”); lines without a name take turns.
      </p>
    </>
  );
}
