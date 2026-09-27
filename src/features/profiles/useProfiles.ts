/**
 * useProfiles — Nerve user profiles (household profiles).
 *
 * A profile owns an independent set of groups and bots. The server is the
 * source of truth: the active profile is stored in a cookie and every
 * `/api/roster` response is filtered by it. This hook only reflects that
 * state and triggers refetches when the active profile changes.
 *
 * @module
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** A household profile. */
export interface Profile {
  id: string;
  name: string;
  color: string;
  emoji: string | null;
  order: number;
  createdAt: number;
}

/** Fields accepted when creating a profile. */
export interface CreateProfileInput {
  name: string;
  color?: string;
  emoji?: string | null;
}

/** Fields accepted when patching a profile. */
export type UpdateProfileInput = Partial<Pick<Profile, 'name' | 'color' | 'emoji' | 'order'>>;

/** Thrown when the server refuses a delete because it is the last profile. */
export class LastProfileError extends Error {
  readonly code = 'last-profile' as const;

  constructor(message = 'A household needs at least one profile.') {
    super(message);
    this.name = 'LastProfileError';
  }
}

/** Type guard for the friendly 409 case. */
export function isLastProfileError(err: unknown): err is LastProfileError {
  return err instanceof LastProfileError;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error('Unexpected server response');
  }
}

function errorMessage(res: Response, body: unknown): string {
  if (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string') {
    return (body as { error: string }).error;
  }
  return `Request failed (${res.status})`;
}

function throwIfError(res: Response, body: unknown): void {
  if (res.ok) return;
  throw new Error(errorMessage(res, body));
}

function normalizeProfile(raw: unknown): Profile {
  const p = (raw ?? {}) as Partial<Profile>;
  return {
    id: String(p.id ?? ''),
    name: String(p.name ?? 'Unnamed'),
    color: typeof p.color === 'string' && p.color ? p.color : '#0A84FF',
    emoji: typeof p.emoji === 'string' && p.emoji ? p.emoji : null,
    order: typeof p.order === 'number' ? p.order : 0,
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
  };
}

function normalizeList(raw: unknown): Profile[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeProfile).filter((p) => p.id);
}

/** True when the server refused access to this profile. */
function isForbiddenStatus(res: Response): boolean {
  return res.status === 401 || res.status === 403;
}

/** Outcome of the last profiles load, so the UI can distinguish refusal from empty. */
export type ProfilesAccess = 'unknown' | 'ok' | 'denied';

export interface UseProfilesOptions {
  /**
   * Runs after a successful activate. The host app uses this to drop every
   * scrap of the previous profile (roster, sessions, transcript) before
   * refetching, so nothing from the old profile can linger on screen.
   */
  onProfileActivated?: (profileId: string) => void | Promise<void>;
}

export interface UseProfilesResult {
  profiles: Profile[];
  activeProfile: Profile | null;
  activeProfileId: string | null;
  loading: boolean;
  /** True while an activate round-trip is in flight. */
  switching: boolean;
  error: string | null;
  /** `denied` when the server refused this profile. */
  access: ProfilesAccess;
  refresh: () => Promise<void>;
  createProfile: (input: CreateProfileInput) => Promise<Profile>;
  updateProfile: (id: string, input: UpdateProfileInput) => Promise<Profile>;
  /** Throws {@link LastProfileError} when the server answers 409. */
  deleteProfile: (id: string) => Promise<void>;
  activateProfile: (id: string) => Promise<void>;
}

/** Profile list, mutations, and active-profile switching. */
export function useProfiles({ onProfileActivated }: UseProfilesOptions = {}): UseProfilesResult {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** `denied` = the server refused this profile. Never render as "empty". */
  const [access, setAccess] = useState<ProfilesAccess>('unknown');

  // Kept in a ref so `activateProfile` never re-creates on parent re-render.
  const onActivatedRef = useRef(onProfileActivated);
  onActivatedRef.current = onProfileActivated;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/profiles');
      // A refusal is handled inline (res is not in scope in catch) and must
      // also drop any profile state we were already showing.
      if (isForbiddenStatus(res)) {
        setProfiles([]);
        setActiveProfileId(null);
        setAccess('denied');
        setError('You do not have access to view profiles. Sign in again.');
        return;
      }
      const body = await readJson(res);
      throwIfError(res, body);
      const data = (body ?? {}) as { profiles?: unknown; activeProfileId?: unknown };
      const list = normalizeList(data.profiles);
      setProfiles(list);
      const nextActive = typeof data.activeProfileId === 'string' ? data.activeProfileId : null;
      // The server's session binding is the ONLY source of truth for which
      // profile is active. We never fall back to a client-chosen profile: that
      // would let the browser assert a binding the server never granted.
      setActiveProfileId(nextActive && list.some((p) => p.id === nextActive) ? nextActive : null);
      setAccess('ok');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profiles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createProfile = useCallback(async (input: CreateProfileInput): Promise<Profile> => {
    const trimmed = input.name.trim();
    if (!trimmed) throw new Error('Give the profile a name.');

    const payload: CreateProfileInput = { name: trimmed };
    if (input.color) payload.color = input.color;
    if (input.emoji !== undefined) payload.emoji = input.emoji;

    try {
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await readJson(res);
      throwIfError(res, body);
      const created = normalizeProfile(body);
      setProfiles((prev) => [...prev, created]);
      setError(null);
      return created;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create profile');
      throw err;
    }
  }, []);

  const updateProfile = useCallback(async (id: string, input: UpdateProfileInput): Promise<Profile> => {
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const body = await readJson(res);
      throwIfError(res, body);
      const updated = normalizeProfile(body);
      setProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setError(null);
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update profile');
      throw err;
    }
  }, []);

  const deleteProfile = useCallback(async (id: string): Promise<void> => {
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const body = await readJson(res).catch(() => null);
      if (!res.ok) {
        // 409 = refusing to remove the final profile. Surface it as a
        // friendly condition rather than a raw HTTP failure.
        if (res.status === 409) throw new LastProfileError();
        throw new Error(errorMessage(res, body));
      }
      const remaining = profiles.filter((p) => p.id !== id);
      setProfiles(remaining);
      // If we deleted the active profile, the SERVER decides what is active
      // now. We do not pick a replacement client-side.
      if (activeProfileId === id) await refresh();
      setError(null);
    } catch (err) {
      if (isLastProfileError(err)) setError(err.message);
      else setError(err instanceof Error ? err.message : 'Could not delete profile');
      throw err;
    }
  }, [activeProfileId, profiles, refresh]);

  const activateProfile = useCallback(async (id: string): Promise<void> => {
    if (id === activeProfileId) return;
    setSwitching(true);
    try {
      const res = await fetch('/api/profiles/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const body = await readJson(res);
      throwIfError(res, body);
      const serverActive = (body as { activeProfileId?: unknown } | null)?.activeProfileId;
      if (typeof serverActive === 'string') {
        setActiveProfileId(serverActive);
      } else {
        // The server did not confirm the binding — re-read it from the server
        // rather than trusting the id this browser asked for.
        await refresh();
      }
      setError(null);
      // Host wipes previous-profile state *before* refetching anything.
      await onActivatedRef.current?.(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not switch profile');
      throw err;
    } finally {
      setSwitching(false);
    }
  }, [activeProfileId, refresh]);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? null,
    [activeProfileId, profiles],
  );

  return {
    profiles,
    activeProfile,
    activeProfileId,
    loading,
    switching,
    error,
    access,
    refresh,
    createProfile,
    updateProfile,
    deleteProfile,
    activateProfile,
  };
}

export type ProfilesApi = ReturnType<typeof useProfiles>;
