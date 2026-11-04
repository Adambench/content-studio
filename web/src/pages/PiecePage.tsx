import { ArrowLeft, CalendarClock, ChevronRight, Clapperboard, Copy, GitBranchPlus, History, Inbox, Lightbulb, MoreHorizontal, Pencil, Save, Sparkles, ThumbsUp, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import type { ReviewClip } from '@shared/clipping';
import { LIMITS, PLATFORM_LABELS, REVIEW_STAGE, type DraftContent, type Platform } from '@shared/types';
import { MediaCard } from '@/components/MediaCard';
import { MediaDialog } from '@/components/MediaDialog';
import { DirectionPanel } from '@/components/package/DirectionPanel';
import { ClipReview } from '@/components/package/ClipReview';
import { StageStepper } from '@/components/package/StageStepper';
import { VideoPanel } from '@/components/package/VideoPanel';
import { NoteList } from '@/components/package/VideoNotes';
import { PiecePosts } from '@/components/publish/PiecePosts';
import { ScheduleDialog } from '@/components/publish/ScheduleDialog';
import { TagInput } from '@/components/TagInput';
import { UploadButton, UploadZone } from '@/components/UploadZone';
import { GenerateButton } from '@/components/GenerateDialog';
import { VersionHistory } from '@/components/VersionHistory';
import { useWorkspaceContext } from '@/components/WorkspaceLayout';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useNativePick, useUpload } from '@/hooks/useUpload';
import { api, errorMessage } from '@/lib/api';
import { onLiveEvent } from '@/lib/live';
import { boardLabel } from '@/lib/nav';
import { copyFixLine } from '@/lib/dashboard';
import { keys, queryClient, useMedia, useNotes, usePackage, usePiece, useYourTurn, useTags } from '@/lib/queries';
import type { Branch, PieceDetail } from '@/lib/types';
import { openClaude } from '@/lib/ui-state';
import { cn } from '@/lib/utils';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export function PiecePage() {
  const { pid = '' } = useParams();
  const { workspace } = useWorkspaceContext();
  const piece = usePiece(pid);
  const navigate = useNavigate();

  if (piece.isError) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">This piece doesn’t exist any more.</p>
          <Button variant="outline" size="sm" onClick={() => navigate(`/w/${workspace.id}/board`)}>
            Back to board
          </Button>
        </div>
      </div>
    );
  }
  if (!piece.data)
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-40 w-full max-w-3xl" />
      </div>
    );
  return <Editor key={piece.data.id} piece={piece.data} />;
}

/** The next thing this video needs, as the header's main button. */
function useNextAction(piece: PieceDetail, summary: ReviewClip | undefined, schedule: () => void) {
  const navigate = useNavigate();
  const notes = useNotes(piece.id);
  const open = (notes.data ?? []).filter((n) => n.status === 'open').length;
  const footage = piece.media.some((m) => m.source !== 'render');
  const done = piece.stage === 'scheduled' || piece.stage === 'posted';
  // The decision card says what's next (approve, wait for Claude, schedule) and holds the buttons.
  if (summary?.render && !done && open) return { label: 'Copy “fix my comments”', icon: Copy, run: copyFixLine };
  if (summary?.render && !done) return { label: 'Approve', icon: ThumbsUp, run: () => document.getElementById('review')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) };
  if (summary?.render && done) return { label: 'Schedule', icon: CalendarClock, run: schedule };
  if (summary?.rendering) return null;
  if (footage) return { label: 'Edit the video', icon: Clapperboard, run: () => navigate(`/w/${piece.workspaceId}/p/${piece.id}/edit`) };
  if (piece.stage === 'idea' || piece.stage === 'script')
    return { label: 'Write it with Claude', icon: Sparkles, run: () => openClaude('Write the hook and script for this video, in my voice.') };
  return { label: 'Add footage', icon: Upload, run: () => document.getElementById('footage')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) };
}

/**
 * A video's package: the video itself, its review (clips), idea and script, captions, footage and posts on one page,
 * with its own Claude chat beside it.
 */
