// Notes: a page's free writing (personal and business pages). No cards and no structure, unlike Ideas: brain dumps,
// half-formed thoughts, plans, lists. Each note is just text; its first line is its title. Shared by the server and
// the web app.

export type NotebookNote = { id: string; workspaceId: string; body: string; createdAt: number; updatedAt: number };

export const NOTEBOOK_MAX = 200_000;

/** A note's title: its first line with words in it (a leading `#` dropped). */
export function noteTitle(body: string) {
  const line = body.split('\n').find((l) => l.trim()) ?? '';
  return line.trim().replace(/^#+\s*/, '').slice(0, 120);
}

/** What comes after the title, flattened, for the list. */
export function noteSnippet(body: string, length = 140) {
  const lines = body.split('\n');
  const first = lines.findIndex((l) => l.trim());
  return lines
    .slice(first + 1)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, length);
}

export const wordCount = (body: string) => body.split(/\s+/).filter(Boolean).length;
