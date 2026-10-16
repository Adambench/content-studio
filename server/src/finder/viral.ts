// Moments that already went viral: other clippers' short clips of a creator that got far more views than the rest,
// found by searching YouTube (yt-dlp, no sign-in), their captions matched against the source video's transcript so
// the finder knows which stretch of the source they were cut from. The pick then looks at those stretches first.
import type { ViralHint } from '../../../shared/finder';
import { ytInfo, youtubeCaptions } from '../campaigns/sources';
import { transcriptWords, type Word } from '../clipping/scan';
import type { Transcript } from '../../../shared/types';

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const GRAM = 3;

/**
 * Where in the source a clip was cut from: the clip's word triples are looked up in the source, and the position most
 * of them agree on (the same offset between the clip and the source) is the cut. `match` is the share of the clip's
 * triples found there; null when too little matches to be sure (< 0.5).
 */
export function matchToSource(clip: Word[], source: Word[]): { start: number; end: number; match: number } | null {
  const c = clip.map((w) => norm(w.text));
  const s = source.map((w) => norm(w.text));
  if (c.length < 12 || s.length < c.length) return null;
  const index = new Map<string, number[]>();
  for (let i = 0; i + GRAM <= s.length; i++) {
    const key = s.slice(i, i + GRAM).join(' ');
    if (!s[i]) continue;
    (index.get(key) ?? index.set(key, []).get(key)!).push(i);
  }
  // Votes for each offset (source index minus clip index), a few words wide to bear small differences.
  const votes = new Map<number, { n: number; first: number; last: number }>();
  let total = 0;
  for (let j = 0; j + GRAM <= c.length; j++) {
    total++;
    for (const i of index.get(c.slice(j, j + GRAM).join(' ')) ?? []) {
      const offset = Math.round((i - j) / 4);
      const v = votes.get(offset) ?? { n: 0, first: i, last: i };
      v.n++;
      v.first = Math.min(v.first, i);
      v.last = Math.max(v.last, i + GRAM - 1);
      votes.set(offset, v);
    }
  }
  const best = [...votes.values()].sort((a, b) => b.n - a.n)[0];
  if (!best || !total || best.n / total < 0.5) return null;
  return { start: source[best.first].start, end: source[best.last].end, match: Math.round((best.n / total) * 100) / 100 };
}

type Found = { link: string; title: string; views: number; seconds: number };

/** Short YouTube videos that mention the creator, ordered as the search gives them. */
export async function searchClips(creator: string, limit = 30): Promise<Found[]> {
  const info = await ytInfo(`ytsearch${limit}:${creator} clips`, ['--flat-playlist']);
  return (info.entries ?? [])
    .filter((e) => (e.webpage_url || e.url) && typeof e.view_count === 'number' && e.duration && e.duration <= 95)
    .map((e) => ({ link: (e.webpage_url ?? e.url)!, title: e.title ?? '', views: e.view_count!, seconds: e.duration! }));
}

/** The clips that did far better than their neighbours: at least 3× the median of the search, and 20,000 views. */
export function outliers(found: Found[], max = 6): Found[] {
  if (found.length < 5) return [];
  const sorted = found.map((f) => f.views).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return found
    .filter((f) => f.views >= Math.max(20_000, median * 3))
    .sort((a, b) => b.views - a.views)
    .slice(0, max);
}

/** Viral hints for one source video: search for the creator's clips, match the outliers' captions to the transcript. */
export async function findViralHints(source: { creator: string | null; title: string; link: string | null }, transcript: Transcript, log: (m: string) => void = () => {}): Promise<ViralHint[]> {
  const creator = source.creator?.trim();
  if (!creator) return [];
  const words = transcriptWords(transcript);
  const found = outliers(await searchClips(creator).catch((err: Error) => (log(`search failed: ${err.message}`), [])));
  const hints: ViralHint[] = [];
  for (const f of found) {
    // The source itself can turn up in the search.
    if (source.link && f.link === source.link) continue;
    const captions = await youtubeCaptions(f.link).catch(() => null);
    if (!captions) continue;
    const at = matchToSource(transcriptWords(captions), words);
    if (!at) continue;
    hints.push({ start: at.start, end: at.end, link: f.link, title: f.title, views: f.views, match: at.match });
  }
  // Several clips of one stretch count once (the biggest).
  return hints
    .sort((a, b) => b.views - a.views)
    .filter((h, i, all) => !all.slice(0, i).some((o) => h.start < o.end && h.end > o.start))
    .slice(0, 6);
}
