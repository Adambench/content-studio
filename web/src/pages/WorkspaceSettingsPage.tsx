import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { Stage, WorkspaceColor } from '@shared/types';
import { ColorPicker } from '@/components/ColorPicker';
import { PageHeader } from '@/components/PageHeader';
import { useWorkspaceContext } from '@/components/WorkspaceLayout';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient } from '@/lib/queries';

export function WorkspaceSettingsPage() {
  const { workspace: ws } = useWorkspaceContext();
  const navigate = useNavigate();
  const [name, setName] = useState(ws.name);
  const [color, setColor] = useState<WorkspaceColor>(ws.color);
  const [description, setDescription] = useState(ws.description);
  const [brandGuide, setBrandGuide] = useState(ws.brandGuide);
  const [voiceMemory, setVoiceMemory] = useState(ws.voiceMemory);
  const [stages, setStages] = useState<Stage[]>(ws.stages);
  const [busy, setBusy] = useState(false);
  const [confirmName, setConfirmName] = useState('');

  // Pick up server changes (e.g. Claude updating voice memory) when there are no local edits to that field.
  useEffect(() => setVoiceMemory(ws.voiceMemory), [ws.voiceMemory]);
  useEffect(() => setStages(ws.stages), [ws.stages]);

  const dirty = name !== ws.name || color !== ws.color || description !== ws.description || brandGuide !== ws.brandGuide || voiceMemory !== ws.voiceMemory || JSON.stringify(stages) !== JSON.stringify(ws.stages);

  async function save() {
    setBusy(true);
    try {
      await api(`/workspaces/${ws.id}`, { method: 'PATCH', body: { name: name.trim(), color, description, brandGuide, voiceMemory, stages: stages.map((s) => ({ ...s, name: s.name.trim() || 'Untitled' })) } });
      await Promise.all([queryClient.invalidateQueries({ queryKey: keys.workspace(ws.id) }), queryClient.invalidateQueries({ queryKey: keys.workspaces })]);
      toast.success('Saved');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function learnNow() {
    try {
      await api(`/workspaces/${ws.id}/learn`, { body: {} });
      toast('Claude is studying your edits…', { icon: <Sparkles className="size-4 text-brand" /> });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function deleteWorkspace() {
    await api(`/workspaces/${ws.id}`, { method: 'DELETE' });
    await queryClient.invalidateQueries({ queryKey: keys.workspaces });
    toast.success(`Deleted ${ws.name}`);
    navigate('/');
  }

  const move = (i: number, d: -1 | 1) =>
    setStages((s) => {
      const next = [...s];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Workspace settings"
        description={ws.name}
        actions={
          <Button size="sm" onClick={save} disabled={!dirty || busy || !name.trim()}>
            {busy && <Spinner />} Save changes
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
          <Card>
            <CardHeader>
              <CardTitle>General</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
              </div>
              <div className="space-y-2">
                <Label>Colour</Label>
                <ColorPicker value={color} onChange={setColor} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">About this brand</Label>
                <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={2000} placeholder="Audience, topics, goals" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Brand guide</CardTitle>
              <CardDescription>Written by you. Claude reads it before every answer: tone, audience, words to use or avoid, example posts, recurring formats.</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={brandGuide}
                onChange={(e) => setBrandGuide(e.target.value)}
                className="min-h-48 font-mono text-[13px] leading-relaxed"
                placeholder={'- Audience: complete beginners, 20–35\n- Tone: direct, a bit cheeky, never preachy\n- Always: one tip per video, show don’t tell\n- Never: “hey guys”, fake urgency'}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-brand" /> Voice memory
              </CardTitle>
              <CardDescription>
                Maintained by Claude from how you rewrite its drafts (it updates after every few edits). You can correct it here.
                {!!ws.pendingEdits && ` ${ws.pendingEdits} new edit${ws.pendingEdits === 1 ? '' : 's'} not learned yet.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea value={voiceMemory} onChange={(e) => setVoiceMemory(e.target.value)} className="min-h-32 text-[13px] leading-relaxed" placeholder="Nothing learned yet. Edit a few of Claude’s drafts and save a version — it learns from the difference." />
              <Button size="sm" variant="outline" onClick={learnNow} disabled={!ws.pendingEdits}>
                <Sparkles /> Learn from my edits now
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pipeline stages</CardTitle>
              <CardDescription>The columns on your board. Cards in a removed stage move to the first one.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {stages.map((s, i) => (
                <div key={s.id} className="flex items-center gap-1.5">
                  <Input value={s.name} onChange={(e) => setStages((all) => all.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))} aria-label={`Stage ${i + 1} name`} className="h-8" maxLength={40} />
                  <Button variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon-sm" disabled={i === stages.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                    <ArrowDown />
                  </Button>
                  <Button variant="ghost" size="icon-sm" disabled={stages.length <= 1} onClick={() => setStages((all) => all.filter((x) => x.id !== s.id))} aria-label="Remove stage">
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" disabled={stages.length >= 12} onClick={() => setStages((s) => [...s, { id: crypto.randomUUID().slice(0, 8), name: 'New stage' }])}>
                <Plus /> Add stage
              </Button>
            </CardContent>
          </Card>

          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle>Delete workspace</CardTitle>
              <CardDescription>Removes every piece, version, chat, footage file and brand asset in “{ws.name}” from this computer.</CardDescription>
            </CardHeader>
            <CardContent>
              <AlertDialog onOpenChange={() => setConfirmName('')}>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    <Trash2 /> Delete workspace
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete “{ws.name}”?</AlertDialogTitle>
                    <AlertDialogDescription>This can’t be undone. Type the workspace name to confirm.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={ws.name} aria-label="Workspace name" />
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" disabled={confirmName !== ws.name} onClick={deleteWorkspace}>
                      Delete forever
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
