import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router';
import { BOARD_COLUMNS, VIDEO_COLUMNS, WRITING_COLUMNS } from '@shared/board';
import { Board } from '@/components/board/Board';
import { CampaignLinks } from '@/components/CampaignLinks';
import { Spinner } from '@/components/ui/spinner';
import { lastSection, pagePath, sectionsFor, writes, type SectionId } from '@/lib/nav';
import { useBoardData } from '@/lib/queries';
import { useStore } from '@/lib/ui-state';
import { PageCalendar } from './CalendarPage';

function Loading() {
  return (
    <div className="grid flex-1 place-items-center">
      <Spinner />
    </div>
  );
}

/** Home: every page's board in one, nothing else. */
export function HomePage() {
  const board = useBoardData();
  if (!board.data) return <Loading />;
  const shown = board.data.pages.filter((p) => !p.hidden);
  const writer = shown.find((p) => writes(p.kind));
  return <Board items={board.data.items} columns={BOARD_COLUMNS} pages={board.data.pages} addTo={writer?.id} />;
}

/** A page's section: its Ideas or Videos/Clips board, its campaign links, or its calendar. */
export function SectionPage() {
  const { wid = '', section } = useParams();
  const board = useBoardData();
  const last = useStore(lastSection);
  const page = board.data?.pages.find((p) => p.id === wid);
  const sections = page ? sectionsFor(page.kind) : [];
  const here = sections.find((s) => s.id === section);
  useEffect(() => {
    if (here && lastSection.get()[wid] !== here.id) lastSection.set((l) => ({ ...l, [wid]: here.id }));
  }, [wid, here]);

  if (!board.data) return <Loading />;
  if (!page) return <Navigate to="/" replace />;
  if (!here) {
    const back: SectionId = sections.some((s) => s.id === last[wid]) ? last[wid] : sections[0].id;
    return <Navigate to={pagePath(wid, back)} replace />;
  }
  const items = board.data.items.filter((i) => i.workspaceId === wid);
  switch (here.id) {
    case 'ideas':
      return <Board items={items} columns={WRITING_COLUMNS} pages={board.data.pages} addTo={wid} />;
    case 'videos':
    case 'clips':
      return <Board items={items} columns={VIDEO_COLUMNS} pages={board.data.pages} />;
    case 'campaigns':
      return <CampaignLinks wid={wid} />;
    case 'calendar':
      return <PageCalendar wid={wid} />;
  }
}
