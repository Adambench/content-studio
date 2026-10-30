// The pages' mascots (phase 12 step 5), drawn as SVG, never generated. Ported from the approved brand drafts
// (~/Documents/content-studio-brand/src/rig.mjs). Every limb is two segments in nested groups that turn at the shoulder
// and elbow (hip and knee), so a pose is a few angles and a scene tweens from one pose to the next. Angles are degrees
// from hanging straight down, + = away from the body. Blok's arms and legs are rigid blocks (only the first angle).
// Each mascot is drawn standing with its feet on y = 0, in its own units (the viewBox), at the rest pose's angles.

export const MASCOTS = ['founder', 'traveller', 'blok', 'host'] as const;
export type MascotId = (typeof MASCOTS)[number];
export const isMascot = (v: unknown): v is MascotId => MASCOTS.includes(v as MascotId);

export const MASCOT_POSES = ['idle', 'point', 'think', 'cheer', 'shock', 'wave', 'dua', 'lantern', 'mic', 'walk', 'talk'] as const;
export type MascotPose = (typeof MASCOT_POSES)[number];
export const isMascotPose = (v: unknown): v is MascotPose => MASCOT_POSES.includes(v as MascotPose);

export const POSE_INFO: Record<MascotPose, { label: string; hint: string; loop?: boolean }> = {
  idle: { label: 'Stand', hint: 'Standing, arms down' },
  point: { label: 'Point', hint: 'Points to its left (your right): put what it points at there, or flip it' },
  think: { label: 'Think', hint: 'A hand on the chin' },
  cheer: { label: 'Cheer', hint: 'Both arms up, a jump: a win, the payoff' },
  shock: { label: 'Shock', hint: 'Hands up: a twist, a surprise' },
  wave: { label: 'Wave', hint: 'Waves while held: hello, follow', loop: true },
  dua: { label: 'Du’a', hint: 'Hands raised in du’a' },
  lantern: { label: 'Lantern', hint: 'Holds up the lantern' },
  mic: { label: 'At the mic', hint: 'At the desk, talking into the mic', loop: true },
  walk: { label: 'Walk', hint: 'Walks on the spot while held: move it with x at the same time', loop: true },
  talk: { label: 'Talk', hint: 'Talks with the hands while held', loop: true },
};

type Box = [number, number, number, number];
export const MASCOT_INFO: Record<MascotId, { label: string; look: string; poses: MascotPose[]; box: Box }> = {
  founder: {
    label: 'The founder (personal brand)',
    look: 'Faceless (no eyes, no mouth): a dark cap with an amber growth-arrow patch, gold aviators, a full beard, an oversized amber hoodie, a crossbody bag with cash sticking out, white sneakers; drawn in wobbly ink',
    poses: ['idle', 'point', 'think', 'cheer', 'shock', 'wave', 'walk', 'talk'],
    box: [-210, -470, 420, 500],
  },
  traveller: {
    label: 'The Traveller (Gentle Return)',
    look: 'Faceless: a white kufi with a gold stitch, a long white thobe, sandals, a lantern. Never a prophet, companion or named person; kept out of salah scenes',
    poses: ['idle', 'point', 'think', 'dua', 'lantern', 'walk', 'talk'],
    box: [-210, -470, 420, 500],
  },
  blok: {
    label: 'Blok (Blox Moments)',
    look: 'A classic blocky avatar: a yellow head with a simple smile, a plain cyan shirt, navy legs, a black cap worn sideways with a cyan brim, rigid block limbs',
    poses: ['idle', 'point', 'cheer', 'shock', 'wave', 'walk', 'talk'],
    box: [-280, -500, 560, 530],
  },
  host: {
    label: 'The host (Long Story Short)',
    look: 'A podcaster: curly hair, a short beard, big orange headphones, the orange hoodie; at the mic he sits behind a desk with LONG STORY SHORT on it',
    poses: ['mic', 'idle', 'point', 'think', 'cheer', 'shock', 'wave', 'walk', 'talk'],
    box: [-210, -470, 420, 500],
  },
};

/** The pose a mascot actually takes: one it doesn't have falls back to standing. */
export const mascotPose = (id: MascotId, pose: MascotPose): MascotPose => (MASCOT_INFO[id].poses.includes(pose) ? pose : 'idle');

// ---------- poses ----------

type Limb = [number, number];
type Mood = 'smug' | 'determined' | 'curious' | 'joy' | 'shock' | 'talk';
/** Everything a pose sets. Numbers tween; the rest switches halfway through a change. */
export type MascotKey = {
  lA: Limb;
  rA: Limb;
  lL: Limb;
  rL: Limb;
  tilt: number;
  lift: number;
  finger: '' | 'l' | 'r';
  cup: boolean;
  lantern: boolean;
  mic: boolean;
  mood: Mood;
};
type Part = Partial<MascotKey>;

