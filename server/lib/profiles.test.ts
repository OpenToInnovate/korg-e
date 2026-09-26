/** Tests for profiles: CRUD, resolution precedence, default migration, cross-profile guards. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DEFAULT_PROFILE_ID,
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
  buildAgentProfileMap,
} from './profiles.js';
import { createBot, createGroup, getRoster, updateBot } from './roster-store.js';

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
  it('maps roster agents to their profile and unknown agents to the default', async () => {
    await createProfile({ name: 'Work' });
    await createBot({ name: 'Coder', agentId: 'agent:coder:main' }, DEFAULT_PROFILE_ID);
    await createBot({ name: 'Client', agentId: 'agent:client:main' }, 'work');

    expect(agentProfileId('agent:coder:main')).toBe(DEFAULT_PROFILE_ID);
    expect(agentProfileId('agent:client:main')).toBe('work');
    // The privacy surfaces take a bare agent id, which must resolve too.
    expect(agentProfileId('client')).toBe('work');
    expect(agentProfileId('coder')).toBe(DEFAULT_PROFILE_ID);
    // Agents absent from the roster (e.g. "main") belong to the default profile.
    expect(agentProfileId('main')).toBe(DEFAULT_PROFILE_ID);
    expect(agentProfileId('agent:nobody:main')).toBe(DEFAULT_PROFILE_ID);
    expect(agentProfileId(null)).toBe(DEFAULT_PROFILE_ID);
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
