import { Bell, Check, Copy, FileUp, QrCode, Smartphone, Unlink } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { encode } from 'uqr';
import type { Pairing } from '@shared/devices';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { api, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { compatibility, disablePush, isNative, lockEnabled, pairing, pushState, Studio, syncPush, unpair } from '@/lib/native';
import { keys, queryClient, useDevices, useFcm } from '@/lib/queries';
import { useStore } from '@/lib/ui-state';

const ANDROID_APP_ID = 'io.github.adambench.contentstudio';

function QrImage({ value, size = 208 }: { value: string; size?: number }) {
  const qr = useMemo(() => encode(value, { ecc: 'M', border: 2 }), [value]);
  const path = useMemo(() => qr.data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x},${y}h1v1h-1z`] : []))).join(''), [qr]);
  return (
    <svg viewBox={`0 0 ${qr.size} ${qr.size}`} width={size} height={size} shapeRendering="crispEdges" className="rounded-lg bg-white" role="img" aria-label="Pairing QR code">
      <path d={path} fill="#09090b" />
    </svg>
  );
}

function useCountdown(until: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return until ? Math.max(0, until - now) : 0;
}

/** Desktop: show a one-time QR code the Android app scans to pair. */
export function PairPhone() {
  const devices = useDevices();
  const [server, setServer] = useState('');
  const [code, setCode] = useState<Pairing | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const left = useCountdown(code?.expiresAt ?? null);
  const known = useRef<Set<string> | null>(null);

  useEffect(() => {
    api<{ url: string | null }>('/devices/address')
      .then(({ url }) => url && setServer((s) => s || url))
      .catch(() => {});
  }, []);

  // A device that wasn't there when the code was shown means it worked.
  useEffect(() => {
    if (!code || !devices.data) return;
    if (!known.current) known.current = new Set(devices.data.map((d) => d.id));
    const added = devices.data.find((d) => !known.current!.has(d.id));
    if (added) {
      toast.success(`Paired with ${added.name}`);
      setCode(null);
      known.current = null;
    }
  }, [devices.data, code]);

  async function show() {
    setBusy(true);
    try {
      known.current = new Set((devices.data ?? []).map((d) => d.id));
      setCode(await api<Pairing>('/devices/pairing', { body: { server } }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setCode(null);
    known.current = null;
    await api('/devices/pairing', { method: 'DELETE' }).catch(() => {});
  }

  if (code && left > 0)
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:gap-5">
        <QrImage value={code.link} />
        <div className="min-w-0 flex-1 space-y-3 text-sm">
          <p>In the Content Studio app on your phone, tap <span className="font-medium">Scan the QR code</span>.</p>
          <p className="text-muted-foreground">
            Code <span className="font-mono text-foreground">{code.code}</span> · works once, for {Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(code.link);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check /> : <Copy />} Copy link
            </Button>
            <Button size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Can’t scan? Send yourself the link and paste it into the app.</p>
        </div>
      </div>
    );

  return (
    <div className="space-y-2">
      <Label htmlFor="pair-address">This computer’s address for the phone</Label>
      <div className="flex flex-wrap gap-2">
        <Input id="pair-address" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://laptop.tail1234.ts.net" className="min-w-0 flex-1 sm:max-w-sm" />
        <Button onClick={show} disabled={busy || !server.trim()}>
          {busy ? <Spinner /> : <QrCode />} {code ? 'Show a new code' : 'Pair a phone'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {code ? 'That code expired.' : 'The Tailscale Funnel address from step 1. If the phone runs Tailscale too, its tailnet address works the same.'}
      </p>
    </div>
  );
}

/** Desktop: the phones paired with this computer, each can be unpaired. */
export function PairedDevices() {
  const devices = useDevices();
  if (!devices.data?.length) return null;

  async function remove(id: string) {
    try {
      await api(`/devices/${id}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: keys.devices });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <ul className="divide-y rounded-lg border">
      {devices.data.map((d) => (
        <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
          <Smartphone className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-sm">
              {d.name}
              {d.push && <Bell className="size-3 text-muted-foreground" aria-label="Gets notifications" />}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              Paired {timeAgo(d.createdAt)}
              {d.lastSeenAt ? ` · last used ${timeAgo(d.lastSeenAt)}` : ''}
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost">
                <Unlink /> Unpair
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Unpair {d.name}?</AlertDialogTitle>
                <AlertDialogDescription>It’s signed out at once and stops getting notifications. Uploads still waiting on it won’t arrive until it’s paired again.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => remove(d.id)}>
                  Unpair
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </li>
      ))}
    </ul>
  );
}

function JsonFileField({ id, label, hint, onText }: { id: string; label: string; hint: string; onText: (text: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          ref={ref}
          id={id}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setName(file.name);
            onText(await file.text());
          }}
        />
        <Button size="sm" variant="outline" onClick={() => ref.current?.click()}>
          <FileUp /> Choose file
        </Button>
        <span className="truncate text-xs text-muted-foreground">{name || hint}</span>
      </div>
    </div>
  );
}

