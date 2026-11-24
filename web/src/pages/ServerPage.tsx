// ai-server at a glance: up or not, Claude's login and usage, the GPU and tools, disk, and the phone.

import { useState } from 'react';
import { renderSVG } from 'uqr';
import { Button } from '@/components/ui/button';
import { api, serverUrl } from '@/lib/api';
import { ago, bytes } from '@/lib/format';
import { useDevices, useSystem } from '@/lib/queries';
import { cn } from '@/lib/utils';

export function ServerPage() {
  const sys = useSystem();
  const devices = useDevices();
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const s = sys.data;
  const five = s?.usage?.fiveHour;
  const row = (k: string, v: React.ReactNode, bad?: boolean) => (
    <div className="flex gap-4 px-4 py-2.5 text-sm">
      <span className="w-28 shrink-0 text-muted-foreground">{k}</span>
      <span className={cn('min-w-0 flex-1 break-words', bad && 'text-destructive')}>{v}</span>
    </div>
  );
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 md:px-8">
        <h1 className="text-xl font-semibold">Server</h1>
        <div className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
          {sys.isError ? (
            row('ai-server', 'Can’t be reached: is it on, and on Tailscale?', true)
          ) : (
            <>
              {row('ai-server', s ? `${s.host} · v${s.version} · ${s.gpu ?? 'no GPU found'}` : '…')}
              {row('Claude', s ? `${s.claude.detail}${five ? ` · ${Math.round(five.utilization * 100)} % of the 5-hour limit` : ''}` : '…', s ? !s.claude.loggedIn || (five?.utilization ?? 0) >= 0.8 : false)}
              {row('Claude’s reach', 'Full shell on ai-server, no prompts. Never Open WebUI, Docker, Ollama, systemd or the network; no deletes outside the video’s folder; never posts.')}
              {row('Studio', s ? `${s.studioDir}${s.diskFree != null ? ` · ${bytes(s.diskFree)} free` : ''}` : '…', s?.diskFree != null && s.diskFree < 20 * 1024 ** 3)}
              {row('Tools', s ? s.tools.map((t) => `${t.name} ${t.ok ? '✓' : 'missing'}`).join(' · ') : '…', s?.tools.some((t) => !t.ok))}
            </>
          )}
        </div>
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Phone</h2>
          <div className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
            {(devices.data ?? []).map((d) => row(d.name, `paired ${ago(d.created_at)}${d.last_seen_at ? ` · seen ${ago(d.last_seen_at)}` : ''}`))}
            <div className="flex flex-col gap-3 px-4 py-3 text-sm">
              {code ? (
                <div className="flex items-center gap-4">
                  <div className="size-36 shrink-0 rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: renderSVG(`${serverUrl()}#${code.code}`) }} />
                  <div className="text-muted-foreground">
                    Scan it in the phone app, or type <span className="font-mono text-foreground">{code.code}</span>. It works once, for 10 minutes.
                  </div>
                </div>
              ) : (
                <Button variant="outline" className="self-start" onClick={async () => setCode(await api('/api/pair/code', { body: {} }))}>
                  Pair a phone
                </Button>
              )}
              <p className="text-xs text-muted-foreground">On the tailnet the app needs no pairing; it’s for the phone app’s background uploads.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
