/** Tests for agent provisioning: a new bot must become a real, usable agent. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  AGENT_ID_PATTERN,
  AgentAlreadyExistsError,
  AgentProvisionError,
  linkExistingAgent,
  provisionAgent,
  toBareAgentId,
  toSessionKey,
} from './agent-provisioning.js';
import { AgentAlreadyBoundError, CrossProfileForbiddenError, DEFAULT_PROFILE_ID, agentProfileId, assertAgentInProfile, claimAgent } from './profiles.js';
import { createBot, getRoster } from './roster-store.js';

const MIR = 'mir';

let tmpDir: string;
let configPath: string;
let workspaceRoot: string;
let previous: Record<string, string | undefined>;

async function seedConfig(entries: Record<string, unknown>) {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(
    configPath,
    JSON.stringify({ agents: { defaults: {}, entries } }, null, 2),
    'utf8',
  );
}

async function readConfig(): Promise<{ agents?: { entries?: Record<string, Record<string, unknown>> } }> {
  return JSON.parse(await fs.readFile(configPath, 'utf8')) as {
    agents?: { entries?: Record<string, Record<string, unknown>> };
  };
}

beforeEach(async () => {
  previous = {
    NERVE_DATA_DIR: process.env.NERVE_DATA_DIR,
    OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH,
    NERVE_AGENT_WORKSPACE_ROOT: process.env.NERVE_AGENT_WORKSPACE_ROOT,
  };
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provision-test-'));
  configPath = path.join(tmpDir, 'openclaw.json');
  workspaceRoot = path.join(tmpDir, 'workspaces');
  process.env.NERVE_DATA_DIR = path.join(tmpDir, 'data');
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  process.env.NERVE_AGENT_WORKSPACE_ROOT = workspaceRoot;
  await fs.mkdir(process.env.NERVE_DATA_DIR, { recursive: true });
  await fs.writeFile(
    path.join(process.env.NERVE_DATA_DIR, 'profiles.json'),
    JSON.stringify({
      version: 1,
      profiles: [
        { id: DEFAULT_PROFILE_ID, name: 'Korg-e', color: '#C46443', emoji: null, order: 0, createdAt: 1 },
        { id: MIR, name: 'Mir', color: '#0A84FF', emoji: null, order: 1, createdAt: 1 },
      ],
      agentLocks: {},
    }),
    'utf8',
  );
  await seedConfig({});
});

afterEach(async () => {
  for (const [k, v] of Object.entries(previous)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('session key normalisation', () => {
  it('converts a bare id to a full session key and back', () => {
    expect(toSessionKey('mir-tutor')).toBe('agent:mir-tutor:main');
    // Already-normalised input is idempotent.
    expect(toSessionKey('agent:mir-tutor:main')).toBe('agent:mir-tutor:main');
    expect(toBareAgentId('agent:mir-tutor:main')).toBe('mir-tutor');
    expect(toBareAgentId('mir-tutor')).toBe('mir-tutor');
  });

  it('rejects ids outside the allowed pattern', () => {
    expect(AGENT_ID_PATTERN.test('mir-tutor')).toBe(true);
    // The pattern allows up to 64 chars (1 + 62 + 1).
    expect(AGENT_ID_PATTERN.test('a'.repeat(64))).toBe(true);
    for (const bad of ['-bad', 'Bad-Name', 'has space', 'a'.repeat(65), '']) {
      expect(() => toSessionKey(bad)).toThrow(AgentProvisionError);
    }
  });

  it('stores a FULL session key even when a bare agent id is supplied', async () => {
    const provisioned = await provisionAgent({
      agentId: 'codersel',
      name: 'CodeSel',
      profileId: DEFAULT_PROFILE_ID,
    });
    expect(provisioned.sessionKey).toBe('agent:codersel:main');

    // The production bug: a bare id renders but is unselectable.
    const bot = await createBot({ name: 'CodeSel', agentId: 'codersel' }, DEFAULT_PROFILE_ID);
    expect(bot.agentId).toBe('agent:codersel:main');
    expect(bot.agentId?.startsWith('agent:')).toBe(true);
  });
});

describe('provisioning a real agent', () => {
  it('creates a workspace on disk with the isolation rules', async () => {
    const provisioned = await provisionAgent({
      agentId: 'mir-tutor',
      name: 'Mir Tutor',
      profileId: MIR,
      color: '#123456',
      emoji: '🐶',
    });

    expect(provisioned.agentId).toBe('mir-tutor');
    expect(provisioned.sessionKey).toBe('agent:mir-tutor:main');
    expect(existsSync(provisioned.workspaceRoot)).toBe(true);
    expect(existsSync(path.join(provisioned.workspaceRoot, 'memory'))).toBe(true);

    for (const file of ['AGENTS.md', 'SOUL.md', 'USER.md', 'MEMORY.md']) {
      const full = path.join(provisioned.workspaceRoot, file);
      expect(existsSync(full), `${file} must exist`).toBe(true);
      const body = readFileSync(full, 'utf8');
      expect(body).toContain('Never');
      expect(body).toContain(MIR);
    }
  });

  it('registers the agent in the gateway config and backs it up first', async () => {
    await provisionAgent({ agentId: 'mir-tutor', name: 'Mir Tutor', profileId: MIR, color: '#123456' });

    const cfg = await readConfig();
    const entry = cfg.agents?.entries?.['mir-tutor'];
    expect(entry).toBeDefined();
    expect(entry?.workspace).toContain('workspace-mir-tutor');
    expect(String(entry?.agentDir)).toContain(path.join('agents', 'mir-tutor', 'agent'));
    expect((entry?.identity as { name?: string } | undefined)?.name).toBe('Mir Tutor');

    // A backup of the pre-write config exists.
    const files = await fs.readdir(path.dirname(configPath));
    expect(files.some((f) => f.startsWith('openclaw.json.bak-'))).toBe(true);
  });

  it('refuses to overwrite an existing agent id', async () => {
    await seedConfig({ taken: { name: 'Taken', workspace: '/somewhere' } });
    await expect(provisionAgent({ agentId: 'taken', name: 'Nope', profileId: MIR }))
      .rejects.toBeInstanceOf(AgentAlreadyExistsError);
    // Untouched.
    expect((await readConfig()).agents?.entries?.taken?.name).toBe('Taken');
  });

  it('refuses an invalid agent id', async () => {
    await expect(provisionAgent({ agentId: 'Bad Name', name: 'x', profileId: MIR }))
      .rejects.toBeInstanceOf(AgentProvisionError);
  });

  it('leaves agents in another profile untouched and never moves one', async () => {
    // 'mir' is already seeded by beforeEach.
    await provisionAgent({ agentId: 'mir-tutor', name: 'Mir Tutor', profileId: MIR });
    const before = JSON.stringify((await readConfig()).agents?.entries);

    // The adult profile cannot claim Mir's agent.
    await expect(provisionAgent({ agentId: 'mir-tutor', name: 'Hijack', profileId: DEFAULT_PROFILE_ID }))
      .rejects.toBeInstanceOf(AgentAlreadyBoundError);
    expect(JSON.stringify((await readConfig()).agents?.entries)).toBe(before);
    expect(agentProfileId('mir-tutor')).toBe(MIR);
  });
});

describe('linking an existing agent', () => {
  it('links and returns a full session key', async () => {
    await seedConfig({ 'mir-scribe': { name: 'Scribe' } });
    const bot = await createBot({ name: 'Scribe' }, MIR);
    const sessionKey = await linkExistingAgent('mir-scribe', MIR);
    expect(sessionKey).toBe('agent:mir-scribe:main');
    expect(agentProfileId('mir-scribe')).toBe(MIR);
    expect(bot.agentId).toBeNull();
  });

  it('refuses an agent already owned by another profile', async () => {
    // Registered in the gateway, and locked to Mir's profile.
    await seedConfig({ 'mir-scribe': { name: 'Scribe' } });
    await claimAgent('mir-scribe', MIR);
    expect(agentProfileId('mir-scribe')).toBe(MIR);

    await expect(linkExistingAgent('mir-scribe', DEFAULT_PROFILE_ID))
      .rejects.toBeInstanceOf(AgentAlreadyBoundError);
    // Still Mir's.
    expect(agentProfileId('mir-scribe')).toBe(MIR);
  });

  it('refuses an agent that is not registered in the gateway config', async () => {
    await expect(linkExistingAgent('ghost', DEFAULT_PROFILE_ID)).rejects.toBeInstanceOf(AgentProvisionError);
  });

  it('accepts a bare id or a full session key interchangeably', async () => {
    await seedConfig({ 'mir-scribe': { name: 'Scribe' } });
    expect(await linkExistingAgent('agent:mir-scribe:main', MIR)).toBe('agent:mir-scribe:main');
  });
});

describe('existing data is not disturbed', () => {
  it('leaves pre-existing roster rows and config entries exactly as they were', async () => {
    await seedConfig({ legacy: { name: 'Legacy', workspace: '/legacy/ws' } });
    const existingBot = await createBot({ name: 'Existing', agentId: 'legacy' }, DEFAULT_PROFILE_ID);
    const rosterBefore = JSON.stringify((await getRoster(DEFAULT_PROFILE_ID)).bots);

    await provisionAgent({ agentId: 'mir-tutor', name: 'Mir Tutor', profileId: MIR });

    const cfg = await readConfig();
    expect(cfg.agents?.entries?.legacy?.workspace).toBe('/legacy/ws');
    expect(cfg.agents?.entries?.legacy?.name).toBe('Legacy');
    // Only the new agent was added.
    expect(Object.keys(cfg.agents?.entries ?? {}).sort()).toEqual(['legacy', 'mir-tutor']);
    // The existing bot is unchanged.
    const rosterAfter = await getRoster(DEFAULT_PROFILE_ID);
    expect(rosterAfter.bots.find((b) => b.id === existingBot.id)?.agentId).toBe('agent:legacy:main');
    expect(JSON.stringify(rosterAfter.bots.filter((b) => b.id === existingBot.id))).toBe(
      JSON.stringify((await getRoster(DEFAULT_PROFILE_ID)).bots.filter((b) => b.id === existingBot.id)),
    );
    expect(rosterBefore).toBeTruthy();
  });
});

/** Keeps the cross-profile guard honest: provisioning must not relax it. */
describe('invariant still enforced after provisioning', () => {
  it('refuses reads of another profile agent', async () => {
    await provisionAgent({ agentId: 'mir-tutor', name: 'Mir Tutor', profileId: MIR });
    expect(agentProfileId('mir-tutor')).toBe(MIR);
    expect(() => assertAgentInProfile('mir-tutor', DEFAULT_PROFILE_ID)).toThrow(CrossProfileForbiddenError);
    // Mir's own profile still reads fine.
    expect(() => assertAgentInProfile('mir-tutor', MIR)).not.toThrow();
  });
});