const IDLE: MascotKey = { lA: [10, -4], rA: [10, -4], lL: [3, 0], rL: [3, 0], tilt: 0, lift: 0, finger: '', cup: false, lantern: false, mic: false, mood: 'smug' };
const POSES: Record<MascotPose, Part | [Part, Part]> = {
  idle: {},
  point: { rA: [94, -6], rL: [6, 0], tilt: 5, finger: 'r', mood: 'determined' },
  think: { lA: [12, -6], rA: [-82, -123], tilt: -7, mood: 'curious' },
  cheer: { lA: [150, 18], rA: [150, 18], lL: [16, -12], rL: [16, -12], lift: 26, mood: 'joy' },
  shock: { lA: [118, 42], rA: [118, 42], lL: [12, 0], rL: [12, 0], mood: 'shock' },
  dua: { lA: [42, -148], rA: [42, -148], cup: true, tilt: -4 },
  lantern: { rA: [26, -16], lantern: true },
  mic: [
    { lA: [24, -84], rA: [34, -150], mic: true, mood: 'talk' },
    { lA: [26, -94], rA: [30, -140], mic: true, mood: 'talk' },
  ],
  walk: [
    { lL: [14, -12], rL: [-2, 0], lA: [4, -8], rA: [18, -10], tilt: 2, mood: 'smug' },
    { lL: [-2, 0], rL: [14, -12], lA: [18, -10], rA: [4, -8], tilt: -2, mood: 'smug' },
  ],
  wave: [
    { rA: [150, 34], tilt: 3, mood: 'joy' },
    { rA: [150, -18], tilt: -1, mood: 'joy' },
  ],
  talk: [
    { lA: [22, -40], rA: [16, -22], mood: 'talk' },
    { lA: [14, -18], rA: [26, -50], mood: 'talk' },
  ],
};
/** Per mascot: a pose drawn its own way (longer arms reach differently). */
const OWN: Partial<Record<MascotId, Partial<Record<MascotPose, Part | [Part, Part]>>>> = {
  // The hand sits under the beard, where the head doesn't cover it.
  founder: { think: { lA: [12, -6], rA: [-58, -161], tilt: -7, mood: 'curious' } },
  traveller: { think: { lA: [12, -6], rA: [-71, -139], tilt: -6 } },
  blok: {
    point: { rA: [90, 0], rL: [4, 0], tilt: 4, mood: 'determined' },
    cheer: { lA: [166, 0], rA: [166, 0], lL: [14, 0], rL: [14, 0], lift: 30, mood: 'joy' },
    shock: { lA: [152, 0], rA: [152, 0], lL: [6, 0], rL: [6, 0], mood: 'shock' },
    idle: { lA: [4, 0], rA: [4, 0], lL: [0, 0], rL: [0, 0] },
    wave: [
      { lA: [4, 0], rA: [150, 0], tilt: 4, mood: 'joy' },
      { lA: [4, 0], rA: [124, 0], tilt: -2, mood: 'joy' },
    ],
    walk: [
      { lA: [-14, 0], rA: [14, 0], lL: [12, 0], rL: [-8, 0], tilt: 2, mood: 'smug' },
      { lA: [14, 0], rA: [-14, 0], lL: [-8, 0], rL: [12, 0], tilt: -2, mood: 'smug' },
    ],
    talk: [
      { lA: [20, 0], rA: [8, 0], mood: 'talk' },
      { lA: [8, 0], rA: [24, 0], mood: 'talk' },
    ],
  },
};

/** Seconds from one key of a looping pose to the other. */
export const LOOP_HALF: Partial<Record<MascotPose, number>> = { walk: 0.3, wave: 0.22, talk: 0.42, mic: 0.46 };
/** Seconds between a talking mouth opening and shutting. */
export const MOUTH_HALF = 0.13;

/** A pose's keys: one for a held pose, two for a looping one (it swings between them). */
export function poseKeys(id: MascotId, pose: MascotPose): [MascotKey] | [MascotKey, MascotKey] {
  const p = mascotPose(id, pose);
  const raw = OWN[id]?.[p] ?? POSES[p];
  const base = { ...IDLE, ...(OWN[id]?.idle as Part | undefined) };
  return Array.isArray(raw) ? [{ ...base, ...raw[0] }, { ...base, ...raw[1] }] : [{ ...base, ...raw }];
}

// ---------- the rig: what each joint's transform is in a key ----------

type Pt = [number, number];
type Geometry = { arm: [Pt, number, number]; leg: [Pt, number, number] | null; neck: number; shadow: number };
const GEOMETRY: Record<MascotId, Geometry> = {
  founder: { arm: [[54, -252], 54, 50], leg: [[24, -136], 66, 60], neck: -270, shadow: 78 },
  host: { arm: [[54, -252], 54, 50], leg: [[24, -136], 66, 60], neck: -270, shadow: 78 },
  traveller: { arm: [[44, -262], 62, 58], leg: null, neck: -282, shadow: 78 },
  // Blok's limbs turn at the top of each block.
  blok: { arm: [[93, -282], 150, 0], leg: [[38, -150], 150, 0], neck: -300, shadow: 78 },
};

const f = (n: number) => Math.round(n * 10) / 10;

