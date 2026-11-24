import { FileIcon, ImageIcon, MicIcon, PaperclipIcon, VideoIcon, XIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { mediaUrl, uploadFile } from '@/lib/api';
import { bytes, secs } from '@/lib/format';
import { pickToCard, Studio } from '@/lib/native';
import { keys, queryClient, useInputActions } from '@/lib/queries';
import { ROLE_LABEL } from '@shared/recipes';
import type { Input, InputRole } from '@shared/types';

const ICON = { video: VideoIcon, audio: MicIcon, image: ImageIcon, doc: FileIcon, other: FileIcon };
const ROLES = Object.entries(ROLE_LABEL) as [Exclude<InputRole, null>, string][];

type Sending = { name: string; fraction: number };

export function useUploader(cardId: string) {
  const [sending, setSending] = useState<Sending[]>([]);
  const send = async (files: File[]) => {
    for (const file of files) {
      setSending((s) => [...s, { name: file.name, fraction: 0 }]);
      try {
        await uploadFile(cardId, file, null, (fraction) => setSending((s) => s.map((x) => (x.name === file.name ? { ...x, fraction } : x))));
      } catch (err) {
        toast.error(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setSending((s) => s.filter((x) => x.name !== file.name));
        void queryClient.invalidateQueries({ queryKey: keys.card(cardId) });
      }
    }
  };
  return { sending, send };
}

function Row({ input, cardId }: { input: Input; cardId: string }) {
  const actions = useInputActions(cardId);
  const Icon = ICON[input.kind];
  const [confirm, setConfirm] = useState(false);
  const thumb = input.kind === 'video' || input.kind === 'image';
  return (
    <div className="group flex items-center gap-3 rounded-lg p-1.5 hover:bg-accent/50">
      <a href={mediaUrl(`/media/input/${input.id}`)} target="_blank" rel="noreferrer" className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {thumb && input.meta ? <img src={mediaUrl(`/media/thumb/${input.id}`)} alt="" className="size-full object-cover" loading="lazy" /> : <Icon className="size-4 text-muted-foreground" />}
      </a>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{input.name}</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <select
            value={input.role ?? ''}
            onChange={(e) => actions.update.mutate({ id: input.id, role: (e.target.value || null) as InputRole })}
            className="-ml-1 rounded bg-transparent px-1 py-0.5 hover:bg-accent focus:outline-none"
          >
            {ROLES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {input.meta?.duration ? <span>{secs(input.meta.duration)}</span> : null}
          <span>{bytes(input.size)}</span>
        </div>
      </div>
      {confirm ? (
        <Button size="xs" variant="destructive" onClick={() => actions.remove.mutate(input.id)} onBlur={() => setConfirm(false)} autoFocus>
          Delete
        </Button>
      ) : (
        <Button size="icon-xs" variant="ghost" aria-label="Remove" className="text-muted-foreground opacity-0 group-hover:opacity-100 max-md:opacity-100" onClick={() => setConfirm(true)}>
          <XIcon />
        </Button>
      )}
    </div>
  );
}

export function Files({ cardId, pageId, inputs, uploader }: { cardId: string; pageId: string; inputs: Input[]; uploader: ReturnType<typeof useUploader> }) {
  const pick = useRef<HTMLInputElement>(null);
  // On the phone the files go through the app's background queue (it carries on with the app closed).
  const add = async () => {
    if (!Studio) return pick.current?.click();
    const n = await pickToCard({ id: cardId, pageId });
    if (n) toast(`${n} file${n === 1 ? '' : 's'} uploading`);
  };
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Files</h3>
        <span className="text-xs text-muted-foreground">{inputs.length || ''}</span>
        <div className="flex-1" />
        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => void add()}>
          <PaperclipIcon /> Add
        </Button>
        <input ref={pick} type="file" multiple hidden onChange={(e) => e.target.files && void uploader.send([...e.target.files])} />
      </div>
      {inputs.length === 0 && uploader.sending.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Drop takes, my voice, screenshots or products here.</p>}
      <div className="flex flex-col">
        {inputs.map((i) => (
          <Row key={i.id} input={i} cardId={cardId} />
        ))}
        {uploader.sending.map((s) => (
          <div key={s.name} className="flex items-center gap-3 p-1.5 text-sm text-muted-foreground">
            <div className="size-11 shrink-0 rounded-md bg-muted" />
            <div className="min-w-0 flex-1">
              <div className="truncate">{s.name}</div>
              <div className="mt-1 h-0.5 overflow-hidden rounded bg-muted">
                <div className="h-full bg-foreground/60" style={{ width: `${Math.max(3, s.fraction * 100)}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
