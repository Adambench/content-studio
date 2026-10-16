import { desc, eq, like, and } from 'drizzle-orm';
import { TRANSITION_INFO, type EditClip, type EditOverlay, type EditSpec, type OverlayAnimation, type TransitionType } from '../../../shared/edit';
import { builtinSfxId } from '../../../shared/sfx';
import { db, schema } from '../db';

/**
 * How a made clip is dressed beyond the page's own style (captions, fonts and colours stay the page's): the hook, the
 * first jump cut, the punch-ins and the sounds. Made by hand from the arsenal (no model call per clip) and rotated, so
 * a page's clips next to each other don't all look the same. Claude changes any of it afterwards in the clip's chat.
 */
export type ClipLook = {
  id: string;
  label: string;
  /** The hook card: big text at the top, or a full-screen word slam. */
  hook: { kind: 'title'; animation: OverlayAnimation; position: 'top' | 'center'; sound: string } | { kind: 'slam' };
  /** Punch the picture in on every other clip (the jump cuts the tightening makes). */
  punchIn: number | null;
  /** The first cut after the hook: a transition (with its sound) or a plain whoosh. */
  firstCut: { transition: TransitionType } | { sound: string; volume: number } | null;
};

export const CLIP_LOOKS: ClipLook[] = [
  { id: 'steady', label: 'Steady', hook: { kind: 'title', animation: 'pop', position: 'top', sound: 'pop' }, punchIn: null, firstCut: { sound: 'whoosh-fast', volume: 0.3 } },
  { id: 'punch-in', label: 'Punch-ins', hook: { kind: 'title', animation: 'pop', position: 'top', sound: 'hit' }, punchIn: 1.14, firstCut: null },
  { id: 'word-slam', label: 'Word slam', hook: { kind: 'slam' }, punchIn: null, firstCut: { sound: 'whoosh-soft', volume: 0.3 } },
  { id: 'whip', label: 'Whip pan', hook: { kind: 'title', animation: 'slide', position: 'top', sound: 'swish' }, punchIn: null, firstCut: { transition: 'whip' } },
  { id: 'soft', label: 'Soft', hook: { kind: 'title', animation: 'fade', position: 'center', sound: 'pop' }, punchIn: 1.08, firstCut: { transition: 'blur' } },
];

const TAG = /· look: ([a-z-]+)$/;
export const lookTag = (look: ClipLook) => ` · look: ${look.id}`;

/** The look the page's recent clips used least (the longest ago on a tie). */
export function pickLook(workspaceId: string, recent = 6): ClipLook {
  const used = db
    .select({ message: schema.editVersions.message })
    .from(schema.editVersions)
    .innerJoin(schema.edits, eq(schema.edits.id, schema.editVersions.editId))
    .where(and(eq(schema.edits.workspaceId, workspaceId), like(schema.editVersions.message, '%· look: %')))
    .orderBy(desc(schema.editVersions.createdAt))
    .limit(recent)
    .all()
    .map((r) => r.message.match(TAG)?.[1])
    .filter(Boolean) as string[];
  const score = (l: ClipLook) => {
    const first = used.indexOf(l.id);
    return [used.filter((u) => u === l.id).length, first === -1 ? -1 : -first];
  };
  return [...CLIP_LOOKS].sort((a, b) => {
    const [ca, la] = score(a);
    const [cb, lb] = score(b);
    return ca - cb || la - lb;
  })[0];
}

const rid = () => crypto.randomUUID().slice(0, 8);

/** Dress a tightened clip edit in a look: the hook card, punch-ins, the first cut's move. Returns the spec. */
export function applyLook(spec: EditSpec, look: ClipLook, hookCard: string, total: number): EditSpec {
  const next: EditSpec = { ...spec, clips: spec.clips.map((c) => ({ ...c })), overlays: [...spec.overlays], audio: { ...spec.audio, sfx: [...spec.audio.sfx] } };
  if (hookCard) {
    const end = Math.min(look.hook.kind === 'slam' ? 2.2 : 2.5, total);
    if (look.hook.kind === 'slam') {
      const o: EditOverlay = { id: rid(), type: 'graphic', template: 'kinetic', text: hookCard, sub: '', items: [], x: 0.5, y: 0.5, position: 'center', sound: true, start: 0, end };
      next.overlays.push(o);
    } else {
      next.overlays.push({ id: rid(), type: 'text', text: hookCard, style: 'title', position: look.hook.position, animation: look.hook.animation, start: 0, end });
      next.audio.sfx.push({ id: rid(), mediaId: builtinSfxId(look.hook.sound), at: 0.05, volume: 0.6 });
    }
  }
  if (look.punchIn) next.clips.forEach((c: EditClip, i) => (c.zoom = i % 2 ? look.punchIn! : Math.max(1, c.zoom)));
  // The first jump cut after the hook: sparing, under the voice.
  let t = 0;
  for (let i = 0; i < next.clips.length - 1; i++) {
    t += next.clips[i].out - next.clips[i].in;
    if (t > 2.6 && t < total - 1 && look.firstCut) {
      if ('transition' in look.firstCut) {
        const type = look.firstCut.transition;
        next.clips[i + 1].transition = { type, duration: TRANSITION_INFO[type].duration, sound: true };
      } else {
        next.audio.sfx.push({ id: rid(), mediaId: builtinSfxId(look.firstCut.sound), at: Math.max(0, Math.round((t - 0.15) * 100) / 100), volume: look.firstCut.volume });
      }
      break;
    }
    if (t >= total - 1) break;
  }
  return next;
}
