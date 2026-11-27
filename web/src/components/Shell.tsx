// The frame around every screen: pages and places on the left (laptop) or tabs at the bottom (phone, hidden while a
// video fills the screen), Ctrl K to jump anywhere, and files shared from the phone's gallery.

import { BookOpen, Inbox, Plus, Search, Server } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { usePages, useSystem, useVideos } from '@/lib/queries';
import { usePhone } from '@/lib/usePhone';
import { cn } from '@/lib/utils';
import { NewPageDialog, openNewPage } from './NewPage';
import { Palette } from './Palette';
import { ShareSheet } from './ShareSheet';

/** New video: the inbox's box, focused. */
export function useNewVideo() {
  const navigate = useNavigate();
  return () => {
    navigate('/');
    setTimeout(() => document.getElementById('composer')?.focus(), 60);
  };
}

export function Shell() {
  const phone = usePhone();
  const location = useLocation();
  const [palette, setPalette] = useState(false);
  const newVideo = useNewVideo();
  const inVideo = location.pathname.startsWith('/v/');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((o) => !o);
        return;
      }
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, [contenteditable="true"], [data-terminal]')) return;
      if (e.key === 'n' && !inVideo) {
        e.preventDefault();
        newVideo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className={cn('h-full', phone ? 'flex flex-col' : 'grid grid-cols-[232px_minmax(0,1fr)]')}>
      {!phone && <Sidebar onPalette={() => setPalette(true)} onNew={newVideo} />}
      {/* The Android app draws under the status bar; the video page pads for it itself. */}
      <main className={cn('min-h-0 min-w-0 flex-1', phone && !inVideo && 'pt-safe')}>
        <Outlet />
      </main>
      {phone && !inVideo && <TabBar onNew={newVideo} />}
      <Palette open={palette} onOpenChange={setPalette} />
      <ShareSheet />
      <NewPageDialog />
    </div>
  );
}

function Sidebar({ onPalette, onNew }: { onPalette: () => void; onNew: () => void }) {
  const pages = usePages();
  const videos = useVideos();
  const system = useSystem();
  const turn = (pageId?: string) => (videos.data ?? []).filter((v) => v.status === 'turn' && (!pageId || v.pageId === pageId)).length;
  const five = system.data?.usage?.fiveHour?.utilization;
  return (
    <aside className="flex min-h-0 flex-col gap-0.5 overflow-y-auto border-r bg-sidebar p-2.5">
      <div className="flex items-center gap-2 px-2 pt-1 pb-3 text-sm font-semibold">
        <span className="size-5 rounded-md bg-[conic-gradient(from_210deg,#e6b450,#ef7a3c,#9b8cf0,#7fb8a4,#e6b450)]" />
        Studio
      </div>
      <Button className="mb-1.5 justify-start" onClick={onNew}>
        <Plus /> New video <Kbd className="ml-auto">N</Kbd>
      </Button>
      <Button variant="outline" className="mb-3 justify-start text-muted-foreground" onClick={onPalette}>
        <Search /> Jump to… <Kbd className="ml-auto">Ctrl K</Kbd>
      </Button>
      <Place to="/" end icon={Inbox} label="Inbox" count={turn()} />
      <div className="px-2.5 pt-4 pb-1 text-[11px] tracking-wider text-muted-foreground uppercase">Pages</div>
      {(pages.data ?? []).map((b) => (
        <NavLink key={b.id} to={`/p/${b.id}`} className={({ isActive }) => cn('flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground', isActive && 'bg-sidebar-accent text-foreground')}>
          <span className="size-2 rounded-full" style={{ background: b.color }} />
          <span className="min-w-0 flex-1 truncate">{b.name}</span>
          {turn(b.id) > 0 && <span className="font-mono text-xs text-you">{turn(b.id)}</span>}
        </NavLink>
      ))}
      <button type="button" onClick={openNewPage} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
        <Plus className="size-3.5" /> New page
      </button>
      <div className="mt-auto flex flex-col gap-0.5 border-t pt-2">
        <Place to="/brain" icon={BookOpen} label="Brain" />
        <Place to="/server" icon={Server} label="Server" />
        <div className="flex items-center gap-2 px-2.5 pt-2 text-xs text-muted-foreground">
          <span className={cn('size-1.5 rounded-full', system.data?.claude.loggedIn ? 'bg-emerald-500' : system.isError ? 'bg-destructive' : 'bg-muted-foreground')} />
          {system.isError ? 'ai-server can’t be reached' : system.data?.claude.loggedIn ? 'Claude ready' : 'Claude isn’t logged in'}
          {five != null && five >= 0.8 && <span className="ml-auto text-destructive">{Math.round(five * 100)} %</span>}
        </div>
      </div>
    </aside>
  );
}

function Place({ to, icon: Icon, label, count, end }: { to: string; icon: typeof Inbox; label: string; count?: number; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cn('flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground', isActive && 'bg-sidebar-accent text-foreground')}>
      <Icon className="size-4" /> <span className="flex-1">{label}</span>
      {!!count && <span className="font-mono text-xs text-you">{count}</span>}
    </NavLink>
  );
}

function TabBar({ onNew }: { onNew: () => void }) {
  const tab = (to: string, Icon: typeof Inbox, label: string, end?: boolean) => (
    <NavLink to={to} end={end} className={({ isActive }) => cn('flex min-w-14 flex-col items-center gap-0.5 text-[11px]', isActive ? 'text-foreground' : 'text-muted-foreground')}>
      <Icon className="size-5" />
      {label}
    </NavLink>
  );
  return (
    <nav className="pb-safe flex items-center justify-around border-t bg-sidebar px-2 pt-2">
      {tab('/', Inbox, 'Inbox', true)}
      {tab('/brain', BookOpen, 'Brain')}
      <button type="button" onClick={onNew} aria-label="New video" className="mb-1 grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
        <Plus className="size-6" />
      </button>
      {tab('/server', Server, 'Server')}
    </nav>
  );
}
