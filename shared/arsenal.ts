// The arsenal: everything a video can use, with when each fits. Claude reads it (get_arsenal) when it plans or edits a
// video, and picks from it instead of reaching for the same few moves; direction pitches and clip edits do the same.
// Halal: nothing here is music. Sound moves are sound effects only (shared/sfx.ts).

import { CAPTION_PRESET_LABELS, CAPTION_PRESETS, GRAPHIC_INFO, GRAPHICS, TRANSITION_INFO, TRANSITIONS } from './edit';
import { MATTE_EFFECT_INFO } from './effects';
import { SFX_GROUPS } from './sfx';

export const ARSENAL_KINDS = {
  transition: 'Transitions',
  caption: 'Caption looks',
  graphic: 'Motion graphics',
  scene: 'Custom scenes',
  format: 'Formats',
  camera: 'Camera moves',
  cut: 'Cutting',
  sound: 'Sound moves',
  effect: 'Effects',
} as const;
export type ArsenalKind = keyof typeof ARSENAL_KINDS;

export type ArsenalItem = {
  /** `kind:name`, e.g. `transition:whip`. Edits record these so the next video can pick something else. */
  id: string;
  kind: ArsenalKind;
  label: string;
  /** When it fits. */
  use: string;
  /** How Claude does it with the studio tools. */
  how: string;
  /** false = on the roadmap (PLAN.md step 7), not buildable yet: don't promise it. */
  ready: boolean;
};

const ready = (kind: ArsenalKind, name: string, label: string, use: string, how: string): ArsenalItem => ({ id: `${kind}:${name}`, kind, label, use, how, ready: true });
const planned = (name: string, label: string, use: string): ArsenalItem => ({ id: `effect:${name}`, kind: 'effect', label, use, how: 'Not built yet', ready: false });

export const ARSENAL: ArsenalItem[] = [
  ...TRANSITIONS.map((t) =>
    ready('transition', t, TRANSITION_INFO[t].label, TRANSITION_INFO[t].hint, `update_edit: a clip's transition { type: "${t}" }`),
  ),
  ...CAPTION_PRESETS.map((p) => ready('caption', p, CAPTION_PRESET_LABELS[p].label, CAPTION_PRESET_LABELS[p].hint, `update_edit: captions.preset = "${p}"`)),
  ...GRAPHICS.map((g) => ready('graphic', g, GRAPHIC_INFO[g].label, GRAPHIC_INFO[g].hint, `update_edit: an overlay { type: "graphic", template: "${g}" }`)),
  ready('scene', 'custom', 'Custom scene', 'When no template says it: a diagram, a map-like layout, a hand-built animation', 'write_scene, then view_overlay to check it'),
  ready('format', 'story', 'Story over footage', 'Faceless page; a story read aloud over background footage with a post card', 'write_format_video kind=story'),
  ready('format', 'chat', 'Text conversation', 'Drama, advice or a joke that plays out as messages, each read aloud', 'write_format_video kind=chat'),
  ready('format', 'dialogue', 'Two characters', 'A back-and-forth between two drawn characters', 'write_format_video kind=dialogue'),
  ready('camera', 'punch-in', 'Punch-in', 'Emphasis on a line; alternate 1.0 and 1.12–1.2 between sentences so a static shot keeps moving', "update_edit: a clip's zoom"),
  ready('camera', 'reframe', 'Reframe on the subject', 'Wide footage into 9:16; podcasts and interviews follow whoever talks', 'focusX/focusY after view_frames; follow_speaker for several people'),
  ready('cut', 'tighten', 'Tighten', 'Pauses, fillers and repeats: the cheapest retention gain', 'tighten_edit'),
  ready('cut', 'best-take', 'Best take', 'Footage with flubs and repeated lines', "read the transcripts, set each clip's in/out to the best take"),
  ready('cut', 'broll', 'B-roll cutaway', 'Cover a jump cut or show what the speaker names', 'update_edit: an overlay { type: "broll" } (layout full, top or pip)'),
  ready('cut', 'grade', 'Colour grade', 'One look across shots from different cameras', 'update_edit: grade.lutMediaId (a LUT from list_assets)'),
  ...(Object.keys(SFX_GROUPS) as (keyof typeof SFX_GROUPS)[]).map((g) =>
    ready('sound', g, SFX_GROUPS[g], 'Sound effects only, never music; a few well placed beat more than one on every cut', `update_edit: audio sfx cues with list_assets ids (builtin:…) of this group`),
  ),
  ...(Object.keys(MATTE_EFFECT_INFO) as (keyof typeof MATTE_EFFECT_INFO)[]).map((e) =>
    ready('effect', `matte-${e}`, MATTE_EFFECT_INFO[e].label, MATTE_EFFECT_INFO[e].hint, `apply_effect effect="${e}" on a clip's video that has a person in it (a few minutes, runs in the background)`),
  ),
  // Step 7 of the build plan (local effects library). Listed so a direction can plan around them later.
  planned('orbit', 'Orbit', 'The subject circled by the camera'),
  planned('frame-break', 'Frame break', 'The subject steps out of the frame over a background'),
  planned('phone-mockup', 'Phone mockup', 'Screen recordings inside a phone'),
  planned('zoom-through', 'Zoom-through cut', 'Zooms into a detail and out of another'),
  planned('paper-cut', 'Paper cut and collage', 'A handmade, cut-paper look'),
  planned('doodle-boil', 'Doodle boil', 'Hand-drawn lines that wobble'),
];

export const readyArsenal = () => ARSENAL.filter((a) => a.ready);

/** Which arsenal items a spec uses, as ids. `spec` is an EditSpec (loosely typed so the web can call it too). */
export function arsenalUsed(spec: {
  clips?: { transition?: { type: string } | null; zoom?: number }[];
  captions?: { enabled?: boolean; preset?: string };
  overlays?: { type: string; template?: string }[];
  recipe?: { kind: string } | null;
}): string[] {
  const used = new Set<string>();
  for (const c of spec.clips ?? []) {
    if (c.transition) used.add(`transition:${c.transition.type}`);
    if ((c.zoom ?? 1) > 1.05) used.add('camera:punch-in');
  }
  if (spec.captions?.enabled && spec.captions.preset) used.add(`caption:${spec.captions.preset}`);
  for (const o of spec.overlays ?? []) {
    if (o.type === 'graphic' && o.template) used.add(`graphic:${o.template}`);
    else if (o.type === 'scene') used.add('scene:custom');
    else if (o.type === 'broll') used.add('cut:broll');
  }
  if (spec.recipe) used.add(`format:${spec.recipe.kind}`);
  return [...used];
}
