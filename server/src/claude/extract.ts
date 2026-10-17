import { SITES, type PageRead } from '../../../shared/sites';
import { HttpError } from '../lib/http';
import { askStructured } from './oneshot';

const MAX_TEXT = 40_000;
const MAX_LINKS = 150;

const SYSTEM = [
  'You read a web page as plain text (what a browser shows, without the layout), followed by its links, and pull out what you are asked for as JSON.',
  'Use only what the page says. Never guess or fill gaps from general knowledge: when the page does not say something, leave that field empty (an empty string, null or an empty list).',
  'Copy rules, requirements and numbers faithfully; keep short rules in the page’s own words. Give links as their full URLs from the list.',
  'Menus, footers, cookie banners and other site chrome are not part of the content.',
].join('\n');

/** The page as text for a prompt: title, address, visible text (trimmed), then its links. */
export function pageForPrompt(page: PageRead) {
  const text = page.text.length > MAX_TEXT ? `${page.text.slice(0, MAX_TEXT)}\n[… the rest of the page is cut]` : page.text;
  const links = page.links
    .filter((l) => l.text)
    .slice(0, MAX_LINKS)
    .map((l) => `- ${l.text} — ${l.href}`)
    .join('\n');
  return `Title: ${page.title}\nAddress: ${page.url}\n\n## Text\n${text}\n\n## Links\n${links || '(none)'}`;
}

/**
 * Turn a page read through the desktop bridge (`readPage`) into JSON matching `schema`. Reading the text instead of
 * the page's markup survives layout changes, at the cost of one Haiku call per page — a few a day.
 * `what` says what to extract; `system` adds context that comes before the page (e.g. playbook rules), kept the same
 * between calls so it caches.
 */
export function parsePage<T>(page: PageRead, input: { what: string; schema: Record<string, unknown>; system?: string; model?: string }): Promise<T> {
  if (page.loginWall) throw new HttpError(409, `Sign in to ${SITES[page.loginWall].label} first (Settings → Connected sites).`);
  return askStructured<T>({
    task: 'pages',
    system: [input.system, SYSTEM].filter(Boolean).join('\n\n'),
    prompt: `${input.what}\n\n---\n\n${pageForPrompt(page)}`,
    schema: input.schema,
    model: input.model ?? 'haiku',
  });
}
