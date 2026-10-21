// Research: what's working in a page's niche. A daily sweep (no Claude) lists the Shorts, TikToks and Reels of the
// accounts a page watches, finds the outliers (views far above their account's usual), and a daily brief (Haiku)
// turns them into patterns, ideas and hooks for the page. Any video can also be analysed: its hook, structure and
// edit, explained (never copied). Shared by the server and the web app.

export const RESEARCH_PLATFORMS = ['youtube', 'tiktok', 'instagram'] as const;
export type ResearchPlatform = (typeof RESEARCH_PLATFORMS)[number];

/** What a page watches. YouTube channels by link (a handle or channel page); TikTok and Instagram by handle. */
export type ResearchSettings = {
  keywords: string[];
  youtube: { url: string; name: string }[];
  tiktok: string[];
  instagram: string[];
};

export const RESEARCH_LIMITS = { keywords: 5, youtube: 20, tiktok: 20, instagram: 20 } as const;

/** A post is an outlier at this many times its account's median views. */
export const OUTLIER_AT = 3;

const handle = (h: string) =>
  h
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?(tiktok|instagram)\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0]
    .trim();

/** A YouTube channel link from a pasted handle, @handle or link; null if it isn't one. */
export function youtubeChannelUrl(input: string) {
  const s = input.trim();
  if (/^@[\w.-]{2,}$/.test(s)) return `https://www.youtube.com/${s}`;
  try {
    const u = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`);
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
    const m = /^\/(@[\w.-]+|channel\/[\w-]+|c\/[\w.-]+|user\/[\w.-]+)/.exec(u.pathname);
    return m ? `https://www.youtube.com/${m[1]}` : null;
  } catch {
    return null;
  }
}

export function normalizeResearch(input: unknown): ResearchSettings {
  const r = (input ?? {}) as Partial<ResearchSettings>;
  const uniq = (list: string[]) => [...new Set(list.filter(Boolean))];
  const youtube: ResearchSettings['youtube'] = [];
  for (const c of Array.isArray(r.youtube) ? r.youtube : []) {
    const url = c && typeof c.url === 'string' ? youtubeChannelUrl(c.url) : null;
    if (url && !youtube.some((x) => x.url.toLowerCase() === url.toLowerCase())) youtube.push({ url, name: typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 100) : url.split('/').pop()! });
  }
  return {
    keywords: uniq((Array.isArray(r.keywords) ? r.keywords : []).map((k) => String(k).trim().slice(0, 80))).slice(0, RESEARCH_LIMITS.keywords),
    youtube: youtube.slice(0, RESEARCH_LIMITS.youtube),
    tiktok: uniq((Array.isArray(r.tiktok) ? r.tiktok : []).map((h) => handle(String(h)).toLowerCase())).slice(0, RESEARCH_LIMITS.tiktok),
    instagram: uniq((Array.isArray(r.instagram) ? r.instagram : []).map((h) => handle(String(h)).toLowerCase())).slice(0, RESEARCH_LIMITS.instagram),
  };
}

export const watchesAnything = (r: ResearchSettings) => r.keywords.length + r.youtube.length + r.tiktok.length + r.instagram.length > 0;

/**
 * `watch`: from an account the page watches; `search`: from a keyword search; `link`: a link I pasted; `library`: a
 * video in the library; `saved`: a post I saved to Ideas (shared from the phone, pasted on the canvas).
 */
export type ResearchSource = 'watch' | 'search' | 'link' | 'library' | 'saved';
export type AnalysisStatus = 'none' | 'queued' | 'running' | 'done' | 'error';

/** Claude's look at one video: how it hooks, how it's built and edited, and what the page can take from it. */
export type ResearchAnalysis = {
  hook: { spoken: string; onScreen: string; visual: string; why: string };
  structure: { at: string; what: string }[];
  edit: { pace: string; captions: string; visuals: string; sound: string };
  whyItWorks: string;
  /** For this page, in its niche: formats and moves to borrow, never the words. */
  takeaways: string[];
  /** Halal or other concerns about the video (music, what it promotes), so it isn't copied blindly. */
  cautions: string[];
  /** Measured, not judged: length, cuts, speech pace. */
  metrics: { seconds: number | null; cuts: number | null; cutsPerSecond: number | null; wordsPerSecond: number | null; firstWords: string };
};

