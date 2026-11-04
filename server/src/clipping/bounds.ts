// A clip's in and out points on whole sentences. The picker chooses them from the source's transcript; once the clip's
// own words are in (Whisper on the cut, with room either side), its start is moved back to where the sentence begins
// when it was picked mid-sentence, and its end goes on to where the sentence (or the point) ends: a clip that stops on
// "and…", "there's also like" or "so when I tell you that" leaves the viewer waiting for an end that never comes. When
// the sentence doesn't end within reach (or the campaign's length cap), the end goes back to the last finished one.
import type { EditSpec } from '../../../shared/edit';
import type { Transcript, TranscriptWord } from '../../../shared/types';

/** Words a finished thought never ends on. */
const DANGLING = new Set(
  'and but so or nor because cause cuz the a an um uh like if when then than also plus which while until unless though although whereas of with my your our their its'.split(' '),
);

/** Words a sentence may open with that a clip leaves out ("And we have…" starts as "We have…"). */
const LEAD_IN = new Set('and so but or um uh like yeah okay ok well'.split(' '));

/** A sentence that opens like these is a question ("Do you guys feel…", "What do you think…"). */
const AUX = new Set('do does did are is was were would could can should have has will'.split(' '));
const SUBJECT = new Set("you we they he she i it y'all".split(' '));
const WH = new Set('what why how who where which'.split(' '));
/** "…, right?": a statement asking for a nod, not a question. */
const TAG = new Set('right yeah okay ok huh no'.split(' '));

const bare = (w: TranscriptWord) => w.word.trim().toLowerCase().replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
const punctuated = (w: TranscriptWord) => /[.!?…]["'”’)\]]*$/.test(w.word.trim());

export type Bounds = { start: number; end: number; moved: string[] };

/**
 * Where a clip of `words` (seconds in the cut) should start and end, given the picked `start`–`end`. `maxLength`
 * caps how long it may get (the campaign's limit). Words that come with punctuation (Whisper) end sentences there;
 * without any (YouTube's captions), a pause of 0.7 s after a word that isn't a dangling one does.
 */
export function sentenceBounds(words: TranscriptWord[], start: number, end: number, opts: { maxLength?: number; maxBack?: number; maxForward?: number; minLength?: number } = {}): Bounds {
  const { maxLength = Infinity, maxBack = 6, maxForward = 15, minLength = 8 } = opts;
  const moved: string[] = [];
  if (words.length < 3) return { start, end, moved };
  const hasPunctuation = words.filter(punctuated).length * 40 >= words.length;
  const gapAfter = (i: number) => (i + 1 < words.length ? words[i + 1].start - words[i].end : Infinity);
  const endsSentence = (i: number) => !DANGLING.has(bare(words[i])) && (hasPunctuation ? punctuated(words[i]) : gapAfter(i) >= 0.7);

  // The start: the first word of the clip, moved back to where its sentence starts.
  let first = words.findIndex((w) => w.end > start + 0.05);
  if (first < 0) return { start, end, moved };
  if (first > 0 && !endsSentence(first - 1) && words[first].start - words[first - 1].end < 0.35) {
    for (let i = first - 1; i >= 1; i--) {
      if (words[first].start - words[i].start > maxBack) break;
      if (endsSentence(i - 1) || words[i].start - words[i - 1].end >= 0.6) {
        // Only a word that leads in ("And we have…", "So, um, …") before it: the clip starts on the sentence itself.
        if (words.slice(i, first).every((w) => LEAD_IN.has(bare(w)))) break;
        moved.push(`started mid-sentence: back to “${words.slice(i, first).map((w) => w.word).join('').trim()}”`);
        first = i;
        break;
      }
    }
  }
  const newStart = Math.min(start, words[first].start);

  // The end: the last word of the clip, on to the end of its sentence (or back to the last finished one).
  let last = -1;
  for (let i = words.length - 1; i >= first; i--)
    if (words[i].start < end - 0.05) {
      last = i;
      break;
    }
  if (last < 0) return { start: newStart, end, moved };
  if (!endsSentence(last)) {
    let to = -1;
    for (let j = last + 1; j < words.length - 1; j++) {
      // The cut's last word may be cut off itself: never end on it.
      if (words[j].end - words[last].end > maxForward || words[j].end - newStart > maxLength) break;
      if (endsSentence(j)) {
        to = j;
        break;
      }
    }
    // The sentence it ends in: a question the speaker starts at the end ("Do you guys feel…") is a new thought for
    // someone else to answer, so the clip ends before it rather than on it.
    let open = last;
    while (open > first && !endsSentence(open - 1)) open--;
    const [w0, w1] = [words[open], words[open + 1]].map((w) => (w ? bare(w) : ''));
    const asks = open > first && ((AUX.has(w0) && SUBJECT.has(w1)) || (WH.has(w0) && AUX.has(w1)) || (to >= 0 && /\?["'”’)\]]*$/.test(words[to].word.trim()) && !TAG.has(bare(words[to]))));
    if (to >= 0 && !asks) {
      moved.push(`ended mid-sentence: on to “${words.slice(last + 1, to + 1).map((w) => w.word).join('').trim()}”`);
      last = to;
    } else {
      for (let j = last - 1; j > first; j--) {
        if (words[j].end - newStart < minLength) break;
        if (endsSentence(j)) {
          moved.push(`ended mid-sentence: back to before “${words.slice(j + 1, last + 1).map((w) => w.word).join('').trim()}”`);
          last = j;
          break;
        }
      }
    }
  }
  return { start: newStart, end: words[last].end, moved };
}

/**
 * An edit that ends on a word a finished thought never ends on ("…family gathering. And") ends before it instead: the
 * last guard before a clip renders, whoever made the last cut. Returns null when the end is fine.
 */
export function trimDanglingEnd(spec: EditSpec, transcripts: Record<string, Transcript | null | undefined>): EditSpec | null {
  const clips = [...spec.clips];
  const i = clips.length - 1;
  const c = clips[i];
  const words = (transcripts[c?.mediaId]?.segments ?? []).flatMap((s) => s.words ?? []).filter((w) => w.word.trim() && w.end > c.in + 0.01 && w.start < c.out - 0.01);
  let out = c?.out;
  for (let k = words.length - 1; k > 0 && words.length - k <= 3; k--) {
    const w = bare(words[k]);
    // "…looks like." ends a sentence: "like" dangles only as a new clause's filler ("…family. Like").
    if (!DANGLING.has(w) || (w === 'like' && !/[.,!?]["'”’)\]]*$/.test(words[k - 1].word.trim()))) break;
    out = Math.min(words[k].start - 0.03, words[k - 1].end + 0.3);
  }
  if (!c || out === c.out || out - c.in < 0.4) return null;
  clips[i] = { ...c, out: Math.round(out * 1000) / 1000 };
  return { ...spec, clips };
}
