import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { WorkspaceColor } from '@shared/types';
import { ColorPicker } from '@/components/ColorPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useWorkspaces } from '@/lib/queries';
import type { Workspace } from '@/lib/types';

export function NewWorkspacePage() {
  const navigate = useNavigate();
  const { data: existing = [] } = useWorkspaces();
  const [name, setName] = useState('');
  const [color, setColor] = useState<WorkspaceColor>('violet');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const ws = await api<Workspace>('/workspaces', { body: { name, color, description } });
      await queryClient.invalidateQueries({ queryKey: keys.workspaces });
      navigate(`/w/${ws.id}/board`);
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <form onSubmit={create} className="mx-auto max-w-lg space-y-8 px-6 py-12">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">{existing.length ? 'New workspace' : 'Create your first workspace'}</h1>
          <p className="text-sm text-muted-foreground">
            One per brand or niche. Each has its own board, footage, brand assets, Claude chats and voice — nothing leaks between them.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ws-name">Name</Label>
          <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gym tips" autoFocus maxLength={60} />
        </div>
        <div className="space-y-2">
          <Label>Colour</Label>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ws-desc">What is this brand about?</Label>
          <Textarea id="ws-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Audience, topics, tone. Claude reads this before helping." maxLength={2000} />
          <p className="text-xs text-muted-foreground">You can add a full brand guide later in workspace settings.</p>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={!name.trim() || busy}>
            {busy && <Spinner />} Create workspace
          </Button>
          {existing.length > 0 && (
            <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
