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
  platformApps: Partial<Record<import('../../../shared/publish').PublishPlatform, { clientId: string; clientSecret: string }>>;
  /** This computer's public HTTPS address (Tailscale Funnel), for sign-in redirects and media the platforms fetch. */
  publicUrl: string;
  /** Signs the short-lived public links to media that Instagram and TikTok download. */
  publicLinkSecret: string;
  catchUpHours: number;
  /** TikTok's URL-prefix verification file, served at <publicUrl>/api/public/<name>. */
  tiktokVerification: { name: string; content: string };
  /** When Claude's weekly review of each workspace's posts runs. */
  weeklyReview: import('../../../shared/analytics').WeeklyReviewSetting;
  /** Firebase, for notifications to the Android app: the service-account key and the app's options. */
  fcm: import('./fcm').FcmSetting;
  /** Days after a campaign ends that its downloaded source videos are deleted; 0 keeps them. */
  sourceRetentionDays: number;
  /** The last read of my submissions page on Content Rewards. */
  submissionsSync: import('../campaigns/submissions').SubmissionsSync;
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
