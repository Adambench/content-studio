import { Check, Mic, Square, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, errorMessage, mediaFileUrl } from '@/lib/api';
import { keys, queryClient } from '@/lib/queries';
import type { Media } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useStudio } from './context';
import { ListenButton, SliderField } from './controls';

const MIME = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m));
const pct = (v: number) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`);
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

/**
 * The creator's own voice for this video: the script read aloud, recorded here (or a voice memo uploaded), kept with
 * the video and played from the start as the voiceover, its words captioned. Claude builds the edit on it.
 */
export function VoiceSection() {
  const { edit, piece, spec, update } = useStudio();
  const vo = spec.audio.voiceover;
  const recordings = (piece?.media ?? []).filter((m) => m.kind === 'audio' && m.source === 'capture');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [sending, setSending] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const cleanup = useRef<() => void>(() => {});
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => cleanup.current(), []);

  const use = (m: Pick<Media, 'id'> | null) => update((s) => ({ ...s, audio: { ...s.audio, voiceover: m ? { mediaId: m.id, volume: s.audio.voiceover?.volume ?? 1 } : null } }));

  async function send(file: Blob, name: string) {
    if (file.size < 1000) return toast.error('That was too short.');
    setSending(true);
    try {
      const form = new FormData();
      form.append('file', file, name);
      const saved = await api<Media>(`/pieces/${edit.pieceId}/recording`, { body: form });
      use(saved);
      await queryClient.invalidateQueries({ queryKey: keys.piece(edit.pieceId) });
      toast.success('Your voice is in', { description: 'Transcribing it for the captions. Ask Claude to build the video on it.' });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  async function start() {
    if (!MIME) return toast.error('This browser can’t record audio: upload a recording instead.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream, { mimeType: MIME });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => void send(new Blob(chunks, { type: MIME.split(';')[0] }), `voice-${new Date().toISOString().slice(0, 16).replace(':', '')}.${MIME.includes('mp4') ? 'm4a' : 'webm'}`);
      rec.start(1000);
      recorder.current = rec;
      const started = Date.now();
      const timer = setInterval(() => setElapsed(Date.now() - started), 250);
      cleanup.current = () => {
        clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
      };
      setElapsed(0);
      setRecording(true);
    } catch (err) {
      toast.error(err instanceof DOMException && err.name === 'NotAllowedError' ? 'Microphone access was blocked.' : errorMessage(err));
    }
  }

  function stop() {
    recorder.current?.stop();
    cleanup.current();
    setRecording(false);
  }

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">Your voice</h3>
        <p className="text-xs text-muted-foreground">Read the script aloud: it plays from the start as the voiceover and its words become the captions.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={recording ? 'destructive' : 'default'} onClick={recording ? stop : () => void start()} disabled={sending}>
          {recording ? <Square className="size-4" /> : <Mic className="size-4" />}
          {recording ? `Stop ${clock(elapsed)}` : sending ? 'Saving…' : 'Record'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()} disabled={recording || sending}>
          <Upload className="size-4" />
          Upload a recording
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void send(f, f.name);
          }}
        />
      </div>
      {recordings.length > 0 && (
        <ul className="space-y-1.5">
          {recordings.map((m) => {
            const on = vo?.mediaId === m.id;
            return (
              <li key={m.id} className={cn('flex items-center gap-2 rounded-lg border px-2 py-1.5', on && 'border-brand/60 bg-brand-soft')}>
                <ListenButton src={mediaFileUrl(m.id)} label={`Listen to ${m.originalName}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs">{m.transcriptText || m.originalName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {m.durationMs ? clock(m.durationMs) : ''}
                    {m.transcriptStatus === 'queued' || m.transcriptStatus === 'running' ? ' · transcribing' : m.transcriptStatus === 'error' ? ' · no words (transcribing failed)' : ''}
                  </p>
                </div>
                <Button size="sm" variant={on ? 'secondary' : 'outline'} onClick={() => use(on ? null : m)}>
                  {on && <Check className="size-4" />}
                  {on ? 'Voiceover' : 'Use'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {vo && <SliderField label="Voiceover level" value={vo.volume} min={0} max={2} step={0.05} format={pct} onChange={(volume) => update((s) => ({ ...s, audio: { ...s.audio, voiceover: s.audio.voiceover && { ...s.audio.voiceover, volume } } }))} />}
    </section>
  );
}
