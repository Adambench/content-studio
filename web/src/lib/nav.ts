import { BadgeDollarSign, CalendarDays, ChartColumn, Clapperboard, Inbox, Lightbulb, Mic, Palette, Telescope, type LucideIcon } from 'lucide-react';
import type { Workspace } from './types';

export type NavItem = {
  /** Relative to the workspace, or absolute (outside workspaces). */
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: 'inbox' | 'attention';
};

/**
 * A workspace's pages in working order, so the first one is where to start. Clipping: find → clips → campaigns;
 * personal and business: ideas (the brainstorm canvas) → videos → loose footage, with research further down. Every
 * page has Brand (mascot, logo, fonts); a clipping page's Inbox only shows when something's in it.
 */
export function workspaceNav(ws: Pick<Workspace, 'kind' | 'modules' | 'inboxCount'>): NavItem[] {
  const has = (m: Workspace['modules'][number]) => ws.modules.includes(m);
  const clipping = ws.kind === 'clipping';
  const items: (NavItem | false)[] = clipping
    ? [
        has('research') && { to: 'research', label: 'Find', icon: Telescope },
        { to: 'board', label: 'Clips', icon: Clapperboard },
        has('campaigns') && { to: 'campaigns', label: 'Campaigns', icon: BadgeDollarSign },
        { to: 'calendar', label: 'Calendar', icon: CalendarDays, badge: 'attention' },
        { to: 'analytics', label: 'Analytics', icon: ChartColumn },
        !!ws.inboxCount && { to: 'inbox', label: 'Inbox', icon: Inbox, badge: 'inbox' },
        { to: 'assets', label: 'Brand', icon: Palette },
      ]
    : [
        has('ideas') && { to: 'ideas', label: 'Ideas', icon: Lightbulb },
        { to: 'board', label: 'Videos', icon: Clapperboard },
        // An Islamic page clips lectures (its own campaign).
        ws.kind === 'islamic' && has('clipping') && { to: 'lectures', label: 'Lectures', icon: Mic },
        { to: 'inbox', label: 'Inbox', icon: Inbox, badge: 'inbox' },
        has('research') && { to: 'research', label: 'Research', icon: Telescope },
        has('campaigns') && { to: 'campaigns', label: 'Campaigns', icon: BadgeDollarSign },
        { to: 'calendar', label: 'Calendar', icon: CalendarDays, badge: 'attention' },
        { to: 'analytics', label: 'Analytics', icon: ChartColumn },
        { to: 'assets', label: 'Brand', icon: Palette },
      ];
  return items.filter((i): i is NavItem => !!i);
}

export const navHref = (wid: string, item: NavItem) => (item.to.startsWith('/') ? item.to : `/w/${wid}/${item.to}`);

/** What the board is called on this kind of page. */
export const boardLabel = (kind: Workspace['kind']) => (kind === 'clipping' ? 'Clips' : 'Videos');
