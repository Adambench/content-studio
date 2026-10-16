// Signed-in windows: sites the desktop app keeps you signed in to, in its own browser session ("persist:sites",
// separate from the app's), so the server can read pages there through the desktop bridge. Shared by the desktop
// app (which opens the windows), the server (which asks it to read pages) and the web app (Settings → Connected sites).

export const SITE_IDS = ['whop', 'tiktok', 'instagram'] as const;
export type SiteId = (typeof SITE_IDS)[number];

export type SiteInfo = {
  id: SiteId;
  label: string;
  /** What the app reads there, for Settings. */
  use: string;
  signInUrl: string;
  /** The site's registrable domains: its cookies, and the storage cleared on sign out. */
  domains: string[];
  /** HttpOnly cookies that only exist while you're signed in. */
  sessionCookie: RegExp;
  /** Its sign-in pages: a read that lands on one ran into a login wall. */
  loginPath: RegExp;
};

export const SITES: Record<SiteId, SiteInfo> = {
  whop: {
    id: 'whop',
    label: 'Whop',
    use: 'Content Rewards campaigns you’ve joined: rules, source files and your submissions.',
    // Campaigns live on contentrewards.com, which has its own sign-in (email code or Google); whop.com is kept too.
    signInUrl: 'https://contentrewards.com/login',
    domains: ['contentrewards.com', 'whop.com'],
    // Its sign-in cookie isn't known yet (no account to try with): a best guess, to confirm on the laptop (PLAN.md).
    // Signed-out visitors get only `cr-surface` and Cloudflare's bot checks as HttpOnly cookies there.
    sessionCookie: /^(?!.*(csrf|xsrf)|cr-surface$|cr_session$|intercom-|__cf_bm$|_cfuvid$|cf_clearance$).*(auth|token|jwt|session|sid)/i,
    loginPath: /^\/(login|signin|sign-in)\b/,
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    use: 'Profiles you research and your own posts’ pages.',
    signInUrl: 'https://www.tiktok.com/login',
    domains: ['tiktok.com'],
    sessionCookie: /^(sessionid|sessionid_ss|sid_tt)$/,
    loginPath: /^\/login\b/,
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    use: 'Profiles you research and your own posts’ pages.',
    signInUrl: 'https://www.instagram.com/accounts/login/',
    domains: ['instagram.com'],
    sessionCookie: /^sessionid$/,
    loginPath: /^\/accounts\/login\b/,
  },
};

const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** The site a host belongs to (cookie domains may start with a dot). */
export function siteOfHost(host: string): SiteId | null {
  const h = host.replace(/^\./, '').toLowerCase();
  return SITE_IDS.find((id) => SITES[id].domains.some((d) => onDomain(h, d))) ?? null;
}

/** The site whose sign-in page `url` is, if any. */
export function loginWallAt(url: string): SiteId | null {
  try {
    const u = new URL(url);
    const site = siteOfHost(u.hostname);
    return site && SITES[site].loginPath.test(u.pathname) ? site : null;
  } catch {
    return null;
  }
}

/** A page as read in the signed-in session: its visible text and links, after waiting and scrolling. */
export type PageRead = {
  /** Where it ended up (after redirects). */
  url: string;
  title: string;
  text: string;
  /** `alt`: the alt text of the link's picture, when it has one (TikTok puts a video's caption there). */
  links: { href: string; text: string; alt?: string }[];
  /** The read landed on this site's sign-in page: sign in from Settings → Connected sites first. */
  loginWall: SiteId | null;
};

export type ReadOptions = {
  /** A CSS selector to wait for (up to 15 s), or extra milliseconds to wait after the page settles (up to 20 s). */
  waitFor?: string | number;
  /** How many screens to scroll down, for content that loads as you scroll (up to 20). */
  scrolls?: number;
};

export type SiteState = { id: SiteId; signedIn: boolean; windowOpen: boolean };
export type SitesStatus = {
  /** False outside the desktop app (e.g. `npm run dev:web`): nothing here works there. */
  available: boolean;
  sites: SiteState[];
  /** Pages read today and the daily cap. */
  reads: { today: number; cap: number };
};

/**
 * The desktop bridge: the server sends `{ id, ...BridgeRequest }` over the IPC channel the desktop app spawned it
 * with; the app answers `{ id, ok: true, result }` or `{ id, ok: false, error, code }`, and sends `{ event: 'sites' }`
 * on its own when a sign-in changes.
 */
export type BridgeRequest =
  | ({ op: 'read'; url: string } & ReadOptions)
  | { op: 'signin'; site: SiteId }
  // A visible window on one of the sites' pages (e.g. a campaign, to submit a clip there myself).
  | { op: 'open'; url: string }
  | { op: 'signout'; site: SiteId }
  | { op: 'status' };
export type BridgeErrorCode = 'cap' | 'bad-request' | 'failed';
export type BridgeReply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string; code: BridgeErrorCode };
