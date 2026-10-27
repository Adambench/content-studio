import { eq } from 'drizzle-orm';
import { editDuration, normalizeEdit, timelineWords, type EditSpec, type TimelineWord } from '../../../shared/edit';
import { measureEdit, QUALITY_BAR, QUALITY_INFO, qualityScore, qualityText, screenEvents, type QualityItem, type QualityReport } from '../../../shared/quality';
import { askStructured } from '../claude/oneshot';
import { playbook } from '../claude/plugin';
import { waitForUsage } from '../claude/usage';
import { db, now, schema } from '../db';
import { emit } from '../lib/events';
import { notFound } from '../lib/http';
import { enqueue } from '../jobs/queue';
import { getPiece, type Author } from '../services/pieces';
import { getEdit, listEditVersions, saveEditVersion, specMedia, specTranscripts } from './edits';
import { onCancel, setRender } from './render';

const r1 = (n: number) => Math.round(n * 10) / 10;

/** What's said, in lines with their times: a new line at a pause or every ~14 words. */
function spokenLines(words: TimelineWord[]) {
  const lines: { start: number; end: number; text: string[] }[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && w.start - last.end < 0.5 && last.text.length < 14) {
      last.text.push(w.text);
      last.end = w.end;
    } else lines.push({ start: w.start, end: w.end, text: [w.text] });
  }
  return lines.map((l) => `[${r1(l.start)}–${r1(l.end)}] ${l.text.join(' ')}`);
}

/** The edit as the judge reads it: the story, what's said and what appears on screen, second by second. */
function storyboard(spec: EditSpec, words: TimelineWord[], measured: QualityItem[]) {
  const duration = editDuration(spec);
  const rec = spec.recipe;
  const events = screenEvents(spec);
  return [
    `Length: ${r1(duration)} s, ${spec.format}.${rec ? ` A ${rec.kind} format video${rec.kind === 'story' ? ` (the post card reads “${rec.title}” until ${r1(rec.titleEnd)} s)` : ''}.` : ''}`,
    `Story named in the edit: promise “${spec.story.promise || '(not named)'}”; payoff “${spec.story.payoff || '(not named)'}”; payoff at ${spec.story.payoffAt === null ? '(not placed)' : `${r1(spec.story.payoffAt)} s`}.`,
    `Captions: ${spec.captions.enabled ? `on (${spec.captions.preset}, ${spec.captions.maxWords} words at a time)` : 'off'}.`,
    `What's said (seconds on the finished video):\n${spokenLines(words).join('\n') || '(nothing: no speech)'}`,
    `What appears on screen:\n${
      events
        .slice(0, 80)
        .map((e) => `${r1(e.at)} s: ${e.what}${e.motion ? (e.sound ? ' (with sound)' : ' (silent)') : ''}`)
        .join('\n') || '(nothing changes: one shot)'
    }\nText on screen: ${
      spec.overlays
        .filter((o) => o.type === 'text' || o.type === 'graphic')
        .slice(0, 30)
        .map((o) => `${r1(o.start)}–${r1(o.end)} s ${o.type === 'graphic' ? o.template : o.style} “${[o.text, o.type === 'graphic' ? o.sub : '', ...(o.type === 'graphic' ? o.items : [])].filter(Boolean).join(' / ')}”`)
        .join('; ') || '(none)'
    }`,
    `Measured:\n${measured.map((i) => `- ${QUALITY_INFO[i.criterion].label}: ${i.score}/10 (${i.measured})`).join('\n')}`,
  ].join('\n\n');
}

const JUDGED = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'why', 'fix'],
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 10, description: '7 = good enough to post, 9–10 = exceptional, under 5 = people swipe' },
    why: { type: 'string', description: 'One sentence' },
    fix: { type: 'string', description: 'Concrete changes to the edit (seconds, the words to say or show); empty when nothing needs fixing' },
  },
};
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hook', 'payoff', 'summary'],
  properties: { hook: JUDGED, payoff: JUDGED, summary: { type: 'string', description: 'The verdict in one line' } },
};

const INSTRUCTIONS = `You judge ONE short vertical video (TikTok, Reels, Shorts) before it renders, against the playbook above. You get its storyboard: the story the edit names, what's said with times, what appears on screen and what was measured.
Judge two things, 0–10 each:
- hook: do the first 3 seconds (the spoken line, the text on screen, the first frame) make one concrete promise, at once, with no warm-up? Would a stranger stop scrolling?
- payoff: does the content build toward that promise and keep it, clearly and visibly, late in the video (around the payoff time named, if any)? Is anything in the middle not earning its place?
Be strict: most first cuts are a 5 or 6. The fix says exactly what to change in this edit (cut at 0.0–1.2 s, show "…" as text from 0 s, move the reveal to 24 s, put the number on screen…). Never invent facts the video doesn't contain. Halal rules hold: never suggest music or anything haram.`;

type Judged = { hook: { score: number; why: string; fix: string }; payoff: { score: number; why: string; fix: string }; summary: string };

