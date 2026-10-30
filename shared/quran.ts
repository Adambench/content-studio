// Ayat on screen are never typed by Claude: a scene names the reference and the server fills the Arabic and the
// meaning from the Quran text (Tanzil, verbatim) and one translation (server/src/islamic/quran.ts).

export type AyahRef = { surah: number; from: number; to: number };

/** One passage as it goes on screen: the Arabic, the meaning and the citation. */
export type QuranPassage = AyahRef & {
  /** Transliterated surah name, e.g. Ash-Sharh. */
  name: string;
  /** Its English name, e.g. The Consolation. */
  english: string;
  arabicName: string;
  /** The ayat in Arabic, each followed by its number in an end-of-ayah mark when there are several. */
  arabic: string;
  meaning: string;
  /** "Ash-Sharh 94:5–6": goes in the scene's `sub`, which is parsed again to look it up. */
  citation: string;
  translation: string;
};

/** Most ayat one card holds; longer passages go on several cards. */
export const MAX_AYAT = 6;
/** The longest Arabic (letters and marks) and meaning one card can hold readably. */
export const MAX_ARABIC = 600;
export const MAX_MEANING = 600;

/** "94:5", "94:5-6", "Quran 2:255", "Ash-Sharh 94:5–6": the first surah:ayah(-ayah) in the text. */
export function parseAyahRef(text: string): AyahRef | null {
  const m = /(\d{1,3})\s*:\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?/.exec(text);
  if (!m) return null;
  const surah = Number(m[1]);
  const from = Number(m[2]);
  const to = m[3] ? Number(m[3]) : from;
  if (surah < 1 || surah > 114 || from < 1 || to < from) return null;
  return { surah, from, to };
}

export const refLabel = (r: AyahRef) => `${r.surah}:${r.from}${r.to > r.from ? `–${r.to}` : ''}`;