function Editor({ piece }: { piece: PieceDetail }) {
  const { workspace } = useWorkspaceContext();
  const navigate = useNavigate();
  const tags = useTags(workspace.id);
  const summary = usePackage(piece.id);
  const queue = useYourTurn();
  const branch = piece.branches.find((b) => b.id === piece.activeBranchId) ?? piece.branches[0];
  // The player, for the comments beside it to jump to their moment.
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);

  const [title, setTitle] = useState(piece.title);
  useEffect(() => setTitle(piece.title), [piece.title]);

  async function patchPiece(body: Record<string, unknown>) {
    try {
      await api(`/pieces/${piece.id}`, { method: 'PATCH', body });
      queryClient.invalidateQueries({ queryKey: keys.piece(piece.id) });
      queryClient.invalidateQueries({ queryKey: keys.board(workspace.id) });
      queryClient.invalidateQueries({ queryKey: keys.review });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const next = useNextAction(piece, summary.data, () => setScheduling(true));
  const fileCount = piece.media.length;
  // What can wait in the Inbox: footage, not what was made for this video (renders, cuts, voices).
  const footageCount = piece.media.filter((m) => m.source === 'upload' || m.source === 'share').length;
  async function deletePiece(files: 'delete' | 'keep') {
    await api(`/pieces/${piece.id}?files=${files}`, { method: 'DELETE' });
    queryClient.invalidateQueries({ queryKey: keys.board(workspace.id) });
    navigate(`/w/${workspace.id}/board`);
    toast.success(files === 'keep' && footageCount ? 'Deleted; its footage is in the Inbox' : 'Deleted');
  }

  // Videos waiting for my eyes on any page (not the ones with Claude): step through them without going back.
  const reviewing = !!summary.data && (summary.data.stage === REVIEW_STAGE || !!summary.data.render || !!summary.data.rendering);
  const waiting = queue;
  const at = waiting.findIndex((c) => c.pieceId === piece.id);
  const after = at >= 0 ? (waiting[at + 1] ?? waiting[at - 1]) : waiting.find((c) => c.pieceId !== piece.id);
  const openClip = (c: { pieceId: string; workspaceId: string } | undefined) => c && navigate(`/w/${c.workspaceId}/p/${c.pieceId}`);
  const isClip = !!(summary.data?.moment || summary.data?.campaign);

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-2 border-b px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" asChild aria-label={`Back to ${boardLabel(workspace.kind).toLowerCase()}`}>
            <Link to={`/w/${workspace.id}/board`}>
              <ArrowLeft />
            </Link>
          </Button>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== piece.title && patchPiece({ title: title.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1 text-base font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label="Title"
          />
          {next && (
            <Button size="sm" onClick={next.run}>
              <next.icon /> <span className="hidden sm:inline">{next.label}</span>
            </Button>
          )}
          {summary.data?.render && !next && (
            <Button size="sm" variant="outline" onClick={() => setScheduling(true)}>
              <CalendarClock /> <span className="hidden sm:inline">Schedule</span>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => openClaude(isClip ? 'Watch this clip and tell me what would make it stronger before I approve it.' : 'Review this video and suggest what to improve.')}>
                <Sparkles /> Ask Claude to review
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setScheduling(true)}>
                <CalendarClock /> Schedule
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                <Trash2 /> Delete video
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {piece.idea && (
          <Link to={`/w/${piece.idea.workspaceId}/ideas?open=${piece.idea.id}`} className="ml-9 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Lightbulb className="size-3 text-amber-400" />
            {piece.idea.series ? `${piece.idea.series.name} · Episode ${piece.idea.series.episode}` : 'From Ideas'}
            <ChevronRight className="size-3" />
          </Link>
        )}
        <div className="flex items-center gap-2 pl-9">
          <StageStepper stages={workspace.stages} current={piece.stage} onChange={(stage) => patchPiece({ stage })} className="flex-1" />
          {after && (
            <Button size="sm" variant="ghost" className="h-7 shrink-0 text-xs" onClick={() => openClip(after)}>
              Next to watch{waiting.length > (at >= 0 ? 1 : 0) ? ` (${waiting.length - (at >= 0 ? 1 : 0)})` : ''} <ChevronRight />
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-6xl gap-6 p-4 md:p-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-8">
          <div className="lg:sticky lg:top-0 lg:self-start">
            <VideoPanel piece={piece} summary={summary.data} video={video} onVideo={setVideo} />
          </div>
          <div className="min-w-0 space-y-8">
            {reviewing && summary.data && (
              <section id="review" className="scroll-mt-4 rounded-xl border bg-card p-4" aria-label="Review">
                <ClipReview clip={summary.data} piece={piece} onSchedule={() => setScheduling(true)} onDone={() => (after ? openClip(after) : navigate('/today'))} />
              </section>
            )}
            {summary.data?.render && <NoteList pieceId={piece.id} video={video} mediaId={summary.data.render.mediaId} version={summary.data.renderVersion} />}
            {workspace.kind !== 'clipping' && <DirectionPanel piece={piece} />}
            <section className="space-y-3" aria-label="Idea and script">
              <TagInput value={piece.tags} onChange={(t) => patchPiece({ tags: t })} suggestions={tags.data} />
              {branch && <BranchEditor key={branch.id} piece={piece} branch={branch} />}
            </section>
            <AttachedMedia piece={piece} />
            <PiecePosts wid={workspace.id} pieceId={piece.id} onSchedule={() => setScheduling(true)} />
          </div>
        </div>
      </div>
      <ScheduleDialog open={scheduling} onOpenChange={setScheduling} wid={workspace.id} pieceId={piece.id} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{piece.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Its alternatives, versions{fileCount ? `, edit and ${fileCount} file${fileCount === 1 ? '' : 's'}` : ' and edit'} go with it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {footageCount > 0 && (
              <Button variant="outline" onClick={() => deletePiece('keep')}>
                Keep the footage
              </Button>
            )}
            <AlertDialogAction variant="destructive" onClick={() => deletePiece('delete')}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const sameDraft = (a: DraftContent, b: DraftContent) => JSON.stringify(a) === JSON.stringify(b);

function BranchEditor({ piece, branch }: { piece: PieceDetail; branch: Branch }) {
  const [draft, setDraft] = useState<DraftContent>(branch.working);
  const [state, setState] = useState<SaveState>('saved');
  const [remoteChange, setRemoteChange] = useState(false);
  const synced = useRef<DraftContent>(branch.working);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [newAlt, setNewAlt] = useState<{ fromVersionId?: string; name: string } | null>(null);
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);

  // Accept server changes (e.g. Claude wrote a draft) unless I have unsaved edits.
  useEffect(() => {
    if (sameDraft(branch.working, synced.current)) return;
    if (state === 'saved') {
      setDraft(branch.working);
      synced.current = branch.working;
    } else setRemoteChange(true);
  }, [branch.working]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () =>
      onLiveEvent((e) => {
        if (e.type === 'branch' && e.branchId === branch.id && e.by === 'claude') toast('Claude updated this draft', { icon: <Sparkles className="size-4 text-brand" /> });
      }),
    [branch.id],
  );

  const flush = useCallback(
    async (content: DraftContent) => {
      clearTimeout(timer.current);
      if (sameDraft(content, synced.current)) return setState('saved');
      setState('saving');
      try {
        await api(`/branches/${branch.id}/working`, { method: 'PUT', body: { content } });
        synced.current = content;
        setState((s) => (s === 'saving' ? 'saved' : s));
      } catch {
        setState('error');
      }
    },
    [branch.id],
  );

  const latest = useRef(draft);
  latest.current = draft;
  // Save what's pending when leaving the page or switching alternatives.
  useEffect(() => () => void flush(latest.current), [flush]);

  function update(fn: (d: DraftContent) => DraftContent) {
    setDraft((d) => {
      const next = fn(structuredClone(d));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(next), 800);
      return next;
    });
    setState('dirty');
  }

  async function saveVersion(message?: string) {
    clearTimeout(timer.current);
    setState('saving');
    try {
      const r = await api<{ number: number; unchanged: boolean }>(`/branches/${branch.id}/versions`, { body: { message: message || undefined, content: draft } });
      synced.current = draft;
      setState('saved');
      setRemoteChange(false);
      toast.success(r.unchanged ? 'No changes since the last version' : `Saved v${r.number}`);
      queryClient.invalidateQueries({ queryKey: keys.piece(piece.id) });
    } catch (err) {
      setState('error');
      toast.error(errorMessage(err));
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveVersion();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function switchBranch(id: string) {
    await flush(latest.current);
    await api(`/pieces/${piece.id}`, { method: 'PATCH', body: { activeBranchId: id } });
    queryClient.invalidateQueries({ queryKey: keys.piece(piece.id) });
  }

  async function createAlternative() {
    if (!newAlt?.name.trim()) return;
    await flush(latest.current);
    try {
      await api(`/pieces/${piece.id}/branches`, { body: { name: newAlt.name.trim(), fromBranchId: newAlt.fromVersionId ? undefined : branch.id, fromVersionId: newAlt.fromVersionId } });
      setNewAlt(null);
      setHistoryOpen(false);
      queryClient.invalidateQueries({ queryKey: keys.piece(piece.id) });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const [renaming, setRenaming] = useState<{ branch: Branch; name: string } | null>(null);
  const [deleting, setDeleting] = useState<Branch | null>(null);

  async function renameBranch() {
    if (!renaming) return;
    const name = renaming.name.trim();
    setRenaming(null);
    if (!name || name === renaming.branch.name) return;
    await api(`/branches/${renaming.branch.id}`, { method: 'PATCH', body: { name } }).catch((err) => toast.error(errorMessage(err)));
    queryClient.invalidateQueries({ queryKey: keys.piece(piece.id) });
  }

  async function deleteBranch() {
    if (!deleting) return;
    await api(`/branches/${deleting.id}`, { method: 'DELETE' }).catch((err) => toast.error(errorMessage(err)));
    setDeleting(null);
    queryClient.invalidateQueries({ queryKey: keys.piece(piece.id) });
  }

  const setPlatform = <P extends Platform>(p: P, field: keyof DraftContent['platforms'][P], value: string) =>
    update((d) => {
      (d.platforms[p] as Record<string, string>)[field as string] = value;
      return d;
    });

  return (
    <div className="space-y-6">
      {/* Alternatives + save controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist" aria-label="Alternatives">
          {piece.branches.map((b) => (
            <div key={b.id} className={cn('group flex shrink-0 items-center rounded-md', b.id === branch.id ? 'bg-secondary' : 'hover:bg-accent/60')}>
              <button type="button" role="tab" aria-selected={b.id === branch.id} onClick={() => b.id !== branch.id && switchBranch(b.id)} className="h-7 px-2.5 text-sm">
                {b.name}
              </button>
              {b.id === branch.id && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="pr-1.5 text-muted-foreground hover:text-foreground" aria-label={`${b.name} options`}>
                      <MoreHorizontal className="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => setRenaming({ branch: b, name: b.name })}>
                      <Pencil /> Rename
                    </DropdownMenuItem>
                    {piece.branches.length > 1 && (
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(b)}>
                        <Trash2 /> Delete alternative
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
          <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={() => setNewAlt({ name: '' })}>
            <GitBranchPlus /> Alternative
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <SaveIndicator state={state} />
          <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
            <History /> <span className="hidden sm:inline">History</span>
            {branch.versions.length > 0 && <span className="text-muted-foreground tabular-nums">{branch.versions.length}</span>}
          </Button>
          <Popover open={noteOpen} onOpenChange={setNoteOpen}>
            <PopoverTrigger asChild>
              <Button size="sm">
                <Save /> Save version
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-2">
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveVersion(note);
                  setNote('');
                  setNoteOpen(false);
                }}
              >
                <Label htmlFor="version-note" className="text-xs">
                  What changed? <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input id="version-note" autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Shorter hook" />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    <Kbd>Ctrl</Kbd> <Kbd>S</Kbd> saves without a note
                  </span>
                  <Button type="submit" size="sm">
                    Save
                  </Button>
                </div>
              </form>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {remoteChange && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2 text-sm">
          <Sparkles className="size-4 text-brand" />
          <span className="mr-auto">This draft changed elsewhere (probably Claude) while you were typing.</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setDraft(branch.working);
              synced.current = branch.working;
              setState('saved');
              setRemoteChange(false);
            }}
          >
            Load latest
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRemoteChange(false)}>
            Keep mine
          </Button>
        </div>
      )}

      <Field label="Hook" hint="The first 1–2 seconds">
        <Textarea value={draft.hook} onChange={(e) => update((d) => ({ ...d, hook: e.target.value }))} rows={1} placeholder="What stops the scroll?" className="min-h-10 text-base font-medium md:text-base" />
      </Field>

      <Field label="Script">
        <Textarea value={draft.script} onChange={(e) => update((d) => ({ ...d, script: e.target.value }))} placeholder="Beats, lines, on-screen text…" className="min-h-48 leading-relaxed" />
      </Field>

      <Field label="Production notes">
        <Textarea value={draft.notes} onChange={(e) => update((d) => ({ ...d, notes: e.target.value }))} placeholder="Shots, locations, b-roll, props" className="min-h-20" />
      </Field>

      <section id="platform-copy" className="scroll-mt-4 space-y-2" aria-label="Captions">
        <h2 className="text-sm font-medium">Captions</h2>
        <Tabs defaultValue="tiktok">
          <TabsList className="w-full justify-start overflow-x-auto [scrollbar-width:none]">
            {(['tiktok', 'instagram', 'youtube', 'x'] as const).map((p) => (
              <TabsTrigger key={p} value={p} className="flex-none">
                {PLATFORM_LABELS[p]}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="tiktok" className="space-y-3 pt-2">
            <Counted label="Caption" value={draft.platforms.tiktok.caption} limit={LIMITS.tiktokCaption} onChange={(v) => setPlatform('tiktok', 'caption', v)} rows={4} />
            <Counted label="Hashtags" value={draft.platforms.tiktok.hashtags} onChange={(v) => setPlatform('tiktok', 'hashtags', v)} single />
          </TabsContent>
          <TabsContent value="instagram" className="space-y-3 pt-2">
            <Counted label="Caption" value={draft.platforms.instagram.caption} limit={LIMITS.instagramCaption} onChange={(v) => setPlatform('instagram', 'caption', v)} rows={4} />
            <Counted label="Hashtags" value={draft.platforms.instagram.hashtags} onChange={(v) => setPlatform('instagram', 'hashtags', v)} single />
          </TabsContent>
          <TabsContent value="youtube" className="space-y-3 pt-2">
            <Counted label="Title" value={draft.platforms.youtube.title} limit={LIMITS.youtubeTitle} onChange={(v) => setPlatform('youtube', 'title', v)} single />
            <Counted label="Description" value={draft.platforms.youtube.description} limit={LIMITS.youtubeDescription} onChange={(v) => setPlatform('youtube', 'description', v)} rows={4} />
            <Counted label="Tags" value={draft.platforms.youtube.tags} onChange={(v) => setPlatform('youtube', 'tags', v)} single />
          </TabsContent>
          <TabsContent value="x" className="space-y-3 pt-2">
            <Counted label="Post" value={draft.platforms.x.text} limit={LIMITS.xText} onChange={(v) => setPlatform('x', 'text', v)} rows={3} />
          </TabsContent>
        </Tabs>
      </section>

      <VersionHistory
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        branch={branch}
        current={draft}
        onRestored={() => {
          setState('saved');
          queryClient.invalidateQueries({ queryKey: keys.piece(piece.id) });
        }}
        onBranch={(versionId, number) => setNewAlt({ fromVersionId: versionId, name: `From v${number}` })}
      />

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void renameBranch();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>Rename alternative</DialogTitle>
              <DialogDescription className="sr-only">Give this alternative a new name</DialogDescription>
            </DialogHeader>
            <Input autoFocus value={renaming?.name ?? ''} onChange={(e) => setRenaming((r) => r && { ...r, name: e.target.value })} aria-label="Name" />
            <DialogFooter>
              <Button type="submit" disabled={!renaming?.name.trim()}>
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>This alternative and its version history are deleted. Other alternatives aren’t affected.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={deleteBranch}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!newAlt} onOpenChange={(o) => !o && setNewAlt(null)}>
        <DialogContent className="sm:max-w-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createAlternative();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>New alternative</DialogTitle>
              <DialogDescription>{newAlt?.fromVersionId ? 'Starts from the selected version.' : `Starts as a copy of “${branch.name}”.`} Try a different hook or angle without losing this one.</DialogDescription>
            </DialogHeader>
            <Input autoFocus value={newAlt?.name ?? ''} onChange={(e) => setNewAlt((a) => a && { ...a, name: e.target.value })} placeholder="e.g. Story hook" aria-label="Name" />
            <DialogFooter>
              <Button type="submit" disabled={!newAlt?.name.trim()}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const text = { saved: 'Draft saved', dirty: 'Editing…', saving: 'Saving…', error: 'Couldn’t save' }[state];
  return (
    <span className={cn('hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex', state === 'error' && 'text-destructive')} aria-live="polite">
      {state === 'saving' && <Spinner className="size-3" />}
      {text}
    </span>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <Label className="text-sm font-medium">{label}</Label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Counted({ label, value, onChange, limit, rows = 2, single }: { label: string; value: string; onChange: (v: string) => void; limit?: number; rows?: number; single?: boolean }) {
  const over = limit !== undefined && value.length > limit;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        {limit !== undefined && <span className={cn('text-xs text-muted-foreground tabular-nums', over && 'text-destructive')}>{value.length}/{limit}</span>}
      </div>
      {single ? (
        <Input value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={over || undefined} aria-label={label} />
      ) : (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} aria-invalid={over || undefined} aria-label={label} />
      )}
    </div>
  );
}

function AttachedMedia({ piece }: { piece: PieceDetail }) {
  const { workspace } = useWorkspaceContext();
  const upload = useUpload(workspace.id, { pieceId: piece.id });
  const pick = useNativePick(workspace.id, { pieceId: piece.id });
  const [openId, setOpenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const footage = piece.media.filter((m) => m.source !== 'render');
  const videos = piece.media.filter((m) => m.source === 'render').reverse();

  return (
    <UploadZone onFiles={upload} accept="video/*,image/*,audio/*" className="space-y-8 pb-10">
      {videos.length > 0 && (
        <section className="space-y-3" aria-label="Finished videos">
          <div className="flex items-center gap-2">
            <h2 className="mr-auto text-sm font-medium">
              Finished videos <span className="text-muted-foreground tabular-nums">{videos.length}</span>
            </h2>
            <Button size="sm" variant="ghost" asChild>
              <Link to={`/w/${workspace.id}/p/${piece.id}/edit`}>
                <Clapperboard /> Video editor
              </Link>
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
            {videos.map((m) => (
              <MediaCard key={m.id} media={m} onClick={() => setOpenId(m.id)} />
            ))}
          </div>
        </section>
      )}
      <section id="footage" className="scroll-mt-4 space-y-3" aria-label="Footage">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="mr-auto text-sm font-medium whitespace-nowrap">
            Footage <span className="text-muted-foreground tabular-nums">{footage.length || ''}</span>
          </h2>
          <GenerateButton wid={workspace.id} pieceId={piece.id} />
          <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>
            <Inbox /> From Inbox
          </Button>
          <UploadButton onFiles={upload} onPick={pick} accept="video/*,image/*,audio/*" variant="outline" />
        </div>
        {footage.length ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
            {footage.map((m) => (
              <MediaCard key={m.id} media={m} onClick={() => setOpenId(m.id)} />
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Drop what you filmed for this video here. Claude can watch it and help with hooks and captions, then cut it together in the video editor.</p>
        )}
      </section>
      <MediaDialog wid={workspace.id} mediaId={openId} onClose={() => setOpenId(null)} />
      <InboxPicker open={picking} onOpenChange={setPicking} wid={workspace.id} pieceId={piece.id} />
    </UploadZone>
  );
}

function InboxPicker({ open, onOpenChange, wid, pieceId }: { open: boolean; onOpenChange: (o: boolean) => void; wid: string; pieceId: string }) {
  const media = useMedia(wid, { scope: 'inbox' });
  const [selected, setSelected] = useState<string[]>([]);
  const available = media.data ?? [];

  async function attach() {
    await Promise.all(selected.map((id) => api(`/media/${id}`, { method: 'PATCH', body: { pieceId } })));
    setSelected([]);
    onOpenChange(false);
    queryClient.invalidateQueries({ queryKey: keys.piece(pieceId) });
    queryClient.invalidateQueries({ queryKey: ['media', wid] });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add from the Inbox</DialogTitle>
          <DialogDescription>Files that aren’t in a video yet. To use one from another video, search for it (Ctrl K).</DialogDescription>
        </DialogHeader>
        <div className="max-h-[55dvh] overflow-y-auto">
          {available.length ? (
            <div className="grid grid-cols-3 gap-3 p-1 sm:grid-cols-4">
              {available.map((m) => (
                <MediaCard key={m.id} media={m} selected={selected.includes(m.id)} onClick={() => setSelected((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id]))} />
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">The Inbox is empty.</p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={attach} disabled={!selected.length}>
            Add {selected.length || ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
