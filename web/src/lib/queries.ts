import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Card, CardDetail, CardSummary, Comment, Draft, Input, Job, LiveEvent, Page, Rule, Stage, SystemInfo } from '@shared/types';
import { api, eventsUrl } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, refetchOnWindowFocus: true, retry: 1 },
    mutations: { onError: (err) => toast.error(err instanceof Error ? err.message : String(err)) },
  },
});

export const keys = {
  pages: ['pages'] as const,
  board: (pageId?: string) => ['board', pageId ?? 'all'] as const,
  card: (id: string) => ['card', id] as const,
  drafts: (id: string) => ['drafts', id] as const,
  rules: ['rules'] as const,
  system: ['system'] as const,
  devices: ['devices'] as const,
};

export const usePages = () => useQuery({ queryKey: keys.pages, queryFn: () => api<Page[]>('/api/pages') });
export const useBoard = (pageId?: string) => useQuery({ queryKey: keys.board(pageId), queryFn: () => api<CardSummary[]>(`/api/board${pageId ? `?pageId=${pageId}` : ''}`) });
export const useCard = (id: string) => useQuery({ queryKey: keys.card(id), queryFn: () => api<CardDetail>(`/api/cards/${id}`) });
export const useDrafts = (id: string, enabled: boolean) => useQuery({ queryKey: keys.drafts(id), queryFn: () => api<Draft[]>(`/api/cards/${id}/drafts`), enabled });
export const useRules = () => useQuery({ queryKey: keys.rules, queryFn: () => api<Rule[]>('/api/rules') });
export const useSystem = () => useQuery({ queryKey: keys.system, queryFn: () => api<SystemInfo & { usage: { fiveHour?: { utilization: number; resetsAt: number } } | null }>('/api/system'), refetchInterval: 60_000 });
export const useDevices = () => useQuery({ queryKey: keys.devices, queryFn: () => api<{ id: string; name: string; created_at: number; last_seen_at: number | null }[]>('/api/devices') });

function invalidateCard(qc: QueryClient, cardId: string) {
  void qc.invalidateQueries({ queryKey: keys.card(cardId) });
  void qc.invalidateQueries({ queryKey: ['board'] });
}

export function useUpdateCard(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Pick<Card, 'title' | 'script' | 'notes' | 'recipe' | 'stage' | 'caption' | 'pageId'>> & { labels?: Partial<Card['labels']>; between?: [string | null, string | null] }) =>
      api<Card>(`/api/cards/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: (card) => {
      qc.setQueryData<CardDetail>(keys.card(id), (d) => (d ? { ...d, card } : d));
      void qc.invalidateQueries({ queryKey: ['board'] });
    },
  });
}

export function useMoveCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; stage: Stage; between: [string | null, string | null] }) => api<Card>(`/api/cards/${v.id}`, { method: 'PATCH', body: { stage: v.stage, between: v.between } }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['board'] }),
  });
}

export function useCreateCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { pageId: string; title: string; stage?: Stage; recipe?: string }) => api<Card>('/api/cards', { body: v }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['board'] }),
  });
}

/** The big buttons: Write, Hooks, Make, Fix, Approve. */
export function useCardAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { action: 'write' | 'hooks' | 'make' | 'fix' | 'approve' | 'test-render'; body?: unknown }) => api<Job | Card>(`/api/cards/${id}/${v.action}`, { body: v.body ?? {} }),
    onSuccess: () => invalidateCard(qc, id),
  });
}

export function useComment(cardId: string) {
  const qc = useQueryClient();
  const done = () => invalidateCard(qc, cardId);
  return {
    add: useMutation({ mutationFn: (v: { renderId: string | null; versionId: string | null; at?: number | null; end?: number | null; slide?: number | null; text: string }) => api<Comment>(`/api/cards/${cardId}/comments`, { body: v }), onSuccess: done }),
    update: useMutation({ mutationFn: (v: { id: string; text?: string; status?: Comment['status'] }) => api<Comment>(`/api/comments/${v.id}`, { method: 'PATCH', body: { text: v.text, status: v.status } }), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => api(`/api/comments/${id}`, { method: 'DELETE' }), onSuccess: done }),
  };
}

export function useInputActions(cardId: string) {
  const qc = useQueryClient();
  const done = () => invalidateCard(qc, cardId);
  return {
    update: useMutation({ mutationFn: (v: { id: string; role?: Input['role']; name?: string }) => api<Input>(`/api/inputs/${v.id}`, { method: 'PATCH', body: { role: v.role, name: v.name } }), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => api(`/api/inputs/${id}`, { method: 'DELETE' }), onSuccess: done }),
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
      const cards = new Set<string>();
      let board = false;
      for (const ev of batch) {
        if (ev.cardId) cards.add(ev.cardId);
        if (ev.entity === 'card' || ev.entity === 'job' || ev.entity === 'render' || ev.entity === 'comment' || ev.entity === 'input' || ev.entity === 'version') board = true;
        if (ev.entity === 'page') void queryClient.invalidateQueries({ queryKey: keys.pages });
        if (ev.entity === 'rule') void queryClient.invalidateQueries({ queryKey: keys.rules });
        if (ev.entity === 'system') void queryClient.invalidateQueries({ queryKey: keys.system });
      }
      for (const id of cards) void queryClient.invalidateQueries({ queryKey: keys.card(id) });
      if (board) void queryClient.invalidateQueries({ queryKey: ['board'] });
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
