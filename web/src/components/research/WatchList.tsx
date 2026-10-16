import { Plus, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { RESEARCH_LIMITS, youtubeChannelUrl, type ChannelSuggestion, type ResearchSettings } from '@shared/research';
import { PlatformIcon } from '@/components/publish/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { compact } from '@/lib/format';
import { keys, queryClient } from '@/lib/queries';
import { cn } from '@/lib/utils';

function Chip({ children, onRemove, label }: { children: React.ReactNode; onRemove: () => void; label: string }) {
  return (
    <span className="inline-flex h-7 max-w-full items-center gap-1 rounded-md bg-muted pr-0.5 pl-2 text-xs">
      <span className="truncate">{children}</span>
      <button type="button" onClick={onRemove} className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground" aria-label={`Remove ${label}`}>
        <X className="size-3" />
      </button>
    </span>
  );
}

/** A list of chips with a box to add one: Enter or the button adds, `parse` cleans it (or rejects it with a message). */
function ChipList({
  id,
  label,
  icon,
  items,
  placeholder,
  max,
  parse,
  onChange,
}: {
  id: string;
  label: string;
  icon?: React.ReactNode;
  items: { key: string; text: string }[];
  placeholder: string;
  max: number;
  parse: (raw: string) => string | { error: string };
  onChange: (keys: string[]) => void;
}) {
  const [text, setText] = useState('');
  function add() {
    if (!text.trim()) return;
    const v = parse(text);
    if (typeof v !== 'string') return toast.error(v.error);
    if (!items.some((i) => i.key.toLowerCase() === v.toLowerCase())) onChange([...items.map((i) => i.key), v]);
    setText('');
  }
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="flex items-center gap-1.5">
        {icon} {label} <span className="font-normal text-muted-foreground tabular-nums">{items.length ? `${items.length}/${max}` : ''}</span>
      </Label>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((i) => (
            <Chip key={i.key} label={i.text} onRemove={() => onChange(items.filter((x) => x.key !== i.key).map((x) => x.key))}>
              {i.text}
            </Chip>
          ))}
        </div>
      )}
      {items.length < max && (
        <div className="flex gap-2">
          <Input
            id={id}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder={placeholder}
            className="h-8"
          />
          <Button size="sm" variant="outline" onClick={add} disabled={!text.trim()} aria-label={`Add to ${label}`}>
            <Plus />
          </Button>
        </div>
      )}
    </div>
  );
}

const handleOf = (raw: string) => {
  const h = raw
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?(tiktok|instagram)\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0];
  return /^[\w.]{2,30}$/.test(h) ? h.toLowerCase() : { error: 'That isn’t a handle (like @name).' };
};

/**
 * What a page's research watches: keywords, YouTube channels, TikTok and Instagram accounts. "Find channels" searches
 * YouTube Shorts for the keywords and suggests the channels that keep coming up. Saved as it changes.
 */
export function WatchListCard({ wid, settings, niche, className }: { wid: string; settings: ResearchSettings; niche: string; className?: string }) {
  const [draft, setDraft] = useState(settings);
  const [finding, setFinding] = useState(false);
  const [suggestions, setSuggestions] = useState<ChannelSuggestion[] | null>(null);
  useEffect(() => setDraft(settings), [settings]);

  async function save(next: ResearchSettings) {
    setDraft(next);
    try {
      const saved = await api<ResearchSettings>(`/workspaces/${wid}/research/settings`, { method: 'PUT', body: next });
      setDraft(saved);
      queryClient.invalidateQueries({ queryKey: keys.research(wid) });
    } catch (err) {
      toast.error(errorMessage(err));
      setDraft(settings);
    }
  }

  async function find() {
    setFinding(true);
    try {
      const r = await api<{ keywords: string[]; channels: ChannelSuggestion[] }>(`/workspaces/${wid}/research/find-channels`, { body: {} });
      setSuggestions(r.channels);
      if (!r.channels.length) toast('No channels came up for those keywords. Try broader ones.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setFinding(false);
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>What it watches</CardTitle>
        <CardDescription>
          Every morning the accounts here are checked for posts doing far better than their usual, and a brief is written from them. TikTok and Instagram accounts are read by
          the desktop app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ChipList
          id="research-keywords"
          label="Keywords"
          items={draft.keywords.map((k) => ({ key: k, text: k }))}
          placeholder={niche ? `e.g. ${niche.split(/[.,;:—–]/)[0].slice(0, 40)}` : 'e.g. halal business'}
          max={RESEARCH_LIMITS.keywords}
          parse={(raw) => (raw.trim().length >= 2 ? raw.trim().slice(0, 80) : { error: 'A keyword needs a couple of letters.' })}
          onChange={(keywords) => save({ ...draft, keywords })}
        />
        <div className="space-y-2">
          <ChipList
            id="research-youtube"
            label="YouTube channels"
            icon={<PlatformIcon platform="youtube" className="size-3.5" />}
            items={draft.youtube.map((c) => ({ key: c.url, text: c.name }))}
            placeholder="@handle or channel link"
            max={RESEARCH_LIMITS.youtube}
            parse={(raw) => youtubeChannelUrl(raw) ?? { error: 'That isn’t a YouTube channel (like @name or youtube.com/@name).' }}
            onChange={(urls) => save({ ...draft, youtube: urls.map((url) => draft.youtube.find((c) => c.url === url) ?? { url, name: url.split('/').pop()! }) })}
          />
          <Button size="sm" variant="outline" onClick={find} disabled={finding || (!draft.keywords.length && !niche)}>
            {finding ? <Spinner /> : <Search />} Find channels for me
          </Button>
          {suggestions && suggestions.length > 0 && (
            <ul className="divide-y rounded-lg border">
              {suggestions.map((c) => {
                const added = draft.youtube.some((x) => x.url.toLowerCase() === c.url.toLowerCase());
                return (
                  <li key={c.url} className="flex items-center gap-3 p-2.5">
                    <div className="min-w-0 flex-1">
                      <a href={c.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:underline">
                        {c.name}
                      </a>
                      <p className="truncate text-xs text-muted-foreground">
                        {c.hits} in the search{c.medianViews !== null ? ` · ${compact(c.medianViews)} views typical` : ''} · “{c.sample}”
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={added ? 'ghost' : 'outline'}
                      disabled={added || draft.youtube.length >= RESEARCH_LIMITS.youtube}
                      onClick={() => save({ ...draft, youtube: [...draft.youtube, { url: c.url, name: c.name }] })}
                    >
                      {added ? 'Added' : 'Watch'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className={cn('grid gap-5 sm:grid-cols-2')}>
          <ChipList
            id="research-tiktok"
            label="TikTok accounts"
            icon={<PlatformIcon platform="tiktok" className="size-3.5" />}
            items={draft.tiktok.map((h) => ({ key: h, text: `@${h}` }))}
            placeholder="@handle"
            max={RESEARCH_LIMITS.tiktok}
            parse={handleOf}
            onChange={(tiktok) => save({ ...draft, tiktok })}
          />
          <ChipList
            id="research-instagram"
            label="Instagram accounts"
            icon={<PlatformIcon platform="instagram" className="size-3.5" />}
            items={draft.instagram.map((h) => ({ key: h, text: `@${h}` }))}
            placeholder="@handle"
            max={RESEARCH_LIMITS.instagram}
            parse={handleOf}
            onChange={(instagram) => save({ ...draft, instagram })}
          />
        </div>
      </CardContent>
    </Card>
  );
}
