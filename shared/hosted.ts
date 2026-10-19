// Hosted generation (kie.ai): pictures and clips made by a paid service instead of the home PCs, so quality isn't
// capped by a GTX 1070. The key stays on the server (write-only in Settings); a daily cap stops runaway spend. Prices
// are credits (kie.ai bills in credits, ~$0.005 each); the defaults come from its public price list and can be changed
// in Settings → Models when the dashboard says otherwise.

import type { GenAspect, GenKind } from './generate';

/** Where a kind of generation runs: the hosted service, a home PC, or hosted with the home PC when it can't. */
export type GenBackend = 'hosted' | 'home' | 'auto';
export const GEN_BACKEND_LABELS: Record<GenBackend, string> = { auto: 'Hosted, home PC if unavailable', hosted: 'Hosted only', home: 'Home PC only' };

export type HostedModel = {
  /** The service's model id, e.g. wan/2-5-text-to-video. */
  id: string;
  /** Credits per picture, or per second of a clip. */
  credits: number;
  /** Clip length in seconds (ignored for pictures). */
  seconds: number;
  /** "720p" / "1080p" for clips, "1K" / "2K" for pictures. */
  resolution: string;
};

export type HostedSettings = {
  backend: Record<GenKind, GenBackend>;
  /** Dollars per credit. */
  usdPerCredit: number;
  /** No new request starts once today's spend plus its price would pass this. */
  dailyCapUsd: number;
  models: Record<GenKind, HostedModel>;
};

export const DEFAULT_HOSTED: HostedSettings = {
  backend: { image: 'auto', video: 'auto' },
  usdPerCredit: 0.005,
  dailyCapUsd: 10,
  models: {
    image: { id: 'flux-2/text-to-image', credits: 5, seconds: 0, resolution: '1K' },
    video: { id: 'wan/2-5-text-to-video', credits: 12, seconds: 5, resolution: '720p' },
  },
};

export function normalizeHosted(h: Partial<HostedSettings> | undefined): HostedSettings {
  const d = DEFAULT_HOSTED;
  const backend = (v: unknown, def: GenBackend): GenBackend => (v === 'hosted' || v === 'home' || v === 'auto' ? v : def);
  const num = (v: unknown, def: number, min: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min ? v : def);
  const model = (m: Partial<HostedModel> | undefined, def: HostedModel): HostedModel => ({
    id: typeof m?.id === 'string' && m.id.trim() ? m.id.trim() : def.id,
    credits: num(m?.credits, def.credits, 0),
    seconds: num(m?.seconds, def.seconds, 0),
    resolution: typeof m?.resolution === 'string' && m.resolution.trim() ? m.resolution.trim() : def.resolution,
  });
  return {
    backend: { image: backend(h?.backend?.image, d.backend.image), video: backend(h?.backend?.video, d.backend.video) },
    usdPerCredit: num(h?.usdPerCredit, d.usdPerCredit, 0.0001),
    dailyCapUsd: num(h?.dailyCapUsd, d.dailyCapUsd, 0),
    models: { image: model(h?.models?.image, d.models.image), video: model(h?.models?.video, d.models.video) },
  };
}

/** What one request costs in dollars. */
export function hostedPriceUsd(h: HostedSettings, kind: GenKind) {
  const m = h.models[kind];
  return (kind === 'video' ? m.credits * m.seconds : m.credits) * h.usdPerCredit;
}

/** The final size hosted results are brought to (FFmpeg scales and crops; the service's own sizes differ). */
export const HOSTED_OUT: Record<GenAspect, [number, number]> = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080] };

export type HostedStatus = {
  /** A key is saved (the key itself never leaves the server). */
  hasKey: boolean;
  spentTodayUsd: number;
  settings: HostedSettings;
  /** Dollars per kind of request, for the Generate dialog. */
  priceUsd: Record<GenKind, number>;
  /** Credits left at the service, when it answered. */
  creditsLeft: number | null;
  error: string | null;
};
