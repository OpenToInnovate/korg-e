import { useCallback, useEffect, useState } from 'react';
import type { RosterBot, RosterData, RosterGroup, RosterSection } from './types';

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error('Unexpected server response');
  }
}

function throwIfError(res: Response, body: unknown): void {
  if (res.ok) return;
  const message =
    body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `Request failed (${res.status})`;
  throw new Error(message);
}

/** Roster data + mutations for bot profiles and group chats. */
export function useRoster() {
  const [roster, setRoster] = useState<RosterData>({ version: 2, bots: [], groups: [], sections: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/roster');
      const body = await readJson(res);
      throwIfError(res, body);
      setRoster(body as RosterData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load roster');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        const result = await fn();
        await refresh();
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Request failed');
        throw err;
      }
    },
    [refresh],
  );

  const createBot = useCallback(
    (input: { name: string; title?: string; description?: string; color?: string; avatar?: string; agentId?: string | null; sectionId?: string | null; enabledSkills?: string[] }) =>
      mutate(async () => {
        const res = await fetch('/api/roster/bots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        const body = await readJson(res);
        throwIfError(res, body);
        return body as RosterBot;
      }),
    [mutate],
  );

  const updateBot = useCallback(
    (id: string, input: Partial<Pick<RosterBot, 'name' | 'title' | 'description' | 'color' | 'avatar' | 'agentId' | 'sectionId' | 'pinned' | 'hidden' | 'notifications' | 'enabledSkills'>>) =>
      mutate(async () => {
        const res = await fetch(`/api/roster/bots/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        const body = await readJson(res);
        throwIfError(res, body);
        return body as RosterBot;
      }),
    [mutate],
  );

  const duplicateBot = useCallback(
    (id: string) =>
      mutate(async () => {
        const res = await fetch(`/api/roster/bots/${encodeURIComponent(id)}/duplicate`, { method: 'POST' });
        const body = await readJson(res);
        throwIfError(res, body);
        return body as RosterBot;
      }),
    [mutate],
  );

  const deleteBot = useCallback(
    (id: string, deleteRoutines = false) =>
      mutate(async () => {
        const res = await fetch(`/api/roster/bots/${encodeURIComponent(id)}${deleteRoutines ? '?deleteRoutines=true' : ''}`, {
          method: 'DELETE',
        });
        const body = await readJson(res);
        throwIfError(res, body);
        return body as { ok: boolean; removedFromGroups: string[]; routinesRemoved: number };
      }),
    [mutate],
  );

  const createGroup = useCallback(
    (input: { name: string; memberBotIds: string[]; alphaBotId?: string | null }) =>
      mutate(async () => {
        const res = await fetch('/api/roster/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        const body = await readJson(res);
        throwIfError(res, body);
        return body as RosterGroup;
      }),
    [mutate],
  );

  const updateGroup = useCallback(
    (id: string, input: Partial<Pick<RosterGroup, 'name' | 'memberBotIds' | 'alphaBotId' | 'pinned' | 'hidden'>>) =>
      mutate(async () => {
        const res = await fetch(`/api/roster/groups/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        const body = await readJson(res);
        throwIfError(res, body);
        return body as RosterGroup;
      }),
    [mutate],
  );

  const deleteGroup = useCallback(
    (id: string) =>
      mutate(async () => {
        const res = await fetch(`/api/roster/groups/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const body = await readJson(res);
        throwIfError(res, body);
      }),
    [mutate],
  );

  const createSection = useCallback(
    (name: string) =>
      mutate(async () => {
        const res = await fetch('/api/roster/sections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const body = await readJson(res);
        throwIfError(res, body);
        return body as RosterSection;
      }),
    [mutate],
  );

  const renameSection = useCallback(
    (id: string, name: string) =>
      mutate(async () => {
        const res = await fetch(`/api/roster/sections/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const body = await readJson(res);
        throwIfError(res, body);
        return body as RosterSection;
      }),
    [mutate],
  );

  const deleteSection = useCallback(
    (id: string) =>
      mutate(async () => {
        const res = await fetch(`/api/roster/sections/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const body = await readJson(res);
        throwIfError(res, body);
        return body as { movedBotIds: string[] };
      }),
    [mutate],
  );

  const moveBotToSection = useCallback(
    (botId: string, sectionId: string | null) =>
      mutate(async () => {
        const res = await fetch(`/api/roster/bots/${encodeURIComponent(botId)}/section`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sectionId }),
        });
        const body = await readJson(res);
        throwIfError(res, body);
        return body as RosterBot;
      }),
    [mutate],
  );

  const kickoffGroup = useCallback(async (id: string, text: string) => {
    const res = await fetch(`/api/roster/groups/${encodeURIComponent(id)}/kickoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const body = await readJson(res);
    throwIfError(res, body);
    return body as { ok: boolean; results: Record<string, { ok: boolean; error?: string; skipped?: boolean }> };
  }, []);

  const chatWithGroup = useCallback(async (id: string, text: string) => {
    const res = await fetch(`/api/roster/groups/${encodeURIComponent(id)}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const body = await readJson(res);
    throwIfError(res, body);
    return body as { ok: boolean };
  }, []);

  const handoffToBot = useCallback(async (id: string, text: string, from?: string) => {
    const res = await fetch(`/api/roster/bots/${encodeURIComponent(id)}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, from }),
    });
    const body = await readJson(res);
    throwIfError(res, body);
    return body as { ok: boolean };
  }, []);

  return {
    roster,
    loading,
    error,
    refresh,
    createBot,
    updateBot,
    duplicateBot,
    deleteBot,
    createGroup,
    updateGroup,
    deleteGroup,
    createSection,
    renameSection,
    deleteSection,
    moveBotToSection,
    kickoffGroup,
    chatWithGroup,
    handoffToBot,
  };
}

export type RosterApi = ReturnType<typeof useRoster>;
