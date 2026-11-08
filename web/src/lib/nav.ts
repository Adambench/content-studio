import { useMatch } from 'react-router';
import type { BoardColumn } from '@shared/board';
import { useBoardData } from './queries';
import { createStore } from './ui-state';

// Pages on the top bar, then the page's sections (PLAN.md Phase 14). A page that writes its videos (Personal brand)
// has Videos (one board from idea to posted) · Series · Calendar; a clipping page has Campaigns · Clips · Calendar.

export type SectionId = 'videos' | 'series' | 'clips' | 'campaigns' | 'calendar';
export type Section = { id: SectionId; label: string };

/** Whether a page's videos start as my ideas and scripts (not clips made for campaigns). */
export const writes = (kind: string) => kind !== 'clipping';

export function sectionsFor(kind: string): Section[] {
  return writes(kind)
    ? [
        { id: 'videos', label: 'Videos' },
        { id: 'series', label: 'Series' },
        { id: 'calendar', label: 'Calendar' },
      ]
    : [
        { id: 'campaigns', label: 'Campaigns' },
        { id: 'clips', label: 'Clips' },
        { id: 'calendar', label: 'Calendar' },
      ];
}

/** The section a page's cards live in, whatever their stage. */
export const sectionOf = (kind: string): SectionId => (writes(kind) ? 'videos' : 'clips');

/** A page's cards as a list (the card page's sidebar, the phone): what waits for me, what's being made, what I'm writing, then what's gone out. */
export const LIST_ORDER: readonly BoardColumn[] = ['review', 'editing', 'film', 'writing', 'ideas', 'scheduled', 'posted'];

/** The section I last opened on each page, so its tab takes me back there. */
export const lastSection = createStore<Record<string, SectionId>>({}, 'cs.lastSection');

export const pagePath = (wid: string, section?: SectionId) => `/p/${wid}${section ? `/${section}` : ''}`;
export const cardPath = (id: string) => `/c/${id}`;
export const seriesPath = (wid: string, id: string) => `/p/${wid}/series/${id}`;

/** The page I'm on and its section: from the address, or the card's own page. */
export function useCurrentPage(): { wid: string; section: string } | null {
  const onPage = useMatch('/p/:wid/*');
  const onCard = useMatch('/c/:id');
  const board = useBoardData();
  if (onPage) return { wid: onPage.params.wid ?? '', section: onPage.params['*']?.split('/')[0] ?? '' };
  const item = onCard && board.data?.items.find((i) => i.id === onCard.params.id);
  if (!item) return null;
  const kind = board.data?.pages.find((p) => p.id === item.workspaceId)?.kind ?? 'personal';
  return { wid: item.workspaceId, section: sectionOf(kind) };
}
