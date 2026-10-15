import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { KIND_INFO, KIND_PRESETS, MODULE_INFO, type WorkspaceColor, type WorkspaceKind } from '@shared/types';
import { ColorPicker } from '@/components/ColorPicker';
import { KindPicker } from '@/components/KindPicker';
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
  const [kind, setKind] = useState<WorkspaceKind | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState<WorkspaceColor>('violet');
  const [niche, setNiche] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!kind) return;
    setBusy(true);
    try {
      const ws = await api<Workspace>('/workspaces', { body: { kind, name, color, niche, description } });
      await queryClient.invalidateQueries({ queryKey: keys.workspaces });
      navigate(`/w/${ws.id}/board`);
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <form onSubmit={create} className="mx-auto max-w-2xl space-y-8 px-4 py-10 md:px-6 md:py-12">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">{existing.length ? 'New workspace' : 'Create your first workspace'}</h1>
          <p className="text-sm text-muted-foreground">
            One per page: its own board, footage, brand assets, accounts, Claude chats and voice. Nothing leaks between them.
          </p>
        </div>

        <div className="space-y-2">
          <Label id="kind-label">What is it?</Label>
          <KindPicker value={kind} onChange={setKind} labelledBy="kind-label" />
        </div>

        {kind && (
          <>
            <p className="text-xs text-muted-foreground">
              Starts with {KIND_PRESETS[kind].modules.map((m) => MODULE_INFO[m].label).join(', ')} and the stages {KIND_PRESETS[kind].stages.map((s) => s.name).join(' → ')}. You can change
              both later in its settings.
            </p>
            <div className="space-y-2">
              <Label htmlFor="ws-name">Name</Label>
              <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'clipping' ? 'e.g. Money moves' : kind === 'business' ? 'e.g. Atelier Noor' : 'e.g. Adam'} autoFocus maxLength={60} />
            </div>
            <div className="space-y-2">
              <Label>Colour</Label>
              <ColorPicker value={color} onChange={setColor} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ws-niche">Niche</Label>
              <Input id="ws-niche" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder={KIND_INFO[kind].niche} maxLength={300} />
              <p className="text-xs text-muted-foreground">One sentence: the topic and who it’s for. Research and clip picking go by it.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ws-desc">About {kind === 'personal' ? 'you' : 'it'} (optional)</Label>
              <Textarea id="ws-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Audience, topics, tone, goals. Claude reads this before helping." maxLength={2000} />
              <p className="text-xs text-muted-foreground">You can add a full brand guide later in workspace settings.</p>
            </div>
          </>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={!kind || !name.trim() || busy}>
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
