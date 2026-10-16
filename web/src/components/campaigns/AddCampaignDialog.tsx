import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { isCampaignLink, type CampaignDetail } from '@shared/campaigns';
import { WorkspaceDot } from '@/components/WorkspaceDot';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useWorkspaces } from '@/lib/queries';

/** Add a campaign: a Content Rewards link (the app reads and screens it), or one of my businesses' own (a brief). */
export function AddCampaignDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { data: workspaces = [] } = useWorkspaces();
  const businesses = workspaces.filter((w) => w.kind === 'business');
  const [tab, setTab] = useState<'content_rewards' | 'business'>('content_rewards');
  const [link, setLink] = useState('');
  const [business, setBusiness] = useState('');
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const businessId = business || businesses[0]?.id || '';

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = tab === 'content_rewards' ? { origin: tab, link: link.trim() } : { origin: tab, businessWorkspaceId: businessId, title: title.trim(), brief: brief.trim() };
      const c = await api<CampaignDetail>('/campaigns', { body });
      queryClient.invalidateQueries({ queryKey: keys.campaigns });
      onOpenChange(false);
      setLink('');
      setTitle('');
      setBrief('');
      navigate(`/campaigns/${c.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const ready = tab === 'content_rewards' ? isCampaignLink(link.trim()) : !!businessId && !!title.trim() && !!brief.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={add} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add a campaign</DialogTitle>
            <DialogDescription>Content Studio reads it, turns its rules into a checklist and screens it against the halal rules. Then you check it and pick its pages.</DialogDescription>
          </DialogHeader>
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="w-full">
              <TabsTrigger value="content_rewards">Content Rewards</TabsTrigger>
              <TabsTrigger value="business">My business</TabsTrigger>
            </TabsList>
            <TabsContent value="content_rewards" className="space-y-2 pt-3">
              <Label htmlFor="campaign-link">The campaign’s link</Label>
              <Input id="campaign-link" type="url" inputMode="url" autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://contentrewards.com/c/campaigns/…" />
              <p className="text-xs text-muted-foreground">Join it on Content Rewards and sign in to Whop under Settings → Connected sites first, so its rules and source files can be read.</p>
            </TabsContent>
            <TabsContent value="business" className="space-y-3 pt-3">
              {businesses.length ? (
                <>
                  <div className="space-y-2">
                    <Label>Business</Label>
                    <Select value={businessId} onValueChange={setBusiness}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {businesses.map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            <WorkspaceDot color={w.color} className="size-2" /> {w.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="campaign-title">Name</Label>
                    <Input id="campaign-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Autumn launch clips" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="campaign-brief">Brief and rules</Label>
                    <Textarea id="campaign-brief" value={brief} onChange={(e) => setBrief(e.target.value)} rows={6} placeholder="What to clip, what every clip must say or show, length, hashtags…" />
                  </div>
                </>
              ) : (
                <p className="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground">Make a workspace of the Business kind first: its campaigns use its brand guide, assets and footage.</p>
              )}
            </TabsContent>
          </Tabs>
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
