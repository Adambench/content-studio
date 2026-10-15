import { Navigate } from 'react-router';
import { Spinner } from '@/components/ui/spinner';
import { useWorkspaces } from '@/lib/queries';

/** Home is Today, once there's a workspace to have a day in. */
export function HomeRedirect() {
  const workspaces = useWorkspaces();
  if (workspaces.isPending)
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  return <Navigate to={workspaces.data?.length ? '/today' : '/w/new'} replace />;
}
