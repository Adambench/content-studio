// The quality score an edit gets before it renders (phase 12): every video has a hook (a promise in the first 1–3 s),
// content that builds toward it and a payoff near the end (the edit's `story`). Most of it is measured from the edit
// here; the hook and the payoff are also judged by one model call against the Knowledge rules (server/src/studio/
// quality.ts). Below the bar, Claude fixes the edit before it renders.
import { clipLength, clipStarts, editDuration, transitionWindows, type EditSpec, type EditStory, type TimelineWord } from './edit';

export const QUALITY_CRITERIA = ['hook', 'payoff', 'pacing', 'motion', 'sfx', 'captions', 'firstFrame'] as const;
export type QualityCriterion = (typeof QUALITY_CRITERIA)[number];

/** Weights add up to 100. */
export const QUALITY_INFO: Record<QualityCriterion, { label: string; weight: number; hint: string }> = {
  hook: { label: 'Hook', weight: 25, hint: 'A promise in the first 1–3 s: words, picture and on-screen text' },
  payoff: { label: 'Promise → payoff', weight: 20, hint: 'The content builds toward the promise and pays it near the end' },
  pacing: { label: 'Pacing', weight: 15, hint: 'Something changes on screen every 2–4 s' },
  motion: { label: 'Motion', weight: 10, hint: 'How much of the video moves: camera moves, graphics, scenes' },
  sfx: { label: 'Sound on motion', weight: 10, hint: 'Each motion event has a sound effect on its frame' },
  captions: { label: 'Captions', weight: 10, hint: 'Every spoken word on screen, short lines' },
  firstFrame: { label: 'First frame', weight: 10, hint: 'The first frame already carries the hook' },
};

/** Below this an edit is fixed before it renders. */
export const QUALITY_BAR = 70;

export type QualityItem = {
  criterion: QualityCriterion;
  /** 0–10. */
  score: number;
  /** What was measured, in a line. */
  measured: string;
  why: string;
  /** Empty when nothing needs fixing. */
  fix: string;
  /** Judged by the model (hook, payoff), or measured only. */
  judged: boolean;
};

export type QualityReport = {
  /** 0–100. */
  score: number;
  bar: number;
  items: QualityItem[];
  summary: string;
  versionNumber: number;
  /** The hook and payoff were judged by the model (false: it couldn't be asked; measured only). */
  judged: boolean;
  /** Claude fixed it once already before this check. */
  afterFix: boolean;
  at: number;
};

export function qualityScore(items: Pick<QualityItem, 'criterion' | 'score'>[]) {
  return Math.round(items.reduce((sum, i) => sum + (Math.min(10, Math.max(0, i.score)) / 10) * QUALITY_INFO[i.criterion].weight, 0));
}

/** Something that changes on screen, at a moment of the finished video. */
export type ScreenEvent = { at: number; what: string; /** It moves (and so wants a sound on its frame). */ motion: boolean; /** Has a sound on its frame. */ sound: boolean };

