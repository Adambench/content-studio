import { eq } from 'drizzle-orm';
import { db, schema } from '../db';

type SettingsShape = {
  passwordHash: string;
  cookieSecret: string;
  vapid: { publicKey: string; privateKey: string };
  defaultModel: string;
  whisperModel: string;
  lastWorkspaceId: string;
  claudeUsage: import('../../../shared/types').ClaudeUsage;
  /** The developer apps registered with each platform (one per platform, shared by every workspace). */
  platformApps: Partial<Record<import('../../../shared/publish').PublishPlatform, import('../publish/platforms/http').AppCredentials>>;
  /** This computer's public HTTPS address (Tailscale Funnel), for sign-in redirects and media the platforms fetch. */
  publicUrl: string;
  /** Signs the short-lived public links to media that Instagram and TikTok download. */
  publicLinkSecret: string;
  catchUpHours: number;
  /** Firebase, for notifications to the Android app: the service-account key and the app's options. */
  fcm: import('./fcm').FcmSetting;
  /** Days after a campaign ends that its downloaded source videos are deleted; 0 keeps them. */
  sourceRetentionDays: number;
  /** Channels and playlists each campaign lists videos from (by campaign id), so the finder can list them again. */
  sourceListings: Record<string, string[]>;
  /** Videos deleted from each campaign (canonical links, by campaign id), so a fresh listing doesn't add them back. */
  removedSources: Record<string, string[]>;
  /** Claude refused for usage: tasks on auto skip it until then (ms). */
  claudeLimitedUntil: number;
  /** The skills' source repos as the scout last read them from GitHub (licence, stars, last push). */
  toolboxRepos: Record<string, import('../toolbox/inventory').RepoInfo>;
  /** When the one-off move to Phase 14 ran (db/phase14.ts). */
  phase14: number;
  /** The Toolbox's weekly scout: its last run. */
  toolScout: import('../../../shared/toolbox').ScoutRun;
};

export function getSetting<K extends keyof SettingsShape>(key: K): SettingsShape[K] | undefined {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  return row?.value as SettingsShape[K] | undefined;
}

export function setSetting<K extends keyof SettingsShape>(key: K, value: SettingsShape[K]) {
  db.insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
    .run();
}
