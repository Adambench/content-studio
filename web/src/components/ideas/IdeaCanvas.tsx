import { Plus } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { CARD_W, estimateHeight, layoutTree, ROOT_ID, type Box } from './layout';
import { IdeaCard, RootCard } from './IdeaCard';
import { childrenOf, createCard, episodeOf, indentCard, isInside, moveCard, outdentCard, removeCard, shiftCard, undoLast, updateCard, type Tree } from './model';

type View = { x: number; y: number; k: number };
type Target = { zone: 'into' | 'before' | 'after'; id: string };
type Drag = { id: string; offX: number; offY: number; wx: number; wy: number; target: Target | null };

const PAD = 56;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Props = {
  wid: string;
  pageName: string;
  tree: Tree;
  /** The card opened as its own canvas, or null for the page. */
  focus: string | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onDive: (id: string | null) => void;
  /** A label filter: only these cards show. */
  only: Set<string> | null;
  editing: string | null;
  onEdit: (id: string | null) => void;
};

/**
 * The mind map: cards place themselves (layout.ts). Tab adds a sub-idea, Enter the next idea, typing edits, drag a
 * card onto another to move it under it (or between two to reorder), double-click to open it as its own canvas.
 * Scroll or drag the background to pan, Ctrl+scroll (or pinch) to zoom.
 */
