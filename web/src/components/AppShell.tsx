import { CalendarDays, Clapperboard, Lightbulb, MoreHorizontal, Mic, Search, Settings, Sparkles, Sun } from 'lucide-react';
import { NavLink, Outlet, useMatch } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import { isApp } from '@/lib/native';
import { boardLabel, navHref, workspaceNav, type NavItem } from '@/lib/nav';
import { useSettings, useToday, useUpcomingPosts, useWorkspaces } from '@/lib/queries';
import type { Workspace } from '@/lib/types';
import { claudeDesktopOpen, claudeMobileOpen, openClaude, useStore } from '@/lib/ui-state';
import { cn } from '@/lib/utils';
import { AppBanners, UploadsButton } from './AppChrome';
import { SearchDialog, searchOpen } from './SearchDialog';
import { UsageMeter } from './UsageMeter';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

function SideLink({ to, icon: Icon, children }: { to: string; icon: NavItem['icon']; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
          isActive && 'bg-sidebar-accent font-medium text-foreground',
        )
      }
    >
      <Icon className="size-4" />
      {children}
    </NavLink>
  );
}

/** What waits for me across every workspace: clips to review, posts that failed or missed their time, campaigns to confirm, clips to submit. */
function TodayBadge({ className }: { className?: string }) {
  const today = useToday();
  const n = (today.data?.review.length ?? 0) + (today.data?.attention.length ?? 0) + (today.data?.campaigns?.toConfirm.length ?? 0) + (today.data?.submissions?.length ?? 0);
  if (!n) return null;
  return (
    <Badge className={cn('h-4 min-w-4 bg-brand px-1 text-[10px] text-white tabular-nums', className)} aria-label={`${n} thing${n === 1 ? '' : 's'} waiting for you`}>
      {n}
    </Badge>
  );
}

/** How many posts failed or missed their time: they need a decision. */
function AttentionBadge({ wid, className }: { wid: string; className?: string }) {
  const posts = useUpcomingPosts(wid);
  const n = (posts.data ?? []).filter((p) => p.status === 'failed' || p.status === 'missed').length;
  if (!n) return null;
  return (
    <Badge variant="destructive" className={cn('h-4 min-w-4 px-1 text-[10px] tabular-nums', className)} aria-label={`${n} post${n === 1 ? '' : 's'} need attention`}>
      {n}
    </Badge>
  );
}

/** Files waiting to be put in a video. */
function InboxBadge({ ws, className }: { ws: Workspace; className?: string }) {
  const n = ws.inboxCount ?? 0;
  if (!n) return null;
  return (
    <Badge variant="secondary" className={cn('h-4 min-w-4 px-1 text-[10px] tabular-nums', className)} aria-label={`${n} file${n === 1 ? '' : 's'} in the Inbox`}>
      {n}
    </Badge>
  );
}

function NavBadge({ item, ws, className }: { item: NavItem; ws: Workspace; className?: string }) {
  if (item.badge === 'attention') return <AttentionBadge wid={ws.id} className={className} />;
  if (item.badge === 'inbox') return <InboxBadge ws={ws} className={className} />;
  return null;
}

