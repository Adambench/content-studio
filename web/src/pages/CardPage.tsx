import { ArrowLeftIcon, CheckIcon, MoreHorizontalIcon, PenLineIcon, PlayIcon, SparklesIcon, WrenchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Doc } from '@/components/card/Doc';
import { Files, useUploader } from '@/components/card/Files';
import { pickRender, Review } from '@/components/card/Review';
import { Versions } from '@/components/card/Versions';
import { PageDot } from '@/components/PageDot';
import { api } from '@/lib/api';
import { keys, queryClient, useCard, useCardAction, usePages, useUpdateCard } from '@/lib/queries';
import { usePhone } from '@/lib/usePhone';
import { RECIPES } from '@shared/recipes';
import { BOARD_STAGES, STAGE_LABEL, type Card, type CardDetail, type Job, type Stage } from '@shared/types';

function Title({ card }: { card: Card }) {
  const update = useUpdateCard(card.id);
  const [value, setValue] = useState(card.title);
  useEffect(() => setValue(card.title), [card.title]);
  const save = () => value.trim() && value.trim() !== card.title && update.mutate({ title: value.trim() });
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
    />
  );
}

function ActiveJob({ job }: { job: Job }) {
  const cancel = async () => {
    await api(`/api/jobs/${job.id}/cancel`, { body: {} });
    void queryClient.invalidateQueries({ queryKey: ['card'] });
  };
  const label: Record<string, string> = { make: 'Making', fix: 'Fixing', write: 'Writing', hooks: 'Hooks', look: 'Looking at a file', 'test-render': 'Test render' };
  const last = job.log[job.log.length - 1];
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm">
      <Spinner className="size-4 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate">
          {label[job.kind] ?? job.kind}
          {job.status === 'running' && job.step ? ` · ${job.step}` : job.status === 'waiting' ? ' · waiting' : job.status === 'queued' ? ' · queued' : ''}
          {job.status === 'running' && job.progress > 0.01 ? ` · ${Math.round(job.progress * 100)} %` : ''}
        </div>
        {(job.status === 'waiting' ? job.error : last?.text) && <div className="truncate text-xs text-muted-foreground">{job.status === 'waiting' ? job.error : last?.text}</div>}
      </div>
      <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => void cancel()}>
        Cancel
      </Button>
    </div>
  );
}

function LastFailure({ detail }: { detail: CardDetail }) {
  const job = detail.jobs[0];
  if (!job || job.status !== 'failed' || Date.now() - (job.finishedAt ?? 0) > 6 * 3600_000) return null;
  return <div className="rounded-lg border border-destructive/30 px-3 py-2 text-sm text-destructive">{job.kind === 'make' ? 'Make' : job.kind} failed: {job.error}</div>;
}

function Buttons({ detail }: { detail: CardDetail }) {
  const { card } = detail;
  const act = useCardAction(card.id);
  const busy = detail.jobs.some((j) => ['queued', 'waiting', 'running'].includes(j.status));
  const hasRender = detail.renders.some((r) => r.status === 'done');
  const run = (action: 'write' | 'hooks' | 'make' | 'fix' | 'approve') =>
    act.mutate({ action }, { onSuccess: () => action === 'approve' && toast('Approved: in Ready') });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => run('write')} title="Claude drafts the script from the notes">
        <PenLineIcon /> Write
      </Button>
      <Button variant="ghost" size="sm" disabled={busy || !card.script.trim()} onClick={() => run('hooks')} title="Other first lines">
        <SparklesIcon /> Hooks
      </Button>
      <Button size="sm" disabled={busy} onClick={() => run('make')}>
        <PlayIcon /> Make
      </Button>
      {card.openComments > 0 && (
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => run('fix')}>
          <WrenchIcon /> Fix {card.openComments}
        </Button>
      )}
      {hasRender && card.stage !== 'ready' && card.stage !== 'posted' && (
        <Button variant="secondary" size="sm" disabled={busy || card.openComments > 0} onClick={() => run('approve')} title={card.openComments ? 'Comments still open' : 'Ready to post'}>
          <CheckIcon /> Approve
        </Button>
      )}
    </div>
  );
}

