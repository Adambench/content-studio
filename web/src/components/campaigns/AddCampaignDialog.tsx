import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { MARKET_INFO, parseCampaignLink, type CampaignDetail } from '@shared/campaigns';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient } from '@/lib/queries';
import type { Workspace } from '@/lib/types';

/**
 * Add a campaign to this page: a Content Rewards or Vyro link (the app reads and screens it), or, on a business's page,
 * one of its own (a brief).
 */
export function AddCampaignDialog({ workspace, open, onOpenChange }: { workspace: Workspace; open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const business = workspace.kind === 'business';
  const [tab, setTab] = useState<'link' | 'business'>('link');
  const [link, setLink] = useState('');
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body =
        tab === 'link' || !business ? { link: link.trim(), pageId: workspace.id } : { origin: 'business', businessWorkspaceId: workspace.id, title: title.trim(), brief: brief.trim() };
      const c = await api<CampaignDetail>('/campaigns', { body });
      queryClient.invalidateQueries({ queryKey: keys.campaigns });
      onOpenChange(false);
      setLink('');
      setTitle('');
      setBrief('');
      navigate(`/w/${workspace.id}/campaigns/${c.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const parsed = parseCampaignLink(link.trim());
  const whopPage = !parsed && /whop\.com/i.test(link);
  const ready = tab === 'link' || !business ? !!parsed : !!title.trim() && !!brief.trim();

  const linkField = (
    <div className="space-y-2">
      <Label htmlFor="campaign-link">The campaign’s link</Label>
      <Input id="campaign-link" type="url" inputMode="url" autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder={MARKET_INFO.content_rewards.linkExample} />
      {whopPage ? (
        <p className="text-xs text-amber-400">
          That’s Whop’s page, which doesn’t say which campaign is open. Use the link button on the campaign’s banner, or open it on contentrewards.com.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {parsed ? `A ${MARKET_INFO[parsed.market].label} campaign. ` : `Like ${MARKET_INFO.content_rewards.linkExample} or ${MARKET_INFO.vyro.linkExample}. `}
          Join it first and sign in under Settings → Connected sites, so its rules and source files can be read.
        </p>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={add} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add a campaign to {workspace.name}</DialogTitle>
            <DialogDescription>Content Studio reads it, turns its rules into a checklist and screens it against the halal rules. Then you check it and confirm.</DialogDescription>
          </DialogHeader>
          {business ? (
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
              <TabsList className="w-full">
                <TabsTrigger value="link">Content Rewards or Vyro</TabsTrigger>
                <TabsTrigger value="business">Its own</TabsTrigger>
              </TabsList>
              <TabsContent value="link" className="pt-3">
                {linkField}
              </TabsContent>
              <TabsContent value="business" className="space-y-3 pt-3">
                <div className="space-y-2">
                  <Label htmlFor="campaign-title">Name</Label>
                  <Input id="campaign-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Autumn launch clips" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="campaign-brief">Brief and rules</Label>
                  <Textarea id="campaign-brief" value={brief} onChange={(e) => setBrief(e.target.value)} rows={6} placeholder="What to clip, what every clip must say or show, length, hashtags…" />
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            linkField
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || busy}>
              {busy && <Spinner />} Add and read
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