export function AppShell() {
  const match = useMatch('/w/:wid/*');
  const settings = useSettings();
  // Outside a workspace (e.g. app settings) keep showing the last one so its nav stays reachable.
  const wid = match ? (match.params.wid !== 'new' ? match.params.wid : undefined) : (settings.data?.lastWorkspaceId ?? undefined);
  // The capture and share screens have their own header on phones.
  const onCapture = !!useMatch('/capture');
  const onShare = !!useMatch('/share');
  const isCapture = onCapture || onShare;
  const desktopOpen = useStore(claudeDesktopOpen);
  const { data: workspaces = [] } = useWorkspaces();
  const ws = workspaces.find((w) => w.id === wid);
  const nav = ws ? workspaceNav(ws) : [];
  // On phones the bottom bar has the board and, on clipping pages, the calendar (else the Ideas canvas); the rest go
  // in the top bar, the first ones as icons.
  const ideasBelow = !!ws && ws.kind !== 'clipping' && nav.some((i) => i.to === 'ideas');
  const topItems = nav.filter((i) => i.to !== 'board' && (ideasBelow ? i.to !== 'ideas' : i.to !== 'calendar'));

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <nav className="flex flex-col gap-0.5 px-2 pt-2" aria-label="Home">
          <SideLink to="/today" icon={Sun}>
            Today
            <TodayBadge className="ml-auto" />
          </SideLink>
          <button
            type="button"
            onClick={() => searchOpen.set(true)}
            className="flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Search className="size-4" />
            Search
            <Kbd className="ml-auto">Ctrl K</Kbd>
          </button>
        </nav>
        <div className="p-2">
          <WorkspaceSwitcher currentId={wid} />
        </div>
        <nav className="flex flex-col gap-0.5 px-2 py-1" aria-label="Workspace">
          {ws &&
            nav.map((item) => (
              <SideLink key={item.to} to={navHref(ws.id, item)} icon={item.icon}>
                {item.label}
                <NavBadge item={item} ws={ws} className="ml-auto" />
              </SideLink>
            ))}
        </nav>
        <div className="mt-auto flex flex-col gap-1 p-2">
          {match && wid && (
            <Button variant="ghost" className="h-8 justify-start gap-2.5 px-2 font-normal text-muted-foreground" onClick={() => (desktopOpen ? claudeDesktopOpen.set(false) : openClaude())}>
              <Sparkles className="size-4 text-brand" />
              {desktopOpen ? 'Hide Claude' : 'Show Claude'}
              <Kbd className="ml-auto">Ctrl J</Kbd>
            </Button>
          )}
          <SideLink to="/capture" icon={Mic}>
            Capture an idea
          </SideLink>
          <SideLink to="/settings" icon={Settings}>
            Settings
          </SideLink>
          <UsageMeter className="mt-1" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className={cn('pt-safe flex items-center justify-between border-b px-2 md:hidden', isCapture && 'hidden')}>
          <div className="flex h-12 min-w-0 items-center">
            <WorkspaceSwitcher currentId={wid} compact />
          </div>
          <div className="flex items-center">
            {isApp && <UploadsButton />}
            <Button variant="ghost" size="icon" aria-label="Search" onClick={() => searchOpen.set(true)}>
              <Search />
            </Button>
            {ws &&
              topItems.slice(0, 2).map((item) => (
                <Button key={item.to} variant="ghost" size="icon" asChild aria-label={item.label} className="relative">
                  <NavLink to={navHref(ws.id, item)}>
                    <item.icon />
                    <NavBadge item={item} ws={ws} className="absolute top-1 right-0.5" />
                  </NavLink>
                </Button>
              ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {ws &&
                  topItems.slice(2).map((item) => (
                    <DropdownMenuItem key={item.to} asChild>
                      <NavLink to={navHref(ws.id, item)}>
                        <item.icon /> {item.label}
                      </NavLink>
                    </DropdownMenuItem>
                  ))}
                <DropdownMenuItem asChild>
                  <NavLink to={wid ? `/w/${wid}/settings` : '/settings'}>
                    <Settings /> Settings
                  </NavLink>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Capture and share have their own header (and say themselves when something waits on the phone). */}
        {isApp && !isCapture && <AppBanners />}

        <main className="min-h-0 flex-1">
          <Outlet />
        </main>

        {/* Mobile bottom navigation */}
        {wid && !isCapture && <MobileNav wid={wid} kind={ws?.kind ?? 'personal'} ideas={ideasBelow} />}
      </div>
      <SearchDialog />
    </div>
  );
}

function MobileNav({ wid, kind, ideas }: { wid: string; kind: Workspace['kind']; ideas: boolean }) {
  const item = 'flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground';
  const active = 'text-foreground';
  return (
    <nav className="pb-safe grid grid-cols-5 border-t bg-sidebar md:hidden" aria-label="Main">
      <NavLink to="/today" className={({ isActive }) => cn(item, 'relative h-14', isActive && active)}>
        <Sun className="size-5" /> Today
        <TodayBadge className="absolute top-2 left-1/2 ml-1.5" />
      </NavLink>
      {ideas ? (
        <NavLink to={`/w/${wid}/ideas`} className={({ isActive }) => cn(item, 'h-14', isActive && active)}>
          <Lightbulb className="size-5" /> Ideas
        </NavLink>
      ) : (
        <NavLink to={`/w/${wid}/board`} className={({ isActive }) => cn(item, 'h-14', isActive && active)}>
          <Clapperboard className="size-5" /> {boardLabel(kind)}
        </NavLink>
      )}
      <NavLink to="/capture" className={cn(item, 'h-14')} aria-label="Capture an idea">
        <span className="grid size-10 place-items-center rounded-full bg-brand text-white shadow-lg shadow-brand/20">
          <Mic className="size-5" />
        </span>
      </NavLink>
      {ideas ? (
        <NavLink to={`/w/${wid}/board`} className={({ isActive }) => cn(item, 'h-14', isActive && active)}>
          <Clapperboard className="size-5" /> {boardLabel(kind)}
        </NavLink>
      ) : (
        <NavLink to={`/w/${wid}/calendar`} className={({ isActive }) => cn(item, 'relative h-14', isActive && active)}>
          <CalendarDays className="size-5" /> Calendar
          <AttentionBadge wid={wid} className="absolute top-2 left-1/2 ml-1.5" />
        </NavLink>
      )}
      <button type="button" className={cn(item, 'h-14')} onClick={() => claudeMobileOpen.set(true)}>
        <Sparkles className="size-5 text-brand" /> Claude
      </button>
    </nav>
  );
}
