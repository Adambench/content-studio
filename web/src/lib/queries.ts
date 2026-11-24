import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Brain, Page, Job, LiveEvent, Note, SystemInfo, Video, VideoDetail, VideoSummary } from '@shared/types';
import { api, eventsUrl } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, refetchOnWindowFocus: true, retry: 1 },
    mutations: { onError: (err) => toast.error(err instanceof Error ? err.message : String(err)) },
  },
});

export const keys = {
  pages: ['pages'] as const,
  videos: ['videos'] as const,
  video: (id: string) => ['video', id] as const,
  script: (id: string) => ['script', id] as const,
  brain: ['brain'] as const,
  system: ['system'] as const,
  devices: ['devices'] as const,
};

export type Usage = { fiveHour?: { utilization: number; resetsAt: number }; sevenDay?: { utilization: number; resetsAt: number } } | null;

export const usePages = () => useQuery({ queryKey: keys.pages, queryFn: () => api<Page[]>('/api/pages') });
export const useVideos = () => useQuery({ queryKey: keys.videos, queryFn: () => api<VideoSummary[]>('/api/videos') });
export const useVideo = (id: string) => useQuery({ queryKey: keys.video(id), queryFn: () => api<VideoDetail>(`/api/videos/${id}`) });
export const useScript = (id: string) => useQuery({ queryKey: keys.script(id), queryFn: () => api<{ text: string }>(`/api/videos/${id}/script`) });
export const useBrain = () => useQuery({ queryKey: keys.brain, queryFn: () => api<Brain>('/api/brain'), staleTime: 60_000 });
export const useSystem = () => useQuery({ queryKey: keys.system, queryFn: () => api<SystemInfo & { usage: Usage }>('/api/system'), refetchInterval: 60_000 });
export const useDevices = () => useQuery({ queryKey: keys.devices, queryFn: () => api<{ id: string; name: string; created_at: number; last_seen_at: number | null }[]>('/api/devices') });

function refresh(qc: QueryClient, videoId?: string) {
  if (videoId) void qc.invalidateQueries({ queryKey: keys.video(videoId) });
  void qc.invalidateQueries({ queryKey: keys.videos });
}

export function useCreateVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { pageId: string; text?: string; title?: string; kind?: string; go?: boolean }) => api<Video>('/api/videos', { body: v }),
    onSuccess: (v) => refresh(qc, v.id),
  });
}

export function useUpdatePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; name?: string; color?: string }) => api<Page>(`/api/pages/${v.id}`, { method: 'PATCH', body: { name: v.name, color: v.color } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.pages });
      void qc.invalidateQueries({ queryKey: keys.brain });
    },
  });
}

/** Everything done to one video from its page. */
export function useVideoActions(id: string) {
  const qc = useQueryClient();
  const done = () => refresh(qc, id);
  const post = <T,>(path: string, body: unknown = {}) => api<T>(`/api/videos/${id}/${path}`, { body });
  return {
    say: useMutation({ mutationFn: (text: string) => post<Job>('messages', { text }), onSuccess: done }),
    go: useMutation({ mutationFn: () => post<Job>('go'), onSuccess: done }),
    fix: useMutation({ mutationFn: () => post<Job>('fix'), onSuccess: done }),
    stop: useMutation({ mutationFn: () => post('stop'), onSuccess: done }),
    answer: useMutation({ mutationFn: (v: { itemId: string; option: number }) => post<Job>('answer', v), onSuccess: done }),
    approve: useMutation({ mutationFn: (n: number) => post<Video>('approve', { n }), onSuccess: done }),
    posted: useMutation({ mutationFn: (posted: boolean) => post<Video>('posted', { posted }), onSuccess: done }),
    update: useMutation({ mutationFn: (patch: { title?: string; caption?: string; kind?: string; pageId?: string }) => api<Video>(`/api/videos/${id}`, { method: 'PATCH', body: patch }), onSuccess: done }),
    remove: useMutation({ mutationFn: () => api(`/api/videos/${id}`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: keys.videos }) }),
    seen: useMutation({ mutationFn: () => post('seen'), onSuccess: () => void qc.invalidateQueries({ queryKey: keys.videos }) }),
    addNote: useMutation({ mutationFn: (v: { versionN: number; at?: number | null; slide?: number | null; text: string }) => post<Note>('notes', v), onSuccess: done }),
    dropNote: useMutation({ mutationFn: (noteId: string) => api(`/api/notes/${noteId}`, { method: 'DELETE' }), onSuccess: done }),
    removeInput: useMutation({ mutationFn: (inputId: string) => api(`/api/inputs/${inputId}`, { method: 'DELETE' }), onSuccess: done }),
    saveScript: useMutation({ mutationFn: (text: string) => api(`/api/videos/${id}/script`, { method: 'PUT', body: { text } }), onSuccess: () => void qc.invalidateQueries({ queryKey: keys.script(id) }) }),
  };
}

export function useBrainActions() {
  const qc = useQueryClient();
  const set = (b: Brain) => qc.setQueryData(keys.brain, b);
  return {
    toggle: useMutation({ mutationFn: (v: { scope: string; line: number; on: boolean }) => api<Brain>('/api/brain/lessons', { method: 'PATCH', body: v }), onSuccess: set }),
    add: useMutation({ mutationFn: (v: { scope: string; text: string }) => api<Brain>('/api/brain/lessons', { body: v }), onSuccess: set }),
    writePage: useMutation({ mutationFn: (v: { pageId: string; text: string }) => api<Brain>(`/api/brain/pages/${v.pageId}`, { method: 'PUT', body: { text: v.text } }), onSuccess: set }),
  };
}

/** Live updates: every change the server announces refetches what shows it. */
export function connectLive() {
  let source: EventSource | null = null;
  let closed = false;
  const open = () => {
    if (closed) return;
    source = new EventSource(eventsUrl());
    source.onmessage = (e) => {
      const batch = JSON.parse(e.data as string) as LiveEvent[];
      const videos = new Set<string>();
      let list = false;
      for (const ev of batch) {
        if (ev.videoId) videos.add(ev.videoId);
        if (ev.entity !== 'brain' && ev.entity !== 'page' && ev.entity !== 'system') list = true;
        if (ev.entity === 'page') void queryClient.invalidateQueries({ queryKey: keys.pages });
        if (ev.entity === 'brain' || ev.entity === 'page') void queryClient.invalidateQueries({ queryKey: keys.brain });
        if (ev.entity === 'system') void queryClient.invalidateQueries({ queryKey: keys.system });
      }
      for (const id of videos) void queryClient.invalidateQueries({ queryKey: keys.video(id) });
      if (list) void queryClient.invalidateQueries({ queryKey: keys.videos });
    };
    // EventSource reconnects by itself; when it gives up (server restarted), open a new one.
    source.onerror = () => {
      if (source?.readyState === EventSource.CLOSED) setTimeout(open, 3000);
    };
  };
  open();
  return () => {
    closed = true;
    source?.close();
  };
}
