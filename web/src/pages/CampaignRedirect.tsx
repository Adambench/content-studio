import { Navigate, useParams } from 'react-router';
import { Spinner } from '@/components/ui/spinner';
import { CampaignPage } from '@/pages/CampaignPage';
import { useCampaign, useSettings, useWorkspaces } from '@/lib/queries';

const Loading = () => (
  <div className="grid h-full place-items-center">
    <Spinner className="size-5 text-muted-foreground" />
  </div>
);

/** Campaigns live on their page: /campaigns opens the last page's (or the first page that has campaigns). */
export function CampaignsRedirect() {
  const workspaces = useWorkspaces();
  const settings = useSettings();
  if (workspaces.isPending || settings.isPending) return <Loading />;
  const withCampaigns = (workspaces.data ?? []).filter((w) => w.modules.includes('campaigns'));
  const page = withCampaigns.find((w) => w.id === settings.data?.lastWorkspaceId) ?? withCampaigns[0];
  return <Navigate to={page ? `/w/${page.id}/campaigns` : '/today'} replace />;
}

/** /campaigns/:id (links from Today, Review, Analytics) opens it on its page; one with no page yet opens on its own. */
export function CampaignRedirect() {
  const { id = '' } = useParams();
  const campaign = useCampaign(id);
  if (campaign.isPending) return <Loading />;
  const c = campaign.data;
  const page = c?.pageIds[0] ?? c?.businessWorkspaceId;
  return page ? <Navigate to={`/w/${page}/campaigns/${id}`} replace /> : <CampaignPage />;
}
