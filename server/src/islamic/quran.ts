import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_ARABIC, MAX_AYAT, MAX_MEANING, parseAyahRef, refLabel, type QuranPassage } from '../../../shared/quran';
import { config } from '../config';
import { HttpError } from '../lib/http';

// The Quran text and its meaning, downloaded once from Tanzil (tanzil.net) into the data folder and kept verbatim
// with their notices: the Arabic in the Simple script with its marks (it reads well in Noto Naskh Arabic) and the
// Saheeh International translation, which Tanzil offers for non-commercial use.

const SOURCES = {
  text: { file: 'quran-simple.txt', url: 'https://tanzil.net/pub/download/index.php?quranType=simple&outType=txt-2&agree=true&marks=true&sajdah=true&tatweel=true' },
  meaning: { file: 'en.sahih.txt', url: 'https://tanzil.net/trans/?transID=en.sahih&type=txt-2' },
  surahs: { file: 'quran-data.xml', url: 'https://tanzil.net/res/text/metadata/quran-data.xml' },
};
export const TRANSLATION = 'Saheeh International';
const AYAT = 6236;

type Surah = { ayat: number; name: string; english: string; arabicName: string };
type Quran = { surahs: Surah[]; text: Map<string, string>; meaning: Map<string, string> };

const dir = () => join(config.dataDir, 'quran');
let loading: Promise<Quran> | null = null;

async function fetchText(url: string) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`tanzil.net answered ${res.status}`);
  return res.text();
}

/** sura|aya|text lines; the notice at the end is kept in the file, not here. */
function lines(raw: string) {
  const out = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const m = /^(\d+)\|(\d+)\|(.+)$/.exec(line.trimEnd());
    if (m) out.set(`${m[1]}:${m[2]}`, m[3]);
  }
  return out;
}

function surahList(xml: string): Surah[] {
  const list: Surah[] = [];
  for (const m of xml.matchAll(/<sura index="(\d+)" ayas="(\d+)"[^>]*? name="([^"]+)" tname="([^"]+)" ename="([^"]+)"/g)) {
    // Tanzil writes long vowels twice (Al-Faatiha); the usual spelling has one.
    list[Number(m[1]) - 1] = { ayat: Number(m[2]), arabicName: m[3], name: m[4].replace(/([aiu])\1/gi, '$1'), english: m[5] };
  }
  return list;
}

async function load(): Promise<Quran> {
  await mkdir(dir(), { recursive: true });
  const raw: Record<keyof typeof SOURCES, string> = { text: '', meaning: '', surahs: '' };
  for (const [key, src] of Object.entries(SOURCES) as [keyof typeof SOURCES, (typeof SOURCES)[keyof typeof SOURCES]][]) {
    const path = join(dir(), src.file);
    if (existsSync(path)) {
      raw[key] = await readFile(path, 'utf8');
      continue;
    }
    const body = await fetchText(src.url);
    // Checked before it's kept, so a broken download is fetched again next time.
    if (key !== 'surahs' && lines(body).size !== AYAT) throw new Error(`The ${key === 'text' ? 'Quran text' : 'translation'} from tanzil.net isn't complete.`);
    if (key === 'surahs' && surahList(body).filter(Boolean).length !== 114) throw new Error('The surah list from tanzil.net isn’t complete.');
    await writeFile(`${path}.part`, body);
    await rename(`${path}.part`, path);
    raw[key] = body;
  }
  return { surahs: surahList(raw.surahs), text: lines(raw.text), meaning: lines(raw.meaning) };
}

function quran() {
  loading ??= load().catch((err) => {
    loading = null;
    throw new HttpError(502, `Couldn’t get the Quran text from tanzil.net: ${err instanceof Error ? err.message : String(err)}`);
  });
  return loading;
}

const arabicDigits = (n: number) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);

/** A passage by its reference ("94:5-6", "Ash-Sharh 94:5–6"), exactly as the sources have it. */
export async function lookupAyat(ref: string): Promise<QuranPassage> {
  const r = parseAyahRef(ref);
  if (!r) throw new HttpError(400, 'Give the reference as surah:ayah, e.g. 94:5 or 94:5-6.');
  const q = await quran();
  const surah = q.surahs[r.surah - 1];
  if (!surah || r.to > surah.ayat) throw new HttpError(400, `Surah ${surah?.name ?? r.surah} has ${surah?.ayat ?? 0} ayat.`);
  if (r.to - r.from + 1 > MAX_AYAT) throw new HttpError(400, `At most ${MAX_AYAT} ayat on one card: split ${refLabel(r)} over several.`);
  const ayat: { n: number; arabic: string; meaning: string }[] = [];
  // The first ayah carries the basmala (Al-Fatihah's first ayah) in this text; it isn't part of the ayah.
  const basmala = `${q.text.get('1:1')} `;
  for (let n = r.from; n <= r.to; n++) {
    let arabic = q.text.get(`${r.surah}:${n}`) ?? '';
    if (n === 1 && r.surah !== 1 && arabic.startsWith(basmala)) arabic = arabic.slice(basmala.length);
    ayat.push({ n, arabic, meaning: q.meaning.get(`${r.surah}:${n}`) ?? '' });
  }
  const many = ayat.length > 1;
  const arabic = ayat.map((a) => (many ? `${a.arabic} ﴿${arabicDigits(a.n)}﴾` : a.arabic)).join(' ');
  const meaning = ayat.map((a) => a.meaning.trim()).join(' ');
  if (arabic.length > MAX_ARABIC || meaning.length > MAX_MEANING) throw new HttpError(400, `${refLabel(r)} is too long for one card: pick fewer ayat.`);
  return { ...r, name: surah.name, english: surah.english, arabicName: surah.arabicName, arabic, meaning, citation: `${surah.name} ${refLabel(r)}`, translation: TRANSLATION };
}
