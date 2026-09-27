import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRoster } from './useRoster';

type FetchCall = { url: string; init?: RequestInit };

function jsonRes(data: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => (data === undefined ? '' : JSON.stringify(data)),
  } as unknown as Response;
}

const SAM_ROSTER = {
  version: 2,
  profileId: 'p1',
  bots: [{ id: 'b1', name: 'Sam Bot' }],
  groups: [{ id: 'g1', name: 'Sam Group' }],
  sections: [],
};

const ALEX_ROSTER = {
  version: 2,
  profileId: 'p2',
  bots: [{ id: 'b2', name: 'Alex Bot' }],
  groups: [],
  sections: [],
};

let calls: FetchCall[];

beforeEach(() => { calls = []; });

afterEach(() => { vi.restoreAllMocks(); });

describe('useRoster — profile scoping', () => {
  it('exposes the profileId the roster belongs to', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push({ url });
      return jsonRes(SAM_ROSTER);
    }));

    const { result } = renderHook(() => useRoster());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.roster.profileId).toBe('p1');
  });

  it('tolerates a server response without profileId', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ version: 2, bots: [], groups: [], sections: [] })));

    const { result } = renderHook(() => useRoster());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.roster.profileId).toBeNull();
  });

  it('clearForProfileSwitch empties the roster immediately', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(SAM_ROSTER)));
    const { result } = renderHook(() => useRoster());
    await waitFor(() => expect(result.current.roster.bots).toHaveLength(1));

    act(() => { result.current.clearForProfileSwitch(); });

    // No trace of the old profile survives the switch, not even for a frame.
    expect(result.current.roster.bots).toEqual([]);
    expect(result.current.roster.groups).toEqual([]);
    expect(result.current.roster.sections).toEqual([]);
    expect(result.current.roster.profileId).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it('discards a slow in-flight response from the previous profile', async () => {
    let releaseFirst: (() => void) | null = null;

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push({ url });
      // First (Sam) request hangs until we release it.
      if (calls.length === 1) {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
        return jsonRes(SAM_ROSTER);
      }
      return jsonRes(ALEX_ROSTER);
    }));

    const { result } = renderHook(() => useRoster());

    // Profile switches while Sam's roster request is still in flight.
    act(() => { result.current.clearForProfileSwitch(); });

    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.roster.bots[0]?.name).toBe('Alex Bot'));

    // Now let the stale Sam response land — it must be ignored.
    await act(async () => { releaseFirst?.(); await Promise.resolve(); });

    expect(result.current.roster.profileId).toBe('p2');
    expect(result.current.roster.bots.map((b: { name: string }) => b.name)).toEqual(['Alex Bot']);
  });

  it('drops a stale error from the previous profile', async () => {
    let releaseFirst: (() => void) | null = null;

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push({ url });
      if (calls.length === 1) {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
        return jsonRes({ error: 'sam exploded' }, { ok: false, status: 500 });
      }
      return jsonRes(ALEX_ROSTER);
    }));

    const { result } = renderHook(() => useRoster());
    act(() => { result.current.clearForProfileSwitch(); });
    await act(async () => { await result.current.refresh(); });

    await act(async () => { releaseFirst?.(); await Promise.resolve(); });

    expect(result.current.error).toBeNull();
    expect(result.current.roster.profileId).toBe('p2');
  });

  it('loads the active profile agent-ownership set', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push({ url });
      if (String(url).includes('agent-ownership')) {
        return jsonRes({ profileId: 'p1', ownedAgentIds: ['mir-tutor', 'agent:mir-tutor:main'] });
      }
      return jsonRes(SAM_ROSTER);
    }));

    const { result } = renderHook(() => useRoster());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.ownedAgentIds).toEqual(['mir-tutor', 'agent:mir-tutor:main']);
  });

  it('fails closed when the ownership endpoint is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push({ url });
      if (String(url).includes('agent-ownership')) return jsonRes({ error: 'nope' }, { ok: false, status: 404 });
      return jsonRes(SAM_ROSTER);
    }));

    const { result } = renderHook(() => useRoster());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Empty set => the sidebar renders no bare session rows at all.
    expect(result.current.ownedAgentIds).toEqual([]);
    // The roster itself still loads.
    expect(result.current.roster.bots).toHaveLength(1);
  });

  it('fails closed on a malformed ownership payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push({ url });
      if (String(url).includes('agent-ownership')) return jsonRes({ ownedAgentIds: 'nope' });
      return jsonRes(SAM_ROSTER);
    }));

    const { result } = renderHook(() => useRoster());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.ownedAgentIds).toEqual([]);
  });

  it('clears ownership on a profile switch so it cannot bleed across', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push({ url });
      if (String(url).includes('agent-ownership')) {
        return jsonRes({ profileId: 'p1', ownedAgentIds: ['mir-tutor', 'adult-agent'] });
      }
      return jsonRes(SAM_ROSTER);
    }));

    const { result } = renderHook(() => useRoster());
    await waitFor(() => expect(result.current.ownedAgentIds).toContain('adult-agent'));

    act(() => { result.current.clearForProfileSwitch(); });

    expect(result.current.ownedAgentIds).toEqual([]);
  });
});

