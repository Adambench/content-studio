import { Menu, Paperclip } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { WorkspaceColor } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { usePhone } from '@/hooks/useMediaQuery';
import { errorMessage } from '@/lib/api';
import { isApp, isNative, Studio } from '@/lib/native';
import { lastSection, pagePath, sectionsFor, useCurrentPage } from '@/lib/nav';
import { useBoardData } from '@/lib/queries';
import { createStore, useStore } from '@/lib/ui-state';
import { cn } from '@/lib/utils';
import { pickedFiles } from '@/pages/SharePage';
import { AppBanners, UploadsButton } from './AppChrome';
import { WorkspaceDot } from './WorkspaceDot';

/** Whether the phone's menu (the laptop's top bar) is open. */
const menuOpen = createStore(false);

/** Opens the phone's menu: in the shell's header, and in a page's own (PageHeader). Nothing on the laptop. */
export function PhoneMenuButton() {
  const phone = usePhone();
  if (!phone) return null;
  return (
    <Button variant="ghost" size="icon" className="-ml-1 size-10 shrink-0" aria-label="Menu" onClick={() => menuOpen.set(true)}>
      <Menu className="size-5" />
    </Button>
  );
}

const item = ({ isActive }: { isActive: boolean }) => cn('flex h-12 items-center gap-3 rounded-lg px-3.5 text-base font-medium text-muted-foreground', isActive && 'bg-muted text-foreground');

/** The laptop's top bar as a list: Home, my pages, then Knowledge, Toolbox, Settings. */
function PhoneMenu() {
  const open = useStore(menuOpen);
  const board = useBoardData();
  const last = useStore(lastSection);
  const current = useCurrentPage();
  const { pathname } = useLocation();
  const pages = (board.data?.pages ?? []).filter((p) => !p.hidden);
  useEffect(() => menuOpen.set(false), [pathname]);
  return (
    <Sheet open={open} onOpenChange={menuOpen.set}>
      <SheetContent side="left" showCloseButton={false} className="pt-safe pb-safe w-72 gap-0">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-3">
            <img src="/icon.svg" alt="" className="size-6" /> Content Studio
          </SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-1 overflow-y-auto px-3 pb-4">
          <NavLink to="/" end className={item}>
            Home
          </NavLink>
          {pages.map((p) => (
            <NavLink key={p.id} to={pagePath(p.id, last[p.id])} className={() => item({ isActive: current?.wid === p.id })}>
              <WorkspaceDot color={p.color as WorkspaceColor} className="size-2" />
              <span className="truncate">{p.name}</span>
            </NavLink>
          ))}
          <div className="my-2 border-t" />
          <NavLink to="/knowledge" className={item}>
            Knowledge
          </NavLink>
          <NavLink to="/toolbox" className={item}>
            Toolbox
          </NavLink>
          <NavLink to="/settings" className={item}>
            Settings
          </NavLink>
        </nav>
      </SheetContent>
    </Sheet>
  );
}

/** Pick clips (Android's picker, or the browser's), then say which video they're for. */
function AddFootage() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  async function pick() {
    if (!isNative) return input.current?.click();
    try {
      const { files } = await Studio.pickFiles({ accept: ['video/*', 'audio/*'] });
      if (!files.length) return;
      pickedFiles.set({ native: files });
      navigate('/share');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return (
    <>
      <Button variant="ghost" size="icon" className="size-10" aria-label="Add footage" onClick={pick}>
        <Paperclip className="size-5" />
      </Button>
      <input
        ref={input}
        type="file"
        accept="video/*,audio/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (!files.length) return;
          pickedFiles.set({ web: files });
          navigate('/share');
        }}
      />
    </>
  );
}

/** Home's and a page's header: the menu, where I am, my uploads and Add footage; under a page, its sections. */
function PlaceHeader() {
  const board = useBoardData();
  const current = useCurrentPage();
  const page = current && board.data?.pages.find((p) => p.id === current.wid);
  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-1 px-3">
        <PhoneMenuButton />
        <h1 className="flex min-w-0 flex-1 items-center gap-2.5 px-1 text-xl font-semibold">
          {page && <WorkspaceDot color={page.color as WorkspaceColor} className="size-2.5" />}
          <span className="truncate">{page ? page.name : 'Home'}</span>
        </h1>
        <UploadsButton className="size-10" />
        <AddFootage />
      </header>
      {page && current && (
        <nav className="flex h-11 shrink-0 items-end gap-6 overflow-x-auto border-b px-4 [scrollbar-width:none]" aria-label={page.name}>
          {sectionsFor(page.kind).map((s) => (
            <NavLink
              key={s.id}
              to={pagePath(page.id, s.id)}
              className={cn('shrink-0 border-b-2 border-transparent px-0.5 pb-2.5 text-[15px] font-medium text-muted-foreground', current.section === s.id && 'border-foreground text-foreground')}
            >
              {s.label}
            </NavLink>
          ))}
        </nav>
      )}
    </>
  );
}

/**
 * The phone (the Android app, or a narrow browser): every page the laptop has, laid out for a small screen. Home and a
 * page's sections get the header with the menu (the laptop's top bar); the other pages bring their own (PageHeader,
 * the card's back bar, the share screen).
 */
export function PhoneShell() {
  const { pathname } = useLocation();
  const place = pathname === '/' || pathname.startsWith('/p/');
  return (
    <div className="pt-safe pb-safe flex h-full flex-col">
      {isApp && <AppBanners />}
      {place && <PlaceHeader />}
      <main className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
      <PhoneMenu />
    </div>
  );
}
