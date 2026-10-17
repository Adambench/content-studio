import { RefreshCw, Server } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AI_MODE_LABELS, AI_TASK_INFO, AI_TASKS, RECOMMENDED_LOCAL_MODEL, type AiMode } from '@shared/ai';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useAiSettings } from '@/lib/queries';

const SHARES = [0.5, 0.7, 0.8, 0.9, 0.95, 1];
const CONTEXTS = [8192, 16384, 32768, 65536, 131072];
const AUTO_MODEL = '__auto';

/** Settings → Models: Claude or the self-hosted model, per task, and the model server on the home PC. */
export function ModelsCard() {
  const ai = useAiSettings();
  const d = ai.data;
  const [url, setUrl] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    if (d) setUrl(d.local.url);
  }, [d?.local.url]);

  async function patch(body: Record<string, unknown>) {
    try {
      await api('/ai', { method: 'PATCH', body });
      queryClient.invalidateQueries({ queryKey: keys.ai });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      queryClient.setQueryData(keys.ai, await api('/ai?fresh=1'));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }

  if (!d) return null;
  const st = d.status;
  const limited = d.claudeLimitedUntil && d.claudeLimitedUntil > Date.now() ? d.claudeLimitedUntil : null;
  const pct = (v: number) => `${Math.round(v * 100)} %`;

  return (
    <Card id="models">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="size-4" /> Models
        </CardTitle>
        <CardDescription>
          Claude, or your own model on the home server (Ollama), for each job. On Auto a job stays on Claude while its usage has room and moves to your model when it runs low or Claude says no.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="local-only">Local only</Label>
            <p className="text-xs text-muted-foreground">Everything on your model, nothing on Claude.</p>
          </div>
          <Switch id="local-only" checked={d.routing.localOnly} onCheckedChange={(v) => patch({ routing: { localOnly: v } })} />
        </div>

        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <span className={`size-2 shrink-0 rounded-full ${st.reachable && st.model ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <p className="min-w-0 flex-1 truncate text-sm">
              {st.reachable ? (st.model ? `Ready: ${st.model}` : 'Reachable, no model yet') : 'Not reachable'}
              {st.url && <span className="text-muted-foreground"> · {st.source === 'worker' ? `on ${st.worker}` : st.url}</span>}
            </p>
            <Button size="icon-sm" variant="ghost" aria-label="Check again" onClick={refresh} disabled={refreshing}>
              {refreshing ? <Spinner /> : <RefreshCw />}
            </Button>
          </div>
          {st.error && <p className="text-xs text-amber-400">{st.error}</p>}
          {!st.url && (
            <p className="text-xs text-muted-foreground">
              Set up the 1070 PC with <code className="font-mono">scripts/setup-worker.sh --with llm …</code> (Compute below): the laptop finds its model server by itself. Or enter an address.
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="local-url">Server address</Label>
            <Input
              id="local-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => url !== d.local.url && patch({ local: { url } })}
              placeholder="From the worker (or http://pc:11434)"
            />
          </div>
          <div className="space-y-2">
            <Label>Model</Label>
            <Select value={d.local.model || AUTO_MODEL} onValueChange={(v) => patch({ local: { model: v === AUTO_MODEL ? '' : v } })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO_MODEL}>The server’s first model with tools</SelectItem>
                {st.models.map((m) => (
                  <SelectItem key={m.name} value={m.name}>
                    {m.name} · {m.sizeGb} GB{m.vision ? ' · sees pictures' : ''}{m.tools ? '' : ' · no tools'}
                  </SelectItem>
                ))}
                {d.local.model && !st.models.some((m) => m.name === d.local.model) && <SelectItem value={d.local.model}>{d.local.model} (not on the server)</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Context window</Label>
            <Select value={String(d.local.contextTokens)} onValueChange={(v) => patch({ local: { contextTokens: Number(v) } })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTEXTS.map((c) => (
                  <SelectItem key={c} value={String(c)}>
                    {c / 1024}k tokens{c === 32768 ? ' (recommended)' : c > 32768 ? ' (needs more memory)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="self-end text-xs text-muted-foreground">
            Recommended: <code className="font-mono">{RECOMMENDED_LOCAL_MODEL}</code>. It handles text, pictures and the studio tools in one, so nothing reloads between jobs.
          </p>
        </div>

        <Separator />

        <div className="grid gap-4 sm:grid-cols-2">
          <ShareSelect label="Auto switches at weekly usage" value={d.routing.weeklyAt} onChange={(weeklyAt) => patch({ routing: { weeklyAt } })} pct={pct} />
          <ShareSelect label="…or at 5-hour usage" value={d.routing.fiveHourAt} onChange={(fiveHourAt) => patch({ routing: { fiveHourAt } })} pct={pct} />
        </div>
        {limited && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-amber-400">
            Claude refused for usage: Auto skips it until {new Date(limited).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
            <Button size="sm" variant="outline" onClick={() => patch({ clearClaudeLimit: true })}>
              Try Claude again
            </Button>
          </div>
        )}

        <ul className="divide-y rounded-lg border">
          {AI_TASKS.map((t) => (
            <li key={t} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
              <div className="min-w-0 flex-1 basis-48">
                <p className="text-sm">{AI_TASK_INFO[t].label}</p>
                <p className="text-xs text-muted-foreground">{AI_TASK_INFO[t].hint}</p>
              </div>
              <Badge variant="outline" className="text-[11px]" title={d.now[t].reason}>
                Now: {d.now[t].provider === 'local' ? 'Local' : 'Claude'}
              </Badge>
              <Select value={d.routing.tasks[t]} onValueChange={(v) => patch({ routing: { tasks: { [t]: v as AiMode } } })} disabled={d.routing.localOnly}>
                <SelectTrigger size="sm" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(AI_MODE_LABELS) as AiMode[]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {AI_MODE_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          ))}
        </ul>

        <Separator />

        <div className="space-y-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Generated pictures and clips</p>
            <p className="text-xs text-muted-foreground">
              Made on a home PC (FLUX for pictures, Wan for ~5 s clips), never showing people or animals: each one is checked and made again if one shows up.{' '}
              {d.generators.length
                ? `Online: ${d.generators.map((g) => `${g.name} (${[g.image && 'pictures', g.video && 'clips'].filter(Boolean).join(', ')})`).join('; ')}.`
                : 'No home PC with them is online: set one up with scripts/setup-worker.sh --with image,video.'}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <HourSelect label="Clips are made from" value={d.generation.videoFrom} onChange={(videoFrom) => patch({ generation: { videoFrom } })} />
            <HourSelect label="…until" value={d.generation.videoTo} onChange={(videoTo) => patch({ generation: { videoTo } })} />
          </div>
          <p className="text-xs text-muted-foreground">A clip takes 20–60 minutes on the GTX 1070 and needs the card to itself, so clips wait for these hours; pictures are made any time.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function HourSelect({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: 24 }, (_, h) => (
            <SelectItem key={h} value={String(h)}>
              {String(h).padStart(2, '0')}:00
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ShareSelect({ label, value, onChange, pct }: { label: string; value: number; onChange: (v: number) => void; pct: (v: number) => string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[...new Set([...SHARES, value])].sort((a, b) => a - b).map((s) => (
            <SelectItem key={s} value={String(s)}>
              {s >= 1 ? 'Only when Claude refuses' : pct(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
