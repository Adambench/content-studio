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
  /** Channels and playlists each campaign lists videos from (by campaign id), so the finder can list them again. */
  sourceListings: Record<string, string[]>;
  /** Videos deleted from each campaign (canonical links, by campaign id), so a fresh listing doesn't add them back. */
  removedSources: Record<string, string[]>;
  /** The finder's last run on each clipping page (by workspace id). */
  finderRuns: Record<string, import('../../../shared/finder').FinderRun>;
  /** Whether each clipping page's finder runs by itself each morning (default on). */
  finderAuto: Record<string, boolean>;
  /** Which model answers each AI task (shared/ai.ts). */
  aiRouting: Partial<import('../../../shared/ai').AiRouting>;
  /** The self-hosted model server. */
  localAi: Partial<import('../../../shared/ai').LocalAiConfig>;
  /** When video clips may be generated (shared/generate.ts). */
  generation: Partial<import('../../../shared/generate').GenerationSettings>;
  /** Hosted generation (shared/hosted.ts): backend per kind, prices, daily cap. */
  hosted: Partial<import('../../../shared/hosted').HostedSettings>;
  /** The kie.ai API key: write-only, never sent to the UI. */
  hostedKey: string;
  /** Claude refused for usage: tasks on auto skip it until then (ms). */
  claudeLimitedUntil: number;
  /** Campaigns found on Content Rewards that aren't added yet. */
  campaignLeads: import('../../../shared/finder').CampaignLeads;
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
