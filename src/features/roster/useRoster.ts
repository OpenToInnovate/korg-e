import { useCallback, useEffect, useRef, useState } from 'react';
import type { RosterBot, RosterData, RosterGroup, RosterSection } from './types';
import { toAgentSessionKey, toBareAgentId } from '@/features/profiles/agentKeys';

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

/**
 * Read the active profile's agent-ownership set.
 *
 * This is a PRIVACY BOUNDARY, so it fails closed: any problem (endpoint
 * missing, non-2xx, malformed body) yields an empty set, which renders
 * roster bots only and no bare session rows. Showing another profile's
 * agents is far worse than showing none.
 */
async function readOwnedAgentIds(res: Response): Promise<string[]> {
  if (!res.ok) return [];
  try {
    const body = await readJson(res);
    const ids = (body as { ownedAgentIds?: unknown } | null)?.ownedAgentIds;
    if (!Array.isArray(ids)) return [];
    return ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

/** True when the server refused access to this profile's data. */
function isForbidden(res: Response): boolean {
  return res.status === 401 || res.status === 403;
}

const EMPTY_ROSTER: RosterData = { version: 2, bots: [], groups: [], sections: [], profileId: null };

/** Outcome of the last roster load, so the UI can tell "empty" from "forbidden". */
export type RosterAccess = 'unknown' | 'ok' | 'denied' | 'error';

/** Roster data + mutations for bot profiles and group chats. */
export function useRoster() {
  const [roster, setRoster] = useState<RosterData>(EMPTY_ROSTER);
  const [ownedAgentIds, setOwnedAgentIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * How the last load ended. `denied` means the SERVER refused this profile —
   * the UI must say "not permitted", never render an empty list, because an
   * empty list reads as "no data" and hides a real access failure.
   */
  const [access, setAccess] = useState<RosterAccess>('unknown');

  // Bumped on every refresh; a response from an older generation is discarded
  // so a slow request issued for the previous profile can never repopulate the
  // sidebar after the user has already switched.
  const requestGenerationRef = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++requestGenerationRef.current;
    try {
      // Fetched together so roster and ownership always describe the same
      // profile, and both are discarded together if a switch races us.
      const [rosterRes, ownershipRes] = await Promise.all([
        fetch('/api/roster'),
        fetch('/api/profiles/agent-ownership'),
      ]);
      if (generation !== requestGenerationRef.current) return;

      // A refusal must be visible and must not leave another profile's data
      // on screen. Clear first, then report.
      if (isForbidden(rosterRes) || isForbidden(ownershipRes)) {
        setRoster(EMPTY_ROSTER);
        setOwnedAgentIds([]);
        setAccess('denied');
        setError('You do not have access to this profile’s data. Switch to a profile you own, or sign in again.');
        return;
      }

      const body = await readJson(rosterRes);
      throwIfError(rosterRes, body);
      setRoster(normalizeRoster(body));
      setAccess('ok');

      // Ownership fails closed, but never silently: an empty agent list with
      // no explanation would look like "this profile has no agents".
      if (!ownershipRes.ok) {
        setOwnedAgentIds([]);
        setError('Could not verify which agents belong to this profile, so only saved bots are shown.');
      } else {
        setOwnedAgentIds(await readOwnedAgentIds(ownershipRes));
        setError(null);
      }
    } catch (err) {
      if (generation !== requestGenerationRef.current) return;
      // Any failure drops the previous profile's rows rather than leaving
      // stale data on screen.
      setRoster(EMPTY_ROSTER);
      setOwnedAgentIds([]);
      setAccess('error');
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
    setOwnedAgentIds([]);
    setAccess('unknown');
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

  /**
   * POST /api/roster/bots/provision — provisions the gateway agent AND creates
   * the roster row in ONE call, so there is no half-state to roll back.
   * Contract verified against `server/routes/roster.ts` (`provisionBotSchema`):
   * `name` required; `agentId` optional (the server derives the slug when
   * omitted). Note it has no `enabledSkills` — apply those with a follow-up
   * PATCH. The server takes the profile from its own session binding
   * (`activeProfileId(c)`), so we never send a profile id in the body.
   */
  const provisionBot = useCallback(async (input: {
    name: string;
    agentId?: string | null;
    title?: string;
    description?: string;
    color?: string;
    avatar?: string;
    sectionId?: string | null;
    emoji?: string | null;
  }): Promise<{ bot: RosterBot; sessionKey: string }> => {
    const res = await fetch('/api/roster/bots/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: input.name,
        // Omit entirely when absent so the server derives the slug itself.
        ...(input.agentId ? { agentId: toBareAgentId(input.agentId) } : {}),
        title: input.title,
        description: input.description,
        color: input.color,
        avatar: input.avatar,
        sectionId: input.sectionId ?? undefined,
        emoji: input.emoji ?? undefined,
      }),
    });
    const body = await readJson(res);
    if (!res.ok) {
      const err = (body ?? {}) as { error?: unknown };
      const error = new Error(
        typeof err.error === 'string' ? err.error : `Could not create the agent (${res.status})`,
      ) as Error & { status: number };
      error.status = res.status;
      throw error;
    }
    const data = (body ?? {}) as { bot?: RosterBot; sessionKey?: string };
    // Always normalise: a bare id here would recreate the shell-bot bug.
    const sessionKey = toAgentSessionKey(data.sessionKey ?? data.bot?.agentId);
    if (!sessionKey || !data.bot) throw new Error('Provisioning returned no bot');
    return { bot: { ...data.bot, agentId: sessionKey }, sessionKey };
  }, []);

  /**
   * POST /api/roster/bots/:id/link — bind an ALREADY-REGISTERED agent to an
   * existing row. This is the "Bot Maintainer" repair path, and the only link
   * path the server actually implements: `provision` cannot take an existing
   * agent, because `provisionAgent()` refuses an id that already exists.
   */
  const linkBotAgent = useCallback(async (input: { botId: string; agentId: string }): Promise<{ bot: RosterBot; sessionKey: string }> => {
    const res = await fetch(`/api/roster/bots/${encodeURIComponent(input.botId)}/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: toBareAgentId(input.agentId) }),
    });
    const body = await readJson(res);
    if (!res.ok) {
      const err = (body ?? {}) as { error?: unknown };
      const raw = typeof err.error === 'string' ? err.error : `Could not link agent (${res.status})`;
      // The server's machine codes are not user-readable; translate them.
      const message = raw === 'agent_already_bound'
        ? 'That agent already belongs to another profile.'
        : raw === 'cross_profile_forbidden'
          ? 'That agent belongs to another profile.'
          : raw;
      const error = new Error(message) as Error & { status: number; code: string };
      error.status = res.status;
      error.code = raw;
      throw error;
    }
    const data = (body ?? {}) as { bot?: RosterBot; sessionKey?: string };
    const sessionKey = toAgentSessionKey(data.sessionKey ?? data.bot?.agentId);
    if (!sessionKey || !data.bot) throw new Error('Linking returned no bot');
    return { bot: { ...data.bot, agentId: sessionKey }, sessionKey };
  }, []);

  /**
   * GET /api/roster/agents/available?profileId= — agents not yet bound to any
   * profile's roster.
   *
   * Until this route lands it 404s. We deliberately THROW rather than return an
   * empty list: a silent `[]` renders as "no agents available", which reads as
   * "there is nothing here" rather than "this could not be checked". The dialog
   * surfaces the real reason.
   */
  const listLinkableAgents = useCallback(async (profileId: string): Promise<{ id: string; name?: string }[]> => {
    const res = await fetch(`/api/roster/agents/available?profileId=${encodeURIComponent(profileId)}`);
    const body = await readJson(res);
    if (!res.ok) {
      const err = (body ?? {}) as { error?: unknown };
      const raw = typeof err.error === 'string' ? err.error : `Could not list available agents (${res.status})`;
      const message = res.status === 404
        ? 'Could not list agents to link: the server does not provide an available-agents list yet.'
        : raw;
      const error = new Error(message) as Error & { status: number };
      error.status = res.status;
      throw error;
    }
    const list = (body as { agents?: unknown } | null)?.agents;
    if (!Array.isArray(list)) {
      throw new Error('Available-agents list was malformed');
    }
    return list
      .map((a) => (a ?? {}) as { id?: unknown; agentId?: unknown; name?: unknown })
      .map((a) => ({ id: toBareAgentId(String(a.id ?? a.agentId ?? '')), name: typeof a.name === 'string' ? a.name : undefined }))
      .filter((a) => a.id.length > 0);
  }, []);

  return {
    roster,
    ownedAgentIds,
    loading,
    access,
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
    provisionBot,
    linkBotAgent,
    listLinkableAgents,
    kickoffGroup,
    chatWithGroup,
    handoffToBot,
  };
}

export type RosterApi = ReturnType<typeof useRoster>;
