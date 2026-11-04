import { CalendarClock, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { DashVideo, FlowStep } from '@shared/dashboard';
import type { ReviewState } from '@shared/review';
import { REVIEW_LOOK } from './review';

/** What I say to Claude Code to have my comments fixed (`npm run notes`, then the fixes and new renders). */
export const FIX_LINE = 'fix my comments';

export async function copyFixLine() {
  try {
    await navigator.clipboard.writeText(FIX_LINE);
    toast.success('Copied', { description: `Paste “${FIX_LINE}” into Claude Code.` });
  } catch {
    toast(`Say “${FIX_LINE}” in Claude Code.`);
  }
}

/** When a post goes out, in few words: "right away", "today 7:30 PM", "Wed 12:30 PM". */
export function whenText(at: number) {
  if (at - Date.now() < 5 * 60_000) return 'right away';
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `today ${time}`;
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`;
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** Where a video is in the loop (shared/dashboard.ts FLOW_STEPS). */
export function flowStep(o: { stage: string; state: ReviewState | null; rendering: boolean }): FlowStep {
  if (o.stage === 'posted') return 'posted';
  if (o.stage === 'scheduled') return 'scheduled';
  if (o.state === 'improve' || o.rendering) return 'claude';
  if (o.state === 'good') return 'approved';
  return 'review';
}

export const VIDEO_LOOK: Record<DashVideo['state'], { icon: LucideIcon; tone: string; chip: string }> = {
  watch: REVIEW_LOOK.watch,
  recheck: REVIEW_LOOK.recheck,
  improve: REVIEW_LOOK.improve,
  ready: { icon: CalendarClock, tone: 'text-emerald-400', chip: 'bg-emerald-500/15 text-emerald-300' },
};

export function videoLabel(v: Pick<DashVideo, 'state' | 'open' | 'version' | 'rendering'>) {
  if (v.rendering) return v.rendering.status === 'queued' ? 'Render waiting' : `Rendering ${Math.round(v.rendering.progress * 100)}%`;
  switch (v.state) {
    case 'watch':
      return 'To watch';
    case 'recheck':
      return v.version ? `Check again · v${v.version}` : 'Check again';
    case 'improve':
      return `${v.open} comment${v.open === 1 ? '' : 's'}`;
    case 'ready':
      return 'Approved · not scheduled';
  }
}
