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
import { resolveAgentWorkspace } from './agent-workspace.js';

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

/**
 * Thrown when an agent is already bound to a different profile. Binding an
 * agent to two profiles would leak one profile's agents into the other, so the
 * write is refused rather than silently last-write-wins.
 */
export class AgentAlreadyBoundError extends Error {
  readonly code = 'agent_already_bound';
  constructor(agentId: string, owner: string) {
    super(`agent_already_bound: ${agentId} is bound to profile ${owner}`);
    this.name = 'AgentAlreadyBoundError';
  }
}

interface ProfileFile {
  version: number;
  profiles: Profile[];
  /**
   * agentId → profileId, kept when a bot is deleted or unlinked so memory
   * isolation outlives the roster row. Lives here rather than in roster.json
   * because roster rows are rewritten by every roster write; this record is
   * the durable ownership fact.
   */
  agentLocks: Record<string, string>;
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
  const agentLocks: Record<string, string> = {};
  if (source.agentLocks && typeof source.agentLocks === 'object' && !Array.isArray(source.agentLocks)) {
    for (const [k, v] of Object.entries(source.agentLocks as Record<string, unknown>)) {
      if (typeof k === 'string' && k && typeof v === 'string' && v) agentLocks[k] = v;
    }
  }
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
  return { version: PROFILE_SCHEMA_VERSION, profiles, agentLocks };
}

