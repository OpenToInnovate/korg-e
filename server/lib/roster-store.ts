/**
 * Roster store — bot profiles + group chats for Korg-e Bot.
 *
 * Bots are long-lived named teammates. Each bot may link to a gateway agent
 * (root session key / agentId); groups reference 2–6 bots by id. All state
 * persists in `${NERVE_DATA_DIR:-~/.nerve}/roster.json` with mutex-protected
 * atomic writes (same pattern as the kanban store). Single-user: last write
 * wins, no CAS versioning.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { withMutex } from './mutex.js';
import { AgentAlreadyBoundError, CrossProfileForbiddenError, DEFAULT_PROFILE_ID, claimAgent } from './profiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

export interface RosterBot {
  id: string;
  /** Owning profile. Absent in pre-profiles files; migrates to the default profile. */
  profileId: string;
  /** Linked gateway agent (root session key or agentId). Null until linked. */
  agentId: string | null;
  /** Sidebar section id (project/client grouping). Null = Unassigned. */
  sectionId: string | null;
  /** Corgi variant id (front-end registry). Empty = derive from name. */
  avatar: string;
  name: string;
  title: string;
  description: string;
  /** Collar/avatar color hex. */
  color: string;
  pinned: boolean;
  hidden: boolean;
  /** Per-bot OS/mobile notification preference. */
  notifications: boolean;
  /** Skill ids enabled for this bot. */
  enabledSkills: string[];
  createdAt: number;
  updatedAt: number;
}

export interface RosterSection {
  id: string;
  /** Owning profile. Absent in pre-profiles files; migrates to the default profile. */
  profileId: string;
  name: string;
  order: number;
  createdAt: number;
}

export interface RosterGroup {
  id: string;
  /** Owning profile. Absent in pre-profiles files; migrates to the default profile. */
  profileId: string;
  name: string;
  /** 2–6 bot ids. */
  memberBotIds: string[];
  /** Bot that owns the group chat and delegates to members (the "Alpha"). */
  alphaBotId: string | null;
  pinned: boolean;
  hidden: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RosterData {
  version: number;
  bots: RosterBot[];
  groups: RosterGroup[];
  sections: RosterSection[];
}

export const MAX_GROUP_MEMBERS = 6;
export const MIN_GROUP_MEMBERS = 2;
export const MAX_ROSTER_BOTS = 50;
export const MAX_SECTIONS = 20;
export const ROSTER_SCHEMA_VERSION = 2;

export class RosterValidationError extends Error {}
export class RosterNotFoundError extends Error {}


function dataFile(): string {
  const base = process.env.NERVE_DATA_DIR || path.join(os.homedir(), '.nerve');
  return path.join(base, 'roster.json');
}

function legacyCandidates(): string[] {
  return [
    path.join(PROJECT_ROOT, 'server-dist', 'data', 'roster.json'),
    path.join(PROJECT_ROOT, 'server', 'data', 'roster.json'),
  ];
}

function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return slug || 'bot';
}

function uniqueId(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
}

function isValidColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/**
 * Validate group members against the active profile. Distinguishes the two
 * failure modes deliberately: an id owned by another profile is a 403
 * (cross_profile_forbidden), an id that exists nowhere is a 400 validation
 * error, so clients can tell "not yours" from "doesn't exist".
 */
export function validateGroupMembers(memberBotIds: string[], bots: RosterBot[], profileId: string): void {
  if (memberBotIds.length < MIN_GROUP_MEMBERS || memberBotIds.length > MAX_GROUP_MEMBERS) {
    throw new RosterValidationError(`Groups need ${MIN_GROUP_MEMBERS}–${MAX_GROUP_MEMBERS} bots`);
  }
  if (new Set(memberBotIds).size !== memberBotIds.length) {
    throw new RosterValidationError('Duplicate group members');
  }
  const byId = new Map(bots.map((b) => [b.id, b]));
  for (const id of memberBotIds) {
    const bot = byId.get(id);
    if (!bot) throw new RosterValidationError(`Unknown bot: ${id}`);
    // Post-migration a missing profileId is an anomaly, not "the adult
    // profile": surface it instead of letting the bot mix in.
    if (typeof bot.profileId !== 'string' || !bot.profileId) {
      throw new CrossProfileForbiddenError(`bot ${id} has no owning profile`);
    }
    if (bot.profileId !== profileId) {
      throw new CrossProfileForbiddenError(`bot ${id} belongs to profile ${bot.profileId}`);
    }
  }
}

