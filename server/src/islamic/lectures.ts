import { and, eq } from 'drizzle-orm';
import { EDIT_FORMATS, newEditId, type EditOverlay, type EditSpec } from '../../../shared/edit';
import { libraryScene, sceneMaxSeconds } from '../../../shared/scene-library';
import { db, newId, schema } from '../db';
import { badRequest } from '../lib/http';
import { enqueue } from '../jobs/queue';
import { emitCampaign, getCampaignRow, setPages } from '../campaigns/campaigns';
import { getWorkspace } from '../services/pieces';

// An Islamic page's lecture clips go through the clipping pipeline as one campaign of its own (origin `business`,
// the page as its business): paste a lecture, it's downloaded, transcribed, its moments picked and cut into clips
// that wait in Review. A video only downloads by itself when it's under Creative Commons; any other waits for my
// click, which says its channel allows clips.

const brief = (page: string) => `Lecture clips for ${page}, an Islamic reminders page: short clips of talks by well-known scholars and speakers, cut from lectures on channels that allow clips (they say so, or the video is under Creative Commons).

Rules:
- Name the speaker on screen for the whole clip, and in the caption.
- Credit the channel and link the full lecture in the caption.
- One reminder per clip that stands alone, 20 to 60 seconds, opening on its strongest line.
- Never cut so it changes what the speaker meant; keep an ayah or hadith with its reference when the speaker gives one.
- No fatwas or rulings, no contested fiqh, nothing sectarian or political.
- Any music in the source is removed, and none is added.`;

/** The page's lecture campaign, if it has one. */
export function findLectureCampaign(workspaceId: string) {
  return db
    .select()
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.origin, 'business'), eq(schema.campaigns.businessWorkspaceId, workspaceId)))
    .get();
}

/** The page's lecture campaign, made (and read, then waiting for my OK) the first time it's opened. */
export function lectureCampaign(workspaceId: string) {
  const ws = getWorkspace(workspaceId);
  if (ws.kind !== 'islamic') throw badRequest('Lecture clips are for Islamic pages.');
  const found = findLectureCampaign(ws.id);
  if (found) return found.id;
  const id = newId();
  const text = brief(ws.name);
  db.insert(schema.campaigns).values({ id, origin: 'business', businessWorkspaceId: ws.id, title: 'Lecture clips', description: text, pageText: text, status: 'reading' }).run();
  setPages(id, [ws.id]);
  enqueue('campaign.read', { campaignId: id }, { maxAttempts: 2 });
  emitCampaign(id);
  return id;
}

/** A campaign that clips lectures for an Islamic page: its sources need a licence or my say-so, its clips a speaker tag. */
export function isLectureCampaign(campaignId: string) {
  const c = getCampaignRow(campaignId);
  return c.origin === 'business' && !!c.businessWorkspaceId && getWorkspace(c.businessWorkspaceId).kind === 'islamic';
}

export const isCreativeCommons = (license: string | undefined) => /creative commons/i.test(license ?? '');

/** A lecture title cut to a few words at a word's end, for under the speaker's name. */
function shortTitle(title: string, max = 40) {
  const t = title.split(/\s+[|•·–—-]\s+/)[0].trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 10)).trim()}…`;
}

/** The speaker's name tag for a whole lecture clip, from after its hook card to the end (the creator fixes the name in Review). */
export function speakerTag(spec: EditSpec, source: { creator: string | null; title: string }, from: number, total: number): EditOverlay | null {
  const start = Math.min(from, Math.max(0, total - 2));
  const end = Math.min(total, start + sceneMaxSeconds('speaker'));
  if (end - start < 1) return null;
  const f = EDIT_FORMATS[spec.format];
  const { problems: _, ...scene } = libraryScene('speaker', { text: source.creator || 'The speaker', sub: shortTitle(source.title) }, { W: f.width, H: f.height, color: spec.captions.highlight }, end - start);
  return { id: newEditId(), type: 'scene', start, end, ...scene };
}