function readProfileFile(): ProfileFile {
  try {
    return normalizeProfileFile(JSON.parse(fs.readFileSync(profilesFile(), 'utf-8')));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    const seeded: ProfileFile = { version: PROFILE_SCHEMA_VERSION, profiles: [defaultProfile()], agentLocks: {} };
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
/**
 * Resolve the active profile.
 *
 * SECURITY: when the authenticated session carries a profile claim, that claim
 * WINS and the client-supplied header/cookie are ignored entirely — a session
 * bound to profile X must resolve to X, never to Y. The header/cookie path only
 * applies when there is no session claim (auth disabled, or a session minted
 * before profiles existed), and it can only name a profile the server knows.
 */
export function resolveActiveProfileIdSync(
  header?: string | null,
  cookieHeader?: string | null,
  sessionProfileId?: string | null,
): string {
  if (sessionProfileId) {
    const exists = readProfileFile().profiles.some((p) => p.id === sessionProfileId);
    // A session bound to a profile that was later deleted falls back to the
    // default rather than becoming unbound.
    return exists ? sessionProfileId : DEFAULT_PROFILE_ID;
  }
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
  sessionProfileId?: string | null,
): Promise<string> {
  return resolveActiveProfileIdSync(header, cookieHeader, sessionProfileId);
}

/** Cookie header for `POST /api/profiles/activate` (UX hint only; the session claim is authoritative). */
export function profileCookieHeader(id: string): string {
  return `${PROFILE_COOKIE}=${encodeURIComponent(id)}; Path=/; SameSite=Lax; Max-Age=31536000`;
}

/**
 * Active profile for a request, from the SIGNED session claim when present.
 * Every route should use this rather than reading the header/cookie itself, so
 * the session binding can't be bypassed route-by-route.
 */
export function activeProfileIdForRequest(c: {
  req: { header: (name: string) => string | undefined };
  get: (key: 'sessionPayload') => { pid?: string } | undefined;
}): string {
  const session = c.get('sessionPayload');
  return resolveActiveProfileIdSync(
    c.req.header(PROFILE_HEADER) ?? null,
    c.req.header('cookie') ?? null,
    session?.pid ?? null,
  );
}

/** The signed session id, when the request has an authenticated session. */
export function sessionIdForRequest(c: { get: (key: 'sessionPayload') => { sid?: string } | undefined }): string | null {
  return c.get('sessionPayload')?.sid ?? null;
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
 * All key forms an agent may be recorded under. Roster rows store session keys
 * (`agent:coder:main`) while the privacy surfaces take a bare id (`coder`), so
 * a lock or lookup must consider both.
 */
export function agentKeyForms(agentId: string): string[] {
  const forms = new Set<string>();
  const trimmed = agentId.trim();
  if (!trimmed) return [];
  forms.add(trimmed);
  const bare = agentIdFromSessionKey(trimmed);
  if (bare) {
    forms.add(bare);
    forms.add(`agent:${bare}:main`);
  } else {
    // A bare id must also be findable under its session-key form: roster rows
    // and locks store session keys, so looking up only the bare form would miss
    // the agent entirely and fall through to "unowned" — which the default
    // profile is allowed to read. Both directions are required.
    forms.add(`agent:${trimmed}:main`);
  }
  return [...forms];
}

/** Profile an agent is locked to, or null when it holds no lock. */
export function findAgentLock(agentId: string | null | undefined): string | null {
  if (!agentId) return null;
  const { agentLocks } = readProfileFile();
  for (const key of agentKeyForms(agentId)) {
    const owner = agentLocks[key];
    if (owner) return owner;
  }
  return null;
}

/**
 * Bind an agent to a profile. Rebinding within the same profile is a no-op;
 * binding an agent that another profile already owns throws
 * {@link AgentAlreadyBoundError}. Locks are only ever added, never removed —
 * unlinking a bot must not hand its agent back to the pool.
 */
export async function bindAgentToProfile(agentId: string, profileId: string): Promise<void> {
  const forms = agentKeyForms(agentId);
  if (forms.length === 0) return;
  await withMutex('profiles', async () => {
    const data = readProfileFile();
    for (const key of forms) {
      const owner = data.agentLocks[key];
      if (owner && owner !== profileId) throw new AgentAlreadyBoundError(agentId, owner);
    }
    for (const key of forms) {
      if (!data.agentLocks[key]) data.agentLocks[key] = profileId;
    }
    writeProfileFile(data);
  });
}

/**
 * agentId → profileId for every agent that has an owner. Persistent locks are
 * consulted first, so an agent whose bot was deleted or unlinked still resolves
 * to its original profile. Roster rows only fill gaps — they never overwrite a
 * lock, and an agent bound in two profiles by legacy data keeps the lock's
 * profile rather than last-write-wins.
 *
 * Agents with no lock and no roster row are simply absent: that is the
 * "unowned" case, and callers decide what it means (see
 * {@link agentProfileId}).
 */
export function buildAgentProfileMap(): Map<string, string> {
  const map = new Map<string, string>();
  let agentLocks: Record<string, string> = {};
  try {
    agentLocks = readProfileFile().agentLocks;
  } catch {
    agentLocks = {};
  }
  for (const [key, profileId] of Object.entries(agentLocks)) {
    map.set(key, profileId);
  }
  let parsed: { bots?: RosterBotRow[] } | null = null;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(dataDir(), 'roster.json'), 'utf-8')) as { bots?: RosterBotRow[] };
  } catch {
    return map;
  }
  for (const bot of parsed?.bots ?? []) {
    if (!bot || typeof bot.agentId !== 'string' || !bot.agentId) continue;
    // A row with no explicit profile is legacy/unowned, not the default
    // profile: do not let it silently claim the agent.
    if (typeof bot.profileId !== 'string' || !bot.profileId) continue;
    const forms = agentKeyForms(bot.agentId);
    for (const key of forms) {
      if (!map.has(key)) map.set(key, bot.profileId as string);
    }
  }
  return map;
}

/**
 * Canonical default workspace root for an agent.
 *
 * Single source of truth shared with agent provisioning, so the path the file
 * guard checks and the path a provisioned agent is given cannot diverge.
 */
export function defaultAgentWorkspaceRoot(agentId: string): string {
  const base = process.env.NERVE_AGENT_WORKSPACE_ROOT?.trim()
    || path.join(process.env.HOME || os.homedir(), '.openclaw');
  return path.join(base, `workspace-${agentId}`);
}

/** Which agent owns a filesystem path, or null when the path is not inside any
 * agent workspace.
 *
 * Used by the file routes, which take a bare path and no agent, to work out
 * whose workspace a request is trying to read. Resolution goes through
 * `resolveAgentWorkspace`, i.e. the same configured-workspace lookup the rest of
 * the app uses, so a custom `workspace` in the gateway config is attributed
 * correctly.
 */