/**
 * Find a row the active profile may touch. A row owned by another profile is
 * rejected as cross-profile rather than silently filtered: the request named
 * a real id, it just isn't yours to read or edit.
 */
function findScoped<T extends { id: string; profileId?: string | null }>(
  list: T[],
  id: string,
  profileId: string,
  label: string,
): T {
  const row = list.find((r) => r.id === id);
  if (!row) throw new RosterNotFoundError(`${label} not found: ${id}`);
  // Legacy rows were migrated on load, so a missing profileId here is a real
  // anomaly. Surface it as cross-profile rather than defaulting it into the
  // adult profile.
  if (typeof row.profileId !== 'string' || !row.profileId) {
    throw new CrossProfileForbiddenError(`${label} has no owning profile`);
  }
  if (row.profileId !== profileId) {
    throw new CrossProfileForbiddenError(`${label} belongs to profile ${row.profileId}`);
  }
  return row;
}

function inProfile<T extends { profileId?: string | null }>(rows: T[], profileId: string): T[] {
  // Rows with no profileId are unowned and excluded — never folded into the
  // default profile.
  return rows.filter((r) => typeof r.profileId === 'string' && r.profileId === profileId);
}

/** Normalize a persisted payload across schema versions (adds sections, sectionId, profileId). */
function normalizeData(raw: Partial<RosterData>): RosterData {
  const bots = Array.isArray(raw.bots)
    ? raw.bots.map((b) => ({
      ...b,
      profileId: b.profileId || DEFAULT_PROFILE_ID,
      sectionId: b.sectionId ?? null,
      avatar: b.avatar ?? '',
    }))
    : [];
  const groups = Array.isArray(raw.groups)
    ? raw.groups.map((g) => ({
      ...g,
      profileId: g.profileId || DEFAULT_PROFILE_ID,
      alphaBotId: g.alphaBotId ?? null,
    }))
    : [];
  const sections = Array.isArray(raw.sections)
    ? raw.sections.map((s) => ({ ...s, profileId: s.profileId || DEFAULT_PROFILE_ID }))
    : [];
  return { version: ROSTER_SCHEMA_VERSION, bots, groups, sections };
}

function readData(): RosterData {
  const file = dataFile();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<RosterData>;
    return normalizeData(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // One-time legacy migration
    for (const legacy of legacyCandidates()) {
      try {
        const raw = JSON.parse(fs.readFileSync(legacy, 'utf-8')) as Partial<RosterData>;
        const data = normalizeData(raw);
        writeData(data);
        return data;
      } catch { /* try next */ }
    }
    return { version: ROSTER_SCHEMA_VERSION, bots: [], groups: [], sections: [] };
  }
}