const ITEM_GRAPHICS = new Set(['list', 'checklist', 'steps', 'ranking', 'timeline', 'compare', 'chart', 'wall']);
const near = (cues: number[], at: number) => cues.some((c) => c >= at - 0.12 && c <= at + 0.25);
const r1 = (n: number) => Math.round(n * 10) / 10;
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Everything that appears or changes on screen, in order: cuts, transitions, overlays (and a list's points), a format video's lines. */
export function screenEvents(spec: EditSpec): ScreenEvent[] {
  const cues = spec.audio.sfx.map((s) => s.at);
  const out: ScreenEvent[] = [];
  const starts = clipStarts(spec);
  const windows = new Map(transitionWindows(spec).map((w) => [w.index, w]));
  spec.clips.forEach((c, i) => {
    if (i === 0) return;
    const w = windows.get(i);
    if (w) out.push({ at: w.start, what: `${w.type} transition`, motion: true, sound: w.sound || near(cues, w.start) || near(cues, w.at) });
    else out.push({ at: starts[i], what: 'cut', motion: false, sound: near(cues, starts[i]) });
  });
  for (const o of spec.overlays) {
    if (o.type === 'graphic') {
      if (o.template === 'progress') continue;
      out.push({ at: o.start, what: `${o.template} graphic${o.text ? ` “${clip(o.text, 40)}”` : ''}`, motion: true, sound: o.sound || near(cues, o.start) });
      // A list's points tick in one by one over most of its time.
      if (ITEM_GRAPHICS.has(o.template) && o.items.length > 1) {
        const span = (o.end - o.start) * 0.7;
        o.items.slice(1).forEach((item, k) => out.push({ at: r1(o.start + ((k + 1) * span) / o.items.length), what: `point “${clip(item, 30)}”`, motion: true, sound: o.sound || near(cues, o.start + ((k + 1) * span) / o.items.length) }));
      }
    } else if (o.type === 'text') out.push({ at: o.start, what: `text “${clip(o.text, 40)}”`, motion: o.animation !== 'none', sound: near(cues, o.start) });
    else if (o.type === 'image') out.push({ at: o.start, what: 'picture', motion: o.animation !== 'none', sound: near(cues, o.start) });
    else if (o.type === 'broll') out.push({ at: o.start, what: 'b-roll cutaway', motion: false, sound: near(cues, o.start) });
    else if (o.type === 'scene') out.push({ at: o.start, what: `scene${o.name ? ` “${clip(o.name, 30)}”` : ''}`, motion: true, sound: near(cues, o.start) });
  }
  const rec = spec.recipe;
  if (rec?.kind === 'chat') rec.messages.forEach((m) => out.push({ at: m.at, what: `message “${clip(m.text, 30)}”`, motion: true, sound: true }));
  if (rec?.kind === 'dialogue') rec.lines.forEach((l, i) => i > 0 && rec.lines[i - 1].who !== l.who && out.push({ at: l.at, what: `${rec.cast[l.who].name} speaks`, motion: false, sound: true }));
  if (rec?.kind === 'story' && rec.titleEnd > 0) out.push({ at: rec.titleEnd, what: 'post card goes', motion: true, sound: near(cues, rec.titleEnd) });
  return out.sort((a, b) => a.at - b.at);
}

/** Seconds of the video that move: camera moves on clips, animated graphics and scenes, a format video's animation. */
function movingSeconds(spec: EditSpec, duration: number) {
  const spans: [number, number][] = [];
  const starts = clipStarts(spec);
  spec.clips.forEach((c, i) => c.motion !== 'none' && spans.push([starts[i], starts[i] + clipLength(c)]));
  for (const o of spec.overlays) if (o.type === 'scene' || (o.type === 'graphic' && o.template !== 'progress') || ((o.type === 'text' || o.type === 'image') && o.animation !== 'none')) spans.push([o.start, Math.min(o.end, o.start + (o.type === 'scene' ? o.end - o.start : 2))]);
  if (spec.recipe?.kind === 'dialogue' || spec.recipe?.kind === 'chat') spans.push([0, duration]);
  spans.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let until = 0;
  for (const [a, b] of spans) {
    const from = Math.max(a, until);
    if (b > from) total += Math.min(b, duration) - Math.min(from, duration);
    until = Math.max(until, b);
  }
  return Math.max(0, total);
}

const OPENERS = /^(hey|hi|hello|so|welcome|today|in this video|what's up|whats up|okay|ok|alright|um|uh)\b/i;

/** The measured part of the report: every criterion scored from the edit alone (the hook and payoff are then judged too). */
export function measureEdit(spec: EditSpec, words: TimelineWord[]): QualityItem[] {
  const story: EditStory = spec.story;
  const duration = editDuration(spec);
  const events = screenEvents(spec);
  const said = (from: number, to: number) => words.filter((w) => w.start >= from && w.start < to).map((w) => w.text).join(' ');
  const textAt = (t: number) => spec.overlays.some((o) => (o.type === 'text' || o.type === 'graphic' || o.type === 'scene') && o.start <= t + 0.05 && o.end > t && !(o.type === 'graphic' && o.template === 'progress'));
  const firstWord = words[0];
  const story0 = spec.recipe?.kind === 'story' || spec.recipe?.kind === 'chat';
  const item = (criterion: QualityCriterion, score: number, measured: string, why: string, fix = ''): QualityItem => ({ criterion, score: Math.max(0, Math.min(10, Math.round(score))), measured, why, fix, judged: false });

  // Hook: speech starts at once, the hook's words are on screen, something happens in the first 1.5 s.
  const opening = said(0, 3);
  const speechAt = firstWord ? firstWord.start : null;
  const textEarly = story0 || [0, 0.5, 1, 1.5].some(textAt);
  const earlyEvent = events.some((e) => e.at <= 1.5);
  let hook = 2;
  if (speechAt === null) hook += textEarly ? 3 : 0;
  else hook += speechAt <= 0.4 ? 4 : speechAt <= 1 ? 3 : speechAt <= 2 ? 1 : 0;
  hook += textEarly ? 2 : 0;
  hook += earlyEvent ? 1 : 0;
  hook += opening && OPENERS.test(opening) ? -2 : 1;
  const hookFix = [
    speechAt !== null && speechAt > 1 && `Cut the first ${r1(speechAt)} s: start on the first word.`,
    !textEarly && 'Put the hook’s promise on screen as text in the first second.',
    opening && OPENERS.test(opening) && `Don’t open with “${opening.split(' ').slice(0, 3).join(' ')}”: open on the promise.`,
    !earlyEvent && 'Make something move or change in the first 1.5 s.',
  ].filter(Boolean);
  const hookItem = item(
    'hook',
    hook,
    [speechAt === null ? 'no speech' : `first word at ${r1(speechAt)} s`, textEarly ? 'text on screen in the first 1.5 s' : 'no text in the first 1.5 s', opening ? `says “${clip(opening, 80)}”` : ''].filter(Boolean).join(' · '),
    hookFix.length ? 'The first seconds lose people before the promise lands.' : 'Starts on the words with the promise on screen.',
    hookFix.join(' '),
  );

  // Promise → payoff: named, and paid in the second half, close to the end.
  const promise = story.promise.trim();
  const payoff = story.payoff.trim();
  const at = story.payoffAt;
  let pay = 0;
  if (promise) pay += 3;
  if (payoff) pay += 2;
  if (at !== null && duration > 0) {
    pay += 2;
    if (at >= duration * 0.5 && at <= duration - 0.3) pay += 2;
    if (duration - at <= 8) pay += 1;
  }
  const payFix = [
    !promise && 'Name the promise the hook makes (story.promise).',
    !payoff && 'Name the payoff: what the viewer waited for (story.payoff).',
    at === null && 'Mark the second the payoff lands (story.payoffAt).',
    at !== null && at < duration * 0.5 && `The payoff lands at ${r1(at)} s of ${r1(duration)} s: save it for the second half, or the rest has nothing to wait for.`,
    at !== null && duration - at > 8 && `${r1(duration - at)} s run on after the payoff: end sooner after it.`,
  ].filter(Boolean);
  const payItem = item(
    'payoff',
    pay,
    [promise ? `promise “${clip(promise, 60)}”` : 'no promise named', payoff ? `payoff “${clip(payoff, 60)}”` : 'no payoff named', at !== null ? `paid at ${r1(at)} s of ${r1(duration)} s` : 'not placed'].join(' · '),
    payFix.length ? 'Without a named promise and a late payoff, there’s no reason to stay to the end.' : 'The promise is named and paid late.',
    payFix.join(' '),
  );

  // Pacing: the longest stretch with nothing changing on screen.
  const marks = [0, ...events.map((e) => e.at).filter((t) => t > 0 && t < duration), duration];
  let gap = 0;
  let gapAt = 0;
  for (let i = 1; i < marks.length; i++)
    if (marks[i] - marks[i - 1] > gap) {
      gap = marks[i] - marks[i - 1];
      gapAt = marks[i - 1];
    }
  const per10 = duration > 0 ? (events.length / duration) * 10 : 0;
  const pacingScore = gap <= 3 ? 10 : gap <= 4 ? 8 : gap <= 6 ? 5 : gap <= 8 ? 3 : 1;
  const pacingItem = item(
    'pacing',
    pacingScore,
    `${events.length} changes on screen (${r1(per10)} per 10 s) · longest stretch ${r1(gap)} s from ${r1(gapAt)} s`,
    gap <= 4 ? 'Something changes every few seconds.' : `Nothing changes on screen for ${r1(gap)} s: that’s where people swipe.`,
    gap <= 4 ? '' : `Between ${r1(gapAt)} s and ${r1(gapAt + gap)} s add a cut, a punch-in, a graphic or b-roll every 2–4 s.`,
  );

  // Motion.
  const moving = duration > 0 ? movingSeconds(spec, duration) / duration : 0;
  const motionScore = moving >= 0.6 ? 10 : moving >= 0.4 ? 7 : moving >= 0.25 ? 5 : moving >= 0.1 ? 3 : 1;
  const motionItem = item(
    'motion',
    motionScore,
    `${Math.round(moving * 100)}% of the video moves`,
    moving >= 0.4 ? 'Most of it moves.' : 'Long stretches sit still.',
    moving >= 0.4 ? '' : 'Add camera moves on the still clips, animated graphics on the key points, or a designed scene.',
  );

  // Sound on motion.
  const moves = events.filter((e) => e.motion);
  const hit = moves.filter((e) => e.sound).length;
  const cover = moves.length ? hit / moves.length : 1;
  const missed = moves.filter((e) => !e.sound).slice(0, 4);
  const sfxScore = !moves.length ? 7 : cover >= 0.8 ? 10 : cover >= 0.6 ? 8 : cover >= 0.4 ? 6 : cover >= 0.2 ? 4 : 2;
  const sfxItem = item(
    'sfx',
    sfxScore,
    moves.length ? `${hit} of ${moves.length} motion events have a sound on their frame` : 'no motion events',
    !moves.length ? 'Nothing moves, so there is nothing to hit.' : cover >= 0.8 ? 'Motion lands with sound.' : 'Motion without sound feels flat.',
    missed.length && cover < 0.8 ? `Add a non-musical effect on: ${missed.map((e) => `${e.what} at ${r1(e.at)} s`).join('; ')}.` : '',
  );

  // Captions.
  const c = spec.captions;
  let capScore: number;
  let capWhy: string;
  let capFix = '';
  if (!words.length) {
    const anyText = spec.overlays.some((o) => o.type === 'text' || o.type === 'graphic' || o.type === 'scene') || !!spec.recipe;
    capScore = anyText ? 8 : 3;
    capWhy = anyText ? 'No speech; the text on screen carries it.' : 'No speech and no text: a muted viewer gets nothing.';
    if (!anyText) capFix = 'Put the point on screen as text.';
  } else if (spec.recipe?.kind === 'chat') {
    capScore = 9;
    capWhy = 'The messages are the text.';
  } else if (!c.enabled) {
    capScore = 2;
    capWhy = 'People speak, but captions are off: most watch muted.';
    capFix = 'Turn the captions on.';
  } else {
    capScore = c.maxWords > 6 ? 7 : 10;
    capWhy = c.maxWords > 6 ? 'Long caption lines read slowly.' : 'Every word on screen, short lines.';
    if (c.maxWords > 6) capFix = 'Show 2–4 words at a time.';
  }
  const captionsItem = item('captions', capScore, words.length ? `${words.length} spoken words · captions ${c.enabled ? `on, ${c.maxWords} words a line` : 'off'}` : 'no speech', capWhy, capFix);

  // First frame: the hook is already on it.
  const textAt0 = story0 || textAt(0.05);
  const wordAt0 = c.enabled && !!firstWord && firstWord.start <= 0.3;
  const ffScore = textAt0 ? 10 : wordAt0 ? 7 : 4;
  const firstItem = item(
    'firstFrame',
    ffScore,
    textAt0 ? 'text on the first frame' : wordAt0 ? 'only a caption on the first frame' : 'bare footage on the first frame',
    textAt0 ? 'The first frame carries the hook (it’s also the cover).' : 'The first frame is what a scroller judges, and often the cover.',
    textAt0 ? '' : 'Start a hook text or graphic at 0 s with the promise in a few words.',
  );

  return [hookItem, payItem, pacingItem, motionItem, sfxItem, captionsItem, firstItem];
}

/** The report as text for Claude: the score, then what to fix, worst first. */
export function qualityText(r: QualityReport) {
  // Worst first = the most points lost.
  const lost = (i: QualityItem) => (10 - i.score) * QUALITY_INFO[i.criterion].weight;
  const fixes = [...r.items].sort((a, b) => lost(b) - lost(a)).filter((i) => i.fix);
  return [
    `Quality ${r.score}/100 (bar ${r.bar}) for edit v${r.versionNumber}.${r.summary ? ` ${r.summary}` : ''}`,
    ...r.items.map((i) => `- ${QUALITY_INFO[i.criterion].label}: ${i.score}/10 (${i.measured}). ${i.why}`),
    fixes.length ? 'Fix, worst first:' : 'Nothing to fix.',
    ...fixes.map((i, n) => `${n + 1}. ${QUALITY_INFO[i.criterion].label}: ${i.fix}`),
  ].join('\n');
}
