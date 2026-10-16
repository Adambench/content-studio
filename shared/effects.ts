// Effects that need to know where the person is (a local matte, server/scripts/matte.py): the person is cut out of
// the picture and the rest changes. Made on this computer with FFmpeg into a new video file; the edit swaps its clip
// for the new file, so the original stays and the effect can be undone by restoring the earlier version.

export const MATTE_EFFECTS = ['background', 'glow'] as const;
export type MatteEffect = (typeof MATTE_EFFECTS)[number];

export const BACKGROUND_STYLES = ['blur', 'dim', 'color', 'image'] as const;
export type BackgroundStyle = (typeof BACKGROUND_STYLES)[number];

export type MatteEffectOptions = {
  /** background: what replaces the background. */
  style?: BackgroundStyle;
  /** background (color): and glow: a colour like #ffcc00. */
  color?: string;
  /** background (image): a library image (a brand asset or a photo). */
  imageMediaId?: string;
};

export const MATTE_EFFECT_INFO: Record<MatteEffect, { label: string; hint: string }> = {
  background: {
    label: 'New background',
    hint: 'Keep the person, change what is behind them: blurred, dimmed, a plain colour or a picture (a green-screen look without the green screen)',
  },
  glow: { label: 'Glowing outline', hint: 'A soft coloured glow around the person that lifts them off the picture' },
};

export const normalizeHex = (c: unknown, fallback = '#ffcc00') => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c.trim()) ? c.trim().toLowerCase() : fallback);

/** The FFmpeg filter graph for an effect. Inputs: 0 = the video, 1 = its mask video; 2 = a colour or picture if the style needs one. */
export function matteFilter(effect: MatteEffect, o: MatteEffectOptions, size: { w: number; h: number; fps: number }): { graph: string; extraInput: string[] } {
  const { w, h, fps } = size;
  // The mask is made at a lower frame rate: held to the video's, and the person cut out with it as the alpha.
  const mask = `[1:v]fps=${fps.toFixed(3)},scale=${w}:${h},format=gray`;
  // The picture is used twice (as the background and as the person) only by the styles that keep it.
  const picture = (twice: boolean) => (twice ? '[0:v]format=yuv420p,split=2[o1][o2]' : '[0:v]format=yuv420p[o2]');
  const head = (twice: boolean, maskTwice = false) => `${picture(twice)};${mask}${maskTwice ? ',split=2[m0][m1]' : '[m0]'};[o2][m0]alphamerge[fg]`;
  if (effect === 'glow') {
    const color = normalizeHex(o.color).slice(1);
    return {
      extraInput: ['-f', 'lavfi', '-i', `color=c=0x${color}:s=${w}x${h}:r=${fps.toFixed(3)}`],
      // A blurred copy of the mask, pushed up so it reaches past the edge, is the glow's strength.
      graph: `${head(true, true)};[m1]gblur=sigma=${Math.max(8, Math.round(w / 45))},lut=y='min(255\\,val*3)'[gm];[2:v]format=yuv420p[col];[col][gm]alphamerge[glow];[o1][glow]overlay=format=auto[withglow];[withglow][fg]overlay=format=auto,format=yuv420p[v]`,
    };
  }
  const style = o.style ?? 'blur';
  if (style === 'color') {
    const color = normalizeHex(o.color, '#101010').slice(1);
    return { extraInput: ['-f', 'lavfi', '-i', `color=c=0x${color}:s=${w}x${h}:r=${fps.toFixed(3)}`], graph: `${head(false)};[2:v]format=yuv420p[bg];[bg][fg]overlay=format=auto,format=yuv420p[v]` };
  }
  if (style === 'image') return { extraInput: ['-loop', '1', '-i', '{image}'], graph: `${head(false)};[2:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps.toFixed(3)},format=yuv420p[bg];[bg][fg]overlay=format=auto,format=yuv420p[v]` };
  if (style === 'dim') return { extraInput: [], graph: `${head(true)};[o1]eq=brightness=-0.32:saturation=0.35[bg];[bg][fg]overlay=format=auto,format=yuv420p[v]` };
  return { extraInput: [], graph: `${head(true)};[o1]gblur=sigma=${Math.max(12, Math.round(w / 28))},eq=brightness=-0.1[bg];[bg][fg]overlay=format=auto,format=yuv420p[v]` };
}