function writeData(data: RosterData): void {
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export interface CreateBotInput {
  name: string;
  title?: string;
  description?: string;
  color?: string;
  agentId?: string | null;
  sectionId?: string | null;
  avatar?: string;
  enabledSkills?: string[];
}

export interface UpdateBotInput {
  name?: string;
  title?: string;
  description?: string;
  color?: string;
  agentId?: string | null;
  sectionId?: string | null;
  avatar?: string;
  pinned?: boolean;
  hidden?: boolean;
  notifications?: boolean;
  enabledSkills?: string[];
}

export interface CreateGroupInput {
  name: string;
  memberBotIds: string[];
  alphaBotId?: string | null;
}

export interface UpdateGroupInput {
  name?: string;
  memberBotIds?: string[];
  alphaBotId?: string | null;
  pinned?: boolean;
  hidden?: boolean;
}

/** Get the roster scoped to one profile. */
export async function getRoster(profileId: string = DEFAULT_PROFILE_ID): Promise<RosterData> {
  return withMutex('roster', async () => {
    const data = readData();
    return {
      version: ROSTER_SCHEMA_VERSION,
      bots: inProfile(data.bots, profileId),
      groups: inProfile(data.groups, profileId),
      sections: inProfile(data.sections, profileId),
    };
  });
}

/** Create a bot profile. */
export async function createBot(input: CreateBotInput, profileId: string = DEFAULT_PROFILE_ID): Promise<RosterBot> {
  return withMutex('roster', async () => {
    const data = readData();
    const scopedBots = inProfile(data.bots, profileId);
    const scopedGroups = inProfile(data.groups, profileId);
    if (scopedBots.length + scopedGroups.length >= MAX_ROSTER_BOTS) {
      throw new RosterValidationError(`Roster is limited to ${MAX_ROSTER_BOTS} bots and groups combined`);
    }
    const name = input.name.trim();
    if (!name || name.length > 100) throw new RosterValidationError('Bot name must be 1–100 characters');
    if (input.color !== undefined && !isValidColor(input.color)) {
      throw new RosterValidationError('Color must be a #rrggbb hex value');
    }
    // Exclusivity at the source: an agent may be bound to bots in at most one
    // profile. Refuse the write rather than storing a duplicate binding.
    if (input.agentId) await claimAgent(input.agentId, profileId);
    const now = Date.now();
    const bot: RosterBot = {
      id: uniqueId(`${slugify(name)}-${crypto.randomBytes(3).toString('hex')}`, new Set(data.bots.map((b) => b.id))),
      profileId,
      agentId: input.agentId ?? null,
      sectionId: input.sectionId ?? null,
      avatar: input.avatar ?? '',
      name,
      title: (input.title ?? '').slice(0, 140),
      description: (input.description ?? '').slice(0, 2000),
      color: input.color ?? '#0A84FF',
      pinned: false,
      hidden: false,
      notifications: true,
      enabledSkills: input.enabledSkills ?? [],
      createdAt: now,
      updatedAt: now,
    };
    data.bots.push(bot);
    writeData(data);
    return bot;
  });
}

/** Update a bot profile. */
export async function updateBot(id: string, input: UpdateBotInput, profileId: string = DEFAULT_PROFILE_ID): Promise<RosterBot> {
  return withMutex('roster', async () => {
    const data = readData();
    const bot = findScoped(data.bots, id, profileId, 'Bot');
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name || name.length > 100) throw new RosterValidationError('Bot name must be 1–100 characters');
      bot.name = name;
    }
    if (input.title !== undefined) bot.title = input.title.slice(0, 140);
    if (input.description !== undefined) bot.description = input.description.slice(0, 2000);
    if (input.color !== undefined) {
      if (!isValidColor(input.color)) throw new RosterValidationError('Color must be a #rrggbb hex value');
      bot.color = input.color;
    }
    if (input.agentId !== undefined) {
      if (input.agentId) await claimAgent(input.agentId, profileId);
      bot.agentId = input.agentId;
    }
    if (input.avatar !== undefined) {
      if (input.avatar.length > 40 || (input.avatar !== '' && !/^[a-z0-9-]+$/.test(input.avatar))) {
        throw new RosterValidationError('Invalid avatar id');
      }
      bot.avatar = input.avatar;
    }
    if (input.sectionId !== undefined) {
      if (input.sectionId !== null && !data.sections.some((sec) => sec.id === input.sectionId)) {
        throw new RosterValidationError(`Unknown section: ${input.sectionId}`);
      }
      if (input.sectionId !== null) {
        const owner = data.sections.find((sec) => sec.id === input.sectionId)?.profileId || DEFAULT_PROFILE_ID;
        if (owner !== profileId) {
          throw new CrossProfileForbiddenError(`section ${input.sectionId} belongs to profile ${owner}`);
        }
      }
      bot.sectionId = input.sectionId;
    }
    if (input.pinned !== undefined) bot.pinned = input.pinned;
    if (input.hidden !== undefined) bot.hidden = input.hidden;
    if (input.notifications !== undefined) bot.notifications = input.notifications;
    if (input.enabledSkills !== undefined) bot.enabledSkills = input.enabledSkills;
    bot.updatedAt = Date.now();
    writeData(data);
    return bot;
  });
}

/** Duplicate a bot profile (skills + settings, no history). */
export async function duplicateBot(id: string, profileId: string = DEFAULT_PROFILE_ID): Promise<RosterBot> {
  const data = await getRoster(profileId);
  const source = data.bots.find((b) => b.id === id);
  if (!source) {
    // Distinguish cross-profile from missing so the route can answer 403 vs 404.
    const raw = readData();
    if (raw.bots.some((b) => b.id === id)) {
      throw new CrossProfileForbiddenError(`bot belongs to profile ${raw.bots.find((b) => b.id === id)?.profileId}`);
    }
    throw new RosterNotFoundError(`Bot not found: ${id}`);
  }
  return createBot({
    name: `${source.name} copy`.slice(0, 100),
    title: source.title,
    description: source.description,
    color: source.color,
    agentId: null,
    avatar: source.avatar,
    enabledSkills: [...source.enabledSkills],
  }, profileId);
}

