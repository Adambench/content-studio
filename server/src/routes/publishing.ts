import { basename, dirname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CATCH_UP_CHOICES, DEFAULT_CATCH_UP_HOURS, PUBLISH_PLATFORM_LABELS, PUBLISH_PLATFORMS, type PublishPlatform } from '../../../shared/publish';
import { config } from '../config';
import { emit } from '../lib/events';
import { badRequest, HttpError, notFound } from '../lib/http';
import { getSetting, setSetting } from '../lib/settings';
import { getMedia } from '../services/media';
import { getWorkspace } from '../services/pieces';
import { accessToken, disconnectAccount, finishConnect, getAccount, listAccounts, pickAccounts, pickOpen, publicAccount, refreshProfiles, startConnect, updateAccount } from '../publish/accounts';
import { PlatformError, type AccountRow } from '../publish/platforms';
import { creatorInfo } from '../publish/platforms/tiktok';
import { createPosts, deletePost, getPost, listPosts, piecePosts, planPosts, postDetail, postNow, scheduleSchema, stopPost, updatePost, updateSchema, upcomingPosts } from '../publish/posts';
import { kickScheduler } from '../publish/scheduler';
import { detectTailscaleUrl, platformApp, publicUrl, redirectUri, variantFile, verifyLink } from '../publish/setup';

