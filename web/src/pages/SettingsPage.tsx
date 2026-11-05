import { Bell, CheckCircle2, CircleAlert, FolderOpen, LogOut, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { CLAUDE_MODELS } from '@shared/types';
import { ConnectedSitesCard } from '@/components/ConnectedSites';
import { PageHeader } from '@/components/PageHeader';
import { ComputeCard } from '@/components/ComputeSettings';
import { FirebaseSetup, PairedDevices, PairPhone, ThisPhone } from '@/components/PhoneSettings';
import { PublishingCard } from '@/components/publish/PublishingSettings';
import { UsageMeter } from '@/components/UsageMeter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { api, errorMessage } from '@/lib/api';
import { desktop } from '@/lib/desktop';
import { isApp } from '@/lib/native';
import { currentSubscription, disablePush, enablePush, pushSupported } from '@/lib/push';
import { keys, queryClient, useAuth, useSettings, useSystemStatus, useWorkspaces } from '@/lib/queries';
import { WorkspaceDot } from '@/components/WorkspaceDot';
import { cn } from '@/lib/utils';

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />}
      <div>{children}</div>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return <code className="block overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs whitespace-pre">{children}</code>;
}

export function SettingsPage() {
  const settings = useSettings();
  const status = useSystemStatus();
  const s = settings.data;
  const st = status.data;
  const { hash } = useLocation();
  // Links like /settings#publishing land on that card.
  useEffect(() => {
    if (hash) setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }, [hash]);

  async function patch(body: Record<string, unknown>) {
    try {
      await api('/settings', { method: 'PATCH', body });
      queryClient.invalidateQueries({ queryKey: keys.settings });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (isApp)
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Settings" actions={<Button variant="ghost" onClick={() => history.back()}>Done</Button>} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-6 p-4">
            <ThisPhoneCard />
          </div>
        </div>
      </div>
    );

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
          <PagesCard />

          {desktop && <AppCard dataDir={st?.dataDir} />}

          <Card>
            <CardHeader>
              <CardTitle>Claude</CardTitle>
              <CardDescription>Runs on your Claude Pro subscription through this computer’s Claude Code login — no API key.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {st && (
                <Status ok={st.claudeLogin}>
                  {st.claudeLogin ? 'Signed in on this computer.' : 'Not signed in. Open a terminal, run `claude`, and use /login once.'}
                </Status>
              )}
              <div className="space-y-2">
                <Label>Default model</Label>
                <Select value={s?.defaultModel ?? 'opus'} onValueChange={(v) => patch({ defaultModel: v })}>
                  <SelectTrigger className="w-full sm:w-96">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLAUDE_MODELS.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label} · {m.hint}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <UsageMeter className="max-w-sm px-0" />
            </CardContent>
          </Card>

          <TranscriptionCard whisperModel={s?.whisperModel ?? 'small'} onModel={(v) => patch({ whisperModel: v })} />

          <RenderingCard />

          <ClipToolsCard />

          {!isApp && <ComputeCard />}

          <PublishingCard />

          <ConnectedSitesCard />

          <NotificationsCard pushDevices={st?.pushDevices ?? 0} vapidPublicKey={s?.vapidPublicKey} />

          <PhoneCard />

          {!desktop && <SignOutCard />}
        </div>
      </div>
    </div>
  );
}

