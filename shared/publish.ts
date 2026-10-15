// Scheduling and publishing: shapes and rules shared by the server and the web app.
import type { DraftContent } from './types';

export const PUBLISH_PLATFORMS = ['tiktok', 'instagram', 'youtube'] as const;
export type PublishPlatform = (typeof PUBLISH_PLATFORMS)[number];

export const PUBLISH_PLATFORM_LABELS: Record<PublishPlatform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
};

/** `reconnect`: the platform stopped accepting our tokens; posting needs a fresh sign-in. */
export type AccountStatus = 'connected' | 'reconnect';

/** A weekly posting time for an account's queue, in the computer's time zone. Days: 0 = Sunday. */
export type QueueSlot = { time: string; days: number[] };

export type AccountSettings = {
  /** TikTok: `inbox` sends a draft to the TikTok app to finish there (works before TikTok's audit); `direct` posts. */
  tiktokMode?: 'inbox' | 'direct';
};

/** What a scheduled post publishes. A photo post with several images is a carousel. */
export type PostFormat = 'video' | 'photo';
export type PostStatus = 'scheduled' | 'publishing' | 'published' | 'failed' | 'missed';

/**
 * The text of one post, copied from the piece's draft when it's scheduled (so later draft edits — or Claude's —
 * never change what goes out without a click). `caption` is TikTok's/Instagram's caption and YouTube's description;
 * `title` is YouTube's title and a TikTok photo post's title; `tags` are YouTube's tags.
 */
export type PostCopy = { caption: string; title: string; tags: string };

export type TikTokPrivacy = 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';
export const TIKTOK_PRIVACY_LABELS: Record<TikTokPrivacy, string> = {
  PUBLIC_TO_EVERYONE: 'Everyone',
  MUTUAL_FOLLOW_FRIENDS: 'Friends',
  FOLLOWER_OF_CREATOR: 'Followers',
  SELF_ONLY: 'Only me',
};
export type YouTubePrivacy = 'public' | 'unlisted' | 'private';

export type PostOptions = {
  // TikTok (direct posting): nothing is on by default, as TikTok's rules require.
  tiktokPrivacy?: TikTokPrivacy;
  allowComments?: boolean;
  allowDuet?: boolean;
  allowStitch?: boolean;
  /** Commercial content disclosure: promoting your own business / a paid partnership. */
  discloseContent?: boolean;
  yourBrand?: boolean;
  brandedContent?: boolean;
  aiGenerated?: boolean;
  /** TikTok photo posts: let TikTok add recommended music. */
  autoAddMusic?: boolean;
  // Instagram
  shareToFeed?: boolean;
  // YouTube
  youtubePrivacy?: YouTubePrivacy;
  madeForKids?: boolean;
};

export type CreatorInfo = {
  nickname: string;
  username: string;
  avatarUrl: string;
  privacyOptions: TikTokPrivacy[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoSeconds: number;
};

/** Limits the platforms enforce (checked before scheduling so a post doesn't fail at its time). */
export const PUBLISH_LIMITS = {
  tiktok: { caption: 2200, photoTitle: 90, photoCaption: 4000, maxPhotos: 35, minSeconds: 1, maxSeconds: 600, maxBytes: 4 * 1024 ** 3 },
  instagram: { caption: 2200, hashtags: 30, maxPhotos: 10, minSeconds: 3, maxSeconds: 15 * 60, maxBytes: 1024 ** 3 },
  youtube: { title: 100, description: 5000, tags: 500, shortsSeconds: 180 },
} as const;

/** Hours a post may run late (computer asleep or off at its time) and still go out; later than that it waits for you. */
export const CATCH_UP_CHOICES = [
  { hours: 0, label: 'No — ask me what to do' },
  { hours: 1, label: 'Yes, up to 1 hour late' },
  { hours: 3, label: 'Yes, up to 3 hours late' },
  { hours: 12, label: 'Yes, up to 12 hours late' },
  { hours: 24 * 365, label: 'Yes, however late' },
] as const;
export const DEFAULT_CATCH_UP_HOURS = 3;

const joinNonEmpty = (parts: string[], sep = '\n\n') => parts.map((p) => p.trim()).filter(Boolean).join(sep);

/** The text a post starts with, from the piece's draft. */
export function copyFromDraft(platform: PublishPlatform, d: DraftContent, format: PostFormat): PostCopy {
  switch (platform) {
    case 'tiktok':
      return {
        caption: joinNonEmpty([d.platforms.tiktok.caption, d.platforms.tiktok.hashtags]),
        // Photo posts have a separate short title.
        title: format === 'photo' ? d.hook.trim().slice(0, PUBLISH_LIMITS.tiktok.photoTitle) : '',
        tags: '',
      };
    case 'instagram':
      return { caption: joinNonEmpty([d.platforms.instagram.caption, d.platforms.instagram.hashtags]), title: '', tags: '' };
    case 'youtube':
      return { caption: d.platforms.youtube.description.trim(), title: (d.platforms.youtube.title || d.hook).trim().slice(0, PUBLISH_LIMITS.youtube.title), tags: d.platforms.youtube.tags.trim() };
  }
}

export const splitTags = (tags: string) =>
  tags
    .split(/[,\n]/)
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean);

export type PostProblem = { level: 'error' | 'warning'; message: string };

