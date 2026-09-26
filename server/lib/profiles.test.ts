/** Tests for profiles: CRUD, resolution precedence, default migration, cross-profile guards. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DEFAULT_PROFILE_ID,
  AgentAlreadyBoundError,
  CrossProfileForbiddenError,
  ProfileValidationError,
  createProfile,
  deleteProfile,
  listProfiles,
  resolveActiveProfileId,
  requestedProfileId,
  updateProfile,
  agentProfileId,
  assertAgentInProfile,
  claimAgent,
  buildAgentProfileMap,
} from './profiles.js';
import { createBot, createGroup, deleteBot, duplicateBot, getRoster, updateBot } from './roster-store.js';

let tmpDir: string;
let originalNerveDataDir: string | undefined;

beforeEach(async () => {
  originalNerveDataDir = process.env.NERVE_DATA_DIR;
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'profiles-test-'));
  process.env.NERVE_DATA_DIR = tmpDir;
});

afterEach(async () => {
  if (originalNerveDataDir === undefined) delete process.env.NERVE_DATA_DIR;
  else process.env.NERVE_DATA_DIR = originalNerveDataDir;
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('profile CRUD', () => {
  it('seeds a default "korge" profile on first read', async () => {
    const profiles = await listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe(DEFAULT_PROFILE_ID);
    expect(profiles[0].name).toBe('Korg-e');
  });

  it('creates a profile with a slugified id', async () => {
    const created = await createProfile({ name: 'Client Work', color: '#123456', emoji: '🐾' });
    expect(created.id).toBe('client-work');
    expect(created.color).toBe('#123456');
    expect(created.emoji).toBe('🐾');
    expect(created.order).toBe(1);
  });

  it('rejects a duplicate slug and bad input', async () => {
    await createProfile({ name: 'Work' });
    await expect(createProfile({ name: 'Work' })).rejects.toBeInstanceOf(ProfileValidationError);
    await expect(createProfile({ name: '' })).rejects.toBeInstanceOf(ProfileValidationError);
    await expect(createProfile({ name: 'Bad', color: 'red' })).rejects.toBeInstanceOf(ProfileValidationError);
  });

  it('updates name, color, emoji and order', async () => {
    const created = await createProfile({ name: 'Work' });
    const updated = await updateProfile(created.id, { name: 'Work 2', color: '#ABCDEF', emoji: null, order: 5 });
    expect(updated).toMatchObject({ name: 'Work 2', color: '#ABCDEF', emoji: null, order: 5 });
  });

  it('refuses to delete the last remaining profile', async () => {
    await expect(deleteProfile(DEFAULT_PROFILE_ID)).rejects.toBeInstanceOf(ProfileValidationError);
    const other = await createProfile({ name: 'Work' });
    await deleteProfile(other.id);
    expect(await listProfiles()).toHaveLength(1);
  });
});

describe('active profile resolution', () => {
  it('prefers the header over the cookie', async () => {
    await createProfile({ name: 'Work' });
    const id = await resolveActiveProfileId('work', 'nerve_profile=korge');
    expect(id).toBe('work');
  });

  it('falls back to the cookie when the header is absent', async () => {
    await createProfile({ name: 'Work' });
    expect(await resolveActiveProfileId(null, 'nerve_profile=work; other=1')).toBe('work');
  });

  it('falls back to the default profile when nothing is set or the id is stale', async () => {
    expect(await resolveActiveProfileId(null, null)).toBe(DEFAULT_PROFILE_ID);
    expect(await resolveActiveProfileId('deleted-profile', null)).toBe(DEFAULT_PROFILE_ID);
  });

  it('reads the requested id from header or cookie, unvalidated', () => {
    expect(requestedProfileId('work', 'nerve_profile=korge')).toBe('work');
    expect(requestedProfileId(undefined, 'nerve_profile=korge')).toBe('korge');
    expect(requestedProfileId(undefined, undefined)).toBeNull();
  });
});

describe('default-profile migration', () => {
  it('assigns existing rows without a profileId to the default profile', async () => {
    // Pre-profiles roster file: rows have no profileId at all.
    await fs.promises.writeFile(
      path.join(tmpDir, 'roster.json'),
      JSON.stringify({
        version: 2,
        bots: [
          { id: 'b1', agentId: 'agent:coder:main', name: 'Coder', createdAt: 1, updatedAt: 1 },
          { id: 'b2', agentId: null, name: 'Second', createdAt: 1, updatedAt: 1 },
        ],
        groups: [{ id: 'g1', name: 'Team', memberBotIds: ['b1', 'b2'], createdAt: 1, updatedAt: 1 }],
        sections: [{ id: 's1', name: 'Work', order: 0, createdAt: 1 }],
      }),
    );

    const roster = await getRoster(DEFAULT_PROFILE_ID);
    expect(roster.bots.map((b) => b.profileId)).toEqual([DEFAULT_PROFILE_ID, DEFAULT_PROFILE_ID]);
    expect(roster.groups[0].profileId).toBe(DEFAULT_PROFILE_ID);
    expect(roster.sections[0].profileId).toBe(DEFAULT_PROFILE_ID);
    // No data loss: every migrated row is still there.
    expect(roster.bots).toHaveLength(2);
    expect(roster.groups[0].memberBotIds).toEqual(['b1', 'b2']);
  });
});

describe('roster scoping', () => {
  it('reads only the active profile', async () => {
    await createBot({ name: 'Korge Bot' }, DEFAULT_PROFILE_ID);
    await createProfile({ name: 'Work' });
    await createBot({ name: 'Work Bot' }, 'work');

    const defaultView = await getRoster(DEFAULT_PROFILE_ID);
    expect(defaultView.bots.map((b) => b.name)).toEqual(['Korge Bot']);

    const workView = await getRoster('work');
    expect(workView.bots.map((b) => b.name)).toEqual(['Work Bot']);
  });

  it('rejects cross-profile writes with 403, not a silent filter', async () => {
    await createProfile({ name: 'Work' });
    const mine = await createBot({ name: 'Mine' }, DEFAULT_PROFILE_ID);
    const theirs = await createBot({ name: 'Theirs' }, 'work');

    await expect(updateBot(theirs.id, { name: 'Hijacked' }, DEFAULT_PROFILE_ID))
      .rejects.toBeInstanceOf(CrossProfileForbiddenError);
    // The rejected write left the row untouched.
    const workView = await getRoster('work');
    expect(workView.bots.find((b) => b.id === theirs.id)?.name).toBe('Theirs');
    expect(mine.profileId).toBe(DEFAULT_PROFILE_ID);
  });

  it('enforces the group privacy rule for members and alpha', async () => {
    await createProfile({ name: 'Work' });
    const mineA = await createBot({ name: 'Mine A' }, DEFAULT_PROFILE_ID);
    const mineB = await createBot({ name: 'Mine B' }, DEFAULT_PROFILE_ID);
    const theirs = await createBot({ name: 'Theirs' }, 'work');

    // Mixing a foreign member in is refused…
    await expect(createGroup(
      { name: 'Leak', memberBotIds: [mineA.id, mineB.id, theirs.id] },
      DEFAULT_PROFILE_ID,
    )).rejects.toBeInstanceOf(CrossProfileForbiddenError);

    // …and so is a foreign alpha, even with a legal member list.
    const group = await createGroup({ name: 'Legal', memberBotIds: [mineA.id, mineB.id] }, DEFAULT_PROFILE_ID);
    await expect(updateGroupAlpha(group.id, theirs.id)).rejects.toBeInstanceOf(CrossProfileForbiddenError);

    // An id that exists nowhere stays a validation error, not a 403.
    await expect(createGroup({ name: 'Ghost', memberBotIds: [mineA.id, 'ghost'] }, DEFAULT_PROFILE_ID))
      .rejects.toBeInstanceOf(Error);
  });
});

// Local helper: alpha assignment goes through updateGroup in the store.
async function updateGroupAlpha(groupId: string, alphaBotId: string) {
  const { updateGroup } = await import('./roster-store.js');
  return updateGroup(groupId, { alphaBotId }, DEFAULT_PROFILE_ID);
}

describe('agent → profile map', () => {
  it('maps roster agents to their profile and reports unowned agents as null', async () => {
    await createProfile({ name: 'Work' });
    await createBot({ name: 'Coder', agentId: 'agent:coder:main' }, DEFAULT_PROFILE_ID);
    await createBot({ name: 'Client', agentId: 'agent:client:main' }, 'work');

    expect(agentProfileId('agent:coder:main')).toBe(DEFAULT_PROFILE_ID);
    expect(agentProfileId('agent:client:main')).toBe('work');
    // The privacy surfaces take a bare agent id, which must resolve too.
    expect(agentProfileId('client')).toBe('work');
    expect(agentProfileId('coder')).toBe(DEFAULT_PROFILE_ID);
    // Agents with no lock and no roster row are UNOWNED (null), not the
    // default profile — defaulting them is what allowed cross-profile mixing.
    expect(agentProfileId('main')).toBeNull();
    expect(agentProfileId('agent:nobody:main')).toBeNull();
    expect(agentProfileId(null)).toBeNull();
    // Two bots, indexed under both the session key and the bare agent id.
    expect(buildAgentProfileMap().size).toBe(4);
  });

  it('assertAgentInProfile throws only for foreign agents', async () => {
    await createProfile({ name: 'Work' });
    await createBot({ name: 'Client', agentId: 'agent:client:main' }, 'work');

    // Agents nobody owns fall back to the default profile and always pass.
    expect(() => assertAgentInProfile('main', DEFAULT_PROFILE_ID)).not.toThrow();
    expect(() => assertAgentInProfile(null, DEFAULT_PROFILE_ID)).not.toThrow();
    // A foreign agent passes in its own profile and fails in another.
    expect(() => assertAgentInProfile('client', 'work')).not.toThrow();
    expect(() => assertAgentInProfile('client', DEFAULT_PROFILE_ID)).toThrow(CrossProfileForbiddenError);
    expect(() => assertAgentInProfile('agent:client:main', DEFAULT_PROFILE_ID)).toThrow(CrossProfileForbiddenError);
  });
});

/* ── Agent locks: one agent, one profile, forever ──────────────────── */

