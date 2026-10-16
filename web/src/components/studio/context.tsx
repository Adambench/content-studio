import { createContext, useContext } from 'react';
import type { EditSpec } from '@shared/edit';
import type { EditDetail, Media, PieceDetail } from '@/lib/types';

export type Selection = { kind: 'clip' | 'overlay' | 'sfx'; id: string } | null;

/** What every panel of the video editor works with. */
export type StudioState = {
  edit: EditDetail;
  piece: PieceDetail | undefined;
  spec: EditSpec;
  /** Change the edit (autosaved). */
  update: (fn: (spec: EditSpec) => EditSpec) => void;
  /** Run something that changes the edit on the server (tighten, restore…): saves pending changes first, then takes the result. */
  serverAction: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  /** Playhead, in seconds of the finished video. */
  time: number;
  seek: (seconds: number) => void;
  selection: Selection;
  select: (s: Selection) => void;
  /** Every library file the editor knows about: the edit's own, the footage and the brand assets. */
  media: Map<string, Media>;
  footage: Media[];
  assets: Media[];
  /** Switch the side panel to a tab (e.g. the script once a format video is started). */
  showTab: (tab: 'script' | 'clips' | 'captions' | 'text' | 'sound' | 'look' | 'renders') => void;
};

export const StudioContext = createContext<StudioState | null>(null);

export function useStudio() {
  const s = useContext(StudioContext);
  if (!s) throw new Error('useStudio outside the video editor');
  return s;
}
