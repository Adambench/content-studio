import { AlertCircle, CheckCircle2, Clock, Inbox, TimerOff } from 'lucide-react';
import { useState } from 'react';
import { PUBLISH_PLATFORM_LABELS, type PostStatus, type PublishPlatform } from '@shared/publish';
import { Spinner } from '@/components/ui/spinner';
import type { Account, Post } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Simplified platform marks, drawn in the platform's colour so posts are recognisable at a glance. */
export function PlatformIcon({ platform, className }: { platform: PublishPlatform; className?: string }) {
  const common = { viewBox: '0 0 24 24', 'aria-hidden': true, className: cn('size-4 shrink-0', className) } as const;
  if (platform === 'youtube')
    return (
      <svg {...common} className={cn(common.className, 'text-red-500')}>
        <rect x="2" y="5" width="20" height="14" rx="4.5" fill="currentColor" />
        <path d="M10 9.2v5.6l4.8-2.8z" fill="white" />
      </svg>
    );
  if (platform === 'instagram')
    return (
      <svg {...common} className={cn(common.className, 'text-pink-400')} fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="5.5" />
        <circle cx="12" cy="12" r="4.2" />
        <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    );
  return (
    <svg {...common} className={cn(common.className, 'text-cyan-300')} fill="currentColor">
      <path d="M13.2 2h3.1c.3 2.4 1.8 4 4.2 4.3v3.2c-1.6 0-3-.5-4.2-1.3v6.6a6.1 6.1 0 1 1-6.1-6.1c.3 0 .6 0 .9.1v3.3a2.9 2.9 0 1 0 2.1 2.8z" />
    </svg>
  );
}

export function AccountAvatar({ account, platform, className }: { account: Pick<Account, 'avatarUrl' | 'name' | 'handle'> | null; platform: PublishPlatform; className?: string }) {
  // Platforms hand out profile pictures as expiring links; fall back to an initial when one has lapsed.
  const [broken, setBroken] = useState(false);
  return (
    <span className={cn('relative inline-block size-7 shrink-0', className)}>
      {account?.avatarUrl && !broken ? (
        <img src={account.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-full rounded-full bg-muted object-cover" />
      ) : (
        <span className="grid size-full place-items-center rounded-full bg-muted text-[11px] font-medium uppercase">{(account?.handle || account?.name || '?').slice(0, 1)}</span>
      )}
      <span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-background">
        <PlatformIcon platform={platform} className="size-3" />
      </span>
    </span>
  );
}

export const accountName = (a: Pick<Account, 'handle' | 'name'> | null | undefined, fallback = '') => (a ? (a.handle ? `@${a.handle}` : a.name) : fallback);

/** A TikTok post that landed in the inbox still needs finishing in the TikTok app. */
export const isInbox = (p: Pick<Post, 'status' | 'stage'>) => p.status === 'published' && p.stage.startsWith('In your TikTok inbox');

export const STATUS_LABELS: Record<PostStatus, string> = { scheduled: 'Scheduled', publishing: 'Posting', published: 'Posted', failed: 'Failed', missed: 'Missed' };

export function StatusIcon({ post, className }: { post: Pick<Post, 'status' | 'stage'>; className?: string }) {
  const c = cn('size-3.5 shrink-0', className);
  switch (post.status) {
    case 'scheduled':
      return <Clock className={cn(c, 'text-muted-foreground')} />;
    case 'publishing':
      return <Spinner className={c} />;
    case 'published':
      return isInbox(post) ? <Inbox className={cn(c, 'text-cyan-300')} /> : <CheckCircle2 className={cn(c, 'text-emerald-400')} />;
    case 'failed':
      return <AlertCircle className={cn(c, 'text-destructive')} />;
    case 'missed':
      return <TimerOff className={cn(c, 'text-amber-400')} />;
  }
}

export const statusText = (p: Pick<Post, 'status' | 'stage'>) => (isInbox(p) ? 'In TikTok inbox' : STATUS_LABELS[p.status]);

export const needsAttention = (p: Pick<Post, 'status'>) => p.status === 'failed' || p.status === 'missed';

export const platformLabel = (p: PublishPlatform) => PUBLISH_PLATFORM_LABELS[p];

export function formatWhen(ms: number, opts: { weekday?: boolean } = {}) {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, { weekday: opts.weekday === false ? undefined : 'short', month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const formatTime = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** yyyy-mm-dd and hh:mm in local time, for native date and time inputs. */
export function toInputs(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export function fromInputs(date: string, time: string) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, min).getTime();
}

/** The first day of the week in this locale (0 = Sunday), where the browser knows it. */
export function firstDayOfWeek() {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const first = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    return first ? first % 7 : 1;
  } catch {
    return 1;
  }
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
