import { CheckCircle2, CircleAlert, Copy, ExternalLink, Search, Send, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ACTIVE_PLATFORMS, CATCH_UP_CHOICES, type PublishPlatform } from '@shared/publish';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, usePublishingSetup } from '@/lib/queries';
import type { PublishingSetup } from '@/lib/types';
import { PlatformIcon, platformLabel } from './common';

const GUIDES: Record<PublishPlatform, { console: string; idLabel: string; secretLabel: string; configLabel?: string; steps: React.ReactNode[] }> = {
  tiktok: {
    console: 'https://developers.tiktok.com/apps',
    idLabel: 'Client key',
    secretLabel: 'Client secret',
    steps: [
      'On developers.tiktok.com, create an app (Web).',
      'Add the Login Kit, Content Posting API and Display API products; in Content Posting, turn on Direct Post.',
      'Scopes: user.info.basic, video.upload, video.publish, plus video.list and user.info.stats for analytics.',
      'Login Kit → Redirect URI: the address below.',
      'For photo posts, add a URL prefix property for your public address + /api/public/ and upload TikTok’s verification file below.',
      'Posts stay private (or go to your inbox) until TikTok audits the app — the audit needs a screen recording of this app posting.',
    ],
  },
  instagram: {
    console: 'https://developers.facebook.com/apps',
    idLabel: 'App ID',
    secretLabel: 'App secret',
    configLabel: 'Configuration ID',
    steps: [
      'Your Instagram accounts must be Business or Creator accounts.',
      'On developers.facebook.com, create an app with the use case “Manage messaging & content on Instagram” and connect your business portfolio.',
      'Use cases → Customize → API setup with Unified login → Create new configuration. Edit permissions: instagram_basic, instagram_content_publish and instagram_manage_insights (analytics); the ads ones can go. Token expiry: Never.',
      'Under Redirect URL there, and in Facebook Login for Business → Settings → Valid OAuth Redirect URIs: the address below.',
      'Copy the App ID and secret from App settings → Basic, and the configuration’s ID from Facebook Login for Business → Configurations.',
      'Make each Instagram account a tester: Unified login → Generate access tokens → Add account; then on instagram.com, signed in as that account, Settings → Website permissions → Apps and websites → Tester invites → Accept.',
      'Connect from a workspace’s Accounts page and pick the Instagram account for it in Meta’s window. If Meta doesn’t pass on which one, Content Studio asks for its ID (the number under its name in Generate access tokens). Leave the app unpublished: it works for your own accounts.',
    ],
  },
  youtube: {
    console: 'https://console.cloud.google.com/apis/credentials',
    idLabel: 'Client ID',
    secretLabel: 'Client secret',
    steps: [
      'In Google Cloud, create a project and enable the YouTube Data API v3 and the YouTube Analytics API (watch time and shares).',
      'OAuth consent screen: External, add yourself as a test user, then Publish app (“In production”) — otherwise sign-ins expire after 7 days.',
      'Credentials → Create OAuth client ID → Web application → Authorised redirect URI: the address below.',
      'Uploads are private until Google approves the YouTube API audit form.',
    ],
  },
};

export function PublishingCard() {
  const setup = usePublishingSetup();
  const s = setup.data;
  return (
    <Card id="publishing">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="size-4" /> Publishing
        </CardTitle>
        <CardDescription>
          Posts go out through each platform’s official API, from this computer, using developer apps you register once. Accounts are connected per workspace, on its Accounts page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {s ? (
          <>
            <PublicAddress setup={s} />
            {ACTIVE_PLATFORMS.map((p) => (
              <PlatformApp key={p} platform={p} setup={s} />
            ))}
            <CatchUp setup={s} />
          </>
        ) : (
          <Spinner className="text-muted-foreground" />
        )}
      </CardContent>
    </Card>
  );
}

async function save(path: string, body: unknown, method = 'PUT') {
  const next = await api<PublishingSetup>(path, { method, body });
  queryClient.setQueryData(keys.publishingSetup, next);
  return next;
}

function PublicAddress({ setup }: { setup: PublishingSetup }) {
  const [url, setUrl] = useState(setup.publicUrl ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => setUrl(setup.publicUrl ?? ''), [setup.publicUrl]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-2">
      <Label htmlFor="public-url">Public address</Label>
      <p className="text-xs text-muted-foreground">
        Your Tailscale Funnel address (see Phone access below). Platforms send you back here after signing in, and Instagram and TikTok download photos and videos from short-lived links on it.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input id="public-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://laptop.tail1234.ts.net" className="min-w-0 flex-1 sm:max-w-sm" />
        <Button
          variant="outline"
          disabled={!!busy}
          onClick={() =>
            run('detect', async () => {
              const { url: found } = await api<{ url: string | null }>('/publishing/detect-url', { body: {} });
              if (found) setUrl(found);
              else toast.error('Tailscale isn’t installed or signed in on this computer.');
            })
          }
        >
          {busy === 'detect' ? <Spinner /> : <Search />} Detect
        </Button>
        <Button
          disabled={!!busy || url.trim() === (setup.publicUrl ?? '')}
          onClick={() =>
            run('save', async () => {
              await save('/publishing/setup', { publicUrl: url.trim() }, 'PATCH');
              setResult(null);
              toast.success(url.trim() ? 'Public address saved' : 'Public address removed');
            })
          }
        >
          Save
        </Button>
        <Button
          variant="ghost"
          disabled={!!busy || !setup.publicUrl}
          onClick={() =>
            run('check', async () => {
              setResult(await api<{ ok: boolean; message: string }>('/publishing/check-url', { body: {} }));
            })
          }
        >
          {busy === 'check' && <Spinner />} Check it works
        </Button>
      </div>
      {result && (
        <p className={result.ok ? 'flex items-center gap-1.5 text-xs text-emerald-400' : 'flex items-center gap-1.5 text-xs text-destructive'}>
          {result.ok ? <CheckCircle2 className="size-3.5" /> : <CircleAlert className="size-3.5" />} {result.message}
        </p>
      )}
    </section>
  );
}