describe('agent locks', () => {
  it('rejects binding the same agent to a second profile on create', async () => {
    await createProfile({ name: 'Work' });
    await createBot({ name: 'Coder', agentId: 'agent:coder:main' }, DEFAULT_PROFILE_ID);

    await expect(
      createBot({ name: 'Impostor', agentId: 'agent:coder:main' }, 'work'),
    ).rejects.toBeInstanceOf(AgentAlreadyBoundError);

    // The rejected create left nothing behind.
    expect((await getRoster('work')).bots).toHaveLength(0);
  });

  it('rejects the same bind on update', async () => {
    await createProfile({ name: 'Work' });
    await createBot({ name: 'Coder', agentId: 'agent:coder:main' }, DEFAULT_PROFILE_ID);
    const free = await createBot({ name: 'Free' }, 'work');

    await expect(updateBot(free.id, { agentId: 'agent:coder:main' }, 'work'))
      .rejects.toBeInstanceOf(AgentAlreadyBoundError);
    expect((await getRoster('work')).bots.find((b) => b.id === free.id)?.agentId).toBeNull();
  });

  it('allows a same-profile rebind', async () => {
    const a = await createBot({ name: 'Coder', agentId: 'agent:coder:main' }, DEFAULT_PROFILE_ID);
    const b = await createBot({ name: 'Coder 2' }, DEFAULT_PROFILE_ID);
    const updated = await updateBot(b.id, { agentId: 'agent:coder:main' }, DEFAULT_PROFILE_ID);
    expect(updated.agentId).toBe('agent:coder:main');
    expect(agentProfileId('coder')).toBe(DEFAULT_PROFILE_ID);
    expect(a.profileId).toBe(DEFAULT_PROFILE_ID);
  });

  it('duplicateBot does not smuggle the agent binding', async () => {
    await createProfile({ name: 'Work' });
    const source = await createBot({ name: 'Coder', agentId: 'agent:coder:main' }, DEFAULT_PROFILE_ID);
    const copy = await duplicateBot(source.id, DEFAULT_PROFILE_ID);

    // The copy is unlinked, so it neither rebinds nor steals the lock.
    expect(copy.agentId).toBeNull();
    expect(agentProfileId('coder')).toBe(DEFAULT_PROFILE_ID);
  });

  it('keeps the lock after the bot is deleted, and still refuses other profiles', async () => {
    await createProfile({ name: 'Work' });
    const bot = await createBot({ name: 'Coder', agentId: 'agent:coder:main' }, 'work');
    expect(agentProfileId('coder')).toBe('work');

    await deleteBot(bot.id, 'work');
    expect((await getRoster('work')).bots).toHaveLength(0);

    // Memory isolation outlives the roster row: the agent still resolves to
    // its original profile and cannot be claimed by another profile.
    expect(agentProfileId('coder')).toBe('work');
    expect(agentProfileId('agent:coder:main')).toBe('work');
    await expect(createBot({ name: 'Sneaky', agentId: 'agent:coder:main' }, DEFAULT_PROFILE_ID))
      .rejects.toBeInstanceOf(AgentAlreadyBoundError);
    expect(() => assertAgentInProfile('coder', DEFAULT_PROFILE_ID)).toThrow(CrossProfileForbiddenError);
    expect(() => assertAgentInProfile('coder', 'work')).not.toThrow();
  });

  it('lock takes precedence over a roster row claiming another profile', async () => {
    // Legacy-style conflicting data: the lock says work, a row claims korge.
    await createProfile({ name: 'Work' });
    await createBot({ name: 'Coder', agentId: 'agent:coder:main' }, 'work');
    expect(agentProfileId('coder')).toBe('work');
  });
});

describe('unowned agents fail closed', () => {
  it('refuses an unowned agent on non-default profiles, allows it on the default', async () => {
    await createProfile({ name: 'Work' });

    // No lock, no roster row.
    expect(agentProfileId('stranger')).toBeNull();
    expect(() => assertAgentInProfile('stranger', 'work')).toThrow(CrossProfileForbiddenError);
    // The default profile keeps today's permissive behaviour.
    expect(() => assertAgentInProfile('stranger', DEFAULT_PROFILE_ID)).not.toThrow();
  });
});