/** Desktop: Firebase, so notifications reach the Android app. */
export function FirebaseSetup() {
  const fcm = useFcm();
  const [files, setFiles] = useState<{ googleServices?: string; serviceAccount?: string }>({});
  const [busy, setBusy] = useState(false);
  const f = fcm.data;
  const ready = !!f?.serviceAccount && !!f?.app;

  async function save() {
    setBusy(true);
    try {
      await api('/push/fcm', { method: 'PUT', body: files });
      setFiles({});
      queryClient.invalidateQueries({ queryKey: keys.fcm });
      toast.success('Firebase saved', { description: 'Phones turn notifications on in the app’s Settings.' });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Android app</p>
      {ready ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="mr-auto">
            Firebase project <span className="font-mono">{f.projectId}</span> is set up.
          </span>
          <Button size="sm" variant="ghost" onClick={() => api('/push/fcm', { method: 'DELETE' }).then(() => queryClient.invalidateQueries({ queryKey: keys.fcm }))}>
            Remove
          </Button>
        </div>
      ) : (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              In the{' '}
              <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">
                Firebase console
              </a>
              , create a project (free; Analytics not needed).
            </li>
            <li>
              Add an Android app with the package name <span className="font-mono text-foreground">{ANDROID_APP_ID}</span> and download its google-services.json.
            </li>
            <li>Project settings → Service accounts → Generate new private key.</li>
          </ol>
          <div className="grid gap-3 sm:grid-cols-2">
            <JsonFileField id="fcm-app" label="google-services.json" hint={f?.app ? 'Saved' : 'Not added'} onText={(googleServices) => setFiles((x) => ({ ...x, googleServices }))} />
            <JsonFileField id="fcm-key" label="Private key (.json)" hint={f?.serviceAccount ? 'Saved' : 'Not added'} onText={(serviceAccount) => setFiles((x) => ({ ...x, serviceAccount }))} />
          </div>
          <Button size="sm" onClick={save} disabled={busy || (!files.googleServices && !files.serviceAccount)}>
            {busy && <Spinner />} Save
          </Button>
        </>
      )}
    </div>
  );
}

/** In the Android app: what it's paired with, notifications, the lock, unpairing. */
export function ThisPhone() {
  const paired = useStore(pairing);
  const push = useStore(pushState);
  const compat = useStore(compatibility);
  const lock = useStore(lockEnabled);
  const [canLock, setCanLock] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Studio.canLock().then((r) => setCanLock(r.available), () => {});
    if (push === 'checking') void syncPush({ ask: false });
  }, []);

  async function togglePush(on: boolean) {
    setBusy(true);
    try {
      if (!on) await disablePush();
      else {
        const state = await syncPush({ ask: true });
        if (state === 'denied') toast.error('Notifications are blocked', { description: 'Allow them for Content Studio in Android’s settings.' });
      }
      queryClient.invalidateQueries({ queryKey: keys.status });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleLock(on: boolean) {
    if (on) {
      const { ok } = await Studio.unlock({ title: 'Turn on the lock', subtitle: 'Confirm it’s you' }).catch(() => ({ ok: false }));
      if (!ok) return;
    }
    lockEnabled.set(on);
  }

  const pushHint: Partial<Record<typeof push, string>> = {
    unavailable: 'Set up Firebase on your computer first: Settings → Notifications there.',
    denied: 'Blocked in Android’s settings for Content Studio.',
    restart: 'Close and reopen the app to finish turning them on.',
    failed: 'Firebase didn’t accept this app. Check the two Firebase files in Settings → Notifications on your computer.',
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1 text-sm">
        <p>
          Paired with <span className="font-mono">{paired?.server.replace(/^https?:\/\//, '')}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          App {__APP_VERSION__}
          {compat.server && ` · Content Studio ${compat.server.version} on the computer`}
        </p>
      </div>
      {isNative && (
        <>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="app-push">Notifications</Label>
              <p className="text-xs text-muted-foreground">{pushHint[push] ?? 'Posts going live or failing, finished renders, captured ideas.'}</p>
            </div>
            <Switch id="app-push" checked={push === 'on'} disabled={busy || push === 'unavailable' || push === 'checking'} onCheckedChange={togglePush} />
          </div>
          {push === 'denied' && (
            <Button size="sm" variant="outline" onClick={() => void Studio.openAppSettings()}>
              Open Android settings
            </Button>
          )}
          {canLock && (
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="app-lock">Lock with fingerprint</Label>
                <p className="text-xs text-muted-foreground">Asks again after the app has been in the background for a minute.</p>
              </div>
              <Switch id="app-lock" checked={lock} onCheckedChange={toggleLock} />
            </div>
          )}
        </>
      )}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Unlink /> Unpair this phone
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unpair this phone?</AlertDialogTitle>
            <AlertDialogDescription>You’ll need a new QR code from your computer to use the app again. Uploads still waiting on this phone are sent after you pair again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void unpair()}>
              Unpair
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
