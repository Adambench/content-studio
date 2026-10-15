import { toast } from 'sonner';
import type { AssetType } from '@shared/types';
import { errorMessage, uploadFiles } from '@/lib/api';
import { isNative, pickAndUpload } from '@/lib/native';
import { queryClient } from '@/lib/queries';
import type { Media } from '@/lib/types';

/** Upload files into a workspace with a progress toast. */
export function useUpload(wid: string, opts: { pieceId?: string; assetType?: AssetType } = {}) {
  return async (files: File[]) => {
    if (!files.length) return [];
    const params = new URLSearchParams(Object.entries(opts).filter(([, v]) => v) as [string, string][]);
    const label = files.length === 1 ? files[0].name : `${files.length} files`;
    const id = toast.loading(`Uploading ${label}…`);
    try {
      const saved = await uploadFiles<Media[]>(`/workspaces/${wid}/media?${params}`, files, (f) => toast.loading(`Uploading ${label}… ${Math.round(f * 100)}%`, { id }));
      const transcribing = saved.some((m) => m.kind === 'video' || m.kind === 'audio') && !opts.assetType;
      toast.success(`Uploaded ${label}`, { id, description: transcribing ? 'Transcribing in the background.' : undefined });
      queryClient.invalidateQueries({ queryKey: ['media', wid] });
      if (opts.pieceId) queryClient.invalidateQueries({ queryKey: ['piece', opts.pieceId] });
      return saved;
    } catch (err) {
      toast.error(`Upload failed: ${errorMessage(err)}`, { id });
      return [];
    }
  };
}

/**
 * In the Android app: pick with Android's own picker (or the camera) and upload in the background, so big videos keep
 * going when the app is closed. Undefined elsewhere (the file input is used).
 */
export function useNativePick(wid: string, opts: { pieceId?: string; assetType?: AssetType } = {}) {
  if (!isNative) return undefined;
  return async (accept: string | undefined, camera: boolean) => {
    try {
      const types = (accept ?? '').split(',').map((a) => a.trim()).filter(Boolean);
      const n = await pickAndUpload({ workspaceId: wid, pieceId: opts.pieceId ?? null, assetType: opts.assetType ?? null }, types, camera);
      if (n) toast.success(n === 1 ? 'Uploading in the background' : `Uploading ${n} files in the background`, { description: 'It shows up here when it’s done.' });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
}
