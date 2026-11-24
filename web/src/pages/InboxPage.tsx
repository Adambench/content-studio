// Home: one box to start something, then my videos by what they need. Your turn first; status is never set by hand.

import { ArrowUp, ChevronDown, Paperclip } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { KIND_LABEL, KINDS, type Brand, type Kind, type VideoSummary } from '@shared/types';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { mediaUrl } from '@/lib/api';
import { ago, secs } from '@/lib/format';
import { api } from '@/lib/api';
import { useBrands, useCreateVideo, useVideos } from '@/lib/queries';
import { uploadFiles } from '@/lib/uploads';
import { cn } from '@/lib/utils';

const LAST_BRAND = 'cs-last-brand';

export function InboxPage() {
  const { brandId } = useParams();
  const brands = useBrands();
  const videos = useVideos();
  const brand = brands.data?.find((b) => b.id === brandId);
  const list = (videos.data ?? []).filter((v) => !brandId || v.brandId === brandId);
  const by = (s: VideoSummary['status']) => list.filter((v) => v.status === s);
  const posted = by('posted');

  if (brands.data && !brands.data.length) return <FirstBrand />;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 md:px-8">
        {brand && (
          <div className="flex items-center gap-2 text-lg font-semibold">
            <span className="size-2.5 rounded-full" style={{ background: brand.color }} />
            {brand.name}
          </div>
        )}
        <Composer brands={brands.data ?? []} fixedBrand={brand ?? null} />
        {videos.isPending && <Spinner className="mx-auto" />}
        <Section title="Your turn" list={by('turn')} brands={brands.data ?? []} />
        <Section title="Making" list={by('making')} brands={brands.data ?? []} />
        <Section title="Ready to post" list={by('ready')} brands={brands.data ?? []} />
        {posted.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">
              Posted <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{posted.length}</span>
            </h2>
            <div className="flex flex-col divide-y overflow-hidden rounded-xl border">
              {posted.slice(0, 30).map((v) => (
                <PostedRow key={v.id} v={v} brand={brands.data?.find((b) => b.id === v.brandId)} />
              ))}
            </div>
          </section>
        )}
        {!videos.isPending && !list.length && <p className="text-center text-sm text-muted-foreground">Nothing yet. Say what you want to make above.</p>}
      </div>
    </div>
  );
}

function Section({ title, list, brands }: { title: string; list: VideoSummary[]; brands: Brand[] }) {
  if (!list.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">
        {title} <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{list.length}</span>
      </h2>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] md:gap-x-4 md:gap-y-6 md:overflow-visible md:px-0">
        {list.map((v) => (
          <Card key={v.id} v={v} brand={brands.find((b) => b.id === v.brandId)} />
        ))}
      </div>
    </section>
  );
}

function Card({ v, brand }: { v: VideoSummary; brand?: Brand }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(`/v/${v.id}`)} className="group flex w-[42vw] shrink-0 snap-start flex-col gap-2 text-left md:w-auto">
      <Thumb v={v} color={brand?.color} />
      <div className="line-clamp-2 text-sm leading-snug font-medium">{v.title}</div>
      {v.status === 'making' ? (
        <div className="flex flex-col gap-1">
          <div className="truncate text-xs text-muted-foreground">{v.reason}</div>
          {v.job && (
            <div className="h-0.5 overflow-hidden rounded bg-muted">
              <div className="h-full bg-foreground transition-[width] duration-700" style={{ width: `${Math.round(v.job.progress * 100)}%` }} />
            </div>
          )}
        </div>
      ) : (
        <div className={cn('flex items-center gap-1.5 text-xs', v.status === 'turn' && (v.unseen || v.reason.startsWith('Claude asks')) ? 'text-you' : v.reason.startsWith('Stopped') ? 'text-destructive' : 'text-muted-foreground')}>
          {v.status === 'turn' && v.unseen && <span className="size-1.5 shrink-0 rounded-full bg-you" />}
          <span className="line-clamp-2">{v.reason}</span>
        </div>
      )}
      <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: brand?.color }} />
        {brand?.name} · {KIND_LABEL[v.kind]}
      </div>
    </button>
  );
}

function Thumb({ v, color }: { v: VideoSummary; color?: string }) {
  const l = v.latest;
  const src = l ? (l.kind === 'carousel' ? `/media/slide/${l.id}/0` : `/media/poster/${l.id}`) : null;
  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl border bg-card transition group-hover:-translate-y-0.5 group-hover:border-foreground/20" style={{ background: `radial-gradient(110% 70% at 50% 15%, color-mix(in oklab, ${color ?? '#888'} 35%, transparent), transparent 75%)` }}>
      {src ? (
        <img src={mediaUrl(src)} alt="" loading="lazy" className={cn('size-full', l!.kind === 'carousel' ? 'object-contain' : 'object-cover')} />
      ) : (
        <div className="absolute inset-x-3 top-[14%] text-[15px] leading-tight font-extrabold text-balance text-white/90 uppercase [text-shadow:0_2px_12px_#000a]">{v.title}</div>
      )}
      {v.status === 'making' && (
        <div className="absolute inset-0 grid place-items-center bg-black/40">
          <Spinner />
        </div>
      )}
      {l && <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 font-mono text-[11px] text-white">{l.kind === 'carousel' ? `${l.slides} slides` : secs(l.duration)}</span>}
    </div>
  );
}