/** Delete a bot profile (also drops it from groups). Returns removed group ids. */
export async function deleteBot(id: string, profileId: string = DEFAULT_PROFILE_ID): Promise<{ removedFromGroups: string[] }> {
  return withMutex('roster', async () => {
    const data = readData();
    const index = data.bots.findIndex((b) => b.id === id);
    if (index < 0) throw new RosterNotFoundError(`Bot not found: ${id}`);
    if ((data.bots[index].profileId || DEFAULT_PROFILE_ID) !== profileId) {
      throw new CrossProfileForbiddenError(`bot belongs to profile ${data.bots[index].profileId}`);
    }
    const [removed] = data.bots.splice(index, 1);
    void removed;
    const removedFromGroups: string[] = [];
    for (const group of data.groups) {
      if ((group.profileId || DEFAULT_PROFILE_ID) !== profileId) continue;
      if (group.memberBotIds.includes(id)) {
        group.memberBotIds = group.memberBotIds.filter((m) => m !== id);
        group.updatedAt = Date.now();
        removedFromGroups.push(group.id);
      }
      if (group.alphaBotId === id) {
        group.alphaBotId = null;
        group.updatedAt = Date.now();
      }
    }
    // Drop groups left with fewer than 2 members
    data.groups = data.groups.filter(
      (g) => (g.profileId || DEFAULT_PROFILE_ID) !== profileId || g.memberBotIds.length >= MIN_GROUP_MEMBERS,
    );
    writeData(data);
    return { removedFromGroups };
  });
}

/** Create a group chat. */
export async function createGroup(input: CreateGroupInput, profileId: string = DEFAULT_PROFILE_ID): Promise<RosterGroup> {
  return withMutex('roster', async () => {
    const data = readData();
    const scopedBots = inProfile(data.bots, profileId);
    if (scopedBots.length + inProfile(data.groups, profileId).length >= MAX_ROSTER_BOTS) {
      throw new RosterValidationError(`Roster is limited to ${MAX_ROSTER_BOTS} bots and groups combined`);
    }
    const name = input.name.trim();
    if (!name || name.length > 100) throw new RosterValidationError('Group name must be 1–100 characters');
    validateGroupMembers(input.memberBotIds, data.bots, profileId);
    if (input.alphaBotId !== undefined && input.alphaBotId !== null) {
      const alpha = data.bots.find((b) => b.id === input.alphaBotId);
      if (!alpha) throw new RosterValidationError(`Unknown alpha bot: ${input.alphaBotId}`);
      const alphaOwner = alpha.profileId || DEFAULT_PROFILE_ID;
      if (alphaOwner !== profileId) {
        throw new CrossProfileForbiddenError(`alpha bot ${input.alphaBotId} belongs to profile ${alphaOwner}`);
      }
    }
    const now = Date.now();
    const group: RosterGroup = {
      id: uniqueId(`${slugify(name)}-${crypto.randomBytes(3).toString('hex')}`, new Set(data.groups.map((g) => g.id))),
      profileId,
      name,
      memberBotIds: [...input.memberBotIds],
      alphaBotId: input.alphaBotId ?? null,
      pinned: false,
      hidden: false,
      createdAt: now,
      updatedAt: now,
    };
    data.groups.push(group);
    writeData(data);
    return group;
  });
}

