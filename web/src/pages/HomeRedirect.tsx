import { Navigate } from 'react-router';
import { Spinner } from '@/components/ui/spinner';
import { useSettings, useWorkspaces } from '@/lib/queries';

export function HomeRedirect() {
  const workspaces = useWorkspaces();
  const settings = useSettings();
  if (workspaces.isPending || settings.isPending)
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  const list = workspaces.data ?? [];
  if (!list.length) return <Navigate to="/w/new" replace />;
  const target = list.find((w) => w.id === settings.data?.lastWorkspaceId) ?? list[0];
  return <Navigate to={`/w/${target.id}/board`} replace />;
}
