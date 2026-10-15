import { useEffect } from 'react';
import { Navigate, Outlet, useMatch, useOutletContext, useParams } from 'react-router';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { api } from '@/lib/api';
import { usePiece, useWorkspace } from '@/lib/queries';
import type { Workspace } from '@/lib/types';
import { claudeDesktopOpen, claudeMobileOpen, openClaude, useStore } from '@/lib/ui-state';
import { ClaudePanel } from './ClaudePanel';

export const useWorkspaceContext = () => useOutletContext<{ workspace: Workspace }>();

export function WorkspaceLayout() {
  const { wid = '' } = useParams();
  const ws = useWorkspace(wid);
  const pieceMatch = useMatch('/w/:wid/p/:pid');
  const videoMatch = useMatch('/w/:wid/p/:pid/edit');
  const pid = pieceMatch?.params.pid ?? videoMatch?.params.pid ?? '';
  const piece = usePiece(pid);
  const isDesktop = useIsDesktop();
  const desktopOpen = useStore(claudeDesktopOpen);
  const mobileOpen = useStore(claudeMobileOpen);

  useEffect(() => {
    if (ws.data) api('/settings', { method: 'PATCH', body: { lastWorkspaceId: wid } }).catch(() => {});
  }, [wid, ws.data?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        if (isDesktop) claudeDesktopOpen.set(!claudeDesktopOpen.get());
        else openClaude();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDesktop]);

  if (ws.isError) return <Navigate to="/" replace />;
  if (!ws.data)
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );

  const contextPiece = pid && piece.data ? { id: piece.data.id, title: piece.data.title, view: videoMatch ? ('video' as const) : undefined } : undefined;

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-hidden">
        <Outlet context={{ workspace: ws.data }} />
      </div>
      {isDesktop && desktopOpen && (
        <aside className="w-[min(420px,34vw)] shrink-0 border-l" aria-label="Claude">
          <ClaudePanel wid={wid} piece={contextPiece} onClose={() => claudeDesktopOpen.set(false)} />
        </aside>
      )}
      {!isDesktop && (
        <Sheet open={mobileOpen} onOpenChange={claudeMobileOpen.set}>
          <SheetContent side="bottom" showCloseButton={false} className="gap-0 overflow-hidden rounded-t-2xl p-0 data-[side=bottom]:h-[92dvh]">
            <SheetTitle className="sr-only">Claude</SheetTitle>
            <SheetDescription className="sr-only">Chat with Claude about this workspace</SheetDescription>
            <ClaudePanel wid={wid} piece={contextPiece} onClose={() => claudeMobileOpen.set(false)} />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
