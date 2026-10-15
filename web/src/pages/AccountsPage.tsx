import { Plus, RefreshCw, Settings, Unplug, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { PUBLISH_PLATFORMS, type PublishPlatform, type QueueSlot } from '@shared/publish';
import { PageHeader } from '@/components/PageHeader';
import { AccountAvatar, accountName, DAY_NAMES, firstDayOfWeek, PlatformIcon, platformLabel } from '@/components/publish/common';
import { useWorkspaceContext } from '@/components/WorkspaceLayout';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { desktop } from '@/lib/desktop';
import { isApp, openExternal } from '@/lib/native';
import { keys, queryClient, useAccounts, usePublishingSetup } from '@/lib/queries';
import type { Account } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Open a platform's sign-in page: the system browser on the desktop app and in the Android app, a new tab on the phone. */
async function signIn(path: string, body: unknown) {
  const { url } = await api<{ url: string }>(path, { body });
  if (isApp) {
    await openExternal(url);
    return void toast('Finish signing in in your browser', { description: 'This page updates by itself when it’s done.' });
  }
  // The desktop app hands new windows to the system browser (and returns no window).
  const tab = window.open(url, '_blank');
  if (tab) tab.opener = null;
  else if (!desktop) window.location.href = url;
  toast(desktop ? 'Finish signing in in your browser' : 'Finish signing in in the new tab', { description: 'This page updates by itself when it’s done.' });
}

export function AccountsPage() {
  const { workspace } = useWorkspaceContext();
  const accounts = useAccounts(workspace.id);
  const setup = usePublishingSetup();
  const [busy, setBusy] = useState<PublishPlatform | null>(null);
  const configured = PUBLISH_PLATFORMS.filter((p) => setup.data?.platforms[p].configured);

  async function connect(platform: PublishPlatform) {
    setBusy(platform);
    try {
      await signIn(`/workspaces/${workspace.id}/accounts/connect`, { platform });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Accounts" description={`Where ${workspace.name} posts, and when`} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
          {setup.data && configured.length < PUBLISH_PLATFORMS.length && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand/30 bg-brand-soft px-4 py-3 text-sm">
              <span className="mr-auto">
                {configured.length ? `Add your ${PUBLISH_PLATFORMS.filter((p) => !configured.includes(p)).map(platformLabel).join(' and ')} developer app` : 'First, add your developer apps for TikTok, Instagram and YouTube'} in Settings → Publishing (one-time setup).
              </span>
              <Button size="sm" variant="secondary" asChild>
                <Link to="/settings#publishing">
                  <Settings /> Publishing settings
                </Link>
              </Button>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Connect an account</CardTitle>
              <CardDescription>You sign in on the platform’s own page; Content Studio never sees your password. Connect as many accounts as you like.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {PUBLISH_PLATFORMS.map((p) => (
                <Button key={p} variant="outline" disabled={!setup.data?.platforms[p].configured || !!busy} onClick={() => connect(p)}>
                  {busy === p ? <Spinner /> : <PlatformIcon platform={p} />} {platformLabel(p)}
                </Button>
              ))}
            </CardContent>
          </Card>

          {accounts.isPending ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            accounts.data?.map((a) => <AccountCard key={a.id} account={a} timeZone={setup.data?.timeZone} />)
          )}
          {accounts.data && !accounts.data.length && <p className="text-center text-sm text-muted-foreground">No accounts connected to {workspace.name} yet.</p>}
        </div>
      </div>
    </div>
  );
}

function AccountCard({ account: a, timeZone }: { account: Account; timeZone?: string }) {
  const [confirm, setConfirm] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.accounts(a.workspaceId) });

  async function patch(body: Partial<Pick<Account, 'settings' | 'slots'>>) {
    try {
      await api(`/accounts/${a.id}`, { method: 'PATCH', body });
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <AccountAvatar account={a} platform={a.platform} className="size-10" />
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate">{accountName(a)}</CardTitle>
            <CardDescription>
              {platformLabel(a.platform)}
              {a.handle && a.name && a.name !== a.handle && ` · ${a.name}`}
            </CardDescription>
          </div>
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirm(true)}>
            <Unplug /> <span className="hidden sm:inline">Disconnect</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {a.status === 'reconnect' && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm">
            <span className="mr-auto text-destructive">{a.statusMessage ?? 'The platform stopped accepting this sign-in.'} Posts to this account wait until you reconnect.</span>
            <Button size="sm" onClick={() => signIn(`/accounts/${a.id}/reconnect`, {}).catch((err) => toast.error(errorMessage(err)))}>
              <RefreshCw /> Reconnect
            </Button>
          </div>
        )}

        {a.status === 'connected' && a.statsNote && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-400/10 px-3 py-2 text-sm">
            <span className="mr-auto">
              <span className="text-muted-foreground">Analytics: </span>
              {a.statsNote}
            </span>
            <Button size="sm" variant="secondary" onClick={() => signIn(`/accounts/${a.id}/reconnect`, {}).catch((err) => toast.error(errorMessage(err)))}>
              <RefreshCw /> Reconnect
            </Button>
          </div>
        )}

        {a.platform === 'tiktok' && (
          <div className="space-y-2">
            <Label>How posts reach TikTok</Label>
            <Select value={a.settings.tiktokMode ?? 'inbox'} onValueChange={(v) => patch({ settings: { tiktokMode: v as 'inbox' | 'direct' } })}>
              <SelectTrigger className="w-full sm:w-[26rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inbox">Send to my TikTok inbox, I post it from the app</SelectItem>
                <SelectItem value="direct">Post directly</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {(a.settings.tiktokMode ?? 'inbox') === 'inbox'
                ? 'Works before TikTok audits your developer app. At the scheduled time the video lands in your TikTok inbox; open TikTok, paste the caption and post.'
                : 'Needs TikTok’s audit of your developer app — until then TikTok only accepts direct posts to private accounts.'}
            </p>
          </div>
        )}
        {a.platform === 'youtube' && <p className="text-xs text-muted-foreground">Until Google audits your API project, YouTube makes every upload private — you can publish it from YouTube Studio.</p>}

        <QueueEditor slots={a.slots} timeZone={timeZone} onChange={(slots) => patch({ slots })} />
      </CardContent>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {accountName(a)}?</AlertDialogTitle>
            <AlertDialogDescription>Content Studio forgets its sign-in and asks {platformLabel(a.platform)} to revoke access. Posts scheduled to it won’t go out. Nothing already posted is touched.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                await api(`/accounts/${a.id}`, { method: 'DELETE' }).catch((err) => toast.error(errorMessage(err)));
                refresh();
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** The account's weekly posting times, which "Next queue time" fills in order. Saves as you change it. */
function QueueEditor({ slots, timeZone, onChange }: { slots: QueueSlot[]; timeZone?: string; onChange: (s: QueueSlot[]) => void }) {
  const [draft, setDraft] = useState(slots);
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => setDraft(slots), [slots]);
  const order = Array.from({ length: 7 }, (_, i) => (firstDayOfWeek() + i) % 7);

  function update(next: QueueSlot[], delay = 0) {
    setDraft(next);
    clearTimeout(pending.current);
    pending.current = setTimeout(() => onChange(next.filter((s) => s.days.length).sort((a, b) => a.time.localeCompare(b.time))), delay);
  }

  return (
    <div className="space-y-2">
      <div>
        <Label>Queue times</Label>
        <p className="text-xs text-muted-foreground">“Next queue time” in the schedule dialog takes the first of these that’s free.{timeZone && ` Times are in ${timeZone.replace(/_/g, ' ')}.`}</p>
      </div>
      {draft.map((slot, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <Input
            type="time"
            value={slot.time}
            onChange={(e) => e.target.value && update(draft.map((s, j) => (j === i ? { ...s, time: e.target.value } : s)), 600)}
            className="h-8 w-36"
            aria-label="Time"
          />
          <div className="flex gap-1" role="group" aria-label="Days">
            {order.map((d) => {
              const on = slot.days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => update(draft.map((s, j) => (j === i ? { ...s, days: on ? s.days.filter((x) => x !== d) : [...s.days, d].sort() } : s)))}
                  className={cn('h-8 w-9 rounded-md border text-xs transition-colors', on ? 'border-brand/60 bg-brand-soft text-foreground' : 'text-muted-foreground hover:bg-accent/50')}
                >
                  {DAY_NAMES[d].slice(0, 2)}
                </button>
              );
            })}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => update(draft.filter((_, j) => j !== i))} aria-label="Remove time">
            <X />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => update([...draft, { time: '12:00', days: [1, 2, 3, 4, 5] }])} disabled={draft.length >= 24}>
        <Plus /> Add a time
      </Button>
    </div>
  );
}