/**
 * PROFILE-BINDING CONTRACT — the client must reflect the SERVER's decision and
 * must never let a browser-asserted profile widen access or read as "empty".
 */
describe('useRoster — access refusal is never shown as an empty profile', () => {
  beforeEach(() => { calls = []; });

  it('marks a 403 as denied and shows no roster data', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push({ url });
      return jsonRes({ error: 'forbidden' }, { ok: false, status: 403 });
    }));

    const { result } = renderHook(() => useRoster());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.access).toBe('denied');
    expect(result.current.roster.bots).toEqual([]);
    expect(result.current.error).toMatch(/do not have access/i);
  });

  it('REGRESSION: a refusal drops the previous profile’s rows from screen', async () => {
    let denied = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push({ url });
      if (String(url).includes('agent-ownership')) {
        return denied ? jsonRes({ error: 'forbidden' }, { ok: false, status: 403 }) : jsonRes({ profileId: 'p1', ownedAgentIds: ['mir-tutor'] });
      }
      return denied ? jsonRes({ error: 'forbidden' }, { ok: false, status: 403 }) : jsonRes(SAM_ROSTER);
    }));

    const { result } = renderHook(() => useRoster());
    await waitFor(() => expect(result.current.roster.bots).toHaveLength(1));
    expect(result.current.access).toBe('ok');

    // Server refuses after a switch.
    denied = true;
    await act(async () => { await result.current.refresh(); });

    // Stale rows must not linger, and it must not read as an empty profile.
    expect(result.current.roster.bots).toEqual([]);
    expect(result.current.ownedAgentIds).toEqual([]);
    expect(result.current.access).toBe('denied');
  });

  it('clears roster rows on any transport failure too', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push({ url });
      return jsonRes({ error: 'boom' }, { ok: false, status: 500 });
    }));

    const { result } = renderHook(() => useRoster());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.access).toBe('error');
    expect(result.current.roster.bots).toEqual([]);
  });

  it('surfaces an ownership failure instead of silently showing no agents', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push({ url });
      if (String(url).includes('agent-ownership')) return jsonRes({ error: 'nope' }, { ok: false, status: 500 });
      return jsonRes(SAM_ROSTER);
    }));

    const { result } = renderHook(() => useRoster());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.ownedAgentIds).toEqual([]);
    // Fail closed, but say so — an unexplained empty list reads as "no agents".
    expect(result.current.error).toMatch(/could not verify which agents belong/i);
  });

  it('does not treat a denial as a normal error state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ error: 'forbidden' }, { ok: false, status: 403 })));
    const { result } = renderHook(() => useRoster());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.access).not.toBe('ok');
  });
});