function PostedRow({ v, brand }: { v: VideoSummary; brand?: Brand }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(`/v/${v.id}`)} className="flex items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent">
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: brand?.color }} />
      <span className="min-w-0 flex-1 truncate">{v.title}</span>
      <span className="text-xs text-muted-foreground">{v.postedAt ? ago(v.postedAt) : ''}</span>
    </button>
  );
}

/** The box: what I want (and files), which brand, what kind. Enter is my go. */
export function Composer({ brands, fixedBrand }: { brands: Brand[]; fixedBrand: Brand | null }) {
  const navigate = useNavigate();
  const create = useCreateVideo();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [kind, setKind] = useState<Kind>('auto');
  const [picked, setPicked] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_BRAND);
    } catch {
      return null;
    }
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const brand = fixedBrand ?? brands.find((b) => b.id === picked) ?? brands[0];

  // A skill picked in Ctrl K lands here when no video is open.
  useEffect(() => {
    const on = (e: Event) => {
      const add = String((e as CustomEvent).detail ?? '');
      setText((cur) => (cur ? `${cur.trimEnd()} ${add}` : add));
      requestAnimationFrame(() => document.getElementById('composer')?.focus());
    };
    window.addEventListener('cs:insert', on);
    return () => window.removeEventListener('cs:insert', on);
  }, []);

  const start = () => {
    if (!brand || (!text.trim() && !files.length)) return;
    const said = text.trim();
    const withFiles = files;
    create.mutate(
      { brandId: brand.id, text: said, title: said ? undefined : withFiles[0]?.name.replace(/\.[^.]+$/, ''), kind, go: !withFiles.length },
      {
        onSuccess: (v) => {
          // With files, the go waits until they're all in.
          if (withFiles.length)
            uploadFiles(v.id, withFiles, () => {
              void (said ? api(`/api/videos/${v.id}/messages`, { body: { text: said } }) : api(`/api/videos/${v.id}/go`, { body: {} })).catch((err: Error) => toast.error(err.message));
            });
          setText('');
          setFiles([]);
          navigate(`/v/${v.id}`);
        },
      },
    );
  };

  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-col gap-2 rounded-2xl border bg-card p-3 pl-4 focus-within:border-foreground/25"
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        setFiles([...files, ...e.dataTransfer.files]);
      }}
    >
      <textarea
        id="composer"
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            start();
          }
        }}
        rows={2}
        placeholder="What are we making? Say the idea, paste a link, or drop takes."
        aria-label="What are we making?"
        className="min-h-12 resize-none bg-transparent text-base outline-none placeholder:text-muted-foreground"
      />
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((f, k) => (
            <button key={k} type="button" onClick={() => setFiles(files.filter((_, j) => j !== k))} className="rounded-md border px-2 py-0.5 font-mono text-xs text-muted-foreground hover:line-through" title="Remove">
              {f.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        {!fixedBrand && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 rounded-full text-xs">
                <span className="size-2 rounded-full" style={{ background: brand?.color }} />
                {brand?.name ?? 'Brand'} <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {brands.map((b) => (
                <DropdownMenuItem
                  key={b.id}
                  onSelect={() => {
                    setPicked(b.id);
                    try {
                      localStorage.setItem(LAST_BRAND, b.id);
                    } catch {
                      // Remembering is a convenience.
                    }
                  }}
                >
                  <span className="size-2 rounded-full" style={{ background: b.color }} /> {b.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 rounded-full text-xs">
              {KIND_LABEL[kind]} <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {KINDS.map((k) => (
              <DropdownMenuItem key={k} onSelect={() => setKind(k)}>
                {KIND_LABEL[k]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="ml-auto" />
        <input ref={fileInput} type="file" multiple hidden accept="video/*,audio/*,image/*" onChange={(e) => setFiles([...files, ...(e.currentTarget.files ?? [])])} />
        <Button size="icon" variant="ghost" className="size-8" onClick={() => fileInput.current?.click()} aria-label="Add files">
          <Paperclip className="size-4" />
        </Button>
        <Button size="icon" className="size-8 rounded-lg" onClick={start} disabled={create.isPending || (!text.trim() && !files.length)} aria-label="Start">
          <ArrowUp className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/** No brand yet: the first one, in one line. */
function FirstBrand() {
  const [name, setName] = useState('');
  const navigate = useNavigate();
  const create = async () => {
    if (!name.trim()) return;
    await api('/api/brands', { body: { name: name.trim(), color: '#e6b450' } });
    navigate(0);
  };
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-3">
        <div className="text-lg font-semibold">Your first brand</div>
        <p className="text-sm text-muted-foreground">A page you post on. Each gets a folder on ai-server with its own style and lessons.</p>
        <input value={name} onChange={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} placeholder="Personal brand" className="rounded-lg border bg-card px-3 py-2 text-sm outline-none" aria-label="Brand name" />
        <Button onClick={() => void create()} disabled={!name.trim()}>
          Make it
        </Button>
      </div>
    </div>
  );
}
