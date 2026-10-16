// The built-in 2D characters (CHARACTERS in shared/recipe.ts), drawn as SVG busts on a 400×600 canvas. Each has five
// mouth shapes (.m0 shut … .m4 wide open) that the dialogue format switches between with the voice, and eyes
// (.eyes) that blink. Simple, flat and friendly, so they read at phone size.
import type { CharacterId } from '../../../shared/recipe';

const humanMouth = (lip: string) => `
<g class="mouth" transform="translate(200 322)">
  <path class="m0" d="M -26 0 Q 0 9 26 0" stroke="${lip}" stroke-width="7" fill="none" stroke-linecap="round"/>
  <g class="m1" opacity="0"><ellipse rx="17" ry="7" fill="${lip}"/></g>
  <g class="m2" opacity="0"><ellipse rx="21" ry="12" fill="${lip}"/><ellipse cy="5" rx="11" ry="5" fill="#e07b7b"/></g>
  <g class="m3" opacity="0"><ellipse rx="24" ry="18" fill="${lip}"/><ellipse cy="9" rx="13" ry="7" fill="#e07b7b"/><rect x="-14" y="-17" width="28" height="6" rx="3" fill="#fff"/></g>
  <g class="m4" opacity="0"><ellipse rx="26" ry="24" fill="${lip}"/><ellipse cy="12" rx="15" ry="8" fill="#e07b7b"/><rect x="-16" y="-23" width="32" height="7" rx="3" fill="#fff"/></g>
</g>`;

const humanEyes = (y: number, lashes = false) => `
<g class="eyes">
  ${[155, 245]
    .map(
      (x) => `<ellipse cx="${x}" cy="${y}" rx="19" ry="21" fill="#fff"/><circle cx="${x + 2}" cy="${y + 2}" r="10" fill="#1f2937"/><circle cx="${x + 5}" cy="${y - 2}" r="3.5" fill="#fff"/>` +
        (lashes ? `<path d="M ${x - 20} ${y - 14} Q ${x} ${y - 30} ${x + 20} ${y - 14}" stroke="#1f2937" stroke-width="5" fill="none" stroke-linecap="round"/>` : ''),
    )
    .join('')}
</g>`;

const brows = (y: number, color: string) =>
  `<path d="M 130 ${y} Q 155 ${y - 12} 180 ${y - 2}" stroke="${color}" stroke-width="9" fill="none" stroke-linecap="round"/><path d="M 220 ${y - 2} Q 245 ${y - 12} 270 ${y}" stroke="${color}" stroke-width="9" fill="none" stroke-linecap="round"/>`;

const nose = (skin: string) => `<path d="M 200 268 Q 190 296 200 300 Q 208 300 212 296" stroke="${skin}" stroke-width="6" fill="none" stroke-linecap="round" opacity=".55"/>`;
const cheeks = `<circle cx="138" cy="300" r="20" fill="#f87171" opacity=".18"/><circle cx="262" cy="300" r="20" fill="#f87171" opacity=".18"/>`;