/** Where a researched video is: a platform, or `file` for a video in the library. */
export type ItemPlatform = ResearchPlatform | 'file';

export type ResearchItem = {
  id: string;
  workspaceId: string;
  platform: ItemPlatform;
  externalId: string;
  url: string;
  channel: string;
  channelUrl: string | null;
  /** The title (YouTube) or caption (TikTok, Instagram). */
  title: string;
  views: number | null;
  /** The account's median views and this post's views over it (outliers are at OUTLIER_AT or more). */
  channelMedian: number | null;
  score: number | null;
  postedAt: number | null;
  /** The first words spoken, from YouTube's captions. */
  hook: string;
  source: ResearchSource;
  keyword: string | null;
  mediaId: string | null;
  analysis: ResearchAnalysis | null;
  analysisStatus: AnalysisStatus;
  analysisError: string | null;
  transcript: string;
  firstSeenAt: number;
  lastSeenAt: number;
};

/** `pieceId`: added to a clipping page's board; `ideaId`: saved to a page's Ideas. */
export type BriefIdea = { title: string; hook: string; why: string; pieceId?: string; ideaId?: string };

export type ResearchBriefBody = {
  headline: string;
  /** Formulas that over-perform now, each with the outliers that show it. */
  patterns: { pattern: string; why: string; examples: string[] }[];
  topics: string[];
  ideas: BriefIdea[];
  /** Opening lines shaped for this page. */
  hooks: string[];
  /** On a clipping page: what kind of moments to look for in sources. */
  forClips: string;
};

export type ResearchBrief = {
  id: string;
  workspaceId: string;
  /** Local date, yyyy-mm-dd. */
  day: string;
  status: 'running' | 'done' | 'error';
  body: ResearchBriefBody | null;
  /** What the sweep found, in a line ("12 accounts, 4 outliers"). */
  sweep: string;
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
};

/** A channel "Find channels for me" suggests: found in searches for the page's keywords. */
export type ChannelSuggestion = { name: string; url: string; hits: number; medianViews: number | null; sample: string };

export type ResearchOverview = {
  settings: ResearchSettings;
  /** The latest brief that finished. */
  brief: ResearchBrief | null;
  /** A sweep or brief is under way. */
  running: boolean;
  /** Why the newest run failed, if it did. */
  error: string | null;
  /** The outliers of the last few weeks, best first. */
  outliers: ResearchItem[];
  /** Videos I asked to have analysed, newest first. */
  analyses: ResearchItem[];
  /** Reading TikTok and Instagram profiles needs the desktop app. */
  desktop: boolean;
};

/** "1.2M" → 1200000, "15,3 k" → 15300; null when there's no number. */
export function parseCount(text: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*([KkMmBb])?(?![\w])/.exec(text.replace(/(\d),(\d{3})\b/g, '$1$2'));
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  const unit = m[2]?.toUpperCase();
  return Math.round(n * (unit === 'K' ? 1e3 : unit === 'M' ? 1e6 : unit === 'B' ? 1e9 : 1));
}

/** When a TikTok video was posted, from its id (the top 32 bits are the Unix time). */
export function tiktokPostedAt(id: string) {
  try {
    const s = Number(BigInt(id) >> 32n);
    return s > 1.4e9 && s < 4e9 ? s * 1000 : null;
  } catch {
    return null;
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** When an Instagram post was posted, from its shortcode (a media id whose top bits are ms since Instagram's epoch). */
export function instagramPostedAt(code: string) {
  try {
    let id = 0n;
    for (const ch of code.slice(0, 11)) {
      const v = B64.indexOf(ch);
      if (v < 0) return null;
      id = id * 64n + BigInt(v);
    }
    const ms = Number(id >> 23n) + 1314220021721;
    return ms > 1.3e12 && ms < 4e12 ? ms : null;
  } catch {
    return null;
  }
}
