// A clip's in and out points on whole sentences. The picker chooses them from the source's transcript; once the clip's
// own words are in (Whisper on the cut, with room either side), its start is moved back to where the sentence begins
// when it was picked mid-sentence, and its end goes on to where the sentence (or the point) ends: a clip that stops on
// "and…", "there's also like" or "so when I tell you that" leaves the viewer waiting for an end that never comes. When
// the sentence doesn't end within reach (or the campaign's length cap), the end goes back to the last finished one.
import type { TranscriptWord } from '../../../shared/types';

/** Words a finished thought never ends on. */
const DANGLING = new Set(
  'and but so or nor because cause cuz the a an um uh like if when then than also plus which while until unless though although whereas of with my your our their its'.split(' '),
);

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
    if (to >= 0) {
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
