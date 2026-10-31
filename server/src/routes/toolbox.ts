import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { INSTALL_PLACES, parseRepo } from '../../../shared/toolbox';
import { HttpError } from '../lib/http';
import { finishScout, setFindStatus, startScout, stopScout, toolbox } from '../toolbox/scout';
import { addToApp, previewInstall, removeSkill, startInstall } from '../toolbox/skills';

const repoOf = (text: unknown) => {
  const repo = typeof text === 'string' ? parseRepo(text) : null;
  if (!repo) throw new HttpError(400, 'That isn’t a GitHub repo: paste its link, or owner/name.');
  return repo;
};

/** The Toolbox page: what's installed and used, the weekly scout's finds, and installing skills (server/src/toolbox/). */
export async function toolboxRoutes(app: FastifyInstance) {
  app.get('/api/toolbox', async () => toolbox());

  app.post('/api/toolbox/scout', async () => {
    startScout();
    return { ok: true };
  });

  app.post('/api/toolbox/scout/stop', async () => {
    stopScout();
    return { ok: true };
  });

  app.post('/api/toolbox/scout/finish', async () => {
    finishScout();
    return { ok: true };
  });

  app.patch<{ Params: { id: string } }>('/api/toolbox/finds/:id', async (req) => {
    const { status } = z.object({ status: z.enum(['new', 'wanted', 'dismissed']) }).parse(req.body);
    setFindStatus(req.params.id, status);
    return { ok: true };
  });

  // Installing is my click: Claude has no tool for it.
  app.get<{ Querystring: { repo?: string } }>('/api/toolbox/skills/preview', async (req) => previewInstall(repoOf(req.query.repo)));

  app.post('/api/toolbox/skills/install', async (req) => {
    const body = z.object({ repo: z.string(), skills: z.array(z.string()).min(1).max(40), places: z.array(z.enum(INSTALL_PLACES)).min(1) }).parse(req.body);
    return startInstall(repoOf(body.repo), body.skills, [...new Set(body.places)]);
  });

  app.post<{ Params: { name: string } }>('/api/toolbox/skills/:name/add-to-app', async (req) => addToApp(req.params.name));

  app.delete<{ Params: { home: string; name: string } }>('/api/toolbox/skills/:home/:name', async (req) => {
    const home = z.enum(['app', 'claude-code']).parse(req.params.home);
    removeSkill(home, req.params.name);
    return { ok: true };
  });
}
