// Comments the creator pins to moments of a finished video for Claude to fix ("0:07 cut this pause", "0:12–0:18 the
// arrow covers his face"). Times are seconds into the render they were left on (`version` is its edit version).

export const NOTE_STATUSES = ['open', 'fixed', 'done'] as const;
/** `fixed`: Claude changed the edit for it (with a reply). `done`: the creator closed it. */
export type NoteStatus = (typeof NOTE_STATUSES)[number];

export type VideoNote = {
  id: string;
  pieceId: string;
  /** The render it was left on (null once that file is gone). */
  mediaId: string | null;
  version: number | null;
  at: number;
  /** Set for a stretch ("from 0:12 to 0:18"). */
  end: number | null;
  text: string;
  status: NoteStatus;
  /** What Claude changed for it. */
  reply: string;
  createdAt: number;
  resolvedAt: number | null;
};

export const NOTE_MAX = 1000;
