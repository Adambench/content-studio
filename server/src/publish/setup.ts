import { execFile as execFileCb } from 'node:child_process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PUBLISH_PLATFORM_LABELS, type PublishPlatform } from '../../../shared/publish';
import { config } from '../config';
import { findBinary, requireBinary } from '../lib/bin';
import { getSetting, setSetting } from '../lib/settings';
import { mediaPath, type MediaRow } from '../services/media';
import { PlatformError } from './platforms';

const execFile = promisify(execFileCb);

/** This computer's public HTTPS address (Tailscale Funnel), without a trailing slash. */
export const publicUrl = () => getSetting('publicUrl')?.replace(/\/+$/, '') || null;

/**
 * Where a platform sends you back after signing in. TikTok and Meta insist on HTTPS, so they need the public
 * address; Google also accepts this computer's own address.
 */
export function redirectUri(platform: PublishPlatform) {
  const base = publicUrl() ?? (platform === 'youtube' ? `http://localhost:${config.port}` : null);
  return base ? `${base}/api/oauth/${platform}/callback` : null;
}

export function platformApp(platform: PublishPlatform) {
  const app = getSetting('platformApps')?.[platform];
  return app?.clientId && app.clientSecret && (platform !== 'instagram' || app.configId) ? app : null;
}

export function requireApp(platform: PublishPlatform) {
  const app = platformApp(platform);
  if (!app) throw new PlatformError(`Add your ${PUBLISH_PLATFORM_LABELS[platform]} developer app in Settings → Publishing first.`, 'fatal');
  return app;
}

/** The Funnel address Tailscale gives this machine, if Tailscale is installed and signed in. */
export async function detectTailscaleUrl() {
  const bin = findBinary('tailscale');
  if (!bin) return null;
  try {
    const { stdout } = await execFile(bin, ['status', '--json'], { timeout: 5000 });
    const name = String(JSON.parse(stdout)?.Self?.DNSName ?? '').replace(/\.$/, '');
    return name ? `https://${name}` : null;
  } catch {
    return null;
  }
}

// ---------- short-lived public links to media ----------

/** A copy of a file in the shape a platform wants: Instagram takes JPEGs between 4:5 and 1.91:1, TikTok JPEGs up to 1080p. */
export type MediaVariant = 'file' | 'instagram' | 'tiktok';
const VARIANT_FILTERS: Record<Exclude<MediaVariant, 'file'>, string> = {
  instagram: "crop=w='min(iw,ih*1.91)':h='min(ih,iw/0.8)',scale=w='min(1440,iw)':h=-2",
  tiktok: 'scale=w=1080:h=1920:force_original_aspect_ratio=decrease',
};
const LINK_TTL = 24 * 60 * 60_000;

function linkSecret() {
  let secret = getSetting('publicLinkSecret');
  if (!secret) {
    secret = randomBytes(32).toString('base64url');
    setSetting('publicLinkSecret', secret);
  }
  return secret;
}

const sign = (payload: string) => createHmac('sha256', linkSecret()).update(payload).digest('base64url').slice(0, 32);

export function verifyLink(token: string): { mediaId: string; variant: MediaVariant } | null {
  const [mediaId, variant, exp, sig] = token.split('.');
  if (!mediaId || !variant || !exp || !sig || !['file', 'instagram', 'tiktok'].includes(variant)) return null;
  const expected = sign(`${mediaId}.${variant}.${exp}`);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  return { mediaId, variant: variant as MediaVariant };
}

export const variantPath = (mediaId: string, variant: Exclude<MediaVariant, 'file'>) => join(config.cacheDir, 'public', `${mediaId}-${variant}.jpg`);

/** The file a public link serves, converted first if the platform needs another format. */
export async function variantFile(m: MediaRow, variant: MediaVariant) {
  if (variant === 'file') return { path: mediaPath(m), mime: m.mime };
  const out = variantPath(m.id, variant);
  if (!existsSync(out)) {
    await mkdir(join(config.cacheDir, 'public'), { recursive: true });
    const tmp = `${out}.part.jpg`;
    try {
      await execFile(requireBinary('ffmpeg'), ['-y', '-v', 'error', '-i', mediaPath(m), '-frames:v', '1', '-vf', VARIANT_FILTERS[variant], '-q:v', '2', tmp]);
      await rename(tmp, out);
    } catch (err) {
      await rm(tmp, { force: true });
      throw new PlatformError(`Couldn’t prepare “${m.originalName}” for posting (${(err as Error).message.split('\n')[0]}).`, 'fatal');
    }
  }
  return { path: out, mime: 'image/jpeg' };
}

/** A link the platform can download the file from for the next day; nothing else on this computer is reachable with it. */
export async function publicMediaUrl(m: MediaRow, variant: MediaVariant) {
  const base = publicUrl();
  if (!base) throw new PlatformError('This needs your public address (Settings → Publishing), so the platform can fetch the file.', 'fatal');
  // Convert now, so the platform's download doesn't wait on it.
  const { path } = await variantFile(m, variant);
  const exp = Date.now() + LINK_TTL;
  const payload = `${m.id}.${variant}.${exp}`;
  const ext = variant === 'file' ? (path.match(/\.[a-z0-9]+$/i)?.[0] ?? '') : '.jpg';
  return `${base}/api/public/media/${payload}.${sign(payload)}/${m.id}${ext}`;
}