/**
 * The joints that move and their transform in a key: rotations about fixed pivots (in the parent's units), the body's
 * lift and, for upright things held in a hand (a lantern, cupped hands), a turn that undoes the arm's.
 */
export function jointTransforms(id: MascotId, k: MascotKey): Record<string, string> {
  const g = GEOMETRY[id];
  const [[sx, sy], l1] = g.arm;
  const out: Record<string, string> = {
    body: `translate(0 ${f(-k.lift)})`,
    head: `rotate(${f(k.tilt)} 0 ${g.neck})`,
    la1: `rotate(${f(k.lA[0])} ${-sx} ${sy})`,
    ra1: `rotate(${f(-k.rA[0])} ${sx} ${sy})`,
  };
  if (id !== 'blok') {
    out.la2 = `rotate(${f(k.lA[1])} ${-sx} ${sy + l1})`;
    out.ra2 = `rotate(${f(-k.rA[1])} ${sx} ${sy + l1})`;
  }
  if (id === 'traveller') {
    const hand = sy + l1 + g.arm[2];
    out.lup = `rotate(${f(-(k.lA[0] + k.lA[1]))} ${-sx} ${hand})`;
    out.rup = `rotate(${f(k.rA[0] + k.rA[1])} ${sx} ${hand})`;
  }
  if (g.leg) {
    const [[hx, hy], h1] = g.leg;
    out.ll1 = `rotate(${f(k.lL[0])} ${-hx} ${hy})`;
    out.rl1 = `rotate(${f(-k.rL[0])} ${hx} ${hy})`;
    if (id !== 'blok') {
      out.ll2 = `rotate(${f(k.lL[1])} ${-hx} ${hy + h1})`;
      out.rl2 = `rotate(${f(-k.rL[1])} ${hx} ${hy + h1})`;
    }
  }
  return out;
}
/** The ground shadow's width (it shrinks as the mascot jumps). */
export const shadowWidth = (id: MascotId, k: MascotKey) => f(GEOMETRY[id].shadow - k.lift);

/** What shows in a key: each switchable part and whether it's on. */
export function switches(id: MascotId, k: MascotKey): Record<string, boolean> {
  const out: Record<string, boolean> = id === 'blok' ? {} : { fl: k.finger === 'l', fr: k.finger === 'r' };
  if (id === 'traveller') Object.assign(out, { hand: !k.cup, cup: k.cup, lant: k.lantern });
  if (id === 'host') Object.assign(out, { desk: k.mic, legs: !k.mic });
  if (id === 'host' || id === 'blok') for (const m of MOODS) out[`mood-${m}`] = k.mood === m;
  return out;
}
const MOODS: Mood[] = ['smug', 'determined', 'curious', 'joy', 'shock', 'talk'];

// ---------- drawing ----------

