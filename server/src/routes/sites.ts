import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SITE_IDS } from '../../../shared/sites';
import { desktopAvailable, openSignIn, openSitePage, readPage, signOutSite, sitesStatus } from '../lib/desktop';

const siteParam = z.object({ site: z.enum(SITE_IDS) });

/** Settings → Connected sites: the signed-in windows the desktop app keeps (see lib/desktop.ts). */
export async function siteRoutes(app: FastifyInstance) {
  app.get('/api/sites', async () => sitesStatus());

  app.post('/api/sites/:site/signin', async (req) => {
    await openSignIn(siteParam.parse(req.params).site);
    return sitesStatus();
  });

  // A campaign's page (say) in the signed-in window, to submit a clip there. Outside the desktop app the page opens
  // in the browser instead (`opened: false`).
  app.post('/api/sites/open', async (req) => {
    const { url } = z.object({ url: z.string().trim().url().max(2000) }).parse(req.body);
    if (!desktopAvailable()) return { opened: false };
    await openSitePage(url);
    return { opened: true };
  });

  app.post('/api/sites/:site/signout', async (req) => {
    await signOutSite(siteParam.parse(req.params).site);
    return sitesStatus();
  });

  // "Try a page": read one page in the signed-in session, to check a sign-in works (counts towards the daily cap).
  app.post('/api/sites/read', async (req) => {
    const body = z
      .object({
        url: z.string().trim().url().max(2000),
        scrolls: z.number().int().min(0).max(20).optional(),
        waitFor: z.union([z.string().max(200), z.number().int().min(0).max(20_000)]).optional(),
      })
      .parse(req.body);
    return readPage(body.url, { scrolls: body.scrolls, waitFor: body.waitFor });
  });
}
