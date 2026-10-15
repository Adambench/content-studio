import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CalendarClock, Info, ListOrdered, Send, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { PUBLISH_LIMITS, TIKTOK_PRIVACY_LABELS, type PostCopy, type PostFormat, type PostOptions, type PublishPlatform } from '@shared/publish';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api, errorMessage, mediaThumbUrl } from '@/lib/api';
import { duration } from '@/lib/format';
import { keys, queryClient, useAccounts, useCreatorInfo, usePiece, usePublishingSetup } from '@/lib/queries';
import type { Account, Media, PlanTarget } from '@/lib/types';
import { cn } from '@/lib/utils';
import { AccountAvatar, accountName, formatWhen, fromInputs, platformLabel, toInputs } from './common';

type When = 'queue' | 'at' | 'now';

const DEFAULT_OPTIONS: Record<PublishPlatform, PostOptions> = {
  // TikTok requires that nothing is pre-selected.
  tiktok: {},
  instagram: { shareToFeed: true },
  youtube: { youtubePrivacy: 'public', madeForKids: false },
};

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Finished renders first (newest first), then other videos, then photos. */
function mediaChoices(media: Media[]) {
  const renders = media.filter((m) => m.source === 'render' && m.kind === 'video').reverse();
  const videos = media.filter((m) => m.source !== 'render' && m.kind === 'video');
  const photos = media.filter((m) => m.kind === 'image');
  return [...renders, ...videos, ...photos];
}

function nextHour() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d.getTime();
}

