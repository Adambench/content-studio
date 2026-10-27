// Phase 12 step 0, run once and then deleted: the clipping cleanup and Vetto's removal, against the real data dir.
// Run from server/ with the app idle: ../node_modules/.bin/tsx ../scripts/cleanup-clipping.mts
const root = new URL('..', import.meta.url).pathname;
const R = `${root}server/src`;
const { db, schema } = await import(`${R}/db/index.ts`);
const { setSetting } = await import(`${R}/lib/settings.ts`);
const { deleteMedia } = await import(`${R}/services/media.ts`);
const { deleteCampaign } = await import(`${R}/campaigns/campaigns.ts`);
const { config } = await import(`${R}/config.ts`);
const { eq, inArray } = await import(`${root}node_modules/drizzle-orm/index.js`);
const { rm, readdir } = await import('node:fs/promises');
const { join } = await import('node:path');
const { DatabaseSync } = await import('node:sqlite');

const CLIP = '67a763ff-176e-4210-9eff-41f61a822984';
const VETTO = '1eae54bd-3c81-41c7-87e2-7b0e6392b5ad';
const PERSONAL = 'ac959c37-02f2-4566-bbdf-4daa730c642a';

const backup = join(config.dataDir, 'backups', '2026-10-27-before-clipping-cleanup.sqlite');
new DatabaseSync(config.dbFile).exec(`VACUUM INTO '${backup}'`);
console.log('backup', backup);

const busy = db.select().from(schema.jobs).where(inArray(schema.jobs.status, ['queued', 'running'])).all();
if (busy.length) throw new Error(`jobs busy: ${busy.map((j) => j.type).join(', ')}`);

for (const c of db.select().from(schema.campaigns).all()) { await deleteCampaign(c.id); console.log('campaign', c.title); }
for (const m of db.select().from(schema.media).where(eq(schema.media.workspaceId, CLIP)).all()) await deleteMedia(m.id);
const pieces = db.delete(schema.pieces).where(eq(schema.pieces.workspaceId, CLIP)).returning().all();
console.log('pieces', pieces.length);
await rm(join(config.mediaDir, CLIP), { recursive: true, force: true });

// Vetto, as DELETE /api/workspaces/:id does (it has no files).
db.delete(schema.workspaces).where(eq(schema.workspaces.id, VETTO)).run();
await rm(join(config.mediaDir, VETTO), { recursive: true, force: true });

// Clipping's leftovers: finished jobs, the finder's state, the HyperFrames frame cache.
const jobs = db.delete(schema.jobs).where(eq(schema.jobs.status, 'done')).returning().all();
console.log('jobs', jobs.length);
db.delete(schema.settings).where(inArray(schema.settings.key, ['campaignLeads', 'finderRuns', 'removedSources'])).run();
setSetting('lastWorkspaceId', PERSONAL);
for (const f of await readdir(config.cacheDir)) await rm(join(config.cacheDir, f), { recursive: true, force: true });
for (const f of await readdir(config.sourcesDir)) await rm(join(config.sourcesDir, f), { recursive: true, force: true });

console.log('left', Object.fromEntries(['pieces', 'media', 'renders', 'edits', 'moments', 'campaigns', 'campaign_sources', 'workspaces', 'ideas', 'jobs'].map((t) => [t, new DatabaseSync(config.dbFile, { readOnly: true }).prepare(`select count(*) n from ${t}`).get()!.n])));