export function IdeaCanvas({ wid, pageName, tree, focus, selected, onSelect, onDive, only, editing, onEdit }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: PAD, y: PAD, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [sizes, setSizes] = useState(() => new Map<string, number>());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [animate, setAnimate] = useState(false);
  const [smooth, setSmooth] = useState(false);
  const [resized, setResized] = useState(0);
  // Cards made with the keyboard here: one left empty goes away again.
  const fresh = useRef(new Set<string>());
  const wantVisible = useRef(false);
  // Keys typed for a card whose title editor hasn't appeared yet.
  const pendingChar = useRef<string | null>(null);

  const layout = useMemo(() => layoutTree(tree, { focus, sizes, only }), [tree, focus, sizes, only]);
  const byId = useMemo(() => new Map(layout.boxes.map((b) => [b.id, b])), [layout]);
  const minY = useMemo(() => layout.boxes.reduce((m, b) => Math.min(m, b.y), 0), [layout]);
  const rootId = focus ?? ROOT_ID;

  // ---------- measuring cards ----------
  const observer = useMemo(
    () =>
      new ResizeObserver((entries) => {
        setSizes((prev) => {
          let next: Map<string, number> | null = null;
          for (const e of entries) {
            const id = (e.target as HTMLElement).dataset.card;
            if (!id) continue;
            const h = Math.round(e.borderBoxSize?.[0]?.blockSize ?? (e.target as HTMLElement).offsetHeight);
            if (h && prev.get(id) !== h) (next ??= new Map(prev)).set(id, h);
          }
          return next ?? prev;
        });
      }),
    [],
  );
  useEffect(() => () => observer.disconnect(), [observer]);
  const measure = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      observer.observe(el);
      return () => observer.unobserve(el);
    },
    [observer],
  );

  // ---------- the view ----------
  const panTo = useCallback((v: View, animated = false) => {
    if (animated) {
      setSmooth(true);
      window.setTimeout(() => setSmooth(false), 260);
    }
    setView(v);
  }, []);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const w = layout.width;
    const h = layout.height - minY;
    // Readable first: never below 80 % to fit (the rest is a pan away).
    const k = clamp(Math.min((vw - PAD * 2) / Math.max(w, 1), (vh - PAD * 2) / Math.max(h, 1)), 0.8, 1);
    const root = byId.get(rootId);
    const x = w * k <= vw - PAD * 2 ? (vw - w * k) / 2 : PAD;
    const y = h * k <= vh - PAD * 2 ? (vh - h * k) / 2 - minY * k : vh / 2 - ((root ? root.y + root.h / 2 : 0) * k);
    setView({ x, y, k });
  }, [layout, minY, byId, rootId]);

  // Fit once a canvas (the page, or a card opened) has been measured.
  const fittedFor = useRef<string | null>(null);
  const measuredAll = layout.boxes.every((b) => b.type === 'more' || sizes.has(b.id));
  useLayoutEffect(() => {
    if (fittedFor.current === rootId || !measuredAll) return;
    fittedFor.current = rootId;
    fit();
    // Moves animate from here on (not the first placement).
    requestAnimationFrame(() => setAnimate(true));
  }, [rootId, measuredAll, fit]);
  useEffect(() => setAnimate(false), [rootId]);

  // Keep the card I'm working on in view.
  useLayoutEffect(() => {
    if (!wantVisible.current) return;
    const id = editing ?? selected;
    const b = id ? byId.get(id) : undefined;
    const el = box.current;
    if (!b || !el) return;
    wantVisible.current = false;
    const v = viewRef.current;
    const left = b.x * v.k + v.x;
    const top = b.y * v.k + v.y;
    const right = left + (b.w + 24) * v.k;
    const bottom = top + b.h * v.k;
    let dx = 0;
    let dy = 0;
    if (left < 24) dx = 24 - left;
    else if (right > el.clientWidth - 24) dx = el.clientWidth - 24 - right;
    if (top < 24) dy = 24 - top;
    else if (bottom > el.clientHeight - 24) dy = el.clientHeight - 24 - bottom;
    if (dx || dy) panTo({ ...v, x: v.x + dx, y: v.y + dy }, true);
  }, [layout, byId, editing, selected, panTo, resized]);

  const select = useCallback(
    (id: string | null) => {
      wantVisible.current = true;
      onSelect(id);
    },
    [onSelect],
  );
  const edit = useCallback(
    (id: string | null) => {
      wantVisible.current = true;
      onEdit(id);
    },
    [onEdit],
  );

  // The canvas getting narrower or wider (the panel opening, the window): keep what was in the middle in the middle.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let last = { w: el.clientWidth, h: el.clientHeight };
    const ro = new ResizeObserver(() => {
      const now = { w: el.clientWidth, h: el.clientHeight };
      const v = viewRef.current;
      if (last.w && last.h) setView({ ...v, x: v.x + (now.w - last.w) / 2, y: v.y + (now.h - last.h) / 2 });
      last = now;
      wantVisible.current = true;
      setResized((n) => n + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel: pan; Ctrl/⌘ (and trackpad pinch): zoom around the pointer.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        const k = clamp(v.k * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), 0.3, 2);
        setView({ k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k });
      } else setView({ ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX), y: v.y - (e.shiftKey ? 0 : e.deltaY) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (f: number) => {
    const el = box.current;
    if (!el) return;
    const v = viewRef.current;
    const k = clamp(v.k * f, 0.3, 2);
    const px = el.clientWidth / 2;
    const py = el.clientHeight / 2;
    panTo({ k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k }, true);
  };

  // ---------- panning the background (one finger or the mouse), pinching (two fingers) ----------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; k: number; cx: number; cy: number; x: number; y: number } | null>(null);
  const onBackgroundDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-card], [data-more], button, textarea, input')) return;
    box.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const r = box.current!.getBoundingClientRect();
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: viewRef.current.k, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, x: viewRef.current.x, y: viewRef.current.y };
    }
    if (pointers.current.size === 1 && e.button === 0) {
      box.current?.focus({ preventScroll: true });
      if (editing) edit(null);
    }
  };
  const onBackgroundMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const p = pinch.current;
      const k = clamp((p.k * Math.hypot(a.x - b.x, a.y - b.y)) / p.d, 0.3, 2);
      setView({ k, x: p.cx - ((p.cx - p.x) * k) / p.k, y: p.cy - ((p.cy - p.y) * k) / p.k });
      return;
    }
    const v = viewRef.current;
    setView({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y });
  };
  const onBackgroundUp = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    // A plain click on the background lets go of the selection.
    if (p && Math.abs(p.x - e.clientX) < 3 && Math.abs(p.y - e.clientY) < 3 && pointers.current.size === 0 && !(e.target as HTMLElement).closest('[data-card], [data-more]')) select(null);
  };

  // ---------- dragging cards ----------
  const pending = useRef<{ id: string; x: number; y: number; offX: number; offY: number } | null>(null);
  const toWorld = (cx: number, cy: number) => {
    const r = box.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
  };

  const targetAt = useCallback(
    (wx: number, wy: number, dragged: string, cx: number, cy: number): Target | null => {
      // Onto a breadcrumb: up to that level.
      const crumb = (document.elementFromPoint(cx, cy) as HTMLElement | null)?.closest<HTMLElement>('[data-crumb]');
      if (crumb) return { zone: 'into', id: crumb.dataset.crumb || ROOT_ID };
      for (const b of layout.boxes) {
        if (b.type === 'more' || b.id === dragged) continue;
        if (b.type === 'card' && isInside(tree, b.id, dragged)) continue;
        if (wx < b.x - 6 || wx > b.x + b.w + 6 || wy < b.y - 6 || wy > b.y + b.h + 6) continue;
        if (b.type === 'root' || b.node.kind === 'saved') return { zone: 'into', id: b.id };
        const rel = (wy - b.y) / b.h;
        return { zone: rel < 0.28 ? 'before' : rel > 0.72 ? 'after' : 'into', id: b.id };
      }
      return null;
    },
    [layout, tree],
  );

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = pending.current;
      // The page's own card and the Saved pile stay put.
      if (!p || Number.isNaN(p.offX)) return;
      if (!drag && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
      const w = toWorld(e.clientX, e.clientY);
      setDrag({ id: p.id, offX: p.offX, offY: p.offY, wx: w.x, wy: w.y, target: targetAt(w.x, w.y, p.id, e.clientX, e.clientY) });
    };
    const up = () => {
      const p = pending.current;
      pending.current = null;
      if (!p) return;
      if (!drag) {
        // A click: select it, or edit its title when it already was.
        const b = byId.get(p.id);
        if (selected === p.id && b?.type === 'card' && b.node.kind !== 'saved') edit(p.id);
        else select(p.id === ROOT_ID ? (focus ?? null) : p.id);
        return;
      }
      const t = drag.target;
      setDrag(null);
      if (!t) return;
      const into = t.id === ROOT_ID ? null : t.id;
      if (t.zone === 'into') {
        const target = into ? tree.byId.get(into) : null;
        if (into === (tree.byId.get(drag.id)?.parentId ?? null) && target?.kind !== 'saved') return;
        if (target?.collapsed) void updateCard(wid, target.id, { collapsed: false });
        void moveCard(wid, drag.id, into ?? (t.id === ROOT_ID ? focus : null));
      } else {
        const s = tree.byId.get(t.id);
        if (!s) return;
        const parent = s.parentId && tree.byId.has(s.parentId) ? s.parentId : null;
        const sibs = childrenOf(tree, parent).filter((c) => c.id !== drag.id && c.kind !== 'saved');
        const i = sibs.findIndex((c) => c.id === s.id);
        void moveCard(wid, drag.id, parent, t.zone === 'after' ? s.id : (sibs[i - 1]?.id ?? null));
      }
      wantVisible.current = true;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, targetAt, tree, wid, focus, byId, selected, select, edit]);

  const onCardDown = (e: React.PointerEvent, b: Box) => {
    if (e.button !== 0 || editing === b.id) return;
    e.stopPropagation();
    box.current?.focus({ preventScroll: true });
    if (editing) edit(null);
    const w = toWorld(e.clientX, e.clientY);
    // The page's own card and the Saved pile stay put; clicking them still selects.
    pending.current = { id: b.id, x: e.clientX, y: e.clientY, offX: w.x - b.x, offY: w.y - b.y };
    if (b.type === 'root' || (b.type === 'card' && b.node.kind === 'saved')) pending.current = { ...pending.current, offX: NaN };
  };

  // ---------- the keyboard ----------
  const parentForNew = (id: string | null) => (id === null || id === ROOT_ID ? focus : id);

  const addChild = (parentId: string | null) => {
    const parent = parentId ? tree.byId.get(parentId) : null;
    if (parent?.collapsed) void updateCard(wid, parent.id, { collapsed: false });
    const id = createCard(wid, { parentId });
    fresh.current.add(id);
    select(id);
    edit(id);
  };
  const addSibling = (id: string) => {
    const n = tree.byId.get(id);
    if (!n || n.kind === 'saved') return addChild(focus);
    const parent = n.parentId && tree.byId.has(n.parentId) ? n.parentId : null;
    const nid = createCard(wid, { parentId: parent, after: id });
    fresh.current.add(nid);
    select(nid);
    edit(nid);
  };

  const navigate = (key: string) => {
    const cur = selected ? byId.get(selected) : byId.get(rootId);
    if (!cur) return select(childrenOf(tree, focus)[0]?.id ?? null);
    if (key === 'ArrowLeft') {
      if (cur.type === 'card') select(cur.parentId === ROOT_ID ? focus : cur.parentId);
      return;
    }
    if (key === 'ArrowRight') {
      const first = layout.boxes.find((b) => b.type !== 'more' && b.type !== 'root' && (b.type === 'card' ? b.parentId : null) === cur.id);
      if (first) return select(first.id);
      if (cur.type === 'card' && cur.folded && cur.node.collapsed) void updateCard(wid, cur.id, { collapsed: false });
      return;
    }
    // Up/down: the nearest card above or below in the same column, else any column.
    const dir = key === 'ArrowUp' ? -1 : 1;
    const candidates = layout.boxes.filter((b) => b.type === 'card' && b.id !== cur.id && (dir < 0 ? b.y + b.h / 2 < cur.y + cur.h / 2 : b.y + b.h / 2 > cur.y + cur.h / 2));
    const score = (b: Box) => Math.abs(b.y + b.h / 2 - (cur.y + cur.h / 2)) + Math.abs(b.x - cur.x) * 3;
    const best = candidates.sort((a, b) => score(a) - score(b))[0];
    if (best) select(best.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('textarea, input')) return;
    // A card just made (Enter, Tab) shows a moment after the key: what's typed meanwhile goes into it.
    if (editing) {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        pendingChar.current = (pendingChar.current ?? '') + e.key;
      } else if (e.key === 'Escape') {
        // Changed my mind before it even showed.
        if (fresh.current.has(editing) && !pendingChar.current) {
          fresh.current.delete(editing);
          void removeCard(wid, editing, { quiet: true, undo: false });
        }
        pendingChar.current = null;
        edit(null);
      }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const node = selected ? tree.byId.get(selected) : null;
    const k = e.key;
    if (mod && k.toLowerCase() === 'z') {
      e.preventDefault();
      void undoLast();
      return;
    }
    if (mod && k === '0') return (e.preventDefault(), fit());
    if (mod && (k === '=' || k === '+')) return (e.preventDefault(), zoomBy(1.2));
    if (mod && k === '-') return (e.preventDefault(), zoomBy(1 / 1.2));
    if (e.altKey && node && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
      e.preventDefault();
      wantVisible.current = true;
      if (k === 'ArrowUp') shiftCard(wid, tree, node.id, -1);
      else if (k === 'ArrowDown') shiftCard(wid, tree, node.id, 1);
      else if (k === 'ArrowLeft') outdentCard(wid, tree, node.id, focus);
      else indentCard(wid, tree, node.id);
      return;
    }
    if (k === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      if (node?.kind === 'saved') return;
      return addChild(parentForNew(selected));
    }
    if (k === 'Enter' && e.shiftKey) {
      e.preventDefault();
      if (node) onDive(node.id);
      return;
    }
    if (k === 'Enter') {
      e.preventDefault();
      return selected && selected !== focus ? addSibling(selected) : addChild(focus);
    }
    if ((k === 'F2' || k === ' ') && node && node.kind !== 'saved') {
      e.preventDefault();
      return edit(node.id);
    }
    if ((k === 'Delete' || k === 'Backspace') && node && node.kind !== 'saved' && node.id !== focus) {
      e.preventDefault();
      const next = layout.boxes.find((b) => b.type === 'card' && b.parentId === (byId.get(node.id) as { parentId?: string })?.parentId && b.id !== node.id);
      void removeCard(wid, node.id);
      select(next?.id ?? (node.parentId && node.parentId !== focus ? node.parentId : null));
      return;
    }
    if (k === 'Escape') {
      if (selected) select(null);
      else if (focus) onDive(tree.byId.get(focus)?.parentId ?? null);
      return;
    }
    if (k.startsWith('Arrow')) {
      e.preventDefault();
      return navigate(k);
    }
    // Typing on a selected card edits it.
    if (k.length === 1 && !mod && !e.altKey && node && node.kind !== 'saved') {
      e.preventDefault();
      pendingChar.current = (pendingChar.current ?? '') + k;
      edit(node.id);
    }
  };

  // ---------- editing a title in place ----------
  const finishEdit = (id: string, text: string, then?: 'next' | 'child' | 'indent' | 'outdent') => {
    const n = tree.byId.get(id);
    const value = text.replace(/\s+/g, ' ').trim();
    const wasFresh = fresh.current.has(id);
    if (!value && wasFresh && (then === undefined || then === 'next')) {
      fresh.current.delete(id);
      void removeCard(wid, id, { quiet: true, undo: false });
      edit(null);
      select(n?.parentId && n.parentId !== focus ? n.parentId : null);
      box.current?.focus({ preventScroll: true });
      return;
    }
    if (n && value !== n.title) void updateCard(wid, id, { title: value }, { undo: !wasFresh });
    if (value) fresh.current.delete(id);
    // Keys typed before the next card shows land on the canvas (and go into it), not nowhere.
    if (then === 'next' || then === 'child') box.current?.focus({ preventScroll: true });
    if (then === 'next') return addSibling(id);
    if (then === 'child') return addChild(id);
    if (then === 'indent') {
      indentCard(wid, tree, id);
      return edit(id);
    }
    if (then === 'outdent') {
      outdentCard(wid, tree, id, focus);
      return edit(id);
    }
    edit(null);
    box.current?.focus({ preventScroll: true });
  };

  const editor = (id: string, initial: string) => (
    <TitleEditor
      key={id}
      initial={initial + (pendingChar.current ?? '')}
      onMount={() => (pendingChar.current = null)}
      onDone={(text, then) => finishEdit(id, text, then)}
    />
  );

  // ---------- drawing ----------
  const edgePaths = layout.edges.map((e) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) return null;
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    const dx = (x2 - x1) / 2;
    return <path key={`${e.from}-${e.to}`} d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`} className={cn('fill-none stroke-border', animate && 'transition-[d] duration-200')} strokeWidth={1.5} />;
  });

  const unseen = (id: string) => {
    const pile = tree.byId.get(id);
    return childrenOf(tree, id).filter((c) => !pile?.seenAt || c.createdAt > pile.seenAt).length;
  };

  const dragged = drag ? tree.byId.get(drag.id) : null;
  const indicator = drag?.target && drag.target.zone !== 'into' ? byId.get(drag.target.id) : null;
  const emptyHere = !childrenOf(tree, focus).some((c) => c.kind !== 'saved');

  return (
    <div
      ref={box}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onBackgroundDown}
      onPointerMove={onBackgroundMove}
      onPointerUp={onBackgroundUp}
      onPointerCancel={onBackgroundUp}
      className={cn('relative h-full w-full touch-none overflow-hidden outline-none', drag ? 'cursor-grabbing' : 'cursor-default')}
      aria-label="Ideas canvas"
    >
      {/* A faint dot grid, so panning reads as moving. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{ backgroundImage: 'radial-gradient(var(--color-border) 1px, transparent 1px)', backgroundSize: `${22 * view.k}px ${22 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      />
      <div className={cn('absolute top-0 left-0 origin-top-left', smooth && 'transition-transform duration-250 ease-out')} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1}>
          {edgePaths}
        </svg>
        {layout.boxes.map((b) => {
          const style: React.CSSProperties = { transform: `translate(${b.x}px, ${b.y}px)`, width: b.w };
          const moving = cn(animate && drag?.id !== b.id && 'transition-transform duration-200 ease-out');
          if (b.type === 'root')
            return (
              <RootCard
                key={b.id}
                ref={measure}
                node={b.node}
                pageName={pageName}
                selected={selected === (focus ?? '__none') || drag?.target?.id === b.id}
                style={style}
                className={cn(moving, drag?.target?.id === b.id && 'ring-2 ring-emerald-400/70')}
                onPointerDown={(e) => onCardDown(e, b)}
                onDoubleClick={() => focus && onDive(tree.byId.get(focus)?.parentId ?? null)}
              />
            );
          if (b.type === 'more')
            return (
              <button
                key={b.id}
                type="button"
                data-more
                style={style}
                onClick={() => onDive(b.parentId)}
                className={cn('absolute h-8 rounded-lg border border-dashed px-3 text-left text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground', moving)}
              >
                + {b.count} more — open to see all
              </button>
            );
          const n = b.node;
          const isEditing = editing === n.id;
          return (
            <div key={b.id} className={cn('group/slot', drag?.id === n.id && 'opacity-40')}>
              <IdeaCard
                ref={measure}
                node={n}
                style={style}
                className={cn(moving, 'cursor-pointer')}
                selected={selected === n.id}
                dropping={drag?.target?.zone === 'into' && drag.target.id === n.id}
                episode={episodeOf(tree, n)}
                folded={b.folded}
                fresh={n.kind === 'saved' ? unseen(n.id) : 0}
                total={n.kind === 'saved' ? childrenOf(tree, n.id).length : 0}
                editing={isEditing ? editor(n.id, n.title) : undefined}
                onFold={() => (n.collapsed ? void updateCard(wid, n.id, { collapsed: false }) : onDive(n.id))}
                onPointerDown={(e) => onCardDown(e, b)}
                onDoubleClick={() => onDive(n.id)}
              />
              {/* Hover: add a sub-idea without the keyboard. */}
              {!b.folded && !isEditing && n.kind !== 'image' && (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => addChild(n.id)}
                  style={{ transform: `translate(${b.x + b.w - 10}px, ${b.y + b.h / 2 - 10}px)` }}
                  className={cn('absolute top-0 left-0 grid size-5 place-items-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-sm group-hover/slot:opacity-100 hover:text-foreground focus-visible:opacity-100', moving)}
                  aria-label="Add a sub-idea"
                  title="Add a sub-idea (Tab)"
                >
                  <Plus className="size-3" />
                </button>
              )}
            </div>
          );
        })}
        {indicator && (
          <div className="pointer-events-none absolute top-0 left-0 h-0.5 rounded-full bg-emerald-400" style={{ width: indicator.w, transform: `translate(${indicator.x}px, ${(drag!.target!.zone === 'before' ? indicator.y - 6 : indicator.y + indicator.h + 4)}px)` }} />
        )}
        {dragged && drag && (
          <IdeaCard node={dragged} style={{ transform: `translate(${drag.wx - drag.offX}px, ${drag.wy - drag.offY}px) rotate(1.5deg)`, width: CARD_W, height: estimateHeight(dragged) }} className="pointer-events-none z-10 shadow-xl" />
        )}
        {emptyHere && !editing && (
          <div className="pointer-events-none absolute top-0 left-0 w-72 text-sm text-muted-foreground" style={{ transform: `translate(${(byId.get(rootId)?.x ?? 0) + 230}px, ${(byId.get(rootId)?.y ?? 0) + 2}px)` }}>
            <p className="font-medium text-foreground">{focus ? 'Nothing under it yet.' : 'Your brainstorm starts here.'}</p>
            <p className="mt-1">
              Press <kbd className="rounded border px-1 text-xs">Enter</kbd> and type an idea. <kbd className="rounded border px-1 text-xs">Tab</kbd> adds a sub-idea; paste links or screenshots anywhere.
            </p>
          </div>
        )}
      </div>

      <div className="absolute right-3 bottom-3 flex items-center gap-1 rounded-lg border bg-background/90 p-1 text-xs shadow-sm backdrop-blur">
        <button type="button" className="h-7 rounded px-2 hover:bg-accent" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">
          −
        </button>
        <button type="button" className="h-7 min-w-12 rounded px-2 tabular-nums hover:bg-accent" onClick={fit} title="Fit (Ctrl+0)">
          {Math.round(view.k * 100)}%
        </button>
        <button type="button" className="h-7 rounded px-2 hover:bg-accent" onClick={() => zoomBy(1.2)} aria-label="Zoom in">
          +
        </button>
      </div>
    </div>
  );
}

/** The title being typed on a card. Enter: the next idea; Tab: a sub-idea (or, still empty, under the card above). */
function TitleEditor({ initial, onDone, onMount }: { initial: string; onDone: (text: string, then?: 'next' | 'child' | 'indent' | 'outdent') => void; onMount: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    onMount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const finish = (then?: 'next' | 'child' | 'indent' | 'outdent') => {
    if (done.current) return;
    // Indenting keeps typing in the same card.
    if (then !== 'indent' && then !== 'outdent') done.current = true;
    onDone(ref.current?.value ?? '', then);
  };
  return (
    <textarea
      ref={ref}
      defaultValue={initial}
      rows={1}
      placeholder="Type an idea…"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        const empty = !e.currentTarget.value.trim();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finish('next');
        } else if (e.key === 'Tab') {
          e.preventDefault();
          finish(e.shiftKey ? 'outdent' : empty ? 'indent' : 'child');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish();
        }
      }}
      onBlur={() => finish()}
      className="field-sizing-content block w-full min-w-0 resize-none bg-transparent text-[13px] leading-snug font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground"
    />
  );
}