function AppCard({ dataDir }: { dataDir?: string }) {
  const [login, setLogin] = useState<{ enabled: boolean; available: boolean } | null>(null);
  useEffect(() => {
    desktop?.getStartAtLogin().then(setLogin);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>App</CardTitle>
        <CardDescription>Closing the window keeps Content Studio running in the tray, so transcription, renders and scheduled posts keep going. Quit from the tray icon.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="login-item">Start when I log in</Label>
            <p className="text-xs text-muted-foreground">{login?.available === false ? 'Available in the installed app.' : 'Opens quietly in the tray.'}</p>
          </div>
          <Switch
            id="login-item"
            checked={!!login?.enabled}
            disabled={!login?.available}
            onCheckedChange={async (on) => {
              const enabled = await desktop!.setStartAtLogin(on);
              setLogin((l) => l && { ...l, enabled });
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" onClick={() => desktop?.openDataFolder()}>
            <FolderOpen /> Open data folder
          </Button>
          {dataDir && <span className="font-mono text-xs text-muted-foreground">{dataDir}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function TranscriptionCard({ whisperModel, onModel }: { whisperModel: string; onModel: (v: string) => void }) {
  const { data: st } = useSystemStatus();
  const installing = st?.whisperInstall.state === 'installing';

  async function install() {
    try {
      await api('/system/whisper/install', { body: {} });
      queryClient.invalidateQueries({ queryKey: keys.status });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transcription</CardTitle>
        <CardDescription>Whisper turns speech in your footage and voice memos into text, on this computer — nothing is uploaded.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {st &&
          (st.whisper ? (
            <Status ok>Speech-to-text is installed.</Status>
          ) : (
            <div className="space-y-3">
              <Status ok={false}>{st.python ? 'Speech-to-text isn’t installed yet (about 500 MB, one time).' : 'Python 3 is needed first — install it from the Software app.'}</Status>
              <Button size="sm" onClick={install} disabled={installing || !st.python}>
                {installing && <Spinner />} {installing ? 'Installing…' : 'Install speech-to-text'}
              </Button>
              {st.whisperInstall.state !== 'idle' && (
                <p className={st.whisperInstall.state === 'error' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{st.whisperInstall.message}</p>
              )}
            </div>
          ))}
        {st && <Status ok={st.ffmpeg}>{st.ffmpeg ? 'FFmpeg found.' : 'FFmpeg is missing — install it from the Software app to process video.'}</Status>}
        <div className="space-y-2">
          <Label>Accuracy</Label>
          <Select value={whisperModel} onValueChange={onModel}>
            <SelectTrigger className="w-full sm:w-96">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="base">Fast (base)</SelectItem>
              <SelectItem value="small">Balanced (small) — recommended</SelectItem>
              <SelectItem value="medium">Accurate (medium) — slow on this laptop</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">A new model downloads automatically the first time it’s used.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function RenderingCard() {
  const { data: st } = useSystemStatus();
  const installing = st?.rendererInstall.state === 'installing';

  async function install() {
    try {
      await api('/system/renderer/install', { body: {} });
      queryClient.invalidateQueries({ queryKey: keys.status });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Video rendering</CardTitle>
        <CardDescription>The video editor renders on this computer with HyperFrames (a headless Chrome draws each frame) and FFmpeg.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {st &&
          (st.renderer ? (
            <Status ok>The video renderer is installed.</Status>
          ) : (
            <div className="space-y-3">
              <Status ok={false}>The renderer downloads by itself on your first render (about 100 MB, once). You can get it now instead.</Status>
              <Button size="sm" onClick={install} disabled={installing}>
                {installing && <Spinner />} {installing ? 'Downloading…' : 'Download the renderer'}
              </Button>
              {st.rendererInstall.state !== 'idle' && <p className={st.rendererInstall.state === 'error' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{st.rendererInstall.message}</p>}
            </div>
          ))}
        {st && <Status ok={st.ffmpeg}>{st.ffmpeg ? 'FFmpeg found.' : 'FFmpeg is missing — install it from the Software app to edit video.'}</Status>}
      </CardContent>
    </Card>
  );
}

/** Demucs and YuNet for clipping: removing background music (the halal rule) and finding the speaker to reframe on. */
function ClipToolsCard() {
  const { data: st } = useSystemStatus();
  const settings = useSettings();
  const retention = settings.data?.sourceRetentionDays;
  const installing = st?.clipToolsInstall.state === 'installing';

  async function install() {
    try {
      await api('/system/clip-tools/install', { body: {} });
      queryClient.invalidateQueries({ queryKey: keys.status });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clip tools</CardTitle>
        <CardDescription>
          Demucs separates each clip’s voice from everything else, so background music is removed (or the clip is dropped); a face detector finds the speaker to frame on; and Kokoro
          speaks story, text-message and character videos. They run on this computer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {st &&
          (st.clipTools && st.tts ? (
            <Status ok>The clip tools are installed.</Status>
          ) : st.clipTools ? (
            <div className="space-y-3">
              <Status ok={false}>Installed, without the voices for format videos yet (about 120 MB more).</Status>
              <Button size="sm" onClick={install} disabled={installing}>
                {installing && <Spinner />} {installing ? 'Adding…' : 'Add the voices'}
              </Button>
              {st.clipToolsInstall.state !== 'idle' && (
                <p className={st.clipToolsInstall.state === 'error' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{st.clipToolsInstall.message}</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <Status ok={false}>{st.python ? 'Not installed yet (about 1.4 GB, one time). Clips and format videos can’t be made without them.' : 'Python 3 is needed first — install it from the Software app.'}</Status>
              <Button size="sm" onClick={install} disabled={installing || !st.python}>
                {installing && <Spinner />} {installing ? 'Installing…' : 'Install the clip tools'}
              </Button>
              {st.clipToolsInstall.state !== 'idle' && (
                <p className={st.clipToolsInstall.state === 'error' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{st.clipToolsInstall.message}</p>
              )}
            </div>
          ))}
        {retention !== undefined && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-0.5">
              <Label>Source videos of ended campaigns</Label>
              <p className="text-xs text-muted-foreground">Long downloads add up. Their transcripts, moments and clips stay, and a video can be downloaded again.</p>
            </div>
            <Select
              value={String(retention)}
              onValueChange={async (v) => {
                try {
                  await api('/settings', { method: 'PATCH', body: { sourceRetentionDays: Number(v) } });
                  queryClient.invalidateQueries({ queryKey: keys.settings });
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            >
              <SelectTrigger size="sm" className="w-auto" aria-label="When to delete them">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Delete after a day</SelectItem>
                <SelectItem value="7">Delete after a week</SelectItem>
                <SelectItem value="30">Delete after a month</SelectItem>
                <SelectItem value="0">Keep them</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NotificationsCard({ pushDevices, vapidPublicKey }: { pushDevices: number; vapidPublicKey?: string }) {
  const [pushOn, setPushOn] = useState(false);
  useEffect(() => {
    currentSubscription().then((sub) => setPushOn(!!sub));
  }, []);

  async function togglePush(on: boolean) {
    try {
      if (on) await enablePush(vapidPublicKey!);
      else await disablePush();
      setPushOn(on);
      queryClient.invalidateQueries({ queryKey: keys.status });
      if (on) toast.success('Notifications on for this device');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-4" /> Notifications
        </CardTitle>
        <CardDescription>When an idea has been captured, a render is done, or a post goes live, fails or misses its time.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {desktop ? (
          <p className="text-sm text-muted-foreground">On this computer they appear as desktop notifications while the window isn’t in front. For your phone, open Content Studio there and turn notifications on in its Settings.</p>
        ) : pushSupported() ? (
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="push">Notifications on this device</Label>
            <Switch id="push" checked={pushOn} onCheckedChange={togglePush} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">This browser doesn’t support push. On Android, install Content Studio from Chrome’s menu (“Add to Home screen”).</p>
        )}
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" disabled={!pushDevices} onClick={() => api('/push/test', { body: {} }).then(() => toast.success('Sent'))}>
            Send a test to phones
          </Button>
          <span className="text-xs text-muted-foreground">{pushDevices} phone(s) subscribed</span>
        </div>
        <Separator />
        <FirebaseSetup />
      </CardContent>
    </Card>
  );
}

function ThisPhoneCard() {
  return (
    <Card id="phone">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="size-4" /> This phone
        </CardTitle>
        <CardDescription>The app talks to Content Studio on your computer, which has to be running (with Tailscale Funnel on) for anything new to load.</CardDescription>
      </CardHeader>
      <CardContent>
        <ThisPhone />
      </CardContent>
    </Card>
  );
}

function PhoneCard() {
  const auth = useAuth();
  const hasPassword = auth.data ? !auth.data.setupRequired : true;
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pw.next !== pw.confirm) return toast.error('Passwords don’t match.');
    try {
      await api('/auth/password', { body: hasPassword ? { current: pw.current, next: pw.next } : { next: pw.next } });
      setPw({ current: '', next: '', confirm: '' });
      queryClient.invalidateQueries({ queryKey: keys.auth });
      toast.success(hasPassword ? 'Password changed' : 'Phone password set');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card id="phone">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="size-4" /> Phone access
        </CardTitle>
        <CardDescription>
          Use Content Studio from your Android phone. Tailscale Funnel gives this computer a private HTTPS address (free); publishing uses it too, for platform sign-ins and media uploads. The app must be running on this computer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <p className="text-sm font-medium">1. The address (one time)</p>
          <ol className="list-[lower-alpha] space-y-3 pl-5 text-sm">
            <li>
              Install Tailscale on this computer and sign in (in a terminal):
              <Code>{'curl -fsSL https://tailscale.com/install.sh | sh\nsudo tailscale up'}</Code>
            </li>
            <li>
              Publish Content Studio to your private address:
              <Code>sudo tailscale funnel --bg 8787</Code>
            </li>
          </ol>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium">2. The Android app</p>
          <p className="text-sm text-muted-foreground">
            Shares any file from other apps, uploads big videos in the background, records voice memos offline and gets notifications. Install it with{' '}
            <a href="https://obtainium.imranr.dev/" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">
              Obtainium
            </a>{' '}
            from{' '}
            {__APP_REPO__ ? (
              <a href={`${__APP_REPO__}/releases`} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">
                this project’s GitHub releases
              </a>
            ) : (
              'this project’s GitHub releases'
            )}{' '}
            (Obtainium keeps it updated), then pair it:
          </p>
          <PairPhone />
          <PairedDevices />
        </div>

        <Separator />

        <form onSubmit={save} className="space-y-3">
          <p className="text-sm font-medium">{hasPassword ? 'Change the password for the browser' : 'Or use it in Chrome: choose a password'}</p>
          <p className="text-sm text-muted-foreground">Open the https://…ts.net address on your phone, sign in with this password, then menu → “Add to Home screen”.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {hasPassword && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="pw-current">Current password</Label>
                <Input id="pw-current" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} className="sm:max-w-[calc(50%-0.375rem)]" />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="pw-next">New password</Label>
              <Input id="pw-next" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw-confirm">Confirm</Label>
              <Input id="pw-confirm" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" variant={hasPassword ? 'outline' : 'default'} disabled={pw.next.length < 10 || !pw.confirm || (hasPassword && !pw.current)}>
              {hasPassword ? 'Change password' : 'Set password'}
            </Button>
            <span className="text-xs text-muted-foreground">At least 10 characters.</span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SignOutCard() {
  const navigate = useNavigate();
  async function signOut() {
    await api('/auth/logout', { body: {} });
    queryClient.clear();
    navigate('/login');
  }
  return (
    <Card>
      <CardContent>
        <Button variant="ghost" onClick={signOut}>
          <LogOut /> Sign out
        </Button>
      </CardContent>
    </Card>
  );
}

/** My pages: open one's settings, show or hide it, add one. */
function PagesCard() {
  const pages = useWorkspaces();
  async function setHidden(id: string, hidden: boolean) {
    try {
      await api(`/workspaces/${id}`, { method: 'PATCH', body: { hidden } });
      void queryClient.invalidateQueries({ queryKey: keys.workspaces });
      void queryClient.invalidateQueries({ queryKey: keys.boardAll });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return (
    <Card id="pages">
      <CardHeader>
        <CardTitle>Pages</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {(pages.data ?? []).map((w) => (
          <div key={w.id} className="flex items-center gap-3 py-1.5">
            <WorkspaceDot color={w.color} />
            <Link to={`/settings/${w.id}`} className={cn('flex-1 text-[15px] hover:underline', w.hidden && 'text-muted-foreground')}>
              {w.name}
            </Link>
            <span className="text-sm text-muted-foreground">{w.hidden ? 'Hidden' : 'Shown'}</span>
            <Switch checked={!w.hidden} onCheckedChange={(on) => void setHidden(w.id, !on)} aria-label={`Show ${w.name}`} />
          </div>
        ))}
        <Button variant="ghost" className="mt-2 -ml-2" asChild>
          <Link to="/new">+ New page</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
