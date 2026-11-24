import { useState } from 'react';
import { renderSVG } from 'uqr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, isApp, serverUrl } from '@/lib/api';
import { ago } from '@/lib/format';
import { pairWith, Studio } from '@/lib/native';
import { keys, queryClient, useDevices, useSystem } from '@/lib/queries';

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-2 text-sm last:border-none">
      <span className="text-muted-foreground">{label}</span>
      <span className={ok === false ? 'text-destructive' : ''}>{value}</span>
    </div>
  );
}

/** On the laptop: a code (and its QR) for the phone. */
function PairPhone() {
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const devices = useDevices().data ?? [];
  const show = async () => setCode(await api<{ code: string; expiresAt: number }>('/api/pair/code', { body: {} }));
  const forget = async (id: string) => {
    await api(`/api/devices/${id}`, { method: 'DELETE' });
    await queryClient.invalidateQueries({ queryKey: keys.devices });
  };
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Phone</h2>
      {code ? (
        <div className="flex items-center gap-5">
          <div className="size-36 rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: renderSVG(`${serverUrl()}#${code.code}`) }} />
          <div className="text-sm">
            <div className="font-mono text-lg tracking-widest">{code.code}</div>
            <div className="text-muted-foreground">Scan it in the app. 10 minutes.</div>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => void show()}>
          Pair a phone
        </Button>
      )}
      {devices.map((d) => (
        <div key={d.id} className="flex items-center justify-between text-sm">
          <span>
            {d.name} <span className="text-muted-foreground">· {d.last_seen_at ? `seen ${ago(d.last_seen_at)}` : 'never seen'}</span>
          </span>
          <Button variant="ghost" size="xs" onClick={() => void forget(d.id)}>
            Forget
          </Button>
        </div>
      ))}
    </section>
  );
}

/** In the app: pair with the code the laptop shows. */
function PairHere() {
  const [server, setServer] = useState(serverUrl().startsWith('https://localhost') ? 'https://ai-server.tail1e2ac8.ts.net:8443' : serverUrl());
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const scan = async () => {
    const { text } = await Studio!.scanQrCode();
    const [s, c] = (text ?? '').split('#');
    if (s && c) await done(s, c);
  };
  const done = async (s: string, c: string) => {
    try {
      await pairWith(s, c);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Pair with the server</h2>
      <Button onClick={() => void scan()}>Scan the code</Button>
      <Input value={server} onChange={(e) => setServer(e.target.value)} />
      <Input placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} />
      <Button variant="secondary" onClick={() => void done(server, code)}>
        Pair
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

export function SettingsPage() {
  const system = useSystem().data;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-8 p-4 md:p-8">
        {isApp && <PairHere />}
        <section>
          <h2 className="mb-2 text-sm font-medium">Server</h2>
          {system ? (
            <div>
              <Row label="Address" value={serverUrl()} />
              <Row label="Machine" value={`${system.host}${system.gpu ? ` · ${system.gpu}` : ''}`} />
              <Row label="Version" value={system.version} />
              <Row label="Claude" value={system.claude.detail} ok={system.claude.loggedIn} />
              {system.usage?.fiveHour && <Row label="5-hour usage" value={`${Math.round(system.usage.fiveHour.utilization * 100)} %`} />}
              {system.tools.map((t) => (
                <Row key={t.name} label={t.name} value={t.ok ? 'ready' : 'missing'} ok={t.ok} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not connected.</p>
          )}
        </section>
        {!isApp && <PairPhone />}
        <p className="text-xs text-muted-foreground">Content Studio {__APP_VERSION__}</p>
      </div>
    </div>
  );
}
