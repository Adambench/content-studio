import { ArrowLeft, Mic, Send, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { WorkspaceDot } from '@/components/WorkspaceDot';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { duration } from '@/lib/format';
import { isNative, Studio } from '@/lib/native';
import { useSettings, useWorkspaces } from '@/lib/queries';
import { serverReachable } from '@/lib/ui-state';
import { cn } from '@/lib/utils';

const MIME = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m));

const capturedToast = () =>
  serverReachable.get()
    ? toast.success('Captured', { description: 'Transcribing — Claude will turn it into an idea card. You’ll get a notification.' })
    : toast.success('Saved on this phone', { description: 'It goes to your computer as soon as it can reach it.' });

export function CapturePage() {
  const { data: all = [] } = useWorkspaces();
  // Ideas go to workspaces with Ideas & scripts on (all of them if none has it).
  const withIdeas = all.filter((w) => w.modules.includes('ideas'));
  const workspaces = withIdeas.length ? withIdeas : all;
  const settings = useSettings();
  const [wid, setWid] = useState('');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const cleanup = useRef<() => void>(() => {});
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    if (!wid && workspaces.length) setWid(workspaces.find((w) => w.id === settings.data?.lastWorkspaceId)?.id ?? workspaces[0].id);
  }, [workspaces, settings.data, wid]);

  useEffect(() => () => cleanup.current(), []);

  // The "Record a voice memo" launcher shortcut starts recording straight away.
  useEffect(() => {
    if (!wid || !params.has('record')) return;
    setParams({}, { replace: true });
    void start();
  }, [wid, params]);

  // In the Android app the memo is recorded natively and queued on the phone, so it's kept even offline.
  useEffect(() => {
    if (!isNative) return;
    const level = Studio.addListener('recordLevel', (e) => {
      setLevel(e.level);
      setElapsed(e.elapsedMs);
    });
    // Leaving the app stops the recording (Android cuts the mic for apps in the background); it's kept.
    const stopped = Studio.addListener('recordStopped', (e) => {
      setRecording(false);
      setLevel(0);
      if (e.queued) capturedToast();
    });
    return () => {
      void level.then((l) => l.remove());
      void stopped.then((l) => l.remove());
      void Studio.cancelRecording().catch(() => {});
    };
  }, []);

  async function start() {
    if (isNative) {
      try {
        await Studio.startRecording({ workspaceId: wid });
        setElapsed(0);
        setRecording(true);
        navigator.vibrate?.(30);
      } catch (err) {
        toast.error(errorMessage(err));
      }
      return;
    }
    if (!MIME) return toast.error('This browser can’t record audio.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream, { mimeType: MIME });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => void upload(new Blob(chunks, { type: MIME.split(';')[0] }));
      rec.start(1000);
      recorder.current = rec;

      // Live input level so it's obvious the mic is hearing you.
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      let raf = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(peak / 128);
        raf = requestAnimationFrame(tick);
      };
      tick();
      const started = Date.now();
      const timer = setInterval(() => setElapsed(Date.now() - started), 250);
      cleanup.current = () => {
        cancelAnimationFrame(raf);
        clearInterval(timer);
        void ctx.close();
        stream.getTracks().forEach((t) => t.stop());
      };
      setElapsed(0);
      setRecording(true);
      navigator.vibrate?.(30);
    } catch (err) {
      toast.error(err instanceof DOMException && err.name === 'NotAllowedError' ? 'Microphone access was blocked.' : errorMessage(err));
    }
  }

  async function stop() {
    if (isNative) {
      setRecording(false);
      setLevel(0);
      navigator.vibrate?.(30);
      try {
        const { queued } = await Studio.stopRecording();
        if (queued) capturedToast();
        else toast.error('That was too short.');
      } catch (err) {
        toast.error(errorMessage(err));
      }
      return;
    }
    recorder.current?.stop();
    cleanup.current();
    setRecording(false);
    setLevel(0);
    navigator.vibrate?.(30);
  }

  async function upload(blob: Blob) {
    if (blob.size < 1000) return toast.error('That was too short.');
    setSending(true);
    try {
      const form = new FormData();
      const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
      form.append('file', blob, `voice-memo-${new Date().toISOString().slice(0, 16).replace(':', '')}.${ext}`);
      await api(`/workspaces/${wid}/capture`, { body: form });
      toast.success('Captured', { description: 'Transcribing — Claude will turn it into an idea card. You’ll get a notification.' });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  async function sendText(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      if (isNative) {
        await Studio.enqueueText({ workspaceId: wid, text });
        setText('');
        if (!serverReachable.get()) return void toast.success('Saved on this phone', { description: 'It goes to your computer as soon as it can reach it.' });
        return void toast.success('Captured', { description: 'Claude is turning it into an idea card.' });
      }
      await api(`/workspaces/${wid}/capture`, { body: { text } });
      setText('');
      toast.success('Captured', { description: 'Claude is turning it into an idea card.' });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="pt-safe flex items-center gap-2 border-b px-2 md:px-4">
        <div className="flex h-12 items-center gap-2">
          <Button variant="ghost" size="icon-sm" asChild aria-label="Back">
            <Link to={wid ? `/w/${wid}/board` : '/'}>
              <ArrowLeft />
            </Link>
          </Button>
          <h1 className="text-base font-semibold">Capture an idea</h1>
        </div>
        <Select value={wid} onValueChange={setWid}>
          <SelectTrigger size="sm" className="ml-auto w-auto max-w-[50vw]" aria-label="Workspace">
            <SelectValue placeholder="Workspace" />
          </SelectTrigger>
          <SelectContent align="end">
            {workspaces.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                <WorkspaceDot color={w.color} /> {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-6 py-8">
        <p className="max-w-xs text-center text-sm text-muted-foreground">{recording ? 'Listening… say it messy, Claude will tidy it up.' : 'Tap and talk through your idea. It’s transcribed on your computer, then Claude makes a card.'}</p>
        <button
          type="button"
          onClick={recording ? stop : start}
          disabled={!wid || sending}
          aria-label={recording ? 'Stop recording' : 'Start recording'}
          className={cn('relative grid size-36 place-items-center rounded-full text-white transition-transform active:scale-95 disabled:opacity-50', recording ? 'bg-destructive' : 'bg-brand shadow-2xl shadow-brand/30')}
        >
          {recording && <span className="absolute inset-0 rounded-full bg-destructive/40" style={{ transform: `scale(${1 + level * 0.6})`, transition: 'transform 80ms linear' }} aria-hidden />}
          <span className="relative">{sending ? <Spinner className="size-10" /> : recording ? <Square className="size-10 fill-current" /> : <Mic className="size-12" />}</span>
        </button>
        <span className={cn('h-5 text-sm tabular-nums', !recording && 'invisible')}>{duration(elapsed)}</span>

        <form onSubmit={sendText} className="w-full max-w-md space-y-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="…or type it" rows={3} disabled={recording} />
          <Button type="submit" variant="secondary" className="w-full" disabled={!text.trim() || !wid || sending || recording}>
            <Send /> Capture text
          </Button>
        </form>
      </div>
    </div>
  );
}
