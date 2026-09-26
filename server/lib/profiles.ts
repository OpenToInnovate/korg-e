/**
 * Profiles — independent partitions of the roster with memory isolation.
 *
 * A profile owns its own bots, groups and sidebar sections. Every roster row
 * carries a `profileId`; rows without one migrate to {@link DEFAULT_PROFILE_ID}.
 * Memories stay per-agent (see `resolveAgentWorkspace`) and models stay global
 * (gateway `agents.defaults.model`) — profiles partition the roster only.
 *
 * Active profile resolution order: `x-nerve-profile` header → `nerve_profile`
 * cookie → default profile.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withMutex } from './mutex.js';

export interface Profile {
  id: string;
  name: string;
  color: string;
  emoji: string | null;
  order: number;
  createdAt: number;
}

export const DEFAULT_PROFILE_ID = 'korge';
export const DEFAULT_PROFILE_NAME = 'Korg-e';
export const PROFILE_COOKIE = 'nerve_profile';
export const PROFILE_HEADER = 'x-nerve-profile';
export const MAX_PROFILES = 20;
export const PROFILE_SCHEMA_VERSION = 1;

export class ProfileValidationError extends Error {}
export class ProfileNotFoundError extends Error {}
/** Thrown when a request names a row or agent owned by a different profile. */
export class CrossProfileForbiddenError extends Error {
  readonly code = 'cross_profile_forbidden';
  constructor(detail?: string) {
    super(detail ? `cross_profile_forbidden: ${detail}` : 'cross_profile_forbidden');
    this.name = 'CrossProfileForbiddenError';
  }
}

interface ProfileFile {
  version: number;
  profiles: Profile[];
}

function dataDir(): string {
  return process.env.NERVE_DATA_DIR || path.join(os.homedir(), '.nerve');
}

function profilesFile(): string {
  return path.join(dataDir(), 'profiles.json');
}

function slugifyProfile(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug || 'profile';
}

function isValidColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function defaultProfile(): Profile {
  return {
    id: DEFAULT_PROFILE_ID,
    name: DEFAULT_PROFILE_NAME,
    color: '#C46443',
    emoji: null,
    order: 0,
    createdAt: Date.now(),
  };
}

function normalizeProfileFile(raw: unknown): ProfileFile {
  const source = (raw ?? {}) as Partial<ProfileFile>;
  const seen = new Set<string>();
  const profiles: Profile[] = [];
  if (Array.isArray(source.profiles)) {
    for (const p of source.profiles) {
      const candidate = p as Partial<Profile>;
      if (!candidate || typeof candidate.id !== 'string' || !candidate.id) continue;
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      profiles.push({
        id: candidate.id,
        name: typeof candidate.name === 'string' && candidate.name ? candidate.name : candidate.id,
        color: typeof candidate.color === 'string' && isValidColor(candidate.color) ? candidate.color : '#C46443',
        emoji: typeof candidate.emoji === 'string' && candidate.emoji ? candidate.emoji.slice(0, 8) : null,
        order: Number.isFinite(candidate.order) ? Number(candidate.order) : profiles.length,
        createdAt: Number.isFinite(candidate.createdAt) ? Number(candidate.createdAt) : Date.now(),
      });
    }
  }
  if (!seen.has(DEFAULT_PROFILE_ID)) profiles.unshift(defaultProfile());
  return { version: PROFILE_SCHEMA_VERSION, profiles };
}

function readProfileFile(): ProfileFile {
  try {
    return normalizeProfileFile(JSON.parse(fs.readFileSync(profilesFile(), 'utf-8')));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    const seeded = { version: PROFILE_SCHEMA_VERSION, profiles: [defaultProfile()] };
    writeProfileFile(seeded);
    return seeded;
  }
}

function writeProfileFile(data: ProfileFile): void {
  const file = profilesFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/* ── CRUD ──────────────────────────────────────────────────────────── */

/** All profiles, ordered by `order` then name. */
export async function listProfiles(): Promise<Profile[]> {
  const data = readProfileFile();
  return [...data.profiles].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export async function getProfile(id: string): Promise<Profile | undefined> {
  return readProfileFile().profiles.find((p) => p.id === id);
}

export interface CreateProfileInput {
  name: string;
  color?: string;
  emoji?: string | null;
}

export async function createProfile(input: CreateProfileInput): Promise<Profile> {
  const name = (input.name ?? '').trim();
  if (!name || name.length > 60) throw new ProfileValidationError('Profile name must be 1–60 characters');
  if (input.color !== undefined && !isValidColor(input.color)) {
    throw new ProfileValidationError('Color must be a #rrggbb hex value');
  }
  return withMutex('profiles', async () => {
    const data = readProfileFile();
    if (data.profiles.length >= MAX_PROFILES) {
      throw new ProfileValidationError(`Profile limit reached (${MAX_PROFILES})`);
    }
    const id = slugifyProfile(name);
    if (data.profiles.some((p) => p.id === id)) {
      throw new ProfileValidationError(`Profile already exists: ${id}`);
    }
    const profile: Profile = {
      id,
      name,
      color: input.color ?? '#0A84FF',
      emoji: input.emoji ? input.emoji.slice(0, 8) : null,
      order: data.profiles.length,
      createdAt: Date.now(),
    };
    data.profiles.push(profile);
    writeProfileFile(data);
    return profile;
  });
}

export interface UpdateProfileInput {
  name?: string;
  color?: string;
  emoji?: string | null;
  order?: number;
}

export async function updateProfile(id: string, input: UpdateProfileInput): Promise<Profile> {
  return withMutex('profiles', async () => {
    const data = readProfileFile();
    const profile = data.profiles.find((p) => p.id === id);
    if (!profile) throw new ProfileNotFoundError(`Profile not found: ${id}`);
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name || name.length > 60) throw new ProfileValidationError('Profile name must be 1–60 characters');
      profile.name = name;
    }
    if (input.color !== undefined) {
      if (!isValidColor(input.color)) throw new ProfileValidationError('Color must be a #rrggbb hex value');
      profile.color = input.color;
    }
    if (input.emoji !== undefined) {
      profile.emoji = input.emoji ? input.emoji.slice(0, 8) : null;
    }
    if (input.order !== undefined && Number.isFinite(input.order)) {
      profile.order = Number(input.order);
    }
    writeProfileFile(data);
    return profile;
  });
}