const seg = (x: number, y1: number, y2: number, w: number, color: string) =>
  `<path d="M${f(x)} ${f(y1)} L${f(x)} ${f(y2)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
const dot = ([x, y]: Pt, r: number, fill: string, line = 'none', ow = 0) => `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="${fill}" stroke="${line}" stroke-width="${ow}"/>`;

type Ctx = { P: string; t: Record<string, string>; on: Record<string, boolean> };
const cls = (c: Ctx, name: string) => `${c.P}-${name}`;
/** A joint's group at its pose. */
const joint = (c: Ctx, name: string, inner: string) => `<g class="${cls(c, name)}" transform="${c.t[name]}">${inner}</g>`;
/** A part that switches on and off. */
const part = (c: Ctx, name: string, inner: string) => `<g class="${cls(c, name)}" opacity="${c.on[name] ? 1 : 0}">${inner}</g>`;

/**
 * A two-segment limb: its outlines first, then its fills (so the elbow has no seam), each in the same nested joints.
 * `tip` is drawn in the lower segment's frame at its end (x, end): a hand, a shoe.
 */
function limb(c: Ctx, side: 'la' | 'ra' | 'll' | 'rl', [x, y]: Pt, l1: number, l2: number, w: number, fill: string, line: string, ow: number, tip = '') {
  const e = y + l1;
  const end = e + l2;
  const layer = (color: string, width: number, extra: string) => joint(c, `${side}1`, seg(x, y, e, width, color) + joint(c, `${side}2`, seg(x, e, end, width, color) + extra));
  return layer(line, w + ow * 2, '') + layer(fill, w, tip);
}

// The founder: the user, faceless like the page.
const PB = { ink: '#1E1B18', paper: '#FFFCF5', hoodie: '#E39B2D', hoodieDark: '#B8741A', pants: '#3F3A35', dark: '#2B2724', lens: '#141210', gold: '#C9A45C', cash: '#8DBF7A' };
function founder(c: Ctx, lift: number) {
  const { ink, paper, hoodie, hoodieDark, pants, dark, lens, gold, cash } = PB;
  const hand = (x: number, end: number, side: 'l' | 'r') =>
    seg(x, end - 17, end - 7, 44, ink) + seg(x, end - 17, end - 7, 34, hoodieDark) +
    part(c, `f${side}`, seg(x, end, end + 24, 20, ink) + seg(x, end, end + 24, 10, paper)) +
    dot([x, end], 15, paper, ink, 5);
  const shoe = (x: number, end: number, sg: number) =>
    `<ellipse cx="${f(x + sg * 9)}" cy="${f(end - 2)}" rx="28" ry="15" fill="${paper}" stroke="${ink}" stroke-width="5"/><path d="M${f(x + sg * 9 - 24)} ${f(end + 5)} L${f(x + sg * 9 + 24)} ${f(end + 5)}" stroke="${hoodie}" stroke-width="5" stroke-linecap="round"/>`;
  const bills = [[26, -210, -16], [40, -214, 0], [54, -208, 16]]
    .map(([x, y, r]) => `<g transform="rotate(${r} ${x + 15} ${y + 40})"><rect x="${x}" y="${y}" width="30" height="46" rx="3" fill="${cash}" stroke="${ink}" stroke-width="3.5"/><rect x="${x + 5}" y="${y + 5}" width="20" height="36" rx="2" fill="none" stroke="${ink}" stroke-width="1.5" opacity=".5"/><path d="M${x + 15} ${y + 13} L${x + 15} ${y + 33} M${x + 20} ${y + 17} Q${x + 15} ${y + 13} ${x + 11} ${y + 17} Q${x + 9} ${y + 22} ${x + 15} ${y + 23} Q${x + 21} ${y + 24} ${x + 19} ${y + 29} Q${x + 15} ${y + 33} ${x + 10} ${y + 29}" fill="none" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/></g>`)
    .join('');
  const y = -322;
  const aviators = `<path d="M-52 ${y - 10} L-8 ${y - 10} Q-6 ${y + 12} -24 ${y + 18} Q-50 ${y + 20} -52 ${y - 10} Z M52 ${y - 10} L8 ${y - 10} Q6 ${y + 12} 24 ${y + 18} Q50 ${y + 20} 52 ${y - 10} Z" fill="${lens}" stroke="${gold}" stroke-width="4" stroke-linejoin="round"/><path d="M-8 ${y - 8} L8 ${y - 8} M-8 ${y - 2} Q0 ${y - 6} 8 ${y - 2}" fill="none" stroke="${gold}" stroke-width="3"/>`;
  const head =
    `<circle cx="0" cy="-318" r="64" fill="${paper}" stroke="${ink}" stroke-width="6"/>` +
    `<path d="M-63 -326 A64 64 0 1 0 63 -326 L55 -312 Q49 -288 24 -286 Q0 -291 -24 -286 Q-49 -288 -55 -312 Z" fill="${ink}"/>` +
    aviators +
    `<path d="M-63 -350 C-62 -420 62 -420 63 -350 Z" fill="${dark}" stroke="${ink}" stroke-width="5" stroke-linejoin="round"/>` +
    `<path d="M-1 -416 L-1 -352" stroke="${paper}" stroke-width="2" opacity=".2"/>` +
    `<rect x="-18" y="-398" width="36" height="28" rx="5" fill="${hoodie}" stroke="${ink}" stroke-width="3"/><path d="M-11 -377 L-3 -385 L3 -380 L11 -390" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 -391 L12 -391 L12 -384" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M-80 -350 Q0 -372 80 -350 Q84 -340 72 -336 Q0 -352 -72 -336 Q-84 -340 -80 -350 Z" fill="${dark}" stroke="${ink}" stroke-width="5" stroke-linejoin="round"/>` +
    dot([0, -404], 5, dark, ink, 3);
  return (
    `<g filter="url(#${c.P}-rough)"><ellipse class="${cls(c, 'sh')}" cx="0" cy="4" rx="${f(78 - lift)}" ry="11" fill="${ink}" opacity=".14"/>` +
    joint(
      c,
      'body',
      `<ellipse cx="0" cy="-258" rx="54" ry="20" fill="${hoodieDark}" stroke="${ink}" stroke-width="6"/>` +
        limb(c, 'll', [-24, -136], 66, 60, 30, pants, ink, 6, shoe(-24, 0, -1)) +
        limb(c, 'rl', [24, -136], 66, 60, 30, pants, ink, 6, shoe(24, 0, 1)) +
        `<path d="M-58 -262 C-72 -220 -68 -160 -60 -126 L60 -126 C68 -160 72 -220 58 -262 C26 -276 -26 -276 -58 -262 Z" fill="${hoodie}" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/>` +
        `<path d="M-34 -186 L34 -186 L42 -146 L-42 -146 Z" fill="none" stroke="${ink}" stroke-width="4" stroke-linejoin="round" opacity=".75"/><path d="M-11 -262 L-13 -226 M11 -262 L13 -222" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>` +
        `<path d="M-50 -258 L44 -158" stroke="${ink}" stroke-width="13" stroke-linecap="round"/><path d="M-50 -258 L44 -158" stroke="${dark}" stroke-width="6" stroke-linecap="round"/>` +
        bills +
        `<rect x="22" y="-170" width="58" height="42" rx="10" fill="${dark}" stroke="${ink}" stroke-width="5"/><path d="M30 -158 L72 -158" stroke="${hoodie}" stroke-width="3"/>` +
        limb(c, 'la', [-54, -252], 54, 50, 30, hoodie, ink, 6, hand(-54, -148, 'l')) +
        limb(c, 'ra', [54, -252], 54, 50, 30, hoodie, ink, 6, hand(54, -148, 'r')) +
        joint(c, 'head', head),
    ) +
    '</g>'
  );
}

// Gentle Return: the Traveller. No face at all; drawn flat (no gradients).
const GR = { line: '#13261F', robe: '#F5F0E3', skin: '#E8D8BC', kufi: '#FFFFFF', gold: '#C9A45C', sandal: '#6B5038', flame: '#FFD27A' };
function traveller(c: Ctx) {
  const { line, robe, skin, kufi, gold, sandal, flame } = GR;
  const end = -262 + 62 + 58;
  const lantern = (x: number, y: number) =>
    `<g transform="translate(${x} ${y})"><path d="M-9 4 Q0 -10 9 4" fill="none" stroke="${line}" stroke-width="4"/><path d="M-16 20 L16 20 L11 6 L-11 6 Z" fill="${gold}" stroke="${line}" stroke-width="4" stroke-linejoin="round"/><path d="M-15 20 Q-22 52 -12 80 L12 80 Q22 52 15 20 Z" fill="${flame}" stroke="${line}" stroke-width="4" stroke-linejoin="round"/><path d="M0 22 L0 80 M-8 22 Q-13 52 -6 80 M8 22 Q13 52 6 80" fill="none" stroke="${gold}" stroke-width="2" opacity=".8"/><path d="M-16 80 L16 80 L12 92 L-12 92 Z" fill="${gold}" stroke="${line}" stroke-width="4" stroke-linejoin="round"/></g>`;
  const hand = (x: number, side: 'l' | 'r') =>
    part(c, 'hand', part(c, `f${side}`, seg(x, end, end + 22, 16, line) + seg(x, end, end + 22, 8, skin)) + dot([x, end], 12, skin, line, 4)) +
    joint(
      c,
      side === 'l' ? 'lup' : 'rup',
      part(c, 'cup', `<path d="M${x - 15} ${end - 4} Q${x} ${end + 16} ${x + 15} ${end - 4} Z" fill="${skin}" stroke="${line}" stroke-width="4" stroke-linejoin="round"/>`) +
        (side === 'r' ? part(c, 'lant', lantern(x, end + 6)) : ''),
    );
  return (
    `<ellipse class="${cls(c, 'sh')}" cx="0" cy="4" rx="78" ry="11" fill="#000" opacity=".22"/>` +
    joint(
      c,
      'body',
      `<ellipse cx="-24" cy="-8" rx="20" ry="9" fill="${sandal}" stroke="${line}" stroke-width="4"/><ellipse cx="24" cy="-8" rx="20" ry="9" fill="${sandal}" stroke="${line}" stroke-width="4"/>` +
        `<path d="M-46 -270 C-56 -200 -62 -110 -70 -20 Q0 -10 70 -20 C62 -110 56 -200 46 -270 C22 -283 -22 -283 -46 -270 Z" fill="${robe}" stroke="${line}" stroke-width="5" stroke-linejoin="round"/>` +
        `<path d="M0 -276 L0 -206" stroke="${line}" stroke-width="3" opacity=".45"/>${dot([0, -250], 3, line)}${dot([0, -232], 3, line)}` +
        `<path d="M-30 -278 Q0 -262 30 -278" fill="none" stroke="${line}" stroke-width="3" opacity=".5"/>` +
        limb(c, 'la', [-44, -262], 62, 58, 24, robe, line, 5, hand(-44, 'l')) +
        limb(c, 'ra', [44, -262], 62, 58, 24, robe, line, 5, hand(44, 'r')) +
        joint(
          c,
          'head',
          `<circle cx="0" cy="-326" r="46" fill="${skin}" stroke="${line}" stroke-width="5"/>` +
            `<path d="M-41 -346 C-39 -388 39 -388 41 -346 Q0 -356 -41 -346 Z" fill="${kufi}" stroke="${line}" stroke-width="5" stroke-linejoin="round"/>` +
            `<path d="M-36 -356 L-28 -362 L-20 -356 L-12 -362 L-4 -356 L4 -362 L12 -356 L20 -362 L28 -356 L36 -362" fill="none" stroke="${gold}" stroke-width="2.5"/>`,
        ),
    )
  );
}

// Blox Moments: Blok, built like any player's blocky avatar (no logo, no official character).
const RB = { ink: '#0B1220', skin: '#F5CD30', shirt: '#22D3EE', shirtDark: '#0891B2', pants: '#1E3A8A', shoe: '#14275E', cap: '#111827', brim: '#22D3EE' };
function blok(c: Ctx, lift: number) {
  const { ink, skin, shirt, shirtDark, pants, shoe, cap, brim } = RB;
  const leg = (x: number) => `<rect x="${x}" y="-150" width="74" height="150" rx="8" fill="${pants}"/><rect x="${x}" y="-26" width="74" height="26" rx="6" fill="${shoe}"/><rect x="${x}" y="-150" width="74" height="150" rx="8" fill="none" stroke="${ink}" stroke-width="6"/>`;
  const arm = (x: number) => `<rect x="${x}" y="-300" width="72" height="150" rx="12" fill="${skin}"/><rect x="${x}" y="-300" width="72" height="48" rx="10" fill="${shirt}"/><path d="M${x} -252 L${x + 72} -252" stroke="${shirtDark}" stroke-width="4"/><rect x="${x}" y="-300" width="72" height="150" rx="12" fill="none" stroke="${ink}" stroke-width="6"/>`;
  const faces: Record<Mood, string> = {
    smug: `<ellipse cx="-22" cy="-362" rx="7" ry="12" fill="${ink}"/><ellipse cx="22" cy="-362" rx="7" ry="12" fill="${ink}"/><path d="M-28 -338 Q0 -316 28 -338" fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>`,
    determined: `<ellipse cx="-20" cy="-360" rx="7" ry="11" fill="${ink}"/><ellipse cx="24" cy="-360" rx="7" ry="11" fill="${ink}"/><path d="M-36 -380 L-10 -373 M10 -373 L36 -380" stroke="${ink}" stroke-width="6" stroke-linecap="round"/><path d="M-24 -334 Q4 -322 28 -340" fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>`,
    curious: `<ellipse cx="-20" cy="-362" rx="7" ry="12" fill="${ink}"/><ellipse cx="22" cy="-364" rx="7" ry="12" fill="${ink}"/><path d="M-20 -334 Q4 -340 22 -332" fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>`,
    shock: `<ellipse cx="-22" cy="-364" rx="11" ry="15" fill="#fff" stroke="${ink}" stroke-width="5"/><ellipse cx="22" cy="-364" rx="11" ry="15" fill="#fff" stroke="${ink}" stroke-width="5"/><ellipse cx="-22" cy="-362" rx="5" ry="7" fill="${ink}"/><ellipse cx="22" cy="-362" rx="5" ry="7" fill="${ink}"/><ellipse cx="0" cy="-328" rx="11" ry="14" fill="${ink}"/>`,
    joy: `<path d="M-32 -358 Q-22 -372 -12 -358 M12 -358 Q22 -372 32 -358" fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round"/><path d="M-30 -342 Q0 -306 30 -342 Z" fill="${ink}"/>`,
    talk: `<ellipse cx="-22" cy="-362" rx="7" ry="12" fill="${ink}"/><ellipse cx="22" cy="-362" rx="7" ry="12" fill="${ink}"/>${part(c, 'mo', `<path d="M-22 -340 Q0 -312 22 -340 Z" fill="${ink}"/>`)}${part(c, 'ms', `<path d="M-26 -338 Q0 -320 26 -338" fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>`)}`,
  };
  return (
    `<ellipse class="${cls(c, 'sh')}" cx="0" cy="4" rx="${f(78 - lift)}" ry="11" fill="${ink}" opacity=".2"/>` +
    joint(
      c,
      'body',
      joint(c, 'll1', leg(-75)) +
        joint(c, 'rl1', leg(1)) +
        `<rect x="-75" y="-300" width="150" height="152" rx="8" fill="${shirt}" stroke="${ink}" stroke-width="6"/><path d="M-30 -300 Q0 -284 30 -300" fill="none" stroke="${shirtDark}" stroke-width="5"/>` +
        joint(c, 'la1', arm(-147)) +
        joint(c, 'ra1', arm(75)) +
        joint(
          c,
          'head',
          `<rect x="-62" y="-412" width="124" height="112" rx="34" fill="${skin}" stroke="${ink}" stroke-width="6"/>` +
            MOODS.map((m) => part(c, `mood-${m}`, faces[m])).join('') +
            `<path d="M-60 -394 L-114 -392 Q-122 -385 -112 -379 L-60 -381 Z" fill="${brim}" stroke="${ink}" stroke-width="5" stroke-linejoin="round"/>` +
            `<path d="M-64 -386 C-64 -446 64 -446 64 -386 Z" fill="${cap}" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/>` +
            dot([0, -430], 6, brim),
        ),
    )
  );
}