function PlatformApp({ platform, setup }: { platform: PublishPlatform; setup: PublishingSetup }) {
  const info = setup.platforms[platform];
  const guide = GUIDES[platform];
  const [clientId, setClientId] = useState(info.clientId);
  const [configId, setConfigId] = useState(info.configId);
  const [secret, setSecret] = useState('');
  const [open, setOpen] = useState(!info.configured);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => setClientId(info.clientId), [info.clientId]);
  useEffect(() => setConfigId(info.configId), [info.configId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await save(`/publishing/apps/${platform}`, { clientId: clientId.trim(), clientSecret: secret.trim() || undefined, configId: configId.trim() || undefined });
      setSecret('');
      setOpen(false);
      toast.success(`${platformLabel(platform)} app saved`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function uploadVerification(f: File) {
    try {
      await save('/publishing/tiktok-verification', { name: f.name, content: (await f.text()).trim() });
      toast.success('Verification file is live', { description: 'Now press Verify in the TikTok developer portal.' });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <section className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <PlatformIcon platform={platform} />
        <span className="text-sm font-medium">{platformLabel(platform)}</span>
        {info.configured ? <CheckCircle2 className="size-4 text-emerald-400" aria-label="Set up" /> : <span className="text-xs text-muted-foreground">not set up</span>}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setOpen(!open)}>
          {open ? 'Close' : info.configured ? 'Change' : 'Set up'}
        </Button>
      </div>
      {open && (
        <div className="space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
            {guide.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <Button size="sm" variant="outline" asChild>
            <a href={guide.console} target="_blank" rel="noreferrer">
              <ExternalLink /> Open the developer console
            </a>
          </Button>
          <div className="space-y-1.5">
            <Label className="text-xs">Redirect URI to register</Label>
            {info.redirectUri ? (
              <div className="flex gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted px-3 py-1.5 font-mono text-xs whitespace-nowrap">{info.redirectUri}</code>
                <Button size="icon-sm" variant="ghost" aria-label="Copy" onClick={() => navigator.clipboard.writeText(info.redirectUri!).then(() => toast.success('Copied'))}>
                  <Copy />
                </Button>
              </div>
            ) : (
              <p className="text-xs text-amber-300/90">Set the public address above first — {platformLabel(platform)} only sends sign-ins back over HTTPS.</p>
            )}
          </div>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${platform}-id`} className="text-xs">
                {guide.idLabel}
              </Label>
              <Input id={`${platform}-id`} value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${platform}-secret`} className="text-xs">
                {guide.secretLabel}
              </Label>
              <Input id={`${platform}-secret`} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={info.hasSecret ? 'Saved — type to replace' : ''} autoComplete="off" />
            </div>
            {guide.configLabel && (
              <div className="space-y-1.5">
                <Label htmlFor={`${platform}-config`} className="text-xs">
                  {guide.configLabel}
                </Label>
                <Input id={`${platform}-config`} value={configId} onChange={(e) => setConfigId(e.target.value)} autoComplete="off" />
              </div>
            )}
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={busy || !clientId.trim() || (!secret.trim() && !info.hasSecret) || (!!guide.configLabel && !configId.trim())}>
                {busy && <Spinner />} Save
              </Button>
              {info.configured && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    save(`/publishing/apps/${platform}`, undefined, 'DELETE')
                      .then(() => toast.success('Removed'))
                      .catch((err) => toast.error(errorMessage(err)))
                  }
                >
                  Remove
                </Button>
              )}
            </div>
          </form>
          {platform === 'tiktok' && (
            <div className="space-y-1.5">
              <Label className="text-xs">URL-prefix verification file (for photo posts)</Label>
              <div className="flex flex-wrap items-center gap-2">
                <input ref={file} type="file" accept=".txt,text/plain" className="hidden" onChange={(e) => e.target.files?.[0] && uploadVerification(e.target.files[0])} />
                <Button size="sm" variant="outline" onClick={() => file.current?.click()}>
                  <Upload /> {setup.tiktokVerification ? 'Replace file' : 'Upload TikTok’s file'}
                </Button>
                {setup.tiktokVerification && setup.publicUrl && <code className="font-mono text-xs text-muted-foreground">{`${setup.publicUrl}/api/public/${setup.tiktokVerification}`}</code>}
              </div>
              <p className="text-xs text-muted-foreground">In TikTok’s portal verify the prefix {setup.publicUrl ? <code className="font-mono">{setup.publicUrl}/api/public/</code> : 'your public address + /api/public/'}.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CatchUp({ setup }: { setup: PublishingSetup }) {
  return (
    <section className="space-y-2">
      <Label>Post late if this computer was asleep or off at the time?</Label>
      <Select
        value={String(setup.catchUpHours)}
        onValueChange={(v) =>
          save('/publishing/setup', { catchUpHours: Number(v) }, 'PATCH')
            .then(() => toast.success('Saved'))
            .catch((err) => toast.error(errorMessage(err)))
        }
      >
        <SelectTrigger className="w-full sm:w-96">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CATCH_UP_CHOICES.map((c) => (
            <SelectItem key={c.hours} value={String(c.hours)}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">Otherwise you get a notification to post it now or pick a new time. Content Studio keeps the computer from sleeping just before a post is due (closing the lid still suspends it — see the README).</p>
    </section>
  );
}
