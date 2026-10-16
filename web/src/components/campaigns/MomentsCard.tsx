import { Clapperboard, Loader2, RotateCcw, SkipForward } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { CampaignDetail } from '@shared/campaigns';
import { MOMENT_KIND_LABELS, MOMENT_STATUS_LABELS, clock, type Moment } from '@shared/clipping';
import { REVIEW_STAGE } from '@shared/types';
import { WorkspaceDot } from '@/components/WorkspaceDot';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient } from '@/lib/queries';
import type { Workspace } from '@/lib/types';
import { cn } from '@/lib/utils';

const save = (c: CampaignDetail) => queryClient.setQueryData(keys.campaign(c.id), c);

/** A hook card's *accent* word, bold here as it's coloured on screen. */
function HookCard({ text }: { text: string }) {
  return (
    <span>
      {text.split(/(\*[^*]+\*)/).map((part, i) =>
        part.startsWith('*') && part.endsWith('*') ? (
          <strong key={i} className="text-brand">
            {part.slice(1, -1)}
          </strong>
        ) : (
          part
        ),
      )}
    </span>
  );
}

/** Where a made clip is now, by its card's column. */
const CLIP_STAGE_LABELS: Record<string, string> = { making: 'Rendering', [REVIEW_STAGE]: 'In review', ready: 'Approved', scheduled: 'Scheduled', posted: 'Posted' };

const STATUS_TONE: Partial<Record<Moment['status'], string>> = {
  made: 'text-emerald-400',
  rejected: 'text-muted-foreground',
  dropped: 'text-amber-400',
  failed: 'text-destructive',
};

function MomentRow({ m, link, page, active }: { m: Moment; link: string | null; page: Workspace | undefined; active: boolean }) {
  const [busy, setBusy] = useState(false);
  const at = `${clock(m.start)}–${clock(m.end)}`;
  const href = link && /youtube\.com\/watch/.test(link) ? `${link}&t=${Math.floor(m.start)}s` : link;
  const clipHref = m.pieceId ? (m.pieceStage === REVIEW_STAGE ? `/review?piece=${m.pieceId}` : `/w/${m.workspaceId}/p/${m.pieceId}`) : null;
  const canMake = active && (m.status === 'candidate' || m.status === 'failed' || m.status === 'dropped' || m.status === 'rejected' || (m.status === 'made' && !m.pieceId));

  async function act(path: string) {
    setBusy(true);
    try {
      save(await api<CampaignDetail>(path, { body: {} }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const note =
    m.status === 'rejected'
      ? m.rejectReason && `Rejected: ${m.rejectReason}`
      : m.status === 'made' && !m.pieceId
        ? 'Its card was deleted.'
        : m.detail;

  return (
    <li className="space-y-1 p-3">
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-medium">{m.title || m.firstLine.slice(0, 80)}</p>
          {m.hookCard && (
            <p className="text-xs">
              <span className="text-muted-foreground">Hook card: </span>
              <HookCard text={m.hookCard} />
            </p>
          )}
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" className="tabular-nums hover:text-foreground hover:underline">
                {at}
              </a>
            ) : (
              <span className="tabular-nums">{at}</span>
            )}
            <span>
              {MOMENT_KIND_LABELS[m.kind]} · {m.score}/10
            </span>
            {page && (
              <span className="inline-flex items-center gap-1">
                <WorkspaceDot color={page.color} className="size-2" /> {page.name}
              </span>
            )}
          </p>
          {m.why && <p className="text-xs text-muted-foreground">{m.why}</p>}
          {note && <p className={cn('text-xs', m.status === 'failed' ? 'text-destructive' : m.status === 'dropped' ? 'text-amber-400' : 'text-muted-foreground')}>{note}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge variant="secondary" className={cn('gap-1', STATUS_TONE[m.status])}>
            {(m.status === 'making' || (m.status === 'made' && m.pieceStage === 'making')) && <Loader2 className="animate-spin" />}
            {(m.status === 'made' && m.pieceStage && CLIP_STAGE_LABELS[m.pieceStage]) || MOMENT_STATUS_LABELS[m.status]}
          </Badge>
          <div className="flex items-center gap-1">
            {clipHref && (
              <Button size="sm" variant="outline" asChild>
                <Link to={clipHref}>
                  <Clapperboard /> {m.pieceStage === REVIEW_STAGE ? 'Review' : 'Open'}
                </Link>
              </Button>
            )}
            {canMake && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => act(`/moments/${m.id}/make`)}>
                {busy ? <Spinner /> : <RotateCcw />} {m.status === 'candidate' ? 'Make clip' : 'Make again'}
              </Button>
            )}
            {m.status === 'candidate' && (
              <Button size="icon-sm" variant="ghost" disabled={busy} aria-label="Skip this moment" onClick={() => act(`/moments/${m.id}/skip`)}>
                <SkipForward />
              </Button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * The moments Claude picked in each source, and what became of them: made into a clip (in Review or further on the
 * board), dropped by the checks, rejected by me (with the reason the next pick reads).
 */
export function MomentsCard({ campaign, workspaces }: { campaign: CampaignDetail; workspaces: Workspace[] }) {
  if (!campaign.moments.length) return null;
  const bySource = campaign.sources.map((s) => ({ s, moments: campaign.moments.filter((m) => m.sourceId === s.id) })).filter((g) => g.moments.length);
  const made = campaign.moments.filter((m) => m.status === 'made' && m.pieceId).length;
  const multiPage = campaign.pageIds.length > 1;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Moments</CardTitle>
        <CardDescription>
          Claude picks them from each source by the playbook and the rules. Each is cut, cleaned of any music, checked and edited into a clip that waits in Review for you. {made} of {campaign.moments.length} made.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {bySource.map(({ s, moments }) => (
          <div key={s.id} className="space-y-1.5">
            <p className="truncate text-xs font-medium text-muted-foreground">{s.title || 'Upload'}</p>
            <ul className="divide-y rounded-lg border">
              {moments.map((m) => (
                <MomentRow key={m.id} m={m} link={s.link} page={multiPage ? workspaces.find((w) => w.id === m.workspaceId) : undefined} active={campaign.status === 'active'} />
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