// Long Story Short: the host, a podcaster in big orange headphones; at the mic he sits behind the desk.
const LS = { ink: '#141414', orange: '#F97316', orangeDark: '#C2410C', desk: '#262626', hair: '#1F1A17', skin: '#C68A5E' };
function host(c: Ctx, lift: number) {
  const { ink, orange, orangeDark, desk, hair, skin } = LS;
  const eyes = (m: Mood) => {
    const [dx, dy] = { smug: [1, 0], determined: [3, 0], curious: [3, -4], shock: [0, 0], talk: [2, 0], joy: [0, 0] }[m];
    if (m === 'joy') return `<path d="${[-24, 24].map((x) => `M${x - 9} -316 Q${x} -330 ${x + 9} -316`).join(' ')}" fill="none" stroke="${ink}" stroke-width="5.2" stroke-linecap="round"/>`;
    return [-24, 24].map((x) => dot([x + dx, -318 + dy], m === 'shock' ? 8.1 : 6.5, ink)).join('');
  };
  const brows = (m: Mood) => {
    const y = -340;
    const [a, b] = [-24, 24];
    const h = 11;
    const shapes: Record<Mood, string[]> = {
      smug: [`M${a - h} ${y} L${a + h} ${y + 1}`, `M${b - h} ${y - 2} Q${b} ${y - 13} ${b + h} ${y - 5}`],
      determined: [`M${a - h} ${y - 6} L${a + h} ${y + 4}`, `M${b - h} ${y + 4} L${b + h} ${y - 6}`],
      curious: [`M${a - h} ${y - 8} Q${a} ${y - 19} ${a + h} ${y - 10}`, `M${b - h} ${y + 1} L${b + h} ${y - 1}`],
      joy: [a, b].map((x) => `M${x - h} ${y - 3} Q${x} ${y - 14} ${x + h} ${y - 3}`),
      shock: [a, b].map((x) => `M${x - h} ${y - 12} Q${x} ${y - 23} ${x + h} ${y - 12}`),
      talk: [a, b].map((x) => `M${x - h} ${y - 5} Q${x} ${y - 13} ${x + h} ${y - 6}`),
    };
    return `<path d="${shapes[m].join(' ')}" fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round"/>`;
  };
  const y = -288;
  const open = `<path d="M-15 ${y - 3} Q0 ${y + 17} 15 ${y - 3} Z" fill="#5A1E14" stroke="${ink}" stroke-width="4" stroke-linejoin="round"/><path d="M-7 ${y + 7} Q0 ${y + 2} 7 ${y + 7}" fill="none" stroke="#E5736B" stroke-width="4" stroke-linecap="round"/>`;
  const mouths: Record<Mood, string> = {
    talk: part(c, 'mo', open) + part(c, 'ms', `<path d="M-12 ${y + 1} Q0 ${y + 6} 12 ${y + 1}" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>`),
    smug: `<path d="M-14 ${y} Q2 ${y + 9} 17 ${y - 5}" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>`,
    determined: `<path d="M-18 ${y - 3} Q0 ${y + 18} 18 ${y - 3} Z" fill="#5A1E14" stroke="${ink}" stroke-width="4" stroke-linejoin="round"/><path d="M-15 ${y - 2} L15 ${y - 2} Q12 ${y + 4} 0 ${y + 4} Q-12 ${y + 4} -15 ${y - 2} Z" fill="#fff"/>`,
    curious: `<path d="M-9 ${y + 3} Q2 ${y - 2} 11 ${y + 2}" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>`,
    joy: `<path d="M-22 ${y - 5} Q0 ${y + 26} 22 ${y - 5} Z" fill="#5A1E14" stroke="${ink}" stroke-width="4" stroke-linejoin="round"/><path d="M-19 ${y - 4} L19 ${y - 4} Q15 ${y + 3} 0 ${y + 3} Q-15 ${y + 3} -19 ${y - 4} Z" fill="#fff"/>`,
    shock: `<ellipse cx="0" cy="${y + 2}" rx="11" ry="14" fill="#5A1E14" stroke="${ink}" stroke-width="4"/>`,
  };
  const hand = (x: number, end: number, side: 'l' | 'r') => part(c, `f${side}`, seg(x, end, end + 24, 20, ink) + seg(x, end, end + 24, 10, skin)) + dot([x, end], 14, skin, ink, 5);
  const shoe = (x: number, end: number, sg: number) =>
    `<ellipse cx="${f(x + sg * 9)}" cy="${f(end - 2)}" rx="28" ry="15" fill="#fff" stroke="${ink}" stroke-width="5"/><path d="M${f(x + sg * 9 - 24)} ${f(end + 5)} L${f(x + sg * 9 + 24)} ${f(end + 5)}" stroke="${orange}" stroke-width="5" stroke-linecap="round"/>`;
  const curls = ([[-42, -366, 17], [-20, -380, 19], [4, -384, 19], [28, -377, 18], [47, -360, 14], [-54, -348, 13]] as const).map(([x, yy, r]) => dot([x, yy], r, hair, ink, 4)).join('');
  const head =
    `<circle cx="0" cy="-320" r="60" fill="${skin}" stroke="${ink}" stroke-width="6"/>` +
    `<path d="M-58 -332 C-60 -392 60 -392 58 -332 Q30 -352 0 -352 Q-30 -352 -58 -332 Z" fill="${hair}"/>${curls}` +
    `<path d="M-58 -308 A60 60 0 0 0 58 -308 L48 -300 Q36 -270 0 -268 Q-36 -270 -48 -300 Z" fill="${hair}"/><path d="M-22 -298 Q0 -308 22 -298 Q0 -293 -22 -298 Z" fill="${hair}"/>` +
    MOODS.map((m) => part(c, `mood-${m}`, eyes(m) + brows(m) + mouths[m])).join('') +
    `<path d="M-68 -318 C-72 -426 72 -426 68 -318" fill="none" stroke="${ink}" stroke-width="17" stroke-linecap="round"/><path d="M-68 -318 C-72 -426 72 -426 68 -318" fill="none" stroke="#333" stroke-width="8" stroke-linecap="round"/>` +
    `<rect x="-82" y="-352" width="28" height="64" rx="12" fill="${orange}" stroke="${ink}" stroke-width="5"/><rect x="54" y="-352" width="28" height="64" rx="12" fill="${orange}" stroke="${ink}" stroke-width="5"/>`;
  const mic =
    `<path d="M210 -470 L156 -360 L118 -284" fill="none" stroke="${ink}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/><path d="M210 -470 L156 -360 L118 -284" fill="none" stroke="#3A3A3A" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<rect x="58" y="-300" width="66" height="34" rx="17" fill="#2E2E2E" stroke="${ink}" stroke-width="5"/><path d="M74 -298 L74 -268 M88 -298 L88 -268" stroke="#555" stroke-width="3"/><rect x="102" y="-300" width="10" height="34" fill="${orange}" stroke="${ink}" stroke-width="3"/>`;
  const deskFront =
    `<rect x="-180" y="-150" width="360" height="118" rx="10" fill="${desk}" stroke="${ink}" stroke-width="6"/><rect x="-180" y="-150" width="360" height="14" fill="${orange}" stroke="${ink}" stroke-width="4"/>` +
    `<text x="0" y="-80" text-anchor="middle" font-family="Montserrat, Arial, sans-serif" font-weight="800" font-size="22" letter-spacing="4" fill="${orange}">LONG STORY SHORT</text>` +
    `<rect x="-150" y="-190" width="38" height="42" rx="5" fill="#fff" stroke="${ink}" stroke-width="4"/><path d="M-112 -180 Q-96 -172 -112 -160" fill="none" stroke="${ink}" stroke-width="5"/>`;
  return (
    part(c, 'legs', `<ellipse class="${cls(c, 'sh')}" cx="0" cy="4" rx="${f(78 - lift)}" ry="11" fill="${ink}" opacity=".16"/>`) +
    joint(
      c,
      'body',
      `<ellipse cx="0" cy="-258" rx="54" ry="20" fill="${orangeDark}" stroke="${ink}" stroke-width="6"/>` +
        part(c, 'legs', limb(c, 'll', [-24, -136], 66, 60, 30, '#2B2B2B', ink, 6, shoe(-24, 0, -1)) + limb(c, 'rl', [24, -136], 66, 60, 30, '#2B2B2B', ink, 6, shoe(24, 0, 1))) +
        `<path d="M-58 -262 C-72 -220 -68 -160 -60 -126 L60 -126 C68 -160 72 -220 58 -262 C26 -276 -26 -276 -58 -262 Z" fill="${orange}" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/>` +
        `<path d="M-34 -186 L34 -186 L42 -146 L-42 -146 Z" fill="none" stroke="${ink}" stroke-width="4" stroke-linejoin="round" opacity=".7"/><path d="M-11 -262 L-13 -226 M11 -262 L13 -222" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>` +
        limb(c, 'la', [-54, -252], 54, 50, 30, orange, ink, 6, hand(-54, -148, 'l')) +
        limb(c, 'ra', [54, -252], 54, 50, 30, orange, ink, 6, hand(54, -148, 'r')) +
        joint(c, 'head', head) +
        part(c, 'desk', mic + deskFront),
    )
  );
}

