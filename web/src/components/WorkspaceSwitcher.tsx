import { Check, ChevronsUpDown, Plus, Settings, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useWorkspaces } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { WorkspaceDot } from './WorkspaceDot';

export function WorkspaceSwitcher({ currentId, compact }: { currentId?: string; compact?: boolean }) {
  const { data: workspaces = [] } = useWorkspaces();
  const navigate = useNavigate();
  const current = workspaces.find((w) => w.id === currentId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className={cn('h-9 justify-between gap-2 px-2 font-medium', compact ? 'max-w-[60vw]' : 'w-full')}>
          <span className="flex min-w-0 items-center gap-2">
            {current ? <WorkspaceDot color={current.color} /> : <img src="/icon.svg" alt="" className="size-4" />}
            <span className="truncate">{current?.name ?? 'Content Studio'}</span>
          </span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => navigate(`/w/${w.id}/board`)}>
            <WorkspaceDot color={w.color} />
            <span className="truncate">{w.name}</span>
            {w.id === currentId && <Check className="ml-auto" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {current && (
          <DropdownMenuItem onSelect={() => navigate(`/w/${current.id}/settings`)}>
            <Settings2 /> Workspace settings
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => navigate('/w/new')}>
          <Plus /> New workspace
        </DropdownMenuItem>
        {/* Phones have no sidebar: this is their way to the app's own settings (notifications, phone access). */}
        <DropdownMenuItem className="md:hidden" onSelect={() => navigate('/settings')}>
          <Settings /> App settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