/** Update a group chat. */
export async function updateGroup(id: string, input: UpdateGroupInput, profileId: string = DEFAULT_PROFILE_ID): Promise<RosterGroup> {
  return withMutex('roster', async () => {
    const data = readData();
    const group = findScoped(data.groups, id, profileId, 'Group');
    const scopedBots = inProfile(data.bots, profileId);
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name || name.length > 100) throw new RosterValidationError('Group name must be 1–100 characters');
      group.name = name;
    }
    if (input.memberBotIds !== undefined) {
      validateGroupMembers(input.memberBotIds, data.bots, profileId);
      group.memberBotIds = [...input.memberBotIds];
    }
    if (input.alphaBotId !== undefined) {
      if (input.alphaBotId !== null) {
        const alpha = data.bots.find((b) => b.id === input.alphaBotId);
        if (!alpha) throw new RosterValidationError(`Unknown alpha bot: ${input.alphaBotId}`);
        const alphaOwner = alpha.profileId || DEFAULT_PROFILE_ID;
        if (alphaOwner !== profileId) {
          throw new CrossProfileForbiddenError(`alpha bot ${input.alphaBotId} belongs to profile ${alphaOwner}`);
        }
      }
      group.alphaBotId = input.alphaBotId;
    }
    if (input.pinned !== undefined) group.pinned = input.pinned;
    if (input.hidden !== undefined) group.hidden = input.hidden;
    group.updatedAt = Date.now();
    writeData(data);
    return group;
  });
}

/** Delete a group chat. */
export async function deleteGroup(id: string, profileId: string = DEFAULT_PROFILE_ID): Promise<void> {
  return withMutex('roster', async () => {
    const data = readData();
    const index = data.groups.findIndex((g) => g.id === id);
    if (index < 0) throw new RosterNotFoundError(`Group not found: ${id}`);
    if ((data.groups[index].profileId || DEFAULT_PROFILE_ID) !== profileId) {
      throw new CrossProfileForbiddenError(`group belongs to profile ${data.groups[index].profileId}`);
    }
    data.groups.splice(index, 1);
    writeData(data);
  });
}

/* ── Sidebar sections (GrokBot parity: group bots by project/client) ── */

/** Create a sidebar section. */
export async function createSection(name: string, profileId: string = DEFAULT_PROFILE_ID): Promise<RosterSection> {
  const clean = name.trim();
  if (!clean || clean.length > 100) throw new RosterValidationError('Section name must be 1–100 characters');
  return withMutex('roster', async () => {
    const data = readData();
    const scoped = inProfile(data.sections, profileId);
    if (scoped.length >= MAX_SECTIONS) {
      throw new RosterValidationError(`Section limit reached (${MAX_SECTIONS})`);
    }
    const section: RosterSection = {
      id: uniqueId(`${slugify(clean)}-${crypto.randomBytes(3).toString('hex')}`, new Set(data.sections.map((s) => s.id))),
      profileId,
      name: clean,
      order: scoped.length,
      createdAt: Date.now(),
    };
    data.sections.push(section);
    writeData(data);
    return section;
  });
}

/** Rename a sidebar section. */
export async function renameSection(id: string, name: string, profileId: string = DEFAULT_PROFILE_ID): Promise<RosterSection> {
  const clean = name.trim();
  if (!clean || clean.length > 100) throw new RosterValidationError('Section name must be 1–100 characters');
  return withMutex('roster', async () => {
    const data = readData();
    const section = findScoped(data.sections, id, profileId, 'Section');
    section.name = clean;
    writeData(data);
    return section;
  });
}

/**
 * Delete a sidebar section. Its bots are moved to Unassigned (sectionId null);
 * neither the bots nor their work are deleted.
 */
export async function deleteSection(id: string, profileId: string = DEFAULT_PROFILE_ID): Promise<{ movedBotIds: string[] }> {
  return withMutex('roster', async () => {
    const data = readData();
    const index = data.sections.findIndex((s) => s.id === id);
    if (index < 0) throw new RosterNotFoundError(`Section not found: ${id}`);
    if ((data.sections[index].profileId || DEFAULT_PROFILE_ID) !== profileId) {
      throw new CrossProfileForbiddenError(`section belongs to profile ${data.sections[index].profileId}`);
    }
    data.sections.splice(index, 1);
    const movedBotIds: string[] = [];
    for (const bot of data.bots) {
      if ((bot.profileId || DEFAULT_PROFILE_ID) === profileId && bot.sectionId === id) {
        bot.sectionId = null;
        bot.updatedAt = Date.now();
        movedBotIds.push(bot.id);
      }
    }
    writeData(data);
    return { movedBotIds };
  });
}

/** Move a bot to a section (or Unassigned when sectionId is null). */
export async function moveBotToSection(botId: string, sectionId: string | null, profileId: string = DEFAULT_PROFILE_ID): Promise<RosterBot> {
  return updateBot(botId, { sectionId }, profileId);
}