function Menu({ card }: { card: Card }) {
  const navigate = useNavigate();
  const act = useCardAction(card.id);
  const trash = async () => {
    await api(`/api/cards/${card.id}`, { method: 'DELETE' });
    void queryClient.invalidateQueries({ queryKey: ['board'] });
    toast('Moved to trash', { action: { label: 'Undo', onClick: () => void api(`/api/cards/${card.id}`, { method: 'PATCH', body: { stage: card.stage } }).then(() => queryClient.invalidateQueries({ queryKey: ['board'] })) } });
    navigate(-1);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="More">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => act.mutate({ action: 'test-render', body: { seconds: 10 } })}>Test render (10 s)</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => void trash()}>
          Move to trash
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Selects({ card }: { card: Card }) {
  const pages = usePages().data ?? [];
  const update = useUpdateCard(card.id);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select value={card.pageId} onValueChange={(pageId) => update.mutate({ pageId })}>
        <SelectTrigger size="sm" className="border-none bg-transparent text-muted-foreground shadow-none hover:text-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {pages.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              <PageDot color={p.color} /> {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={card.recipe} onValueChange={(recipe) => update.mutate({ recipe })}>
        <SelectTrigger size="sm" className="border-none bg-transparent text-muted-foreground shadow-none hover:text-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RECIPES.map((r) => (
            <SelectItem key={r.id} value={r.id} title={r.about}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={card.stage} onValueChange={(stage) => update.mutate({ stage: stage as Stage })}>
        <SelectTrigger size="sm" className="border-none bg-transparent text-muted-foreground shadow-none hover:text-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[...BOARD_STAGES, 'trash' as const].map((s) => (
            <SelectItem key={s} value={s}>
              {STAGE_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function CardPage() {
  const { cardId } = useParams();
  const phone = usePhone();
  const navigate = useNavigate();
  const query = useCard(cardId!);
  const uploader = useUploader(cardId!);
  const [picked, setPicked] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  // A new render replaces the one I was looking at, unless I picked an older one on purpose.
  const newest = query.data?.renders[0]?.id;
  useEffect(() => setPicked(null), [newest]);

  if (query.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (query.error || !query.data) return <div className="p-6 text-sm text-muted-foreground">{query.error instanceof Error ? query.error.message : 'Not found'}</div>;

  const detail = query.data;
  const { card } = detail;
  const render = pickRender(detail, picked);
  const active = detail.jobs.find((j) => ['queued', 'waiting', 'running'].includes(j.status));

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    if (e.dataTransfer.files.length) void uploader.send([...e.dataTransfer.files]);
  };

  const left = (
    <div className="flex flex-col gap-8">
      <Doc card={card} hooks={detail.hooks} />
      <Files cardId={card.id} pageId={card.pageId} inputs={detail.inputs} uploader={uploader} />
    </div>
  );
  const right = (
    <div className="flex flex-col gap-6">
      <Review detail={detail} render={render} />
      <Versions detail={detail} current={render} onPick={setPicked} />
    </div>
  );

  return (
    <div
      className={`h-full overflow-y-auto ${dropping ? 'bg-accent/30' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
      onDrop={onDrop}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:p-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => navigate(-1)} className="text-muted-foreground">
            <ArrowLeftIcon />
          </Button>
          <Title card={card} />
          <Menu card={card} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Selects card={card} />
          <Buttons detail={detail} />
        </div>
        {active && <ActiveJob job={active} />}
        {!active && <LastFailure detail={detail} />}
        {phone ? (
          <div className="flex flex-col gap-8">
            {render && right}
            {left}
            {!render && right}
          </div>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,420px)] gap-10">
            {left}
            {right}
          </div>
        )}
      </div>
    </div>
  );
}

export const cardQueryKey = keys.card;
