import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import type { WorkspaceColor } from '@shared/types';
import { ColorPicker } from '@/components/ColorPicker';
import { PageHeader } from '@/components/PageHeader';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useWorkspace } from '@/lib/queries';
import type { Workspace } from '@/lib/types';

const refresh = (id: string) =>
  Promise.all([queryClient.invalidateQueries({ queryKey: keys.workspace(id) }), queryClient.invalidateQueries({ queryKey: keys.workspaces }), queryClient.invalidateQueries({ queryKey: keys.boardAll })]);

function Settings({ ws }: { ws: Workspace }) {
  const navigate = useNavigate();
  const [name, setName] = useState(ws.name);
  const [color, setColor] = useState<WorkspaceColor>(ws.color);
  const [niche, setNiche] = useState(ws.niche);
  const [description, setDescription] = useState(ws.description);
  const [brandGuide, setBrandGuide] = useState(ws.brandGuide);
  const [busy, setBusy] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  useEffect(() => setName(ws.name), [ws.name]);

  const dirty = name !== ws.name || color !== ws.color || niche !== ws.niche || description !== ws.description || brandGuide !== ws.brandGuide;

  async function save() {
    setBusy(true);
    try {
      await api(`/workspaces/${ws.id}`, { method: 'PATCH', body: { name: name.trim(), color, niche, description, brandGuide } });
      await refresh(ws.id);
      toast.success('Saved');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function setHidden(hidden: boolean) {
    try {
      await api(`/workspaces/${ws.id}`, { method: 'PATCH', body: { hidden } });
      await refresh(ws.id);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function remove() {
    await api(`/workspaces/${ws.id}`, { method: 'DELETE' });
    await queryClient.invalidateQueries({ queryKey: keys.workspaces });
    await queryClient.invalidateQueries({ queryKey: keys.boardAll });
    toast.success(`Deleted ${ws.name}`);
    navigate('/settings');
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={ws.name}
        description="Page settings"
        actions={
          <Button onClick={save} disabled={!dirty || busy || !name.trim()}>
            {busy && <Spinner />} Save
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
          <Card>
            <CardContent className="space-y-5 pt-6">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
              </div>
              <div className="space-y-2">
                <Label>Colour</Label>
                <ColorPicker value={color} onChange={setColor} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="shown">On the top bar and Home</Label>
                <Switch id="shown" checked={!ws.hidden} onCheckedChange={(on) => void setHidden(!on)} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm">Instagram account and posting times</span>
                <Button variant="outline" asChild>
                  <Link to={`/settings/${ws.id}/accounts`}>Accounts</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>About</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="niche">Niche</Label>
                <Input id="niche" value={niche} onChange={(e) => setNiche(e.target.value)} maxLength={300} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">About this brand</Label>
                <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={2000} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Brand guide</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea value={brandGuide} onChange={(e) => setBrandGuide(e.target.value)} className="min-h-64 text-[13px] leading-relaxed" maxLength={20000} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Delete this page</CardTitle>
            </CardHeader>
            <CardContent>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">Delete {ws.name}</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {ws.name}?</AlertDialogTitle>
                    <AlertDialogDescription>Every video on it goes, with its files. Type its name to delete it.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={ws.name} />
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep it</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" disabled={confirmName !== ws.name} onClick={remove}>
                      Delete
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

/** A page's own settings (Settings → Pages). */
export function WorkspaceSettingsPage() {
  const { wid = '' } = useParams();
  const ws = useWorkspace(wid);
  if (!ws.data)
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  return <Settings key={ws.data.id} ws={ws.data} />;
}
