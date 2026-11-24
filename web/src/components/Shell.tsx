import { BookOpenIcon, MenuIcon, PlusIcon, SettingsIcon } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { PageDot } from '@/components/PageDot';
import { api } from '@/lib/api';
import { queryClient, keys, usePages } from '@/lib/queries';
import { usePhone } from '@/lib/usePhone';
import type { Page } from '@shared/types';

const PALETTE = ['#f59e0b', '#10b981', '#a78bfa', '#38bdf8', '#f472b6', '#d6b141', '#fb7185', '#a1a1aa'];

function tab({ isActive }: { isActive: boolean }) {
  return `flex h-9 items-center gap-2 rounded-lg px-3 text-sm transition-colors ${isActive ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`;
}

function NewPage({ onDone }: { onDone?: () => void }) {
  const [name, setName] = useState('');
  const navigate = useNavigate();
  const pages = usePages().data ?? [];
  const add = async () => {
    if (!name.trim()) return;
    const page = await api<Page>('/api/pages', { body: { name: name.trim(), color: PALETTE[pages.length % PALETTE.length] } });
    await queryClient.invalidateQueries({ queryKey: keys.pages });
    setName('');
    onDone?.();
    navigate(`/p/${page.id}`);
  };
  return (
    <Input autoFocus placeholder="Page name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
  );
}

export function Shell() {
  const phone = usePhone();
  const pages = usePages().data ?? [];
  const { pageId } = useParams();
  const location = useLocation();
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const current = pages.find((p) => p.id === pageId);

  if (phone) {
    return (
      <div className="flex h-full flex-col">
        <header className="pt-safe flex shrink-0 items-center gap-2 border-b px-3">
          <Sheet open={menu} onOpenChange={setMenu}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Menu">
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-3">
              <SheetTitle className="px-3 pt-2 pb-3 text-base">Content Studio</SheetTitle>
              <nav className="flex flex-col gap-1" onClick={() => setMenu(false)}>
                <NavLink to="/" end className={tab}>
                  Home
                </NavLink>
                {pages.map((p) => (
                  <NavLink key={p.id} to={`/p/${p.id}`} className={tab}>
                    <PageDot color={p.color} />
                    {p.name}
                  </NavLink>
                ))}
                <div className="my-2 border-t" />
                <NavLink to="/rules" className={tab}>
                  <BookOpenIcon className="size-4" /> Rules
                </NavLink>
                <NavLink to="/settings" className={tab}>
                  <SettingsIcon className="size-4" /> Settings
                </NavLink>
              </nav>
            </SheetContent>
          </Sheet>
          <div className="flex h-12 min-w-0 flex-1 items-center gap-2 text-sm font-medium">
            {current && <PageDot color={current.color} />}
            <span className="truncate">{current?.name ?? (location.pathname.startsWith('/c/') ? '' : 'Home')}</span>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <NavLink to="/" end className={tab}>
          Home
        </NavLink>
        {pages.map((p) => (
          <NavLink key={p.id} to={`/p/${p.id}`} className={tab}>
            <PageDot color={p.color} />
            {p.name}
          </NavLink>
        ))}
        <Popover open={adding} onOpenChange={setAdding}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="New page" className="text-muted-foreground">
              <PlusIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64">
            <NewPage onDone={() => setAdding(false)} />
          </PopoverContent>
        </Popover>
        <div className="flex-1" />
        <NavLink to="/rules" className={tab}>
          <BookOpenIcon className="size-4" /> Rules
        </NavLink>
        <NavLink to="/settings" className={tab}>
          <SettingsIcon className="size-4" />
        </NavLink>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
