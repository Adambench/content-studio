import { Download, Microscope, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ASSET_TYPE_LABELS, ASSET_TYPES, type AssetType } from '@shared/types';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { VocalOnlyDialog } from '@/components/VocalOnlyDialog';
import { api, errorMessage, fileUrl, mediaFileUrl } from '@/lib/api';
import { bytes, clock, duration } from '@/lib/format';
import { keys, queryClient, useBoard, useMediaItem, useWorkspace } from '@/lib/queries';
import { useNavigate } from 'react-router';
import { openClaude } from '@/lib/ui-state';
import { cn } from '@/lib/utils';
import { MediaIcon } from './MediaCard';

const NONE = '__none__';

export function MediaDialog({ wid, mediaId, onClose }: { wid: string; mediaId: string | null; onClose: () => void }) {
  const { data: m } = useMediaItem(mediaId);
  const board = useBoard(wid);
  const playerRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [time, setTime] = useState(0);
  const [notes, setNotes] = useState('');
  const [confirmNasheed, setConfirmNasheed] = useState(false);
  const ws = useWorkspace(wid);
  const navigate = useNavigate();

  useEffect(() => setNotes(m?.notes ?? ''), [m?.id, m?.notes]);

  async function patch(body: Record<string, unknown>) {
    try {
      await api(`/media/${mediaId}`, { method: 'PATCH', body });
      queryClient.invalidateQueries({ queryKey: ['media', wid] });
      queryClient.invalidateQueries({ queryKey: ['media-item', mediaId] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function remove() {
    try {
      await api(`/media/${mediaId}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['media', wid] });
      toast.success('Deleted');
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  /** Someone else's video saved to the library: what makes it work (on the Research page). */
  async function analyseIt() {
    try {
      const item = await api<{ id: string }>(`/workspaces/${wid}/research/analyse`, { body: { mediaId } });
      queryClient.invalidateQueries({ queryKey: keys.research(wid) });
      onClose();
      navigate(`/w/${wid}/research?item=${item.id}`);
      toast('Analysing it: a few minutes');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function retranscribe() {
    try {
      await api(`/media/${mediaId}/transcribe`, { body: {} });
      toast.success('Transcribing again');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const seek = (t: number) => {
    if (playerRef.current) {
      playerRef.current.currentTime = t;
      void playerRef.current.play();
    }
  };

  const isAsset = !!m?.assetType;
  const segments = m?.transcript?.segments ?? [];
  const tall = m?.height && m?.width ? m.height > m.width : false;

  return (
    <Dialog open={!!mediaId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-hidden p-0 sm:max-w-4xl">
        {!m ? (
          <div className="grid h-60 place-items-center">
            <DialogTitle className="sr-only">Loading</DialogTitle>
            <Spinner />
          </div>
        ) : (
          <div className="grid max-h-[92dvh] min-h-0 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            <div className="grid min-h-48 place-items-center bg-black">
              {m.kind === 'video' ? (
                <video ref={playerRef} src={mediaFileUrl(m.id)} controls playsInline preload="metadata" onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} className={cn('max-h-[60dvh] w-full md:max-h-[85dvh]', tall && 'md:h-[85dvh] md:w-auto')} />
              ) : m.kind === 'image' ? (
                <img src={mediaFileUrl(m.id)} alt={m.originalName} className="max-h-[60dvh] object-contain md:max-h-[85dvh]" />
              ) : m.kind === 'audio' ? (
                <audio ref={playerRef} src={mediaFileUrl(m.id)} controls onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} className="w-[90%]" />
              ) : (
                <MediaIcon media={m} className="size-12 text-muted-foreground" />
              )}
            </div>

            <div className="flex min-h-0 flex-col overflow-y-auto">
              <DialogHeader className="border-b p-4 text-left">
                <DialogTitle className="truncate pr-6 text-sm">{m.originalName}</DialogTitle>
                <DialogDescription className="text-xs">
                  {[m.kind, m.width && m.height ? `${m.width}×${m.height}` : null, m.durationMs ? duration(m.durationMs) : null, bytes(m.size)].filter(Boolean).join(' · ')}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 p-4">
                {isAsset ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Type</Label>
                    <Select value={m.assetType ?? 'other'} onValueChange={(v) => (v === 'nasheed' ? setConfirmNasheed(true) : patch({ assetType: v as AssetType }))}>
                      <SelectTrigger className="w-full" size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSET_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {ASSET_TYPE_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Attached to</Label>
                    <Select value={m.pieceId ?? NONE} onValueChange={(v) => patch({ pieceId: v === NONE ? null : v })}>
                      <SelectTrigger className="w-full" size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Not attached</SelectItem>
                        {(board.data ?? []).map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="media-notes" className="text-xs">
                    Notes
                  </Label>
                  <Textarea id="media-notes" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== m.notes && patch({ notes })} rows={2} placeholder="What’s in this clip? Claude can read this." />
                </div>

                <div className="flex flex-wrap gap-2">
                  {!isAsset && (m.kind === 'video' || m.kind === 'image') && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        onClose();
                        openClaude(`Look at "${m.originalName}" (media id ${m.id}) and tell me `);
                      }}
                    >
                      <Sparkles className="text-brand" /> Ask Claude
                    </Button>
                  )}
                  {!isAsset && m.kind === 'video' && m.source !== 'render' && ws.data?.modules.includes('research') && (
                    <Button size="sm" variant="outline" onClick={analyseIt}>
                      <Microscope /> Analyse
                    </Button>
                  )}
                  <Button size="sm" variant="outline" asChild>
                    <a href={fileUrl(`/media/${m.id}/file?download=1`)}>
                      <Download /> Download
                    </a>
                  </Button>
                  {!isAsset && (m.kind === 'video' || m.kind === 'audio') && m.transcriptStatus !== 'running' && m.transcriptStatus !== 'queued' && (
                    <Button size="sm" variant="ghost" onClick={retranscribe}>
                      <RefreshCw /> {m.transcriptStatus === 'done' ? 'Re-transcribe' : 'Transcribe'}
                    </Button>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                        <Trash2 /> Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this file?</AlertDialogTitle>
                        <AlertDialogDescription>“{m.originalName}” and its transcript will be removed from this computer. This can’t be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={remove}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>

                {!isAsset && (m.kind === 'video' || m.kind === 'audio') && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-medium text-muted-foreground">Transcript</h3>
                    {m.transcriptStatus === 'done' ? (
                      segments.length ? (
                        <ol className="space-y-0.5 text-sm">
                          {segments.map((s, i) => {
                            const active = time >= s.start && time < s.end;
                            return (
                              <li key={i}>
                                <button type="button" onClick={() => seek(s.start)} className={cn('flex w-full gap-2 rounded px-1.5 py-1 text-left hover:bg-accent', active && 'bg-brand-soft')}>
                                  <span className="w-9 shrink-0 pt-px text-xs text-muted-foreground tabular-nums">{clock(s.start)}</span>
                                  <span>{s.text}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ol>
                      ) : (
                        <p className="text-sm text-muted-foreground">No speech detected.</p>
                      )
                    ) : m.transcriptStatus === 'queued' || m.transcriptStatus === 'running' ? (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Spinner className="size-3.5" /> Transcribing on this computer…
                      </p>
                    ) : m.transcriptStatus === 'unavailable' ? (
                      <p className="text-sm text-muted-foreground">Speech-to-text isn’t installed yet — install it in Settings → Transcription.</p>
                    ) : m.transcriptStatus === 'error' ? (
                      <p className="text-sm text-destructive">Transcription failed. Try again.</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">No audio track.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
      <VocalOnlyDialog
        open={confirmNasheed}
        onCancel={() => setConfirmNasheed(false)}
        onConfirm={() => {
          setConfirmNasheed(false);
          void patch({ assetType: 'nasheed' });
        }}
      />
    </Dialog>
  );
}