/** Delete a profile. The last remaining profile cannot be deleted. */
export async function deleteProfile(id: string): Promise<void> {
  return withMutex('profiles', async () => {
    const data = readProfileFile();
    const index = data.profiles.findIndex((p) => p.id === id);
    if (index < 0) throw new ProfileNotFoundError(`Profile not found: ${id}`);
    if (data.profiles.length <= 1) {
      throw new ProfileValidationError('Cannot delete the last remaining profile');
    }
    data.profiles.splice(index, 1);
    writeProfileFile(data);
  });
}

/* ── Active-profile resolution ──────────────────────────────────────── */

/** Parse a `Cookie` header into a map. */
function parseCookies(header: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    out.set(key, decodeURIComponent(part.slice(eq + 1).trim()));
  }
  return out;
}

/** Raw requested profile id from header → cookie, ignoring existence. */
export function requestedProfileId(header: string | null | undefined, cookieHeader?: string | null): string | null {
  const fromHeader = header?.trim();
  if (fromHeader) return fromHeader;
  const fromCookie = parseCookies(cookieHeader).get(PROFILE_COOKIE);
  return fromCookie?.trim() || null;
}

/**
 * Resolve the active profile: `x-nerve-profile` → `nerve_profile` cookie →
 * default profile. An id that no longer exists falls back to the default
 * profile so a stale cookie never breaks the app.
 *
 * Synchronous by design: several route helpers resolve the profile from a
 * synchronous code path. The store read is a small JSON file already loaded on
 * every request path, so the sync form is the honest one.
 */
export function resolveActiveProfileIdSync(
  header?: string | null,
  cookieHeader?: string | null,
): string {
  const requested = requestedProfileId(header, cookieHeader);
  if (requested) {
    const profiles = readProfileFile().profiles;
    if (profiles.some((p) => p.id === requested)) return requested;
  }
  return DEFAULT_PROFILE_ID;
}

/** Async alias kept for callers already in async context. */
export async function resolveActiveProfileId(
  header?: string | null,
  cookieHeader?: string | null,
): Promise<string> {
  return resolveActiveProfileIdSync(header, cookieHeader);
}

/** Cookie header for `POST /api/profiles/activate`. */
export function profileCookieHeader(id: string): string {
  return `${PROFILE_COOKIE}=${encodeURIComponent(id)}; Path=/; SameSite=Lax; Max-Age=31536000`;
}

/* ── Agent → profile map ────────────────────────────────────────────── */

interface RosterBotRow {
  id?: string;
  agentId?: string | null;
  profileId?: string | null;
}

/** `agent:<id>:main` → `<id>`. Roster bot records store session keys. */
function agentIdFromSessionKey(value: string): string | null {
  const m = /^agent:([^:]+):/.exec(value);
  return m ? m[1] : null;
}

/**
 * agentId → profileId, built from roster bot records. Reads roster.json
 * directly (rather than importing the roster store) to keep this module free
 * of a circular dependency. Agents absent from the roster — "main" and any
 * unlinked agent — belong to the default profile.
 *
 * Both forms are indexed: the raw stored value (a session key like
 * `agent:coder:main`) and its bare agent id (`coder`). The privacy surfaces
 * (memories, file browser, workspace) take a bare agent id, so indexing only
 * the session key would make every cross-profile check miss.
 */
export function buildAgentProfileMap(): Map<string, string> {
  const map = new Map<string, string>();
  let parsed: { bots?: RosterBotRow[] } | null = null;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(dataDir(), 'roster.json'), 'utf-8')) as { bots?: RosterBotRow[] };
  } catch {
    return map;
  }
  for (const bot of parsed?.bots ?? []) {
    if (!bot || typeof bot.agentId !== 'string' || !bot.agentId) continue;
    const profileId = bot.profileId || DEFAULT_PROFILE_ID;
    map.set(bot.agentId, profileId);
    const bare = agentIdFromSessionKey(bot.agentId);
    if (bare) map.set(bare, profileId);
  }
  return map;
}

/** Profile owning an agent. Unknown agents map to the default profile. */
export function agentProfileId(agentId: string | null | undefined): string {
  if (!agentId) return DEFAULT_PROFILE_ID;
  return buildAgentProfileMap().get(agentId) || DEFAULT_PROFILE_ID;
}

/** Throws {@link CrossProfileForbiddenError} when the agent is in another profile. */
export function assertAgentInProfile(agentId: string | null | undefined, activeProfileId: string): void {
  if (!agentId) return;
  const owner = agentProfileId(agentId);
  if (owner !== activeProfileId) {
    throw new CrossProfileForbiddenError(`agent ${agentId} belongs to profile ${owner}`);
  }
}

/** Throws {@link CrossProfileForbiddenError} when a roster row is in another profile. */
export function assertRowInProfile(
  row: { profileId?: string | null } | undefined,
  activeProfileId: string,
  label: string,
): void {
  if (!row) return;
  const owner = row.profileId || DEFAULT_PROFILE_ID;
  if (owner !== activeProfileId) {
    throw new CrossProfileForbiddenError(`${label} belongs to profile ${owner}`);
  }
}
