// Small helpers for writing composition HTML and its GSAP timeline as strings.

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
/** Text overlays mark their accent word(s) like *this*: shown in the accent colour (after escaping). */
export const accent = (escaped: string) => escaped.replace(/\*([^*\n]+)\*/g, '<span class="acc">$1</span>');
export const attrJson = (v: unknown) => esc(JSON.stringify(v));
export const n = (v: number) => String(Math.round(v * 1000) / 1000);
export const px = (v: number) => `${Math.round(v * 100) / 100}px`;
export const js = (v: unknown) => JSON.stringify(v);
