import { X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useCampaignLinks } from '@/lib/queries';
import { cn } from '@/lib/utils';

/** A clipping page's campaigns: the links I drop here for Claude to check when making its videos. */
export function CampaignLinks({ wid }: { wid: string }) {
  const links = useCampaignLinks(wid);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.campaignLinks(wid) });

  async function add(value = link) {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await api(`/workspaces/${wid}/campaign-links`, { method: 'POST', body: { link: value.trim() } });
      setLink('');
      void refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, url: string) {
    try {
      await api(`/workspaces/${wid}/campaign-links/${id}`, { method: 'DELETE' });
      void refresh();
      toast('Removed', { action: { label: 'Undo', onClick: () => void add(url) } });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-7 px-4 py-6 md:px-6 md:py-8">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Paste a campaign link"
            className="h-11 min-w-0 flex-1 rounded-lg border bg-card px-3.5 text-[15px] outline-none focus:border-foreground/30"
          />
          <Button type="submit" className="h-11 px-5 text-[15px]" disabled={busy || !link.trim()}>
            {busy && <Spinner />} Add
          </Button>
        </form>
        {links.data?.length ? (
          <ul>
            {links.data.map((c) => (
              <li key={c.id} className={cn('flex items-center gap-4 border-b py-3', c.ended && 'text-muted-foreground')}>
                <a href={c.link} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[15px] underline-offset-4 hover:underline">
                  {c.title ?? c.link}
                </a>
                {c.note && (
                  <span className={cn('text-[13px]', c.note === 'Not halal' ? 'text-destructive' : 'text-muted-foreground')} title={c.why}>
                    {c.note}
                  </span>
                )}
                {c.ended ? <span className="text-[13px]">Ended</span> : !c.checked && !c.note && <span className="text-[13px] text-muted-foreground">Not checked yet</span>}
                <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => remove(c.id, c.link)}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          links.data && <p className="text-[15px] text-muted-foreground">None yet</p>
        )}
      </div>
    </div>
  );
}