const platformParam = z.object({ platform: z.enum(PUBLISH_PLATFORMS) });
const slotSchema = z.object({ time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), days: z.array(z.number().int().min(0).max(6)).max(7) });

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The page the browser lands on after signing in to a platform (often the system browser, not the app). */
function callbackPage(ok: boolean | null, title: string, body: string, back?: string, extra = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Content Studio</title>
<style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c0c10;color:#ececf1;font:15px/1.5 system-ui,sans-serif;padding:16px;box-sizing:border-box}
main{max-width:420px;text-align:center}h1{font-size:18px;margin:12px 0 4px}p{color:#a1a1aa;margin:0 0 16px}.mark{font-size:28px;color:${ok === null ? '#a78bfa' : ok ? '#34d399' : '#f87171'}}a{color:#a78bfa}
form{display:flex;gap:8px;margin:0 0 16px}input{flex:1;min-width:0;background:#18181b;border:1px solid #3f3f46;border-radius:8px;color:inherit;padding:8px 10px;font:inherit}button{background:#7c3aed;border:0;border-radius:8px;color:#fff;padding:8px 14px;font:inherit;cursor:pointer}p.error{color:#f87171}</style></head>
<body><main><div class="mark">${ok === null ? '?' : ok ? '✓' : '!'}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>${extra}${back ? `<a href="${escapeHtml(back)}">Open Content Studio</a>` : ''}</main></body></html>`;
}

/** The form for naming accounts a sign-in was for, when the platform listed none (Instagram's Unified login). */
function pickForm(platform: PublishPlatform, pick: string, error?: string) {
  return `${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}<form method="get" action="/api/oauth/${platform}/pick"><input type="hidden" name="pick" value="${escapeHtml(pick)}"><input name="accounts" required autofocus autocomplete="off" placeholder="17841… or @handle" aria-label="Account ID or @handle"><button>Connect</button></form>`;
}

const PICK_HELP =
  'Meta didn’t say which Instagram account you picked. Paste its account ID: in your Meta app, API setup with Unified login → Generate access tokens, the number under its name. Separate several with commas. Once one account is connected, @handles work too.';

function connectedPage(platform: PublishPlatform, accounts: AccountRow[], pick?: string) {
  const label = PUBLISH_PLATFORM_LABELS[platform];
  if (!accounts.length) return callbackPage(null, `Which ${label} account?`, PICK_HELP, undefined, pickForm(platform, pick!));
  const names = accounts.map((a) => (a.handle ? `@${a.handle}` : a.name)).join(', ');
  const another = pick ? `<p>Another account for this page? Paste its ID or @handle.</p>${pickForm(platform, pick)}` : '';
  return callbackPage(true, `${label} connected`, `${names} ${accounts.length > 1 ? 'are' : 'is'} connected to Content Studio. You can close this tab.`, `/w/${accounts[0].workspaceId}/accounts`, another);
}

function setupInfo() {
  const apps = getSetting('platformApps') ?? {};
  return {
    publicUrl: publicUrl(),
    catchUpHours: getSetting('catchUpHours') ?? DEFAULT_CATCH_UP_HOURS,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tiktokVerification: getSetting('tiktokVerification')?.name ?? null,
    platforms: Object.fromEntries(
      PUBLISH_PLATFORMS.map((p) => [
        p,
        { configured: !!platformApp(p), clientId: apps[p]?.clientId ?? '', configId: apps[p]?.configId ?? '', hasSecret: !!apps[p]?.clientSecret, redirectUri: redirectUri(p) },
      ]),
    ) as Record<PublishPlatform, { configured: boolean; clientId: string; configId: string; hasSecret: boolean; redirectUri: string | null }>,
  };
}

export async function publishingRoutes(app: FastifyInstance) {
  // ---------- app-wide setup (Settings → Publishing) ----------

  app.get('/api/publishing/setup', async () => setupInfo());

  app.patch('/api/publishing/setup', async (req) => {
    const body = z
      .object({
        publicUrl: z
          .string()
          .trim()
          .refine((v) => v === '' || /^https:\/\/[^/\s]+$/.test(v.replace(/\/+$/, '')), 'Use the https:// address only, like https://laptop.tail1234.ts.net')
          .optional(),
        catchUpHours: z.number().refine((h) => CATCH_UP_CHOICES.some((c) => c.hours === h)).optional(),
      })
      .parse(req.body);
    if (body.publicUrl !== undefined) setSetting('publicUrl', body.publicUrl.replace(/\/+$/, ''));
    if (body.catchUpHours !== undefined) setSetting('catchUpHours', body.catchUpHours);
    emit({ type: 'changed', entity: 'settings' });
    return setupInfo();
  });

  app.put<{ Params: { platform: string } }>('/api/publishing/apps/:platform', async (req) => {
    const { platform } = platformParam.parse(req.params);
    const body = z
      .object({ clientId: z.string().trim().min(1).max(200), clientSecret: z.string().trim().max(500).optional(), configId: z.string().trim().max(200).optional() })
      .parse(req.body);
    const apps = getSetting('platformApps') ?? {};
    const clientSecret = body.clientSecret || apps[platform]?.clientSecret;
    if (!clientSecret) throw badRequest('Add the client secret too.');
    if (platform === 'instagram' && !body.configId) throw badRequest('Add the configuration ID too (Facebook Login for Business → Configurations).');
    setSetting('platformApps', { ...apps, [platform]: { clientId: body.clientId, clientSecret, ...(body.configId && { configId: body.configId }) } });
    emit({ type: 'changed', entity: 'settings' });
    return setupInfo();
  });

  app.delete<{ Params: { platform: string } }>('/api/publishing/apps/:platform', async (req) => {
    const { platform } = platformParam.parse(req.params);
    const { [platform]: _removed, ...rest } = getSetting('platformApps') ?? {};
    setSetting('platformApps', rest);
    emit({ type: 'changed', entity: 'settings' });
    return setupInfo();
  });

  app.post('/api/publishing/detect-url', async () => ({ url: await detectTailscaleUrl() }));

  // Ask the public address for our own health check: proves the Funnel reaches this app.
  app.post('/api/publishing/check-url', async () => {
    const base = publicUrl();
    if (!base) throw badRequest('Set the public address first.');
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10_000), redirect: 'manual' });
      if (res.ok) return { ok: true, message: 'Reachable — the platforms can reach Content Studio at this address.' };
      return { ok: false, message: `The address answered with HTTP ${res.status}. Is the Funnel pointing at port ${config.port}?` };
    } catch (err) {
      return { ok: false, message: `Couldn’t reach it (${(err as Error).cause ? String((err as { cause: Error }).cause.message) : (err as Error).message}). Is Tailscale running with the Funnel on?` };
    }
  });

  app.put('/api/publishing/tiktok-verification', async (req) => {
    const body = z.object({ name: z.string().regex(/^tiktok[\w-]{1,120}\.txt$/, 'That doesn’t look like TikTok’s verification file (tiktok….txt).'), content: z.string().max(2000) }).parse(req.body);
    setSetting('tiktokVerification', body);
    emit({ type: 'changed', entity: 'settings' });
    return setupInfo();
  });

  // ---------- accounts ----------

  app.get<{ Params: { wid: string } }>('/api/workspaces/:wid/accounts', async (req) => {
    const ws = getWorkspace(req.params.wid);
    // The new names land through a live update once the platforms answer.
    refreshProfiles(ws.id);
    return listAccounts(ws.id).map(publicAccount);
  });

  app.post<{ Params: { wid: string } }>('/api/workspaces/:wid/accounts/connect', async (req) => {
    const { platform } = platformParam.parse(req.body);
    return startConnect(req.params.wid, platform);
  });

  app.post<{ Params: { id: string } }>('/api/accounts/:id/reconnect', async (req) => {
    const a = getAccount(req.params.id);
    return startConnect(a.workspaceId, a.platform);
  });

  app.patch<{ Params: { id: string } }>('/api/accounts/:id', async (req) => {
    const a = getAccount(req.params.id);
    const body = z.object({ settings: z.object({ tiktokMode: z.enum(['inbox', 'direct']).optional() }).optional(), slots: z.array(slotSchema).max(24).optional() }).parse(req.body);
    return publicAccount(updateAccount(a.id, { settings: body.settings, slots: body.slots?.filter((s) => s.days.length) }));
  });

  app.delete<{ Params: { id: string } }>('/api/accounts/:id', async (req) => {
    await disconnectAccount(req.params.id);
    return { ok: true };
  });

  // TikTok wants the creator's current options shown every time a post is set up.
  app.get<{ Params: { id: string } }>('/api/accounts/:id/creator-info', async (req) => {
    const a = getAccount(req.params.id);
    if (a.platform !== 'tiktok') throw badRequest('Only TikTok accounts have creator info.');
    try {
      return await creatorInfo(await accessToken(a));
    } catch (err) {
      if (err instanceof PlatformError) throw new HttpError(502, err.message);
      throw err;
    }
  });

  // The platform sends the browser here after sign-in. Public: the one-time state proves it.
  app.get<{ Params: { platform: string }; Querystring: Record<string, string> }>('/api/oauth/:platform/callback', async (req, reply) => {
    reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store');
    const parsed = platformParam.safeParse(req.params);
    if (!parsed.success) return reply.code(404).send(callbackPage(false, 'Unknown platform', 'This sign-in link isn’t one of Content Studio’s.'));
    const label = PUBLISH_PLATFORM_LABELS[parsed.data.platform];
    try {
      const { accounts, pick } = await finishConnect(parsed.data.platform, req.query);
      return connectedPage(parsed.data.platform, accounts, pick);
    } catch (err) {
      const message = err instanceof HttpError || err instanceof PlatformError ? err.message : 'Something went wrong while connecting.';
      if (!(err instanceof HttpError)) req.log.error(err);
      return reply.code(400).send(callbackPage(false, `Couldn’t connect ${label}`, message, '/'));
    }
  });

  // The accounts named on that page. Public like the callback: the one-time pick key proves it.
  app.get<{ Params: { platform: string }; Querystring: { pick?: string; accounts?: string } }>('/api/oauth/:platform/pick', async (req, reply) => {
    reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store');
    const parsed = platformParam.safeParse(req.params);
    if (!parsed.success) return reply.code(404).send(callbackPage(false, 'Unknown platform', 'This sign-in link isn’t one of Content Studio’s.'));
    const { platform } = parsed.data;
    const label = PUBLISH_PLATFORM_LABELS[platform];
    try {
      return connectedPage(platform, await pickAccounts(platform, req.query.pick, req.query.accounts));
    } catch (err) {
      const message = err instanceof HttpError || err instanceof PlatformError ? err.message : 'Something went wrong while connecting.';
      if (!(err instanceof HttpError)) req.log.error(err);
      if (pickOpen(platform, req.query.pick)) return reply.code(400).send(callbackPage(null, `Which ${label} account?`, PICK_HELP, undefined, pickForm(platform, req.query.pick!, message)));
      return reply.code(400).send(callbackPage(false, `Couldn’t connect ${label}`, message, '/'));
    }
  });

  // ---------- public links the platforms download media from ----------

  app.get<{ Params: { token: string; name: string } }>('/api/public/media/:token/:name', async (req, reply) => {
    const link = verifyLink(req.params.token);
    if (!link) throw notFound();
    const m = getMedia(link.mediaId);
    const file = await variantFile(m, link.variant);
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.type(file.mime).sendFile(basename(file.path), dirname(file.path));
  });

  // TikTok's URL-prefix ownership check reads this file from <public address>/api/public/.
  app.get<{ Params: { file: string } }>('/api/public/:file', async (req, reply) => {
    const v = getSetting('tiktokVerification');
    if (!v || v.name !== req.params.file) throw notFound();
    return reply.type('text/plain; charset=utf-8').send(v.content);
  });

  // ---------- posts ----------

  app.get<{ Params: { wid: string }; Querystring: { from?: string; to?: string } }>('/api/workspaces/:wid/posts', async (req) => {
    const q = z.object({ from: z.coerce.number().int(), to: z.coerce.number().int() }).parse(req.query);
    if (q.to - q.from > 100 * 24 * 60 * 60_000) throw badRequest('Ask for three months at most.');
    return listPosts(getWorkspace(req.params.wid).id, q.from, q.to);
  });

  app.get<{ Params: { wid: string } }>('/api/workspaces/:wid/posts/upcoming', async (req) => upcomingPosts(getWorkspace(req.params.wid).id));

  app.get<{ Params: { id: string } }>('/api/pieces/:id/posts', async (req) => piecePosts(req.params.id));

  app.get<{ Params: { id: string } }>('/api/posts/:id', async (req) => postDetail(req.params.id));

  app.post<{ Params: { id: string } }>('/api/pieces/:id/posts/plan', async (req) => {
    const { targets } = planPosts(req.params.id, scheduleSchema.parse(req.body));
    return targets.map(({ account: _a, ...t }) => t);
  });

  app.post<{ Params: { id: string } }>('/api/pieces/:id/posts', async (req) => {
    const ids = createPosts(req.params.id, scheduleSchema.parse(req.body));
    kickScheduler();
    return { ids };
  });

  app.patch<{ Params: { id: string } }>('/api/posts/:id', async (req) => {
    const post = updatePost(req.params.id, updateSchema.parse(req.body));
    kickScheduler();
    const { remote: _r, ...rest } = post;
    return rest;
  });

  app.post<{ Params: { id: string } }>('/api/posts/:id/publish-now', async (req) => {
    postNow(req.params.id);
    kickScheduler();
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/posts/:id/stop', async (req) => {
    stopPost(req.params.id);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/posts/:id', async (req) => {
    getPost(req.params.id);
    deletePost(req.params.id);
    return { ok: true };
  });
}
