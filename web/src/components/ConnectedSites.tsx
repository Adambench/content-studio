import { BadgeDollarSign, CircleAlert, FileSearch, Globe, LogIn, LogOut } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { SITE_IDS, SITES, type PageRead, type SiteId, type SiteState, type SitesStatus } from '@shared/sites';
import { PlatformIcon } from '@/components/publish/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { desktop } from '@/lib/desktop';
import { keys, queryClient, useSites } from '@/lib/queries';

function SiteIcon({ id }: { id: SiteId }) {
  if (id === 'whop') return <BadgeDollarSign className="size-4 shrink-0 text-orange-400" aria-hidden />;
  if (id === 'vyro') return <BadgeDollarSign className="size-4 shrink-0 text-sky-400" aria-hidden />;
  return <PlatformIcon platform={id} />;
}

/** Settings → Connected sites: the desktop app's signed-in windows for Content Rewards (Whop), Vyro, TikTok and Instagram. */
export function ConnectedSitesCard() {
  const { data } = useSites();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(key: string, path: string, done?: string) {
    setBusy(key);
    try {
      queryClient.setQueryData(keys.sites, await api<SitesStatus>(path, { body: {} }));
      if (done) toast.success(done);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card id="sites">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="size-4" /> Connected sites
        </CardTitle>
        <CardDescription>
          Content Studio reads pages on these sites as you — campaigns you’ve joined on Content Rewards and Vyro, profiles for research — in its own browser profile on this computer. It reads slowly, one page at a time
          and at least 5 seconds apart, and never posts, follows or submits anything.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {data && !data.available && (
          <div className="flex items-start gap-2 text-sm">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <div>Needs the desktop app: sign-in windows and page reading run inside it.</div>
          </div>
        )}
        <ul className="divide-y rounded-lg border">
          {SITE_IDS.map((id) => {
            const state = data?.sites.find((s) => s.id === id);
            return (
              <SiteRow
                key={id}
                id={id}
                state={state}
                available={!!data?.available}
                busy={busy}
                onSignIn={() => act(`in:${id}`, `/sites/${id}/signin`)}
                onSignOut={() => act(`out:${id}`, `/sites/${id}/signout`, `Signed out of ${SITES[id].label}`)}
              />
            );
          })}
        </ul>
        {data?.available && (
          <>
            <TryPage />
            <p className="text-xs text-muted-foreground">
              {data.reads.today} of {data.reads.cap} page reads used today.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SiteRow(props: { id: SiteId; state?: SiteState; available: boolean; busy: string | null; onSignIn: () => void; onSignOut: () => void }) {
  const { id, state, available, busy } = props;
  const site = SITES[id];
  const signedIn = !!state?.signedIn;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
      <SiteIcon id={id} />
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {site.label}
          {available &&
            (signedIn ? (
              <Badge variant="secondary" className="text-emerald-400">
                Signed in
              </Badge>
            ) : state?.windowOpen ? (
              <Badge variant="secondary">Window open</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                Not signed in
              </Badge>
            ))}
        </div>
        <p className="text-xs text-muted-foreground">{site.use}</p>
      </div>
      {available && (
        <div className="flex items-center gap-2">
          {desktop ? (
            <Button size="sm" variant={signedIn ? 'outline' : 'default'} disabled={!!busy} onClick={props.onSignIn}>
              {busy === `in:${id}` ? <Spinner /> : <LogIn />} {state?.windowOpen ? 'Show window' : signedIn ? 'Open' : 'Sign in'}
            </Button>
          ) : (
            !signedIn && <span className="text-xs text-muted-foreground">Sign in from the desktop app</span>
          )}
          {signedIn && (
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={props.onSignOut}>
              {busy === `out:${id}` ? <Spinner /> : <LogOut />} Sign out
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/** Read one page the way the app will, to check a sign-in works (it counts towards the daily cap). */
function TryPage() {
  const [url, setUrl] = useState('');
  const [reading, setReading] = useState(false);
  const [page, setPage] = useState<PageRead | null>(null);

  async function read(e: React.FormEvent) {
    e.preventDefault();
    setReading(true);
    try {
      setPage(await api<PageRead>('/sites/read', { body: { url: url.trim(), scrolls: 3 } }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setReading(false);
    }
  }

  return (
    <form onSubmit={read} className="space-y-2">
      <Label htmlFor="site-read-url">Try a page</Label>
      <p className="text-xs text-muted-foreground">Reads one page as Content Studio will — a campaign you’ve joined, say — so you can check the sign-in works.</p>
      <div className="flex gap-2">
        <Input id="site-read-url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://contentrewards.com/c/campaigns/…" className="min-w-0 flex-1" />
        <Button type="submit" variant="outline" disabled={reading || !/^https?:\/\/\S+$/.test(url.trim())}>
          {reading ? <Spinner /> : <FileSearch />} Read
        </Button>
      </div>
      {reading && <p className="text-xs text-muted-foreground">Reading… pages wait their turn, at least 5 seconds apart.</p>}
      {page && !reading && <PageResult page={page} />}
    </form>
  );
}

function PageResult({ page }: { page: PageRead }) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{page.title || 'Untitled page'}</p>
        <a href={page.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-muted-foreground underline-offset-2 hover:underline">
          {page.url}
        </a>
      </div>
      {page.loginWall && (
        <div className="flex items-start gap-2 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <div>This went to {SITES[page.loginWall].label}’s sign-in page: sign in above first.</div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {page.text.length.toLocaleString()} characters of text · {page.links.length} links
      </p>
      <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-sans text-xs whitespace-pre-wrap">{page.text.slice(0, 5000) || '(no text)'}</pre>
    </div>
  );
}
