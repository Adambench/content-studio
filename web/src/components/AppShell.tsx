import { NavLink, Outlet, useMatch } from 'react-router';
import type { WorkspaceColor } from '@shared/types';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { isApp } from '@/lib/native';
import { lastSection, pagePath, sectionOf, sectionsFor } from '@/lib/nav';
import { useBoardData } from '@/lib/queries';
import { useStore } from '@/lib/ui-state';
import { cn } from '@/lib/utils';
import { AppBanners } from './AppChrome';
import { PhoneShell } from './PhoneShell';
import { WorkspaceDot } from './WorkspaceDot';

const tab = ({ isActive }: { isActive: boolean }) =>
  cn('flex h-9 items-center gap-2.5 rounded-lg px-3.5 text-[15px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground', isActive && 'bg-muted text-foreground');

/** The page I'm on: from the address, or the card's own page. */
function useCurrentPage() {
  const onPage = useMatch('/p/:wid/*');
  const onCard = useMatch('/c/:id');
  const board = useBoardData();
  if (onPage) return { wid: onPage.params.wid ?? '', section: onPage.params['*']?.split('/')[0] ?? '' };
  const item = onCard && board.data?.items.find((i) => i.id === onCard.params.id);
  if (!item) return null;
  const kind = board.data?.pages.find((p) => p.id === item.workspaceId)?.kind ?? 'personal';
  return { wid: item.workspaceId, section: sectionOf(kind, item.column) };
}

/** Top to bottom: the page (Home or one of mine), then its section, then the content. */
function Desktop() {
  const board = useBoardData();
  const current = useCurrentPage();
  const last = useStore(lastSection);
  const pages = (board.data?.pages ?? []).filter((p) => !p.hidden);
  const page = current && board.data?.pages.find((p) => p.id === current.wid);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-15 shrink-0 items-center gap-1 border-b bg-sidebar px-5">
        <img src="/icon.svg" alt="" className="mr-4 size-6" />
        <NavLink to="/" end className={tab}>
          Home
        </NavLink>
        {pages.map((p) => (
          <NavLink key={p.id} to={pagePath(p.id, last[p.id])} className={() => tab({ isActive: current?.wid === p.id })}>
            <WorkspaceDot color={p.color as WorkspaceColor} className="size-2" />
            {p.name}
          </NavLink>
        ))}
        <div className="flex-1" />
        <NavLink to="/knowledge" className={tab}>
          Knowledge
        </NavLink>
        <NavLink to="/toolbox" className={tab}>
          Toolbox
        </NavLink>
        <NavLink to="/settings" className={tab}>
          Settings
        </NavLink>
      </header>
      {page && current && (
        <nav className="flex h-12 shrink-0 items-end gap-7 border-b px-6" aria-label={page.name}>
          {sectionsFor(page.kind).map((s) => (
            <NavLink
              key={s.id}
              to={pagePath(page.id, s.id)}
              className={cn('border-b-2 border-transparent px-0.5 pb-3 text-[15px] font-medium text-muted-foreground hover:text-foreground', current.section === s.id && 'border-foreground text-foreground')}
            >
              {s.label}
            </NavLink>
          ))}
        </nav>
      )}
      <main className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}

/** The laptop shows everything; the phone writes scripts, sends footage and plays the videos (PhoneShell). */
export function AppShell() {
  const small = useMediaQuery('(max-width: 767px)');
  if (isApp || small)
    return (
      <div className="flex h-full flex-col">
        {isApp && <AppBanners />}
        <div className="min-h-0 flex-1">
          <PhoneShell />
        </div>
      </div>
    );
  return <Desktop />;
}
