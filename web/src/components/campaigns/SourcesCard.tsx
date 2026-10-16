import { Download, Loader2, Plus, RotateCcw, Sparkles, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { SOURCE_KIND_LABELS, SOURCE_STATUS_LABELS, type CampaignDetail, type CampaignSource } from '@shared/campaigns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage, uploadFiles } from '@/lib/api';
import { bytes, duration } from '@/lib/format';
import { keys, queryClient } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { SourceKindIcon } from './common';

const save = (c: CampaignDetail) => queryClient.setQueryData(keys.campaign(c.id), c);

function SourceRow({ s, moments, canFind }: { s: CampaignSource; moments: number; canFind: boolean }) {
  const [busy, setBusy] = useState(false);
  const pct = s.status === 'downloading' && s.progress !== null ? Math.round(s.progress * 100) : null;
  const working = s.status === 'queued' || s.status === 'downloading' || s.status === 'transcribing' || s.status === 'scanning';

  async function act(method: 'POST' | 'DELETE', path: string) {
    setBusy(true);
    try {
      save(await api<CampaignDetail>(path, { method, body: method === 'POST' ? {} : undefined }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const facts = [
    SOURCE_KIND_LABELS[s.kind],
    s.durationMs ? duration(s.durationMs) : null,
    s.size && s.downloaded ? bytes(s.size) : null,
    s.status === 'ready' && s.transcriptFrom ? (s.transcriptFrom === 'captions' ? 'YouTube captions' : 'Whisper transcript') : null,
    moments ? `${moments} moment${moments === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="space-y-1.5 p-3">
      <div className="flex items-start gap-2.5">
        <SourceKindIcon kind={s.kind} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          {s.link ? (
            <a href={s.link} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm hover:underline">
              {s.title || s.link}
            </a>
          ) : (
            <p className="line-clamp-2 text-sm">{s.title || 'Upload'}</p>
          )}
          <p className="text-xs text-muted-foreground">{facts}</p>
          {(s.detail || s.status === 'error') && <p className={cn('text-xs', s.status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{s.detail || 'Something went wrong.'}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {working ? (
            <Badge variant="secondary" className="gap-1">
              {s.status !== 'queued' && <Loader2 className="animate-spin" />}
              {SOURCE_STATUS_LABELS[s.status]}
              {pct !== null && <span className="tabular-nums">{pct}%</span>}
            </Badge>
          ) : s.status === 'found' ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act('POST', `/sources/${s.id}/start`)}>
              {busy ? <Spinner /> : <Download />} Get
            </Button>
          ) : s.status === 'ready' && !s.downloaded ? (
            s.link ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => act('POST', `/sources/${s.id}/start`)} title="Download the video again (its transcript is kept)">
                {busy ? <Spinner /> : <Download />} Download again
              </Button>
            ) : (
              <Badge variant="secondary">Video deleted</Badge>
            )
          ) : s.status === 'error' ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act('POST', `/sources/${s.id}/start`)}>
              {busy ? <Spinner /> : <RotateCcw />} Retry
            </Button>
          ) : canFind && s.transcriptFrom ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act('POST', `/sources/${s.id}/moments`)}>
              {busy ? <Spinner /> : <Sparkles />} {moments ? 'Find again' : 'Find moments'}
            </Button>
          ) : (
            <Badge variant="secondary" className="text-emerald-400">
              {SOURCE_STATUS_LABELS[s.status]}
            </Badge>
          )}
          <Button size="icon-sm" variant="ghost" disabled={busy} aria-label="Remove this source" onClick={() => act('DELETE', `/sources/${s.id}`)}>
            <X />
          </Button>
        </div>
      </div>
      {pct !== null && (
        <div className="ml-6.5 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Downloading ${s.title}`}>
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </li>
  );
}

/** The long videos the campaign's clips are cut from: from its page, a link I paste, or an upload. */
export function SourcesCard({ campaign }: { campaign: CampaignDetail }) {
  const [freeing, setFreeing] = useState(false);
  const [link, setLink] = useState('');
  const [adding, setAdding] = useState(false);
  const [upload, setUpload] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Downloaded and downloading ones first; the listed-only ones (a channel's 30 latest) after, in their order.
  const sources = [...campaign.sources.filter((s) => s.status !== 'found'), ...campaign.sources.filter((s) => s.status === 'found')];
  const found = sources.filter((s) => s.status === 'found').length;
  const onDisk = sources.filter((s) => s.downloaded && s.status === 'ready');
  const diskBytes = onDisk.reduce((n, s) => n + (s.size ?? 0), 0);

  async function free() {
    setFreeing(true);
    try {
      save(await api<CampaignDetail>(`/campaigns/${campaign.id}/free-sources`, { body: {} }));
      toast.success(`Freed ${bytes(diskBytes)}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setFreeing(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    try {
      save(await api<CampaignDetail>(`/campaigns/${campaign.id}/sources`, { body: { link: link.trim() } }));
      setLink('');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUpload(0);
    try {
      save(await uploadFiles<CampaignDetail>(`/campaigns/${campaign.id}/sources/upload`, [...files], setUpload));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUpload(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Source videos</CardTitle>
        <CardDescription>
          The long videos clips are cut from. They download to this computer (not into a page) and get a transcript: YouTube’s captions when it has them, Whisper otherwise.
          {found > 0 && ` ${found} listed and not downloaded yet: get the ones you want.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sources.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {sources.map((s) => (
              <SourceRow key={s.id} s={s} moments={campaign.moments.filter((m) => m.sourceId === s.id).length} canFind={campaign.status === 'active' && campaign.pageIds.length > 0} />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
            {campaign.rulesLocked ? 'The campaign’s source files are locked until you join it. You can also add videos yourself.' : 'No source videos yet.'}
          </p>
        )}
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <Input
            type="url"
            inputMode="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="A YouTube, Twitch or Kick video or channel, or a Drive link"
            aria-label="Source link"
            className="min-w-0 flex-1 basis-60"
          />
          <Button type="submit" variant="outline" disabled={adding || !/^https?:\/\/\S+$/.test(link.trim())}>
            {adding ? <Spinner /> : <Plus />} Add
          </Button>
          <Button type="button" variant="ghost" disabled={upload !== null} onClick={() => fileInput.current?.click()}>
            {upload !== null ? <Spinner /> : <Upload />} {upload !== null ? `${Math.round(upload * 100)}%` : 'Upload'}
          </Button>
          <input ref={fileInput} type="file" accept="video/*,audio/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
        </form>
        <p className="text-xs text-muted-foreground">A channel or playlist lists its latest videos to pick from; a Drive folder must be shared with anyone who has the link.</p>
        {campaign.status !== 'active' && onDisk.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 text-sm">
            <span className="min-w-0 flex-1 text-muted-foreground">
              {onDisk.length} video{onDisk.length === 1 ? '' : 's'} ({bytes(diskBytes)}) on this computer.{' '}
              {campaign.status === 'ended' ? 'They’re deleted some days after the campaign ends (Settings → Clip tools); transcripts and clips stay.' : 'Transcripts and clips stay if you delete them.'}
            </span>
            <Button size="sm" variant="outline" disabled={freeing} onClick={free}>
              {freeing && <Spinner />} Delete the videos now
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