const LOOKS: Record<CharacterId, string> = {
  sam: `
<path d="M 55 600 Q 62 470 200 448 Q 338 470 345 600 Z" fill="#3b82f6"/>
<path d="M 160 452 L 200 500 L 240 452 Z" fill="#1d4ed8"/>
<rect x="170" y="360" width="60" height="100" rx="22" fill="#e9b47a"/>
<circle cx="78" cy="268" r="24" fill="#f1c27d"/><circle cx="322" cy="268" r="24" fill="#f1c27d"/>
<circle cx="200" cy="250" r="126" fill="#f1c27d"/>
<path d="M 76 236 Q 84 108 200 102 Q 318 108 324 236 Q 302 158 200 158 Q 104 162 76 236 Z" fill="#2b2b2b"/>
${brows(214, '#2b2b2b')}${humanEyes(252)}${nose('#c98c4f')}${cheeks}${humanMouth('#5b2323')}`,

  max: `
<path d="M 55 600 Q 62 470 200 448 Q 338 470 345 600 Z" fill="#10b981"/>
<path d="M 150 455 Q 200 520 250 455" stroke="#047857" stroke-width="10" fill="none"/>
<rect x="170" y="360" width="60" height="100" rx="22" fill="#c98f55"/>
<circle cx="78" cy="268" r="24" fill="#e0ac69"/><circle cx="322" cy="268" r="24" fill="#e0ac69"/>
<circle cx="200" cy="250" r="126" fill="#e0ac69"/>
<path d="M 84 222 Q 96 116 200 112 Q 306 116 316 222 Q 290 170 200 168 Q 112 170 84 222 Z" fill="#4b3621"/>
<path d="M 84 268 Q 92 386 200 392 Q 308 386 316 268 Q 296 346 200 350 Q 104 346 84 268 Z" fill="#4b3621"/>
${brows(212, '#4b3621')}${humanEyes(252)}
<g fill="none" stroke="#111827" stroke-width="7"><circle cx="155" cy="252" r="35"/><circle cx="245" cy="252" r="35"/><path d="M 190 250 Q 200 242 210 250"/></g>
${nose('#a8743f')}${humanMouth('#3b1414')}`,

  lina: `
<path d="M 48 600 Q 40 430 92 300 Q 104 118 200 108 Q 296 118 308 300 Q 360 430 352 600 Z" fill="#7c3aed"/>
<path d="M 120 470 Q 200 520 280 470 L 300 600 L 100 600 Z" fill="#6d28d9"/>
<ellipse cx="200" cy="268" rx="102" ry="120" fill="#c68642"/>
<ellipse cx="200" cy="264" rx="110" ry="128" fill="none" stroke="#6d28d9" stroke-width="16"/>
${brows(220, '#3b2314')}${humanEyes(258, true)}${nose('#9a6233')}${cheeks}${humanMouth('#4a1717')}`,

  bolt: `
<rect x="70" y="430" width="260" height="190" rx="46" fill="#64748b"/>
<circle cx="200" cy="510" r="26" fill="#22d3ee" opacity=".85"/>
<rect x="175" y="360" width="50" height="80" rx="12" fill="#475569"/>
<line x1="200" y1="120" x2="200" y2="72" stroke="#475569" stroke-width="10" stroke-linecap="round"/>
<circle cx="200" cy="64" r="16" fill="#f43f5e"/>
<rect x="70" y="118" width="260" height="250" rx="56" fill="#94a3b8"/>
<rect x="50" y="210" width="24" height="70" rx="10" fill="#64748b"/><rect x="326" y="210" width="24" height="70" rx="10" fill="#64748b"/>
<rect x="98" y="158" width="204" height="170" rx="34" fill="#0f172a"/>
<g class="eyes"><rect x="133" y="196" width="36" height="44" rx="12" fill="#22d3ee"/><rect x="231" y="196" width="36" height="44" rx="12" fill="#22d3ee"/></g>
<g class="mouth" fill="#22d3ee" transform="translate(200 290)">
  <rect class="m0" x="-34" y="-3" width="68" height="6" rx="3"/>
  ${[1, 2, 3, 4]
    .map((lvl) => {
      const bars = [0.5, 0.8, 1, 0.8, 0.5].map((k, j) => {
        const h = Math.max(6, Math.round(k * lvl * 9));
        return `<rect x="${-34 + j * 14}" y="${-h / 2}" width="10" height="${h}" rx="4"/>`;
      });
      return `<g class="m${lvl}" opacity="0">${bars.join('')}</g>`;
    })
    .join('')}
</g>`,
};

/** A character's SVG; `id` is the DOM id of the element that holds it. */
export const characterSvg = (look: CharacterId) => `<svg class="chr" viewBox="0 0 400 600" preserveAspectRatio="xMidYMax meet">${LOOKS[look] ?? LOOKS.sam}</svg>`;
