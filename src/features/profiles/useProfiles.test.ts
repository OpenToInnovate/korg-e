import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useProfiles, LastProfileError, isLastProfileError, type Profile } from './useProfiles';

const PROFILE_A: Profile = { id: 'p1', name: 'Sam', color: '#0A84FF', emoji: null, order: 0, createdAt: 1 };
const PROFILE_B: Profile = { id: 'p2', name: 'Alex', color: '#30D158', emoji: '🐺', order: 1, createdAt: 2 };

type FetchCall = { url: string; init?: RequestInit };

function jsonRes(data: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => (data === undefined ? '' : JSON.stringify(data)),
  } as unknown as Response;
}

describe('useProfiles', () => {
  let calls: FetchCall[];

  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(handler: (call: FetchCall) => Response) {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      return handler(call);
    }));
  }

  it('loads profiles and the active id from the server', async () => {
    mockFetch(() => jsonRes({ profiles: [PROFILE_A, PROFILE_B], activeProfileId: 'p2' }));

    const { result } = renderHook(() => useProfiles());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profiles).toHaveLength(2);
    expect(result.current.activeProfileId).toBe('p2');
    expect(result.current.activeProfile?.name).toBe('Alex');
  });

  it('falls back to the first profile when the active id is unknown', async () => {
    mockFetch(() => jsonRes({ profiles: [PROFILE_A], activeProfileId: 'missing' }));

    const { result } = renderHook(() => useProfiles());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.activeProfileId).toBe('p1');
  });

  it('activates a profile and notifies the host so it can wipe stale state', async () => {
    mockFetch((call) => {
      if (call.url === '/api/profiles') return jsonRes({ profiles: [PROFILE_A, PROFILE_B], activeProfileId: 'p1' });
      if (call.url === '/api/profiles/activate') return jsonRes({ ok: true, activeProfileId: 'p2' });
      throw new Error(`unexpected ${call.url}`);
    });

    const onProfileActivated = vi.fn();
    const { result } = renderHook(() => useProfiles({ onProfileActivated }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.activateProfile('p2'); });

    const activateCall = calls.find((c) => c.url === '/api/profiles/activate');
    expect(activateCall?.init?.method).toBe('POST');
    expect(JSON.parse(String(activateCall?.init?.body))).toEqual({ id: 'p2' });
    expect(onProfileActivated).toHaveBeenCalledWith('p2');
    expect(result.current.activeProfileId).toBe('p2');
  });

  it('is a no-op when activating the already-active profile', async () => {
    mockFetch(() => jsonRes({ profiles: [PROFILE_A], activeProfileId: 'p1' }));
    const onProfileActivated = vi.fn();

    const { result } = renderHook(() => useProfiles({ onProfileActivated }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.activateProfile('p1'); });

    expect(calls.filter((c) => c.url === '/api/profiles/activate')).toHaveLength(0);
    expect(onProfileActivated).not.toHaveBeenCalled();
  });

  it('still notifies the host when activate fails, so state can be repaired', async () => {
    mockFetch((call) => {
      if (call.url === '/api/profiles') return jsonRes({ profiles: [PROFILE_A, PROFILE_B], activeProfileId: 'p1' });
      return jsonRes({ error: 'nope' }, { ok: false, status: 500 });
    });

    const onProfileActivated = vi.fn();
    const { result } = renderHook(() => useProfiles({ onProfileActivated }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.activateProfile('p2').catch(() => undefined); });

    expect(result.current.error).toBe('nope');
    expect(onProfileActivated).not.toHaveBeenCalled();
  });

  it('creates a profile with name, color and emoji', async () => {
    const created: Profile = { id: 'p3', name: 'Robin', color: '#FF9F0A', emoji: '🦊', order: 2, createdAt: 3 };
    mockFetch((call) => {
      if (call.url === '/api/profiles' && call.init?.method === 'POST') return jsonRes(created);
      return jsonRes({ profiles: [PROFILE_A], activeProfileId: 'p1' });
    });

    const { result } = renderHook(() => useProfiles());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.createProfile({ name: '  Robin ', color: '#FF9F0A', emoji: '🦊' }); });

    const post = calls.find((c) => c.init?.method === 'POST');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ name: 'Robin', color: '#FF9F0A', emoji: '🦊' });
    expect(result.current.profiles.map((p) => p.id)).toContain('p3');
  });

  it('refuses to create a blank-named profile without hitting the server', async () => {
    mockFetch(() => jsonRes({ profiles: [PROFILE_A], activeProfileId: 'p1' }));
    const { result } = renderHook(() => useProfiles());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.createProfile({ name: '   ' }).catch(() => undefined); });

    expect(calls.filter((c) => c.init?.method === 'POST')).toHaveLength(0);
  });

  it('renames a profile via PATCH', async () => {
    mockFetch((call) => {
      if (call.url === '/api/profiles/p1' && call.init?.method === 'PATCH') {
        return jsonRes({ ...PROFILE_A, name: 'Samantha' });
      }
      return jsonRes({ profiles: [PROFILE_A], activeProfileId: 'p1' });
    });

    const { result } = renderHook(() => useProfiles());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.updateProfile('p1', { name: 'Samantha' }); });

    expect(result.current.profiles[0].name).toBe('Samantha');
  });

  it('surfaces a 409 delete as LastProfileError', async () => {
    mockFetch((call) => {
      if (call.url === '/api/profiles/p1' && call.init?.method === 'DELETE') {
        return jsonRes({ error: 'last profile' }, { ok: false, status: 409 });
      }
      return jsonRes({ profiles: [PROFILE_A], activeProfileId: 'p1' });
    });

    const { result } = renderHook(() => useProfiles());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let caught: unknown;
    await act(async () => { caught = await result.current.deleteProfile('p1').catch((e) => e); });

    expect(isLastProfileError(caught)).toBe(true);
    expect(caught).toBeInstanceOf(LastProfileError);
    // Profile survives, and the user gets a readable reason.
    expect(result.current.profiles).toHaveLength(1);
    expect(result.current.error).toMatch(/at least one profile/i);
  });

  it('drops a deleted profile and moves the active id when it was active', async () => {
    mockFetch((call) => {
      if (call.url === '/api/profiles/p1' && call.init?.method === 'DELETE') return jsonRes(undefined, { status: 204 });
      return jsonRes({ profiles: [PROFILE_A, PROFILE_B], activeProfileId: 'p1' });
    });

    const { result } = renderHook(() => useProfiles());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.deleteProfile('p1'); });

    expect(result.current.profiles.map((p) => p.id)).toEqual(['p2']);
    expect(result.current.activeProfileId).toBe('p2');
  });

  it('surfaces a load failure', async () => {
    mockFetch(() => jsonRes({ error: 'boom' }, { ok: false, status: 500 }));
    const { result } = renderHook(() => useProfiles());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('boom');
  });
});
