import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';

/** An Islamic page's Lectures: its lecture campaign (made the first time), where lectures are pasted and clipped. */
export function LecturesRedirect() {
  const { wid } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    if (!wid) return;
    api<{ campaignId: string }>(`/workspaces/${wid}/lectures`, { method: 'POST' }).then(
      ({ campaignId }) => navigate(`/campaigns/${campaignId}`, { replace: true }),
      (err) => {
        toast.error(errorMessage(err));
        navigate(`/w/${wid}/board`, { replace: true });
      },
    );
  }, [wid, navigate]);
  return (
    <div className="grid h-full place-items-center">
      <Spinner className="size-5 text-muted-foreground" />
    </div>
  );
}
