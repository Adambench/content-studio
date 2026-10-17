import { useQuery } from '@tanstack/react-query';
import { Mic, Play, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { ListenButton } from '@/components/studio/controls';
import { api, apiFetch, errorMessage, fileUrl, uploadFiles } from '@/lib/api';
import { keys, queryClient } from '@/lib/queries';

type VoiceState = { reference: { seconds: number; updatedAt: number } | null; workers: string[] };

/** Settings → My voice: the recording the cloned voice copies, and a sample of it. */
export function VoiceCard() {
  const voice = useQuery({ queryKey: [...keys.ai, 'voice'], queryFn: () => api<VoiceState>('/voice'), refetchInterval: 30_000 });
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [sampling, setSampling] = useState(false);
  const d = voice.data;

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const r = await uploadFiles<{ seconds: number }>('/voice/reference', [file]);
      toast.success(`Kept ${r.seconds} s of your voice.`);
      queryClient.invalidateQueries({ queryKey: keys.ai });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  }

  async function sample() {
    setSampling(true);
    try {
      // Made on a home PC the first time (a minute or so), then kept.
      const res = await apiFetch('/tts/voices/clone.wav');
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Request failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSampling(false);
    }
  }

  async function remove() {
    await api('/voice/reference', { method: 'DELETE' }).catch((err) => toast.error(errorMessage(err)));
    queryClient.invalidateQueries({ queryKey: keys.ai });
  }

  return (
    <Card id="voice">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mic className="size-4" /> My voice
        </CardTitle>
        <CardDescription>
          Voiceovers and format videos can speak in your own voice (“My voice” in the voice pickers), cloned on a home PC with Chatterbox. Record 10–30 s of you talking normally, alone, in a quiet room.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {d?.reference ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
            <ListenButton src={fileUrl(`/voice/reference.wav?v=${d.reference.updatedAt}`)} label="Listen to your recording" />
            <p className="mr-auto text-sm">
              Your recording <span className="text-muted-foreground">· {d.reference.seconds} s</span>
            </p>
            <Button size="sm" variant="outline" onClick={sample} disabled={sampling}>
              {sampling ? <Spinner /> : <Play />} Hear the clone
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Delete the recording" onClick={remove}>
              <Trash2 />
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No recording yet.</p>
        )}
        <input ref={input} type="file" accept="audio/*" capture="user" className="hidden" onChange={(e) => upload(e.target.files)} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => input.current?.click()} disabled={uploading}>
            {uploading ? <Spinner /> : <Upload />} {d?.reference ? 'Replace the recording' : 'Add a recording'}
          </Button>
          <p className="text-xs text-muted-foreground">
            {d?.workers.length ? `Made on ${d.workers.join(', ')}.` : 'No home PC with the voice is online: set one up with scripts/setup-worker.sh --with voice.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
