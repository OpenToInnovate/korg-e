import { useCallback, useEffect, useRef, useState } from 'react';
import type { RosterBot, RosterData, RosterGroup, RosterSection } from './types';

/** Normalize an /api/roster payload, tolerating a missing profileId. */
function normalizeRoster(body: unknown): RosterData {
  const raw = (body ?? {}) as Partial<RosterData>;
  return {
    version: typeof raw.version === 'number' ? raw.version : 2,
    bots: Array.isArray(raw.bots) ? raw.bots : [],
    groups: Array.isArray(raw.groups) ? raw.groups : [],
    sections: Array.isArray(raw.sections) ? raw.sections : [],
    profileId: typeof raw.profileId === 'string' ? raw.profileId : null,
  };
}

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

const EMPTY_ROSTER: RosterData = { version: 2, bots: [], groups: [], sections: [], profileId: null };

/** Roster data + mutations for bot profiles and group chats. */
export function useRoster() {
  const [roster, setRoster] = useState<RosterData>(EMPTY_ROSTER);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Bumped on every refresh; a response from an older generation is discarded
  // so a slow request issued for the previous profile can never repopulate the
  // sidebar after the user has already switched.
  const requestGenerationRef = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++requestGenerationRef.current;
    try {
      const res = await fetch('/api/roster');
      const body = await readJson(res);
      if (generation !== requestGenerationRef.current) return;
      throwIfError(res, body);
      setRoster(normalizeRoster(body));
      setError(null);
    } catch (err) {
      if (generation !== requestGenerationRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load roster');
    } finally {
      if (generation === requestGenerationRef.current) setLoading(false);
    }
  }, []);

  /**
   * Drop everything immediately when the active profile changes. Called by
   * the host *before* refetching so the previous profile's bots, groups and
   * sections are never visible, even for a frame.
   */
  const clearForProfileSwitch = useCallback(() => {
    // Invalidate any in-flight request for the old profile.
    requestGenerationRef.current += 1;
    setRoster(EMPTY_ROSTER);
    setError(null);
    setLoading(true);
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
    clearForProfileSwitch,
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
