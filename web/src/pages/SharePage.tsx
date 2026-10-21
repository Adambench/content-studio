import { ArrowLeft, AudioLines, FileIcon, Film, Image as ImageIcon, Link2, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { WorkspaceDot } from '@/components/WorkspaceDot';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage } from '@/lib/api';
import { bytes } from '@/lib/format';
import { pendingShare, Studio, type QueuedFile } from '@/lib/native';
import { useBoard, useSettings, useWorkspaces } from '@/lib/queries';
import { useStore } from '@/lib/ui-state';

const isAudio = (f: QueuedFile) => f.mime.startsWith('audio/');

function FileKindIcon({ file }: { file: QueuedFile }) {
  const Icon = file.mime.startsWith('video/') ? Film : file.mime.startsWith('image/') ? ImageIcon : isAudio(file) ? AudioLines : FileIcon;
  return <Icon className="size-4 shrink-0 text-muted-foreground" />;
}

/**
 * Something shared to the app from another app (Android's share sheet): pick the workspace (and, for footage, a
 * piece), then it uploads in the background. Like the PWA's share target: video and photos go to the library, voice
 * notes and text or links become idea captures.
 */
export function SharePage() {
  const share = useStore(pendingShare);
  const { data: workspaces = [] } = useWorkspaces();
  const settings = useSettings();
  const navigate = useNavigate();
  const [wid, setWid] = useState('');
  const [pieceId, setPieceId] = useState('none');
  const [sending, setSending] = useState(false);
  const board = useBoard(wid);
  // Once it's sent (or dropped) the share is cleared; that mustn't redirect over where we're going.
  const leaving = useRef(false);

  useEffect(() => {
    if (!wid && workspaces.length) setWid(workspaces.find((w) => w.id === settings.data?.lastWorkspaceId)?.id ?? workspaces[0].id);
  }, [workspaces, settings.data, wid]);

  if (!share) return leaving.current ? null : <Navigate to="/" replace />;
  const footage = share.files.filter((f) => !isAudio(f));
  const voice = share.files.filter(isAudio);
  const text = share.files.length ? null : share.text;

  async function cancel() {
    if (share) await Studio.discardShare({ id: share.id }).catch(() => {});
    leaving.current = true;
    pendingShare.set(null);
    navigate(-1);
  }

  async function send() {
    if (!share || !wid) return;
    setSending(true);
    try {
      const target = { workspaceId: wid, pieceId: pieceId === 'none' ? null : pieceId };
      if (footage.length) await Studio.enqueueFiles({ ...target, source: 'share', files: footage });
      if (voice.length) await Studio.enqueueFiles({ workspaceId: wid, source: 'capture', files: voice });
      // Text and links: the Saved pile of a page with Ideas, else an idea card made by Claude.
      const toIdeas = workspaces.find((w) => w.id === wid)?.kind !== 'clipping';
      const savedId = crypto.randomUUID();
      if (text && toIdeas) await Studio.enqueueSaved({ workspaceId: wid, id: savedId, text });
      else if (text) await Studio.enqueueText({ workspaceId: wid, text });
      await Studio.discardShare({ id: share.id });
      leaving.current = true;
      pendingShare.set(null);
      const ws = workspaces.find((w) => w.id === wid)?.name ?? 'the workspace';
      if (footage.length) toast.success(`Sending to ${ws}`, { description: target.pieceId ? 'It uploads in the background into that video.' : 'It uploads in the background into the Inbox; Claude suggests which video it belongs to.' });
      else if (toIdeas) toast.success(`Saved to ${ws}`, { description: 'It’s in Ideas → Saved. Next time, “Save to Ideas” in the share sheet does this with no screen.' });
      else toast.success('Idea captured', { description: 'Claude will turn it into a card on the board.' });
      navigate(footage.length ? (target.pieceId ? `/w/${wid}/p/${target.pieceId}` : `/w/${wid}/inbox`) : toIdeas ? `/w/${wid}/ideas` : `/w/${wid}/board`, { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="pt-safe flex items-center gap-2 border-b px-2 md:px-4">
        <div className="flex h-12 items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="Cancel" onClick={cancel}>
            <ArrowLeft />
          </Button>
          <h1 className="text-base font-semibold">Add to Content Studio</h1>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-6">
        <section className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {footage.length ? 'Goes into a video, or the Inbox' : 'Becomes an idea card'}
            {voice.length > 0 && footage.length > 0 && ' (voice notes become idea cards)'}
          </p>
          <ul className="divide-y rounded-lg border">
            {share.files.map((f) => (
              <li key={f.path} className="flex items-center gap-3 px-3 py-2.5">
                <FileKindIcon file={f} />
                <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{bytes(f.size)}</span>
              </li>
            ))}
            {text && (
              <li className="flex items-start gap-3 px-3 py-2.5">
                <Link2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <p className="min-w-0 flex-1 text-sm break-words whitespace-pre-wrap">{text}</p>
              </li>
            )}
          </ul>
        </section>

        <div className="space-y-2">
          <Label>Workspace</Label>
          <Select value={wid} onValueChange={(v) => (setWid(v), setPieceId('none'))}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={workspaces.length ? 'Workspace' : 'Loading…'} />
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  <WorkspaceDot color={w.color} /> {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {footage.length > 0 && (
          <div className="space-y-2">
            <Label>Piece (optional)</Label>
            <Select value={pieceId} onValueChange={setPieceId} disabled={!board.data}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">The Inbox (Claude suggests where)</SelectItem>
                {(board.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="pb-safe border-t p-3">
        <Button size="lg" className="w-full" onClick={send} disabled={!wid || sending}>
          {sending ? <Spinner /> : <Send />} {footage.length ? `Upload ${footage.length === 1 ? 'it' : `${footage.length} files`}` : 'Capture idea'}
        </Button>
      </div>
    </div>
  );
}