export function ScheduleDialog({ open, onOpenChange, wid, pieceId, initialAt }: { open: boolean; onOpenChange: (o: boolean) => void; wid: string; pieceId: string | null; initialAt?: number | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {open && pieceId && <Schedule key={pieceId} wid={wid} pieceId={pieceId} initialAt={initialAt ?? null} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function Schedule({ wid, pieceId, initialAt, onDone }: { wid: string; pieceId: string; initialAt: number | null; onDone: () => void }) {
  const piece = usePiece(pieceId);
  const accounts = useAccounts(wid);
  const setup = usePublishingSetup();
  const choices = useMemo(() => mediaChoices(piece.data?.media ?? []), [piece.data?.media]);

  const [mediaIds, setMediaIds] = useState<string[] | null>(null);
  const [accountIds, setAccountIds] = useState<string[] | null>(null);
  const [when, setWhen] = useState<When>(initialAt ? 'at' : 'queue');
  const start = toInputs(initialAt ?? nextHour());
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [stagger, setStagger] = useState(15);
  const [copies, setCopies] = useState<Record<string, PostCopy>>({});
  const [options, setOptions] = useState<Record<string, PostOptions>>({});
  const [blockers, setBlockers] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);

  const selected = (mediaIds ?? []).map((id) => choices.find((m) => m.id === id)).filter((m): m is Media => !!m);
  const format: PostFormat = selected[0]?.kind === 'image' ? 'photo' : 'video';
  const all = accounts.data ?? [];
  const usable = (a: Account) => a.status === 'connected' && !(format === 'photo' && a.platform === 'youtube');

  // Defaults once things load: the newest finished video, every account that can take it.
  useEffect(() => {
    if (mediaIds === null && piece.data) {
      const video = choices.find((m) => m.kind === 'video');
      setMediaIds(video ? [video.id] : choices.filter((m) => m.kind === 'image').slice(0, PUBLISH_LIMITS.instagram.maxPhotos).map((m) => m.id));
    }
  }, [piece.data, choices, mediaIds]);
  useEffect(() => {
    if (accountIds === null && accounts.data && mediaIds !== null) setAccountIds(accounts.data.filter(usable).map((a) => a.id));
  }, [accounts.data, accountIds, mediaIds]); // eslint-disable-line react-hooks/exhaustive-deps
  // Switching to photos drops YouTube.
  useEffect(() => {
    setAccountIds((ids) => ids && ids.filter((id) => all.find((a) => a.id === id && usable(a))));
  }, [format]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = (accountIds ?? []).map((id) => all.find((a) => a.id === id)).filter((a): a is Account => !!a);
  const at = fromInputs(date, time);
  const body = {
    format,
    mediaIds: mediaIds ?? [],
    targets: chosen.map((a) => ({ accountId: a.id, copy: copies[a.id], options: options[a.id] ?? DEFAULT_OPTIONS[a.platform] })),
    when: when === 'queue' ? { mode: 'queue' as const } : when === 'now' ? { mode: 'now' as const, staggerMinutes: stagger } : { mode: 'at' as const, at, staggerMinutes: stagger },
  };
  const planBody = useDebounced(body, 300);
  const plan = useQuery({
    queryKey: ['plan', pieceId, JSON.stringify(planBody)],
    queryFn: () => api<PlanTarget[]>(`/pieces/${pieceId}/posts/plan`, { body: planBody }),
    enabled: planBody.mediaIds.length > 0 && planBody.targets.length > 0,
    placeholderData: (prev) => prev,
    staleTime: 0,
    retry: false,
  });
  const targets = new Map((plan.data ?? []).map((t) => [t.accountId, t]));
  const settled = JSON.stringify(planBody) === JSON.stringify(body) && !plan.isFetching && !!plan.data;
  const errors = [
    ...(plan.data ?? []).flatMap((t) => t.problems.filter((p) => p.level === 'error').map((p) => p.message)),
    // Only accounts still picked can hold things up.
    ...chosen.map((a) => blockers[a.id]).filter((b): b is string => !!b),
    ...(when === 'at' && at < Date.now() - 60_000 ? ['That time has passed.'] : []),
  ];
  const canSubmit = settled && !errors.length && chosen.length > 0 && selected.length > 0 && !busy;

  function pickMedia(m: Media) {
    setMediaIds((ids) => {
      const current = ids ?? [];
      if (m.kind !== 'image' || format !== 'photo') return [m.id];
      if (current.includes(m.id)) return current.length > 1 ? current.filter((id) => id !== m.id) : current;
      return [...current, m.id].slice(0, PUBLISH_LIMITS.tiktok.maxPhotos);
    });
  }

  async function submit() {
    setBusy(true);
    try {
      const { ids } = await api<{ ids: string[] }>(`/pieces/${pieceId}/posts`, { body });
      queryClient.invalidateQueries({ queryKey: ['posts', wid] });
      queryClient.invalidateQueries({ queryKey: keys.piecePosts(pieceId) });
      const n = ids.length;
      toast.success(when === 'now' ? `Posting now to ${n} account${n === 1 ? '' : 's'}` : `Scheduled ${n} post${n === 1 ? '' : 's'}`, {
        description: when === 'now' ? 'You’ll get a notification when each one is up.' : 'They go out by themselves while Content Studio is running.',
      });
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!piece.data || !accounts.data || !setup.data) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <>
      <DialogHeader className="border-b px-5 py-4">
        <DialogTitle>Schedule “{piece.data.title}”</DialogTitle>
        <DialogDescription>Captions come from the piece’s draft. Edit them here for this post only.</DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
        <section className="space-y-2" aria-label="What to post">
          <h3 className="text-sm font-medium">What</h3>
          {choices.length ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {choices.map((m) => {
                const on = mediaIds?.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => pickMedia(m)}
                    aria-pressed={on}
                    title={m.originalName}
                    className={cn('relative h-24 w-16 shrink-0 overflow-hidden rounded-md border bg-muted', on && 'ring-2 ring-brand ring-offset-2 ring-offset-popover')}
                  >
                    {m.hasThumb && <img src={mediaThumbUrl(m.id)} alt="" className="size-full object-cover" />}
                    {m.source === 'render' && <span className="absolute top-1 left-1 rounded bg-brand/90 px-1 text-[10px] font-medium text-white">Final</span>}
                    {m.kind === 'video' && m.durationMs != null && <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-[10px] text-white tabular-nums">{duration(m.durationMs)}</span>}
                    {on && format === 'photo' && selected.length > 1 && (
                      <span className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-brand text-[10px] font-medium text-white">{(mediaIds ?? []).indexOf(m.id) + 1}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Nothing to post yet. Render the video in the editor, or attach videos or photos to the piece.</p>
          )}
          <p className="text-xs text-muted-foreground">{format === 'photo' ? `Photo post${selected.length > 1 ? ` — a carousel of ${selected.length}, in the order you picked them` : ' — pick more photos for a carousel'}.` : 'One video. Pick photos instead for a photo post.'}</p>
        </section>

        <section className="space-y-2" aria-label="Where to post">
          <h3 className="text-sm font-medium">Where</h3>
          {all.length ? (
            <div className="flex flex-wrap gap-2">
              {all.map((a) => {
                const on = accountIds?.includes(a.id);
                const why = a.status !== 'connected' ? 'Needs reconnecting' : !usable(a) ? 'Videos only' : null;
                return (
                  <button
                    key={a.id}
                    type="button"
                    disabled={!!why}
                    aria-pressed={on}
                    onClick={() => setAccountIds((ids) => (on ? (ids ?? []).filter((id) => id !== a.id) : [...(ids ?? []), a.id]))}
                    className={cn('flex items-center gap-2 rounded-lg border py-1.5 pr-3 pl-1.5 text-left text-sm transition-colors disabled:opacity-50', on ? 'border-brand/60 bg-brand-soft' : 'hover:bg-accent/50')}
                  >
                    <AccountAvatar account={a} platform={a.platform} className="size-6" />
                    <span className="min-w-0">
                      <span className="block max-w-40 truncate">{accountName(a)}</span>
                      <span className="block text-[11px] text-muted-foreground">{why ?? platformLabel(a.platform)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              No accounts connected to this workspace yet.{' '}
              <Link to={`/w/${wid}/accounts`} className="text-brand underline-offset-4 hover:underline" onClick={onDone}>
                Connect TikTok, Instagram or YouTube
              </Link>
            </p>
          )}
        </section>

        <section className="space-y-3" aria-label="When to post">
          <h3 className="text-sm font-medium">When</h3>
          <ToggleGroup type="single" variant="outline" size="sm" value={when} onValueChange={(v) => v && setWhen(v as When)} className="flex-wrap">
            <ToggleGroupItem value="queue">
              <ListOrdered /> Next queue time
            </ToggleGroupItem>
            <ToggleGroupItem value="at">
              <CalendarClock /> Pick a time
            </ToggleGroupItem>
            <ToggleGroupItem value="now">
              <Send /> Now
            </ToggleGroupItem>
          </ToggleGroup>
          {when === 'at' && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="post-date" className="text-xs">
                  Date
                </Label>
                <Input id="post-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-8 w-40" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="post-time" className="text-xs">
                  Time
                </Label>
                <Input id="post-time" type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} className="h-8 w-32" />
              </div>
            </div>
          )}
          {when !== 'queue' && chosen.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Space them out:</span>
              <Select value={String(stagger)} onValueChange={(v) => setStagger(Number(v))}>
                <SelectTrigger size="sm" className="w-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">All at once</SelectItem>
                  <SelectItem value="5">5 min apart</SelectItem>
                  <SelectItem value="15">15 min apart</SelectItem>
                  <SelectItem value="30">30 min apart</SelectItem>
                  <SelectItem value="60">1 hour apart</SelectItem>
                  <SelectItem value="180">3 hours apart</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {when === 'queue' && <p className="text-xs text-muted-foreground">Each account’s next free time from its queue (set on the Accounts page).</p>}
        </section>

        {chosen.map((a) => (
          <TargetCard
            key={a.id}
            account={a}
            format={format}
            media={selected}
            target={targets.get(a.id)}
            copy={copies[a.id] ?? targets.get(a.id)?.copy ?? null}
            onCopy={(c) => setCopies((all) => ({ ...all, [a.id]: c }))}
            options={options[a.id] ?? DEFAULT_OPTIONS[a.platform]}
            onOptions={(o) => setOptions((all) => ({ ...all, [a.id]: o }))}
            onBlocker={(b) => setBlockers((all) => (all[a.id] === b ? all : { ...all, [a.id]: b }))}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t px-5 py-3">
        <p className={cn('w-full text-xs sm:w-auto sm:min-w-0 sm:flex-1', errors.length ? 'text-destructive' : 'text-muted-foreground')}>
          {plan.isError ? errorMessage(plan.error) : errors.length ? errors[0] : chosen.length ? (when === 'now' ? 'Goes out straight away.' : 'Goes out by itself, even with the window closed (the app keeps running in the tray).') : 'Pick at least one account.'}
        </p>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!canSubmit}>
          {busy || (plan.isFetching && !settled) ? <Spinner /> : when === 'now' ? <Send /> : <CalendarClock />}
          {when === 'now' ? 'Post now' : `Schedule${chosen.length > 1 ? ` ${chosen.length} posts` : ''}`}
        </Button>
      </div>
    </>
  );
}

function TargetCard({
  account,
  format,
  media,
  target,
  copy,
  onCopy,
  options,
  onOptions,
  onBlocker,
}: {
  account: Account;
  format: PostFormat;
  media: Media[];
  target: PlanTarget | undefined;
  copy: PostCopy | null;
  onCopy: (c: PostCopy) => void;
  options: PostOptions;
  onOptions: (o: PostOptions) => void;
  onBlocker: (b: string | null) => void;
}) {
  const p = account.platform;
  const direct = p === 'tiktok' && account.settings.tiktokMode === 'direct';
  const set = (field: keyof PostCopy) => (v: string) => copy && onCopy({ ...copy, [field]: v });
  useEffect(() => {
    if (!direct) onBlocker(null);
  }, [direct]); // eslint-disable-line react-hooks/exhaustive-deps

  const captionLimit = p === 'youtube' ? PUBLISH_LIMITS.youtube.description : p === 'tiktok' && format === 'photo' ? PUBLISH_LIMITS.tiktok.photoCaption : PUBLISH_LIMITS[p].caption;
  return (
    <section className="space-y-3 rounded-xl border p-4" aria-label={`${platformLabel(p)} post`}>
      <div className="flex items-center gap-2.5">
        <AccountAvatar account={account} platform={p} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{accountName(account)}</p>
          <p className="text-xs text-muted-foreground">
            {platformLabel(p)}
            {p === 'tiktok' && (direct ? ' · posts directly' : ' · to your inbox')}
          </p>
        </div>
        <span className="text-right text-xs text-muted-foreground tabular-nums">{target?.scheduledAt ? formatWhen(target.scheduledAt) : target ? 'No free queue time' : ''}</span>
      </div>

      {!copy ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <div className="space-y-3">
          {(p === 'youtube' || (p === 'tiktok' && format === 'photo')) && (
            <CountedField label="Title" value={copy.title} limit={p === 'youtube' ? PUBLISH_LIMITS.youtube.title : PUBLISH_LIMITS.tiktok.photoTitle} onChange={set('title')} single />
          )}
          <CountedField label={p === 'youtube' || (p === 'tiktok' && format === 'photo') ? 'Description' : 'Caption'} value={copy.caption} limit={captionLimit} onChange={set('caption')} />
          {p === 'youtube' && <CountedField label="Tags" hint="comma-separated" value={copy.tags} limit={PUBLISH_LIMITS.youtube.tags} onChange={set('tags')} single />}
        </div>
      )}

      {p === 'tiktok' && direct && <TikTokDirect account={account} format={format} media={media} options={options} onOptions={onOptions} onBlocker={onBlocker} />}
      {p === 'tiktok' && !direct && (
        <Note>
          Goes to your TikTok inbox as a draft — open TikTok to finish and post it.{format === 'video' && ' TikTok drafts don’t carry the caption, so copy it from the post in Content Studio then.'}
        </Note>
      )}
      {p === 'instagram' && format === 'video' && (
        <SwitchRow id={`feed-${account.id}`} label="Also show in the main feed" checked={options.shareToFeed ?? true} onChange={(v) => onOptions({ ...options, shareToFeed: v })} />
      )}
      {p === 'youtube' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label className="text-sm font-normal">Visibility</Label>
            <Select value={options.youtubePrivacy ?? 'public'} onValueChange={(v) => onOptions({ ...options, youtubePrivacy: v as PostOptions['youtubePrivacy'] })}>
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public</SelectItem>
                <SelectItem value="unlisted">Unlisted</SelectItem>
                <SelectItem value="private">Private</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <SwitchRow id={`kids-${account.id}`} label="Made for kids" checked={!!options.madeForKids} onChange={(v) => onOptions({ ...options, madeForKids: v })} />
        </div>
      )}

      {!!target?.problems.length && (
        <ul className="space-y-1">
          {target.problems.map((pr, i) => (
            <li key={i} className={cn('flex gap-1.5 text-xs', pr.level === 'error' ? 'text-destructive' : 'text-amber-300/90')}>
              {pr.level === 'error' ? <AlertCircle className="mt-px size-3.5 shrink-0" /> : <TriangleAlert className="mt-px size-3.5 shrink-0" />}
              {pr.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Direct posting, laid out the way TikTok's content-sharing guidelines require: whose account it goes to, a
 * visibility choice with no default, interactions off until switched on (and greyed out where the creator turned
 * them off), commercial-content disclosure, and the declaration before posting.
 */
function TikTokDirect({ account, format, media, options, onOptions, onBlocker }: { account: Account; format: PostFormat; media: Media[]; options: PostOptions; onOptions: (o: PostOptions) => void; onBlocker: (b: string | null) => void }) {
  const info = useCreatorInfo(account.id);
  const set = (patch: PostOptions) => onOptions({ ...options, ...patch });
  const seconds = format === 'video' ? (media[0]?.durationMs ?? 0) / 1000 : 0;
  const tooLong = info.data && seconds > info.data.maxVideoSeconds;
  const blocker = info.isError ? `TikTok: ${errorMessage(info.error)}` : tooLong ? `This TikTok account can post videos up to ${Math.floor(info.data!.maxVideoSeconds / 60)} min ${info.data!.maxVideoSeconds % 60} s.` : null;
  useEffect(() => onBlocker(info.isPending ? 'Checking the TikTok account…' : blocker), [blocker, info.isPending]); // eslint-disable-line react-hooks/exhaustive-deps

  if (info.isPending) return <Skeleton className="h-32 w-full" />;
  if (info.isError || !info.data) return <p className="text-xs text-destructive">{blocker}</p>;
  const c = info.data;
  const branded = !!(options.discloseContent && options.brandedContent);
  const label = options.discloseContent && (options.brandedContent ? 'Paid partnership' : options.yourBrand ? 'Promotional content' : null);

  return (
    <div className="space-y-3 rounded-lg bg-muted/40 p-3">
      <div className="flex items-center gap-2 text-sm">
        {c.avatarUrl && <img src={c.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-5 rounded-full" />}
        <span>
          Posting to <span className="font-medium">{c.nickname || c.username}</span>’s TikTok
        </span>
      </div>
      {tooLong && <p className="text-xs text-destructive">{blocker}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-sm font-normal">Who can see this video</Label>
        <Select value={options.tiktokPrivacy ?? ''} onValueChange={(v) => set({ tiktokPrivacy: v as PostOptions['tiktokPrivacy'] })}>
          <SelectTrigger size="sm" className="w-40" aria-invalid={!options.tiktokPrivacy || undefined}>
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {c.privacyOptions.map((o) => (
              <SelectItem key={o} value={o} disabled={o === 'SELF_ONLY' && branded}>
                {TIKTOK_PRIVACY_LABELS[o]}
                {o === 'SELF_ONLY' && branded && ' — not for branded content'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Allow users to</Label>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <InlineSwitch id={`c-${account.id}`} label="Comment" checked={!!options.allowComments && !c.commentDisabled} disabled={c.commentDisabled} onChange={(v) => set({ allowComments: v })} />
          {format === 'video' && <InlineSwitch id={`d-${account.id}`} label="Duet" checked={!!options.allowDuet && !c.duetDisabled} disabled={c.duetDisabled} onChange={(v) => set({ allowDuet: v })} />}
          {format === 'video' && <InlineSwitch id={`s-${account.id}`} label="Stitch" checked={!!options.allowStitch && !c.stitchDisabled} disabled={c.stitchDisabled} onChange={(v) => set({ allowStitch: v })} />}
        </div>
      </div>
      <SwitchRow
        id={`disclose-${account.id}`}
        label="Disclose commercial content"
        hint="Turn on if this promotes yourself, a brand, product or service."
        checked={!!options.discloseContent}
        onChange={(v) => set({ discloseContent: v, ...(!v && { yourBrand: false, brandedContent: false }) })}
      />
      {options.discloseContent && (
        <div className="space-y-2 border-l-2 border-border pl-3">
          <SwitchRow id={`own-${account.id}`} label="Your brand" hint="You’re promoting yourself or your own business." checked={!!options.yourBrand} onChange={(v) => set({ yourBrand: v })} />
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <SwitchRow
                  id={`bc-${account.id}`}
                  label="Branded content"
                  hint="You’re promoting another brand or a third party."
                  checked={!!options.brandedContent}
                  disabled={options.tiktokPrivacy === 'SELF_ONLY'}
                  onChange={(v) => set({ brandedContent: v })}
                />
              </div>
            </TooltipTrigger>
            {options.tiktokPrivacy === 'SELF_ONLY' && <TooltipContent>Branded content visibility cannot be set to private.</TooltipContent>}
          </Tooltip>
          {label ? (
            <p className="text-xs text-muted-foreground">Your {format === 'photo' ? 'photo' : 'video'} will be labeled as “{label}”.</p>
          ) : (
            <p className="text-xs text-destructive">You need to indicate if your content promotes yourself, a third party, or both.</p>
          )}
        </div>
      )}
      <SwitchRow id={`ai-${account.id}`} label="AI-generated content" hint="Adds TikTok’s AI-generated label." checked={!!options.aiGenerated} onChange={(v) => set({ aiGenerated: v })} />
      <p className="text-xs text-muted-foreground">
        By posting, you agree to TikTok’s{' '}
        {branded && (
          <>
            <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">
              Branded Content Policy
            </a>{' '}
            and{' '}
          </>
        )}
        <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">
          Music Usage Confirmation
        </a>
        . After it’s posted, it can take a few minutes to show on your profile.
      </p>
    </div>
  );
}

function CountedField({ label, hint, value, limit, onChange, single }: { label: string; hint?: string; value: string; limit: number; onChange: (v: string) => void; single?: boolean }) {
  const over = value.length > limit;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-xs text-muted-foreground">
          {label} {hint && <span className="font-normal">({hint})</span>}
        </Label>
        <span className={cn('text-xs text-muted-foreground tabular-nums', over && 'text-destructive')}>
          {value.length}/{limit}
        </span>
      </div>
      {single ? (
        <Input value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={over || undefined} aria-label={label} />
      ) : (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} aria-invalid={over || undefined} aria-label={label} className="min-h-16" />
      )}
    </div>
  );
}

function SwitchRow({ id, label, hint, checked, disabled, onChange }: { id: string; label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className={cn(disabled && 'opacity-50')}>
        <Label htmlFor={id} className="text-sm font-normal">
          {label}
        </Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function InlineSwitch({ id, label, checked, disabled, onChange }: { id: string; label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={cn('flex items-center gap-2', disabled && 'opacity-50')}>
      <Switch id={id} size="sm" checked={checked} disabled={disabled} onCheckedChange={onChange} />
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 text-xs text-muted-foreground">
      <Info className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
