/** Tests for roster-store: bots CRUD/duplicate/delete, groups validation, limits. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getRoster,
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
  RosterValidationError,
  RosterNotFoundError,
} from './roster-store.js';

let tmpDir: string;
let originalNerveDataDir: string | undefined;

beforeEach(async () => {
  originalNerveDataDir = process.env.NERVE_DATA_DIR;
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'roster-test-'));
  process.env.NERVE_DATA_DIR = tmpDir;
});

afterEach(async () => {
  if (originalNerveDataDir === undefined) delete process.env.NERVE_DATA_DIR;
  else process.env.NERVE_DATA_DIR = originalNerveDataDir;
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('bots', () => {
  it('creates and lists bots', async () => {
    const bot = await createBot({ name: 'Researcher' });
    expect(bot.id).toBeTruthy();
    expect(bot.pinned).toBe(false);
    expect(bot.notifications).toBe(true);
    const roster = await getRoster();
    expect(roster.bots).toHaveLength(1);
  });

  it('rejects empty names and bad colors', async () => {
    await expect(createBot({ name: '  ' })).rejects.toBeInstanceOf(RosterValidationError);
    await expect(createBot({ name: 'Ok', color: 'red' })).rejects.toBeInstanceOf(RosterValidationError);
  });

  it('updates profile fields', async () => {
    const bot = await createBot({ name: 'Writer' });
    const updated = await updateBot(bot.id, { title: 'Drafts', pinned: true, hidden: true });
    expect(updated.title).toBe('Drafts');
    expect(updated.pinned).toBe(true);
    expect(updated.hidden).toBe(true);
  });

  it('throws 404 for unknown bot', async () => {
    await expect(updateBot('nope', { pinned: true })).rejects.toBeInstanceOf(RosterNotFoundError);
  });

  it('duplicates profile and skills without agent link', async () => {
    const bot = await createBot({ name: 'Scout', agentId: 'agent:main:1', enabledSkills: ['s1'] });
    const copy = await duplicateBot(bot.id);
    expect(copy.name).toContain('copy');
    expect(copy.agentId).toBeNull();
    expect(copy.enabledSkills).toEqual(['s1']);
    expect(copy.id).not.toBe(bot.id);
  });

  it('deletes bot and drops it from groups', async () => {
    const a = await createBot({ name: 'A' });
    const b = await createBot({ name: 'B' });
    const g = await createGroup({ name: 'Team', memberBotIds: [a.id, b.id] });
    const result = await deleteBot(a.id);
    expect(result.removedFromGroups).toContain(g.id);
    // Group left with 1 member is dropped
    const roster = await getRoster();
    expect(roster.groups).toHaveLength(0);
    expect(roster.bots).toHaveLength(1);
  });
});

describe('groups', () => {
  it('requires 2–6 existing members', async () => {
    const a = await createBot({ name: 'A' });
    await expect(createGroup({ name: 'Solo', memberBotIds: [a.id] })).rejects.toBeInstanceOf(RosterValidationError);
    await expect(createGroup({ name: 'Ghost', memberBotIds: [a.id, 'missing'] })).rejects.toBeInstanceOf(RosterValidationError);
    const b = await createBot({ name: 'B' });
    const g = await createGroup({ name: 'Duo', memberBotIds: [a.id, b.id] });
    expect(g.memberBotIds).toEqual([a.id, b.id]);
  });

  it('rejects duplicates and oversized rosters', async () => {
    const a = await createBot({ name: 'A' });
    const b = await createBot({ name: 'B' });
    await expect(createGroup({ name: 'Dup', memberBotIds: [a.id, a.id] })).rejects.toBeInstanceOf(RosterValidationError);
    const many = [a.id, b.id, a.id, b.id, a.id, b.id, a.id];
    await expect(createGroup({ name: 'Big', memberBotIds: many })).rejects.toBeInstanceOf(RosterValidationError);
  });

  it('updates and deletes groups', async () => {
    const a = await createBot({ name: 'A' });
    const b = await createBot({ name: 'B' });
    const c = await createBot({ name: 'C' });
    const g = await createGroup({ name: 'Team', memberBotIds: [a.id, b.id] });
    const updated = await updateGroup(g.id, { name: 'Squad', memberBotIds: [a.id, b.id, c.id], pinned: true });
    expect(updated.name).toBe('Squad');
    expect(updated.memberBotIds).toHaveLength(3);
    await deleteGroup(g.id);
    expect((await getRoster()).groups).toHaveLength(0);
    await expect(deleteGroup(g.id)).rejects.toBeInstanceOf(RosterNotFoundError);
  });
});

describe('persistence', () => {
  it('survives across reads via the data file', async () => {
    await createBot({ name: 'Kept' });
    expect(fs.existsSync(path.join(tmpDir, 'roster.json'))).toBe(true);
    const roster = await getRoster();
    expect(roster.bots[0]?.name).toBe('Kept');
  });
});

describe('sections', () => {
  it('creates, lists, and renames sections', async () => {
    const section = await createSection('Rank\'em');
    expect(section.name).toBe("Rank'em");
    const renamed = await renameSection(section.id, 'Rankem Studio');
    expect(renamed.name).toBe('Rankem Studio');
    const roster = await getRoster();
    expect(roster.sections.map((s) => s.name)).toEqual(['Rankem Studio']);
  });

  it('moves bots between sections and rejects unknown sections', async () => {
    const section = await createSection('Project A');
    const bot = await createBot({ name: 'Scout' });
    expect(bot.sectionId).toBeNull();
    const moved = await moveBotToSection(bot.id, section.id);
    expect(moved.sectionId).toBe(section.id);
    await expect(moveBotToSection(bot.id, 'nope')).rejects.toBeInstanceOf(RosterValidationError);
    const unassigned = await moveBotToSection(bot.id, null);
    expect(unassigned.sectionId).toBeNull();
  });

  it('deleting a section unassigns its bots without deleting them', async () => {
    const section = await createSection('Temp');
    const bot = await createBot({ name: 'Keeper', sectionId: section.id });
    const result = await deleteSection(section.id);
    expect(result.movedBotIds).toContain(bot.id);
    const roster = await getRoster();
    expect(roster.sections).toHaveLength(0);
    expect(roster.bots).toHaveLength(1);
    expect(roster.bots[0].sectionId).toBeNull();
  });

  it('migrates legacy payloads to include sections + sectionId', async () => {
    // Simulate a v1 roster written directly to the data file.
    const legacy = { bots: [{ id: 'b1', name: 'Old', agentId: null }], groups: [] };
    await fs.promises.writeFile(path.join(tmpDir, 'roster.json'), JSON.stringify(legacy));
    const roster = await getRoster();
    expect(roster.bots[0].sectionId).toBeNull();
    expect(roster.sections).toEqual([]);
    expect(roster.version).toBe(2);
  });
});

describe('avatar', () => {
  it('defaults to empty and accepts a variant id', async () => {
    const bot = await createBot({ name: 'Pup' });
    expect(bot.avatar).toBe('');
    const updated = await updateBot(bot.id, { avatar: 'zoomies' });
    expect(updated.avatar).toBe('zoomies');
  });

  it('rejects malformed avatar ids', async () => {
    const bot = await createBot({ name: 'Pup2' });
    await expect(updateBot(bot.id, { avatar: 'Not Valid!' })).rejects.toBeInstanceOf(RosterValidationError);
    await expect(updateBot(bot.id, { avatar: 'x'.repeat(41) })).rejects.toBeInstanceOf(RosterValidationError);
  });

  it('duplicates the avatar', async () => {
    const bot = await createBot({ name: 'Scout', avatar: 'chef' });
    const copy = await duplicateBot(bot.id);
    expect(copy.avatar).toBe('chef');
  });

  it('backfills avatar on legacy payloads', async () => {
    await fs.promises.writeFile(path.join(tmpDir, 'roster.json'), JSON.stringify({ bots: [{ id: 'b1', name: 'Old' }], groups: [] }));
    const roster = await getRoster();
    expect(roster.bots[0].avatar).toBe('');
  });
});

describe('group alpha', () => {
  it('creates a group with an alpha and backfills legacy groups', async () => {
    const a = await createBot({ name: 'Alpha' });
    const b = await createBot({ name: 'Member' });
    const g = await createGroup({ name: 'Squad', memberBotIds: [a.id, b.id], alphaBotId: a.id });
    expect(g.alphaBotId).toBe(a.id);
    // legacy payload without alphaBotId
    await fs.promises.writeFile(
      path.join(tmpDir, 'roster.json'),
      JSON.stringify({ bots: [{ id: 'b1', name: 'Old' }], groups: [{ id: 'g1', name: 'Legacy', memberBotIds: [] }] }),
    );
    const roster = await getRoster();
    expect(roster.groups[0].alphaBotId).toBeNull();
  });

  it('rejects an unknown alpha and clears it when the alpha is deleted', async () => {
    const a = await createBot({ name: 'A' });
    const b = await createBot({ name: 'B' });
    const g = await createGroup({ name: 'Team', memberBotIds: [a.id, b.id] });
    await expect(updateGroup(g.id, { alphaBotId: 'ghost' })).rejects.toBeInstanceOf(RosterValidationError);
    await updateGroup(g.id, { alphaBotId: a.id });
    await deleteBot(a.id);
    const roster = await getRoster();
    const updated = roster.groups.find((x) => x.id === g.id);
    expect(updated?.alphaBotId ?? null).toBe(null);
  });
});
