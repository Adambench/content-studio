import { Check, Copy, Cpu, Gauge, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { TOOL_INFO } from '@shared/compute';
import type { Pairing } from '@shared/devices';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { keys, queryClient, useWorkers } from '@/lib/queries';

/** Settings → Compute: the home PCs that take the heavy jobs. */
export function ComputeCard() {
  const workers = useWorkers();
  const [server, setServer] = useState('');
  const [code, setCode] = useState<Pairing | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [test, setTest] = useState<{ running: boolean; result?: string }>({ running: false });

  useEffect(() => {
    api<{ url: string | null }>('/devices/address')
      .then(({ url }) => url && setServer((s) => s || url))
      .catch(() => {});
  }, []);

  async function addWorker() {
    setBusy(true);
    try {
      setCode(await api<Pairing>('/devices/pairing', { body: { server } }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setTest({ running: true });
    try {
      const r = await api<{ on: string; seconds: number }>('/compute/test', { method: 'POST', body: {} });
      setTest({ running: false, result: `A person-matte test ran on ${r.on === 'laptop' ? 'this computer (no worker was free)' : r.on} in ${r.seconds} s.` });
    } catch (err) {
      setTest({ running: false, result: errorMessage(err) });
    }
  }

  async function remove(id: string) {
    await api(`/compute/workers/${id}`, { method: 'DELETE' }).catch((err) => toast.error(errorMessage(err)));
    queryClient.invalidateQueries({ queryKey: keys.compute });
  }

  const command = code ? `scripts/setup-worker.sh --server ${code.server} --code ${code.code} --name "Desktop" --with llm,image,video,voice` : '';

  return (
    <Card id="compute">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="size-4" /> Compute
        </CardTitle>
        <CardDescription>
          Home PCs take the heavy jobs (speech to text, separating voice from music, the person cut-out, the speaker scan) so this computer stays free, and run your own models: the text model, generated pictures and clips, your cloned voice. They reach this one over Tailscale. When none is free or online, the same job runs here (generation and your voice wait for one).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {workers.data && workers.data.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {workers.data.map((w) => (
              <li key={w.id} className="flex items-start gap-3 px-3 py-2.5">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${w.online ? 'bg-emerald-400' : 'bg-muted-foreground/40'}`} aria-label={w.online ? 'Online' : 'Offline'} />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm font-medium">
                    {w.name} <span className="font-normal text-muted-foreground">{w.gpu || (w.online ? 'no GPU' : '')}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {w.task ? `Working: ${TOOL_INFO[w.task.tool].label}${w.task.progress ? ` · ${w.task.progress}` : ''}` : w.online ? 'Free' : w.lastSeenAt ? `Last seen ${timeAgo(w.lastSeenAt)}` : 'Not seen yet'}
                    {w.speed?.matteMsPerFrame ? ` · matte ${w.speed.matteMsPerFrame} ms a frame${w.speed.cuda ? ' (GPU)' : ' (CPU)'}` : ''}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {w.tools.map((t) => (
                      <Badge key={t} variant="outline" className="text-[11px]">
                        {TOOL_INFO[t].label}
                      </Badge>
                    ))}
                    {w.llmUrl && (
                      <Badge variant="outline" className="text-[11px]">
                        Text model
                      </Badge>
                    )}
                    {w.online && w.tools.length === 0 && <span className="text-xs text-amber-400">No tools installed on it yet: run the setup script.</span>}
                  </div>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label={`Remove ${w.name}`} onClick={() => remove(w.id)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {code ? (
          <div className="space-y-2 rounded-lg border p-3 text-sm">
            <p>
              On the home PC (Linux, with this repository checked out, Node 22+, Python 3 and the NVIDIA driver), run this once. The code works once, for 10 minutes. Keep in <code className="font-mono">--with</code> what that PC should run: on the GTX 1070 <code className="font-mono">llm,video,voice</code>, on the GTX 1050 Ti <code className="font-mono">image</code> (generation needs the CUDA toolkit, git and cmake too).
            </p>
            <code className="block overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs whitespace-pre">{command}</code>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(command);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check /> : <Copy />} Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCode(null)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="worker-address">This computer’s address for the worker</Label>
            <div className="flex flex-wrap gap-2">
              <Input id="worker-address" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://laptop.tail1234.ts.net" className="min-w-0 flex-1 sm:max-w-sm" />
              <Button onClick={addWorker} disabled={busy || !server.trim()}>
                {busy ? <Spinner /> : <Plus />} Add a worker
              </Button>
              <Button variant="outline" onClick={runTest} disabled={test.running}>
                {test.running ? <Spinner /> : <Gauge />} Run a test
              </Button>
            </div>
            {test.result && <p className="text-xs text-muted-foreground">{test.result}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
