import { ChevronRight, CornerDownRight, FileText, ImageIcon, Inbox, Layers, Link2, Send, Sparkles, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { firstLink, type IdeaNode } from '@shared/ideas';
import { PlatformIcon } from '@/components/publish/common';
import { mediaThumbUrl } from '@/lib/api';
import { compact } from '@/lib/format';
import { cn } from '@/lib/utils';
import { LabelChips, StatusChip } from './IdeaCard';
import { cardTitle, childrenOf, countUnder, createCard, episodeOf, removeCard, type Tree } from './model';

type Props = {
  wid: string;
  tree: Tree;
  focus: string | null;
  only: Set<string> | null;
  onOpen: (id: string) => void;
  onDive: (id: string | null) => void;
};

/** One line of the list: swipe it left for a sub-idea or delete; tap it to open; the count on the right opens it as its own list. */
function Row({ wid, tree, node, depth, only, onOpen, onDive, onAddUnder }: { wid: string; tree: Tree; node: IdeaNode; depth: number; only: Set<string> | null; onOpen: (id: string) => void; onDive: (id: string) => void; onAddUnder: (id: string) => void }) {
  const [shift, setShift] = useState(0);
  const [open, setOpen] = useState(false);
  const start = useRef<{ x: number; y: number; base: number; moved: boolean } | null>(null);
  const kids = childrenOf(tree, node.id).filter((c) => !only || only.has(c.id));
  const title = cardTitle(node);
  const ep = episodeOf(tree, node);
  const fresh = node.kind === 'saved' ? kids.filter((c) => !node.seenAt || c.createdAt > node.seenAt).length : 0;
  const actions = node.kind !== 'saved';
  return (
    <li>
      <div className="relative overflow-hidden">
        {actions && (
          <div className="absolute inset-y-0 right-0 flex">
            {node.kind !== 'image' && (
              <button type="button" onClick={() => (setShift(0), onAddUnder(node.id))} className="flex w-20 flex-col items-center justify-center gap-0.5 bg-brand text-[11px] text-white">
                <CornerDownRight className="size-4" /> Sub-idea
              </button>
            )}
            <button type="button" onClick={() => (setShift(0), void removeCard(wid, node.id))} className="flex w-16 flex-col items-center justify-center gap-0.5 bg-destructive text-[11px] text-white">
              <Trash2 className="size-4" /> Delete
            </button>
          </div>
        )}
        <div
          className={cn('relative flex touch-pan-y items-center gap-2 bg-background py-2.5 pr-2 transition-transform', start.current?.moved && 'transition-none')}
          style={{ transform: `translateX(${shift}px)`, paddingLeft: 12 + depth * 18 }}
          onPointerDown={(e) => (start.current = { x: e.clientX, y: e.clientY, base: shift, moved: false })}
          onPointerMove={(e) => {
            const s = start.current;
            if (!s || !actions) return;
            const dx = e.clientX - s.x;
            if (!s.moved && (Math.abs(dx) < 8 || Math.abs(e.clientY - s.y) > Math.abs(dx))) return;
            s.moved = true;
            setShift(Math.min(0, Math.max(-144, s.base + dx)));
          }}
          onPointerUp={() => {
            const s = start.current;
            start.current = null;
            if (s?.moved) return setShift(shift < -60 ? (node.kind === 'image' ? -64 : -144) : 0);
            if (shift) return setShift(0);
            onOpen(node.id);
          }}
          onPointerCancel={() => (start.current = null, setShift(0))}
        >
          {kids.length > 0 && depth < 3 ? (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={() => setOpen(!open)}
              className="-ml-1 grid size-6 shrink-0 place-items-center rounded text-muted-foreground"
              aria-label={open ? 'Fold' : 'Unfold'}
            >
              <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          {node.kind === 'link' || node.kind === 'image' ? (
            <span className="grid h-12 w-9 shrink-0 place-items-center overflow-hidden rounded bg-muted">
              {node.hasThumb && node.mediaId ? <img src={mediaThumbUrl(node.mediaId)} alt="" className="size-full object-cover" /> : node.kind === 'link' ? <Link2 className="size-3.5 text-muted-foreground" /> : <ImageIcon className="size-3.5 text-muted-foreground" />}
            </span>
          ) : node.kind === 'saved' ? (
            <Inbox className="size-4 shrink-0 text-muted-foreground" />
          ) : node.kind === 'series' ? (
            <Layers className="size-4 shrink-0 text-brand" />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className={cn('line-clamp-2 text-sm leading-snug', node.kind !== 'link' && 'font-medium', !title && 'text-muted-foreground italic')}>
              {ep ? <span className="mr-1 text-xs text-muted-foreground tabular-nums">Ep {ep}</span> : null}
              {title || (node.kind === 'image' ? 'Picture' : 'Untitled')}
            </p>
            {node.kind === 'link' && node.post && (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <PlatformIcon platform={node.post.platform} className="size-3" />
                <span className="truncate">{node.post.channel}</span>
                {node.post.views !== null && <span className="tabular-nums">· {compact(node.post.views)}</span>}
                {node.post.score !== null && node.post.score >= 1.5 && <span className={cn('font-semibold', node.post.score >= 3 && 'text-emerald-400')}>{node.post.score.toFixed(1)}×</span>}
              </p>
            )}
            {(node.labels.length > 0 || node.piece || node.script || node.by === 'claude') && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <StatusChip node={node} />
                {node.script && !node.piece && <FileText className="size-3 text-muted-foreground" />}
                <LabelChips labels={node.labels} />
                {node.by === 'claude' && <Sparkles className="size-3 text-brand/70" />}
              </div>
            )}
          </div>
          {fresh > 0 && <span className="rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white tabular-nums">{fresh} new</span>}
          {(kids.length > 0 || node.kind === 'saved') && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={() => onDive(node.id)}
              className="flex h-8 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-xs text-muted-foreground tabular-nums"
              aria-label="Open as its own list"
            >
              {countUnder(tree, node.id)}
              <ChevronRight className="size-4" />
            </button>
          )}
        </div>
      </div>
      {open && kids.length > 0 && depth < 3 && (
        <ul>
          {kids.slice(0, 20).map((k) => (
            <Row key={k.id} wid={wid} tree={tree} node={k} depth={depth + 1} only={only} onOpen={onOpen} onDive={onDive} onAddUnder={onAddUnder} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The phone's Ideas: the level being looked at as a list (sub-ideas unfold in place), and a box to add fast. */
export function IdeaList({ wid, tree, focus, only, onOpen, onDive }: Props) {
  const [text, setText] = useState('');
  const [under, setUnder] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const rows = childrenOf(tree, focus).filter((c) => !only || only.has(c.id));
  const target = under ?? focus;
  const add = () => {
    const t = text.trim();
    if (!t) return;
    const url = firstLink(t);
    // A link with nowhere chosen is someone else's post: it goes to Saved.
    const parentId = url && !target ? (tree.saved?.id ?? null) : target;
    createCard(wid, url ? { parentId, url } : { parentId, title: t });
    setText('');
    input.current?.focus();
  };
  const underNode = under ? tree.byId.get(under) : null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
        {rows.map((n) => (
          <Row
            key={n.id}
            wid={wid}
            tree={tree}
            node={n}
            depth={0}
            only={only}
            onOpen={onOpen}
            onDive={onDive}
            onAddUnder={(id) => {
              setUnder(id);
              requestAnimationFrame(() => input.current?.focus());
            }}
          />
        ))}
        {!rows.length && (
          <li className="px-6 py-12 text-center text-sm text-muted-foreground">
            {focus ? 'Nothing under it yet: add the first one below.' : 'Your brainstorm starts here. Type an idea below, or share a post to Content Studio from any app.'}
          </li>
        )}
      </ul>
      <div className="pb-safe border-t bg-sidebar p-2">
        {underNode && (
          <div className="flex items-center gap-1.5 px-1 pb-1.5 text-xs text-muted-foreground">
            <CornerDownRight className="size-3" /> Under “{cardTitle(underNode).slice(0, 40) || 'Untitled'}”
            <button type="button" onClick={() => setUnder(null)} className="ml-auto text-foreground">
              Done
            </button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="flex items-center gap-2"
        >
          <input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={underNode ? 'Add a sub-idea…' : 'Add an idea, or paste a link…'}
            enterKeyHint="send"
            className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-base outline-none focus-visible:border-ring"
          />
          <button type="submit" disabled={!text.trim()} className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand text-white disabled:opacity-40" aria-label="Add">
            <Send className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