const ROUGH = (P: string) =>
  `<filter id="${P}-rough" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G"/></filter>`;

/**
 * A mascot in a key as an SVG: `prefix` names its joints and parts (classes `<prefix>-<joint>`) so a scene can tween
 * them; `flip` faces it the other way.
 */
export function mascotSvg(id: MascotId, key: MascotKey, opts: { prefix?: string; flip?: boolean; attrs?: string } = {}) {
  const P = opts.prefix ?? `m-${id}`;
  const c: Ctx = { P, t: jointTransforms(id, key), on: { ...switches(id, key), mo: true, ms: false } };
  const body = { founder: () => founder(c, key.lift), traveller: () => traveller(c), blok: () => blok(c, key.lift), host: () => host(c, key.lift) }[id]();
  const box = MASCOT_INFO[id].box.join(' ');
  // In a box of another shape it stands on the bottom edge.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" preserveAspectRatio="xMidYMax meet"${opts.attrs ?? ''}><defs>${id === 'founder' ? ROUGH(P) : ''}</defs><g${opts.flip ? ' transform="scale(-1 1)"' : ''}>${body}</g></svg>`;
}

/** A mascot in a pose (its first key) as a standalone picture. */
export const mascotPicture = (id: MascotId, pose: MascotPose = 'idle', flip = false) => mascotSvg(id, poseKeys(id, pose)[0], { flip });
