import { isWritingColumn, type BoardColumn } from '@shared/board';
import { createStore } from './ui-state';

// Pages on the top bar, then the page's sections (PLAN.md Phase 14). A page that writes its videos (Personal brand)
// has Ideas · Videos · Calendar; a clipping page has Campaigns · Clips · Calendar.

export type SectionId = 'ideas' | 'videos' | 'clips' | 'campaigns' | 'calendar';
export type Section = { id: SectionId; label: string };

/** Whether a page's videos start as my ideas and scripts (not clips made for campaigns). */
export const writes = (kind: string) => kind !== 'clipping';

export function sectionsFor(kind: string): Section[] {
  return writes(kind)
    ? [
        { id: 'ideas', label: 'Ideas' },
        { id: 'videos', label: 'Videos' },
        { id: 'calendar', label: 'Calendar' },
      ]
    : [
        { id: 'campaigns', label: 'Campaigns' },
        { id: 'clips', label: 'Clips' },
        { id: 'calendar', label: 'Calendar' },
      ];
}

/** The section a card lives in. */
export const sectionOf = (kind: string, column: BoardColumn): SectionId => (writes(kind) ? (isWritingColumn(column) ? 'ideas' : 'videos') : 'clips');

/** The section I last opened on each page, so its tab takes me back there. */
export const lastSection = createStore<Record<string, SectionId>>({}, 'cs.lastSection');

export const pagePath = (wid: string, section?: SectionId) => `/p/${wid}${section ? `/${section}` : ''}`;
export const cardPath = (id: string) => `/c/${id}`;