export function agentIdOwningWorkspacePath(targetPath: string): string | null {
  let resolved: string;
  try {
    resolved = path.resolve(targetPath);
  } catch {
    return null;
  }
  const candidates = new Set<string>();
  // The adult's own agent is always a candidate: it is unowned by definition,
  // but its workspace must still be attributed so other profiles cannot read it.
  candidates.add('main');
  for (const key of buildAgentProfileMap().keys()) {
    const bare = agentIdFromSessionKey(key) ?? key;
    if (bare) candidates.add(bare);
  }
  let locks: Record<string, string> = {};
  try {
    locks = readProfileFile().agentLocks;
  } catch {
    locks = {};
  }
  for (const key of Object.keys(locks)) {
    const bare = agentIdFromSessionKey(key) ?? key;
    if (bare) candidates.add(bare);
  }
  for (const agentId of candidates) {
    // Check both the configured workspace and the default one: a provisioned
    // agent may exist on disk before/without a gateway config entry.
    const roots: string[] = [defaultAgentWorkspaceRoot(agentId)];
    try {
      roots.unshift(resolveAgentWorkspace(agentId).workspaceRoot);
    } catch {
      // Unresolvable agent — the default root is still checked.
    }
    for (const workspaceRoot of roots) {
      const withSep = workspaceRoot.endsWith(path.sep) ? workspaceRoot : workspaceRoot + path.sep;
      if (resolved === workspaceRoot || resolved.startsWith(withSep)) return agentId;
    }
  }
  return null;
}

/** Profile owning an agent, or `null` when the agent is unowned (no lock and no
 * roster row). Callers must treat `null` explicitly — defaulting it to the
 * default profile is what let unlinked agents leak between profiles.
 */
export function agentProfileId(agentId: string | null | undefined): string | null {
  if (!agentId) return null;
  const lock = findAgentLock(agentId);
  if (lock) return lock;
  const map = buildAgentProfileMap();
  for (const key of agentKeyForms(agentId)) {
    const owner = map.get(key);
    if (owner) return owner;
  }
  return null;
}

/**
 * Claim an agent for a profile: refuses the write when the agent already
 * belongs to a different profile, then persists the lock. This is the single
 * authority the roster store uses, so the "who owns this agent" check and the
 * lock write cannot drift apart.
 */
/**
 * True when `candidate` is the same agent as `listed`, in either id form.
 * Bridge pairs are stored with whichever form the caller supplied, so matching
 * must not depend on the form being identical.
 */
export function agentIdentityMatches(candidate: string, listed: string): boolean {
  const a = new Set(agentKeyForms(candidate));
  return agentKeyForms(listed).some((k) => a.has(k));
}

export async function claimAgent(agentId: string, profileId: string): Promise<void> {
  const owner = agentProfileId(agentId);
  if (owner !== null && owner !== profileId) throw new AgentAlreadyBoundError(agentId, owner);
  await bindAgentToProfile(agentId, profileId);
}

/**
 * Agent ids that may legitimately appear in a profile, in both forms.
 *
 * The client compares these against gateway session keys and bare agent ids, so
 * both are returned. Mirrors the fail-closed rule in
 * {@link assertAgentInProfile}: an agent is included only when it resolves to
 * this profile, and an agent owned by another profile is never included.
 *
 * Unowned agents are not enumerable here — the server has no session list — so
 * for the default profile this returns the agents it actually owns. The client
 * must keep treating "claimed by no profile" as visible to `korge` only.
 */
export function ownedAgentIdsForProfile(profileId: string): string[] {
  const out = new Set<string>();
  for (const [agentId, owner] of buildAgentProfileMap()) {
    if (owner === profileId) out.add(agentId);
  }
  return [...out].sort();
}

/**
 * Guard the privacy surfaces. Fails closed for non-default profiles: an agent
 * nobody owns is only reachable from the default profile, never from a family
 * member's.
 */
export function assertAgentInProfile(agentId: string | null | undefined, activeProfileId: string): void {
  if (!agentId) return;
  const owner = agentProfileId(agentId);
  if (owner === null) {
    // Unowned agent. The default profile keeps today's permissive behaviour so
    // existing unlinked agents keep working; every other profile refuses.
    if (activeProfileId !== DEFAULT_PROFILE_ID) {
      throw new CrossProfileForbiddenError(`agent ${agentId} is not owned by any profile`);
    }
    return;
  }
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