/** What the post's media looks like, for the checks below. */
export type PostMediaInfo = { kind: string; durationMs: number | null; size: number; width: number | null; height: number | null };

/**
 * Everything that would make a post fail (errors) or surprise (warnings), for one platform. The server runs this
 * before saving; the schedule dialog shows the same messages.
 */
export function postProblems(input: {
  platform: PublishPlatform;
  format: PostFormat;
  copy: PostCopy;
  options: PostOptions;
  media: PostMediaInfo[];
  tiktokMode?: 'inbox' | 'direct';
  hasPublicUrl: boolean;
}): PostProblem[] {
  const { platform, format, copy, options, media } = input;
  const out: PostProblem[] = [];
  const error = (message: string) => out.push({ level: 'error', message });
  const warn = (message: string) => out.push({ level: 'warning', message });
  const seconds = (media[0]?.durationMs ?? 0) / 1000;

  if (!media.length) error('Choose what to post.');
  if (format === 'video' && (media.length !== 1 || media[0].kind !== 'video')) error('A video post needs exactly one video.');
  if (format === 'photo' && media.some((m) => m.kind !== 'image')) error('A photo post can only contain photos.');

  if (platform === 'tiktok') {
    const L = PUBLISH_LIMITS.tiktok;
    if (format === 'video') {
      if (copy.caption.length > L.caption) error(`TikTok captions can be ${L.caption} characters at most.`);
      if (media[0] && seconds > L.maxSeconds) error(`TikTok takes videos up to ${L.maxSeconds / 60} minutes through its API.`);
      if (media[0] && media[0].size > L.maxBytes) error('TikTok takes videos up to 4 GB.');
    } else {
      if (copy.title.length > L.photoTitle) error(`TikTok photo titles can be ${L.photoTitle} characters at most.`);
      if (copy.caption.length > L.photoCaption) error(`TikTok photo descriptions can be ${L.photoCaption} characters at most.`);
      if (media.length > L.maxPhotos) error(`TikTok photo posts take up to ${L.maxPhotos} photos.`);
      if (!input.hasPublicUrl) error('TikTok fetches photos from your public address — set it up in Settings → Publishing.');
      else warn('TikTok photo posts need your public address verified in the TikTok developer portal (Settings → Publishing).');
    }
    if (input.tiktokMode === 'direct') {
      if (!options.tiktokPrivacy) error('Choose who can see it on TikTok.');
      if (options.discloseContent && !options.yourBrand && !options.brandedContent) error('You need to indicate if your content promotes yourself, a third party, or both.');
      if (options.discloseContent && options.brandedContent && options.tiktokPrivacy === 'SELF_ONLY') error('Branded content visibility cannot be set to private.');
    }
  }

  if (platform === 'instagram') {
    const L = PUBLISH_LIMITS.instagram;
    if (!input.hasPublicUrl) error('Instagram fetches media from your public address — set it up in Settings → Publishing.');
    if (copy.caption.length > L.caption) error(`Instagram captions can be ${L.caption} characters at most.`);
    if ((copy.caption.match(/(^|\s)#[^\s#]+/g) ?? []).length > L.hashtags) error(`Instagram allows ${L.hashtags} hashtags at most.`);
    if (format === 'video' && media[0]) {
      if (seconds && seconds < L.minSeconds) error(`Reels must be at least ${L.minSeconds} seconds long.`);
      if (seconds > L.maxSeconds) error('Reels can be 15 minutes at most.');
      if (media[0].size > L.maxBytes) error('Reels can be 1 GB at most.');
    }
    if (format === 'photo' && media.length > L.maxPhotos) error(`Instagram carousels take up to ${L.maxPhotos} photos.`);
    if (format === 'photo' && media.some((m) => m.width && m.height && (m.width / m.height < 0.8 || m.width / m.height > 1.91))) {
      warn('Instagram photos must be between 4:5 and 1.91:1 — taller or wider ones are cropped from the centre.');
    }
  }

  if (platform === 'youtube') {
    const L = PUBLISH_LIMITS.youtube;
    if (format !== 'video') error('YouTube only takes videos.');
    if (!copy.title.trim()) error('YouTube needs a title.');
    if (copy.title.length > L.title) error(`YouTube titles can be ${L.title} characters at most.`);
    if (copy.caption.length > L.description) error(`YouTube descriptions can be ${L.description} characters at most.`);
    if (splitTags(copy.tags).join(',').length > L.tags) error(`YouTube tags can add up to ${L.tags} characters at most.`);
    if (format === 'video' && seconds > L.shortsSeconds) warn('Longer than 3 minutes, so it will be a regular video rather than a Short.');
    if (format === 'video' && media[0]?.width && media[0]?.height && media[0].width > media[0].height) warn('Horizontal videos aren’t Shorts.');
  }
  return out;
}

/** Next times a queue's slots come round after `after` (ms), in this machine's time zone, soonest first. */
export function upcomingSlotTimes(slots: QueueSlot[], after: number, days = 60): number[] {
  const times: number[] = [];
  const start = new Date(after);
  for (let d = 0; d <= days; d++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d);
    for (const slot of slots) {
      if (!slot.days.includes(day.getDay())) continue;
      const [h, m] = slot.time.split(':').map(Number);
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
      if (at > after) times.push(at);
    }
  }
  return [...new Set(times)].sort((a, b) => a - b);
}
