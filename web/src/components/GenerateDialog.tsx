import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { GEN_ASPECTS, GEN_PURPOSE_INFO, GEN_PURPOSES, type GenAspect, type GenKind, type GenPurpose } from '@shared/generate';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { api, errorMessage } from '@/lib/api';
import { useAiSettings } from '@/lib/queries';

/** A picture or a clip made on a home PC for this video's files (shared/generate.ts). */
export function GenerateButton({ wid, pieceId }: { wid: string; pieceId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Sparkles /> Generate
      </Button>
      <GenerateDialog open={open} onOpenChange={setOpen} wid={wid} pieceId={pieceId} />
    </>
  );
}

function GenerateDialog({ open, onOpenChange, wid, pieceId }: { open: boolean; onOpenChange: (o: boolean) => void; wid: string; pieceId: string }) {
  const ai = useAiSettings();
  const [kind, setKind] = useState<GenKind>('image');
  const [purpose, setPurpose] = useState<GenPurpose>('broll');
  const [aspect, setAspect] = useState<GenAspect>('9:16');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const gen = ai.data?.generation;
  const online = ai.data?.generators.some((g) => g[kind]);

  async function submit() {
    setBusy(true);
    try {
      await api(`/workspaces/${wid}/generate`, { body: { kind, prompt, purpose, aspect, pieceId } });
      toast.success(kind === 'video' ? `Queued: it’s made tonight from ${String(gen?.videoFrom ?? 23).padStart(2, '0')}:00.` : 'Started: it lands in Footage in a few minutes.');
      setPrompt('');
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate</DialogTitle>
          <DialogDescription>Made on your home PC. Describe a place, an object or a scene: generated pictures never show people or animals, and any that do are made again.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ToggleGroup type="single" variant="outline" value={kind} onValueChange={(v) => v && setKind(v as GenKind)} className="w-full">
            <ToggleGroupItem value="image" className="flex-1">
              Picture
            </ToggleGroupItem>
            <ToggleGroupItem value="video" className="flex-1">
              Clip (tonight)
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="space-y-2">
            <Label htmlFor="gen-prompt">What it shows</Label>
            <Textarea id="gen-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="A laptop on a wooden desk by a window at dawn, steam rising from a cup of tea" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>For</Label>
              <Select value={purpose} onValueChange={(v) => setPurpose(v as GenPurpose)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GEN_PURPOSES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {GEN_PURPOSE_INFO[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Shape</Label>
              <Select value={aspect} onValueChange={(v) => setAspect(v as GenAspect)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GEN_ASPECTS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a === '9:16' ? '9:16 (vertical)' : a === '16:9' ? '16:9 (wide)' : '1:1 (square)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {ai.data && !online && <p className="text-xs text-amber-400">No home PC that makes {kind === 'video' ? 'clips' : 'pictures'} is online: it waits until one is.</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || prompt.trim().length < 3}>
            {busy ? <Spinner /> : <Sparkles />} Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
