import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router';
import { BOARD_COLUMNS, VIDEO_COLUMNS } from '@shared/board';
import { Board } from '@/components/board/Board';
import { BoardList } from '@/components/board/BoardList';
import { CampaignLinks } from '@/components/CampaignLinks';
import { Spinner } from '@/components/ui/spinner';
import { usePhone } from '@/hooks/useMediaQuery';
import { lastSection, pagePath, sectionsFor, writes, type SectionId } from '@/lib/nav';
import { useBoardData } from '@/lib/queries';
import { useStore } from '@/lib/ui-state';
import { PageCalendar } from './CalendarPage';
import { SeriesList } from './SeriesPage';

/** Waiting for the board, or (on the phone, with no copy of it yet) the computer. */
function Loading({ board }: { board: ReturnType<typeof useBoardData> }) {
  return <div className="grid flex-1 place-items-center text-muted-foreground">{board.isError || board.isPaused ? 'Can’t reach your computer' : <Spinner />}</div>;
}

/** Home: every page's board in one, nothing else (on the phone as one list). */
export function HomePage() {
  const board = useBoardData();
  const Cards = usePhone() ? BoardList : Board;
  if (!board.data) return <Loading board={board} />;
  const shown = board.data.pages.filter((p) => !p.hidden);
  const writer = shown.find((p) => writes(p.kind));
  return <Cards items={board.data.items} columns={BOARD_COLUMNS} pages={board.data.pages} addTo={writer?.id} />;
}

/** A page's section: its Videos board (idea to posted) or Clips board (a list on the phone), its series, its campaign links, or its calendar. */
export function SectionPage() {
  const { wid = '', section } = useParams();
  const board = useBoardData();
  const Cards = usePhone() ? BoardList : Board;
  const last = useStore(lastSection);
  const page = board.data?.pages.find((p) => p.id === wid);
  const sections = page ? sectionsFor(page.kind) : [];
  const here = sections.find((s) => s.id === section);
  useEffect(() => {
    if (here && lastSection.get()[wid] !== here.id) lastSection.set((l) => ({ ...l, [wid]: here.id }));
  }, [wid, here]);

  if (!board.data) return <Loading board={board} />;
  if (!page) return <Navigate to="/" replace />;
  if (!here) {
    const back: SectionId = sections.some((s) => s.id === last[wid]) ? last[wid] : sections[0].id;
    return <Navigate to={pagePath(wid, back)} replace />;
  }
  const items = board.data.items.filter((i) => i.workspaceId === wid);
  switch (here.id) {
    case 'videos':
      return <Cards items={items} columns={BOARD_COLUMNS} pages={board.data.pages} addTo={wid} />;
    case 'series':
      return <SeriesList wid={wid} />;
    case 'clips':
      return <Cards items={items} columns={VIDEO_COLUMNS} pages={board.data.pages} />;
    case 'campaigns':
      return <CampaignLinks wid={wid} />;
    case 'calendar':
      return <PageCalendar wid={wid} />;
  }
}
