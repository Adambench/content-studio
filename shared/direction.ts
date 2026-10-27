// A creative direction: how one video will look and feel, pitched by Claude before the edit is built (personal-brand
// and business pages). The creator picks one, mixes two, or says what to change; the script and edit follow it.

export type Direction = {
  id: string;
  name: string;
  /** The first seconds: what's said and shown. */
  hook: string;
  /** What the hook promises (the content model, shared/quality.ts). */
  promise: string;
  /** What the viewer gets for staying, near the end. */
  payoff: string;
  /** How the video runs, beat by beat, in a few lines. */
  structure: string;
  /** The look and feel: framing, captions, colour, pace. */
  look: string;
  /** Arsenal ids (shared/arsenal.ts) the edit will lean on. */
  moves: string[];
  /** Pacing in a line: cuts, punch-ins, how fast. */
  pacing: string;
};

export type PieceDirections = {
  status: 'pitching' | 'ready' | 'failed';
  options: Direction[];
  /** The direction being built to: one of the options, or a mix the creator described. */
  chosen: Direction | null;
  /** What the creator asked for last (a mix, "more playful"…). */
  request: string;
  error: string;
  at: number;
};

export function normalizeDirection(input: unknown, fallbackId: string): Direction | null {
  if (!input || typeof input !== 'object') return null;
  const d = input as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const name = str(d.name, 80);
  const hook = str(d.hook, 400);
  if (!name || !hook) return null;
  return {
    id: str(d.id, 20) || fallbackId,
    name,
    hook,
    promise: str(d.promise, 300),
    payoff: str(d.payoff, 300),
    structure: str(d.structure, 900),
    look: str(d.look, 600),
    moves: Array.isArray(d.moves) ? d.moves.filter((m): m is string => typeof m === 'string').slice(0, 12) : [],
    pacing: str(d.pacing, 300),
  };
}

export function normalizeDirections(input: unknown): PieceDirections | null {
  if (!input || typeof input !== 'object') return null;
  const d = input as Record<string, unknown>;
  const options = (Array.isArray(d.options) ? d.options : []).map((o, i) => normalizeDirection(o, `d${i + 1}`)).filter((o): o is Direction => !!o).slice(0, 4);
  return {
    status: d.status === 'pitching' || d.status === 'failed' ? d.status : 'ready',
    options,
    chosen: normalizeDirection(d.chosen, 'chosen'),
    request: typeof d.request === 'string' ? d.request.slice(0, 600) : '',
    error: typeof d.error === 'string' ? d.error.slice(0, 300) : '',
    at: typeof d.at === 'number' ? d.at : 0,
  };
}

/** The chosen direction as text for a chat message or the piece's notes. */
export function directionText(d: Direction) {
  return [`Direction: ${d.name}`, `Hook: ${d.hook}`, d.promise && `Promise: ${d.promise}`, d.payoff && `Payoff: ${d.payoff}`, d.structure && `Structure: ${d.structure}`, d.look && `Look: ${d.look}`, d.pacing && `Pacing: ${d.pacing}`, d.moves.length && `Moves from the arsenal: ${d.moves.join(', ')}`]
    .filter(Boolean)
    .join('\n');
}
