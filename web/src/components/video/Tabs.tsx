// The rail's other tabs: the script (script.md, Claude's and mine) or, in a page's setup, the page's brief (its
// CLAUDE.md), the files (what I gave), the terminal.

import { useQueryClient } from '@tanstack/react-query';
import { FileAudio, FileImage, FileText, FileVideo, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Input, VideoDetail } from '@shared/types';
import { Button } from '@/components/ui/button';
import { mediaUrl } from '@/lib/api';
import { bytes, secs } from '@/lib/format';
import { keys, useBrain, useBrainActions, useScript, useVideoActions } from '@/lib/queries';
import { useUploads } from '@/lib/uploads';
import { TerminalView } from '../TerminalView';

export function ScriptTab({ videoId }: { videoId: string }) {
  const script = useScript(videoId);
  const act = useVideoActions(videoId);
  const [text, setText] = useState<string | null>(null);
  const server = script.data?.text ?? '';
  useEffect(() => setText(null), [server]);
  const value = text ?? server;
  const dirty = text !== null && text !== server;
  return (
    <div className="flex h-full flex-col gap-2">
      <textarea
        value={value}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={() => dirty && act.saveScript.mutate(value)}
        placeholder="No script yet. Claude writes one when the video needs it, or type it here."
        className="min-h-0 flex-1 resize-none rounded-xl border bg-card p-3 text-sm leading-relaxed outline-none focus:border-foreground/25"
        aria-label="Script"
      />
      <p className="text-xs text-muted-foreground">{dirty ? 'Saved when you click away.' : 'script.md in the video’s folder: Claude and you both edit it.'}</p>
    </div>
  );
}

/** The page's CLAUDE.md: who it is, how it talks and looks, its lessons. Claude writes it while setting the page up. */
export function BriefTab({ detail }: { detail: VideoDetail }) {
  const qc = useQueryClient();
  const brain = useBrain();
  const act = useBrainActions();
  const pageId = detail.video.pageId;
  const [text, setText] = useState<string | null>(null);
  const server = brain.data?.pages.find((b) => b.pageId === pageId)?.text ?? '';
  // Claude edits the file itself: read it again as its work comes in.
  const last = detail.thread.at(-1)?.id;
  useEffect(() => void qc.invalidateQueries({ queryKey: keys.brain }), [qc, last]);
  useEffect(() => setText(null), [server]);
  const value = text ?? server;
  const dirty = text !== null && text !== server;
  return (
    <div className="flex h-full flex-col gap-2">
      <textarea
        value={value}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={() => dirty && act.writePage.mutate({ pageId, text: value })}
        className="min-h-0 flex-1 resize-none rounded-xl border bg-card p-3 font-mono text-xs leading-relaxed outline-none focus:border-foreground/25"
        aria-label="The page's brief"
      />
      <p className="text-xs text-muted-foreground">{dirty ? 'Saved when you click away.' : 'The page’s CLAUDE.md: every video’s Claude reads it. Its look is in kit/.'}</p>
    </div>
  );
}

const icon = (i: Input) => (i.kind === 'video' ? FileVideo : i.kind === 'audio' ? FileAudio : i.kind === 'image' ? FileImage : FileText);

export function FilesTab({ detail, onAttach }: { detail: VideoDetail; onAttach: () => void }) {
  const act = useVideoActions(detail.video.id);
  const uploads = useUploads(detail.video.id).filter((u) => u.state !== 'done');
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={onAttach} className="mb-2 rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground hover:border-foreground/30">
        {detail.video.kind === 'page' ? 'Drop your logo, kit, fonts, past posts or screenshots anywhere here, or click to pick them.' : 'Drop takes, your voice or photos anywhere on this video, or click to pick them.'}
      </button>
      {uploads.map((u) => (
        <div key={u.id} className="flex items-center gap-3 py-1.5">
          <div className="grid size-10 place-items-center rounded-lg bg-muted text-xs text-muted-foreground">{u.state === 'failed' ? '!' : `${Math.round(u.fraction * 100)}%`}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-sm">{u.name}</div>
            <div className="mt-1 h-1 overflow-hidden rounded bg-muted">
              <div className="h-full bg-foreground transition-[width]" style={{ width: `${u.fraction * 100}%` }} />
            </div>
          </div>
        </div>
      ))}
      {detail.inputs.map((i) => {
        const Icon = icon(i);
        return (
          <div key={i.id} className="group flex items-center gap-3 py-1.5">
            {i.kind === 'video' || i.kind === 'image' ? <img src={mediaUrl(`/media/thumb/${i.id}`)} alt="" className="size-10 rounded-lg bg-muted object-cover" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} /> : <Icon className="m-2.5 size-5 text-muted-foreground" />}
            <a href={mediaUrl(`/media/input/${i.id}`)} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
              <div className="truncate font-mono text-sm">{i.name}</div>
              <div className="text-xs text-muted-foreground">{[i.meta?.duration ? secs(i.meta.duration) : null, bytes(i.size), i.role].filter(Boolean).join(' · ')}</div>
            </a>
            {confirm === i.id ? (
              <Button size="sm" variant="destructive" onClick={() => act.removeInput.mutate(i.id)}>
                Delete
              </Button>
            ) : (
              <Button size="icon" variant="ghost" className="size-8 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Delete ${i.name}`} onClick={() => setConfirm(i.id)}>
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        );
      })}
      <p className="mt-3 font-mono text-[11px] break-all text-muted-foreground">{detail.video.folder}/files</p>
    </div>
  );
}

/** Claude Code's own screen on this video's session: the same Claude as the thread, without the app around it. */
export function TerminalTab({ detail }: { detail: VideoDetail }) {
  if (detail.job) return <p className="text-sm text-muted-foreground">Claude is working on this video: its session opens here once it’s done (or Stop it).</p>;
  return <TerminalView path={`/api/terminal?videoId=${detail.video.id}`} className="min-h-0 flex-1" />;
}
