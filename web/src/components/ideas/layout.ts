// Where every card sits on the canvas: a tree growing to the right, each card centred on its children, so nothing is
// ever placed by hand. Only a few levels below the card being looked at show; deeper levels, collapsed cards and long
// lists fold into a count (open the card to see them).
import { SHOWN_CHILDREN, SHOWN_DEPTH, SHOWN_SAVED, type IdeaNode } from '@shared/ideas';
import { childrenOf, type Tree } from './model';

export const CARD_W = 232;
export const ROOT_W = 184;
const COL_GAP = 52;
const GAP = 10;
/** Extra room between branches that have their own children, so groups read as groups. */
const GROUP_GAP = 14;

export type Box =
  | { type: 'root'; id: string; node: IdeaNode | null; x: number; y: number; w: number; h: number; depth: 0 }
  | { type: 'card'; id: string; node: IdeaNode; x: number; y: number; w: number; h: number; depth: number; parentId: string; folded: number }
  | { type: 'more'; id: string; parentId: string; count: number; x: number; y: number; w: number; h: number; depth: number };

export type Edge = { from: string; to: string };

/** Heights before a card has been measured. */
export function estimateHeight(n: IdeaNode) {
  if (n.kind === 'image') return 150;
  if (n.kind === 'link') return 92;
  if (n.kind === 'saved') return 56;
  return n.body ? 62 : 42;
}

export const ROOT_ID = '__root';

type Opts = {
  /** The card being looked at (its children are the first level), or null for the page itself. */
  focus: string | null;
  sizes: Map<string, number>;
  /** With a filter on, only these cards (and the cards above them) show, at any depth. */
  only: Set<string> | null;
};

export function layoutTree(t: Tree, opts: Opts) {
  const boxes: Box[] = [];
  const edges: Edge[] = [];
  const rootId = opts.focus ?? ROOT_ID;
  const heightOf = (id: string, fallback: number) => opts.sizes.get(id) ?? fallback;

  type Item = { kind: 'card'; node: IdeaNode; folded: number; kids: Item[] } | { kind: 'more'; parentId: string; count: number };

  // What shows under a card, depth first.
  const build = (parentId: string | null, depth: number): Item[] => {
    let list = childrenOf(t, parentId);
    if (opts.only) list = list.filter((n) => opts.only!.has(n.id));
    const parent = parentId ? t.byId.get(parentId) : undefined;
    const limit = opts.only ? Infinity : parent?.kind === 'saved' ? SHOWN_SAVED : SHOWN_CHILDREN;
    const shown = list.slice(0, limit);
    const items: Item[] = shown.map((n) => {
      const all = childrenOf(t, n.id).filter((c) => !opts.only || opts.only.has(c.id));
      const open = all.length > 0 && (opts.only ? true : !n.collapsed && depth < SHOWN_DEPTH && n.kind !== 'saved') ;
      // The Saved pile shows its newest few at the top level, like an inbox tray.
      const savedTray = n.kind === 'saved' && depth === 1 && !n.collapsed && all.length > 0;
      const kids = open || savedTray ? build(n.id, depth + 1) : [];
      return { kind: 'card', node: n, folded: kids.length ? 0 : all.length, kids };
    });
    if (list.length > shown.length && parentId) items.push({ kind: 'more', parentId, count: list.length - shown.length });
    return items;
  };

  const top = build(opts.focus, 1);
  const rootNode = opts.focus ? (t.byId.get(opts.focus) ?? null) : null;
  const rootH = heightOf(rootId, rootNode ? estimateHeight(rootNode) : 44);

  const ownH = (it: Item) => (it.kind === 'more' ? 32 : heightOf(it.node.id, estimateHeight(it.node)));
  const heights = new Map<Item, number>();
  const gapBetween = (a: Item, b: Item) => (a.kind === 'card' && a.kids.length) || (b.kind === 'card' && b.kids.length) ? GAP + GROUP_GAP : GAP;
  const blockH = (items: Item[]) => items.reduce((s, it, i) => s + measure(it) + (i ? gapBetween(items[i - 1], it) : 0), 0);
  const measure = (it: Item): number => {
    const cached = heights.get(it);
    if (cached !== undefined) return cached;
    const h = it.kind === 'card' && it.kids.length ? Math.max(ownH(it), blockH(it.kids)) : ownH(it);
    heights.set(it, h);
    return h;
  };
  const colX = (depth: number) => (depth === 0 ? 0 : ROOT_W + COL_GAP + (depth - 1) * (CARD_W + COL_GAP));

  /** Lays out `items` from `top` down; returns the centre line of the block. */
  const place = (items: Item[], depth: number, topY: number, parentId: string) => {
    let y = topY;
    const centres: number[] = [];
    items.forEach((it, i) => {
      if (i) y += gapBetween(items[i - 1], it);
      const h = measure(it);
      if (it.kind === 'more') {
        boxes.push({ type: 'more', id: `more:${it.parentId}`, parentId: it.parentId, count: it.count, x: colX(depth), y, w: CARD_W, h: 32, depth });
        edges.push({ from: parentId, to: `more:${it.parentId}` });
        centres.push(y + 16);
      } else {
        const own = ownH(it);
        let cy = y + h / 2;
        if (it.kids.length) {
          const kidsH = blockH(it.kids);
          cy = place(it.kids, depth + 1, y + (h - kidsH) / 2, it.node.id);
        }
        const boxY = Math.max(y, Math.min(cy - own / 2, y + h - own));
        boxes.push({ type: 'card', id: it.node.id, node: it.node, x: colX(depth), y: boxY, w: CARD_W, h: own, depth, parentId, folded: it.folded });
        edges.push({ from: parentId, to: it.node.id });
        centres.push(boxY + own / 2);
      }
      y += h;
    });
    return centres.length ? (centres[0] + centres[centres.length - 1]) / 2 : topY;
  };

  const total = Math.max(rootH, blockH(top));
  const centre = top.length ? place(top, 1, (total - blockH(top)) / 2, rootId) : total / 2;
  boxes.unshift({ type: 'root', id: rootId, node: rootNode, x: 0, y: centre - rootH / 2, w: ROOT_W, h: rootH, depth: 0 });
  const width = boxes.reduce((m, b) => Math.max(m, b.x + b.w), 0);
  const height = boxes.reduce((m, b) => Math.max(m, b.y + b.h), 0);
  return { boxes, edges, width, height };
}