/** Check one version: measure it, have the hook and payoff judged, and keep the report on the version. */
export async function checkVersion(versionId: string, opts: { afterFix?: boolean } = {}): Promise<QualityReport> {
  const v = db.select().from(schema.editVersions).where(eq(schema.editVersions.id, versionId)).get();
  if (!v) throw notFound('Version not found');
  // Already judged as it is: no second call.
  if (v.quality?.judged) return v.quality;
  const edit = getEdit(v.editId);
  const spec = normalizeEdit(v.spec);
  const words = timelineWords(spec, await specTranscripts(spec, specMedia(spec)));
  const items = measureEdit(spec, words);
  let judged = false;
  let summary = '';
  try {
    await waitForUsage('quality');
    const out = await askStructured<Judged>({
      task: 'quality',
      system: [playbook('content-model', 'hooks', 'retention', 'halal'), INSTRUCTIONS].filter(Boolean).join('\n\n'),
      prompt: storyboard(spec, words, items),
      schema: SCHEMA,
      model: 'sonnet',
    });
    for (const c of ['hook', 'payoff'] as const) {
      const i = items.find((x) => x.criterion === c)!;
      const j = out[c];
      if (!j || typeof j.score !== 'number') continue;
      Object.assign(i, { score: Math.max(0, Math.min(10, Math.round(j.score))), why: j.why?.trim() || i.why, fix: j.fix?.trim() || (j.score >= 8 ? '' : i.fix), judged: true });
    }
    judged = items.some((i) => i.judged);
    summary = out.summary?.trim() ?? '';
  } catch (err) {
    summary = `Measured only (the hook and payoff couldn't be judged: ${(err as Error).message.slice(0, 120)}).`;
  }
  const report: QualityReport = { score: qualityScore(items), bar: QUALITY_BAR, items, summary, versionNumber: v.number, judged, afterFix: !!opts.afterFix, at: now() };
  db.update(schema.editVersions).set({ quality: report }).where(eq(schema.editVersions.id, v.id)).run();
  emit({ type: 'changed', entity: 'edits', workspaceId: edit.workspaceId, id: edit.id, pieceId: edit.pieceId });
  return report;
}

const checking = new Map<string, Promise<QualityReport>>();

/** Check the edit as it is now (saved as a version first, if it changed). Two clicks share one check. */
export function checkEdit(editId: string, by: Author) {
  const busy = checking.get(editId);
  if (busy) return busy;
  const { version } = saveEditVersion(editId, { author: by, message: 'Checked' });
  const p = checkVersion(version.id).finally(() => checking.delete(editId));
  checking.set(editId, p);
  return p;
}

const fixPrompt = (report: QualityReport) =>
  `Quality check before rendering v${report.versionNumber}: ${report.score}/100, under the bar of ${report.bar}. Fix the edit so it clears the bar: change what the fixes below need and keep what works (name the story if it's missing). Then answer in a line or two with what you changed. Don't call render_edit: the render starts by itself when you're done.\n\n${qualityText(report)}`;

/**
 * The `edit.check` job, for a render queued with the check: check the version, and below the bar have Claude fix it
 * once in the video's own chat (the creator sees it there) and check again. Then it renders, whatever the score.
 */
export async function checkJob({ renderId }: { renderId: string }) {
  const live = () => db.select().from(schema.renders).where(eq(schema.renders.id, renderId)).get();
  let r = live();
  if (!r || r.status !== 'queued' || !r.versionId) return;
  try {
    let report = await checkVersion(r.versionId);
    r = live();
    if (!r || r.status !== 'queued') return;
    if (report.score < report.bar) {
      const before = listEditVersions(r.editId)[0]?.id;
      const fixed = await fixEdit(r, report);
      r = live();
      if (!r || r.status !== 'queued') return;
      const head = listEditVersions(r.editId)[0];
      if (fixed && head && head.id !== before) {
        const spec = normalizeEdit(db.select({ spec: schema.editVersions.spec }).from(schema.editVersions).where(eq(schema.editVersions.id, head.id)).get()!.spec);
        setRender(r, { versionId: head.id, versionNumber: head.number, durationMs: Math.round(editDuration(spec) * 1000), stage: 'Checking again' });
        report = await checkVersion(head.id, { afterFix: true });
      }
    }
    r = live();
    if (!r || r.status !== 'queued') return;
    setRender(r, { stage: `Quality ${report.score}/100 · waiting for the renderer` });
  } catch (err) {
    console.error('Quality check failed; rendering anyway', err);
    r = live();
    if (!r || r.status !== 'queued') return;
    setRender(r, { stage: 'Waiting' });
  }
  enqueue('video.render', { renderId }, { maxAttempts: 1 });
}

/** Claude fixes the edit in the video's own chat. False when that can't happen now (someone is already chatting there). */
async function fixEdit(r: { id: string; workspaceId: string; pieceId: string }, report: QualityReport) {
  const { isRunning, pieceThread, runChat, stopChat } = await import('../claude/agent');
  const thread = pieceThread(getPiece(r.pieceId));
  if (isRunning(thread.id)) return false;
  setRender(r, { stage: `Quality ${report.score}/100: Claude is fixing it` });
  onCancel.set(r.id, () => stopChat(thread.id));
  try {
    await runChat({ threadId: thread.id, text: fixPrompt(report), contextPieceId: r.pieceId, contextView: 'video', onEvent: () => {} });
    return true;
  } catch (err) {
    console.error('Quality fix failed', err);
    return false;
  } finally {
    onCancel.delete(r.id);
  }
}
