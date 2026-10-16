import { useEffect } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api';
import type { PieceDetail } from '@/lib/types';

/** Old `/review?piece=…` links (notifications, an older phone app): the clip's own page now, else Today. */
export function ReviewRedirect() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const piece = params.get('piece');
  useEffect(() => {
    if (!piece) return;
    api<PieceDetail>(`/pieces/${piece}`).then(
      (p) => navigate(`/w/${p.workspaceId}/p/${p.id}`, { replace: true }),
      () => navigate('/today', { replace: true }),
    );
  }, [piece, navigate]);
  if (!piece) return <Navigate to="/today" replace />;
  return (
    <div className="grid h-full place-items-center">
      <Spinner className="size-5 text-muted-foreground" />
    </div>
  );
}
