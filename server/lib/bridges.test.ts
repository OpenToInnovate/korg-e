/** Tests for bridges: dual approval, pair scope, time-boxing, and the hard talk-only rule. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';
import {
  DEFAULT_PROFILE_ID,
  CrossProfileForbiddenError,
  agentProfileId,
  assertAgentInProfile,
  createProfile,
} from './profiles.js';
import { createBot, getRoster } from './roster-store.js';
import {
  BridgeNotApprovedError,
  BridgeNotRemoteError,
  BridgePairForbiddenError,
  BridgeValidationError,
  acceptBridge,
  assertBridgeSendAllowed,
  createBridge,
  getBridge,
  listBridgesForProfile,
  revokeBridge,
} from './bridges.js';

const ADULT = DEFAULT_PROFILE_ID;
const MIR = 'mir';

let tmpDir: string;
let originalNerveDataDir: string | undefined;

beforeEach(async () => {
  originalNerveDataDir = process.env.NERVE_DATA_DIR;
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bridges-test-'));
  process.env.NERVE_DATA_DIR = tmpDir;
  await fsp.writeFile(path.join(tmpDir, 'profiles.json'), JSON.stringify({
    version: 1,
    profiles: [
      { id: ADULT, name: 'Korg-e', color: '#C46443', emoji: null, order: 0, createdAt: 1 },
      { id: MIR, name: 'Mir', color: '#0A84FF', emoji: null, order: 1, createdAt: 1 },
    ],
    agentLocks: {},
  }));
});

afterEach(async () => {
  if (originalNerveDataDir === undefined) delete process.env.NERVE_DATA_DIR;
  else process.env.NERVE_DATA_DIR = originalNerveDataDir;
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

/** Adult owns `adult-tutor`, Mir owns `mir-tutor` and `mir-scribe`. */
async function seedOwners() {
  await createBot({ name: 'Adult Tutor', agentId: 'agent:adult-tutor:main' }, ADULT);
  await createBot({ name: 'Mir Tutor', agentId: 'agent:mir-tutor:main' }, MIR);
  await createBot({ name: 'Mir Scribe', agentId: 'agent:mir-scribe:main' }, MIR);
}

async function activeBridge(overrides: Partial<Parameters<typeof createBridge>[0]> = {}) {
  const bridge = await createBridge({
    toProfileId: MIR,
    fromAgentIds: ['agent:adult-tutor:main'],
    toAgentIds: ['agent:mir-tutor:main'],
    reason: 'Homework help',
    ...overrides,
  } as Parameters<typeof createBridge>[0], ADULT);
  return acceptBridge(bridge.id, MIR);
}

describe('bridge creation', () => {
  it('creates pending_remote with the adult approval set', async () => {
    await seedOwners();
    const bridge = await createBridge({
      toProfileId: MIR,
      fromAgentIds: ['agent:adult-tutor:main'],
      toAgentIds: ['agent:mir-tutor:main'],
      reason: 'Homework help',
    }, ADULT);

    expect(bridge.status).toBe('pending_remote');
    expect(bridge.scope).toBe('talk');
    expect(bridge.adultApprovedAt).not.toBeNull();
    expect(bridge.remoteApprovedAt).toBeNull();
    expect(bridge.expiresAt).toBeGreaterThan(Date.now());
    expect(bridge.log.map((e) => e.event)).toContain('created');
  });

  it('rejects agents that do not belong to the side claiming them', async () => {
    await seedOwners();
    await expect(createBridge({
      toProfileId: MIR,
      fromAgentIds: ['agent:mir-tutor:main'],
      toAgentIds: ['agent:mir-scribe:main'],
      reason: 'bad',
    }, ADULT)).rejects.toBeInstanceOf(BridgeValidationError);
  });

  it('validates ttlHours bounds and list sizes', async () => {
    await seedOwners();
    const base = {
      toProfileId: MIR,
      fromAgentIds: ['agent:adult-tutor:main'],
      toAgentIds: ['agent:mir-tutor:main'],
      reason: 'r',
    };
    await expect(createBridge({ ...base, ttlHours: 0 }, ADULT)).rejects.toBeInstanceOf(BridgeValidationError);
    await expect(createBridge({ ...base, ttlHours: 169 }, ADULT)).rejects.toBeInstanceOf(BridgeValidationError);
    await expect(createBridge({ ...base, fromAgentIds: [] }, ADULT)).rejects.toBeInstanceOf(BridgeValidationError);
    await expect(createBridge({
      ...base,
      toAgentIds: ['a', 'b', 'c', 'd'],
    }, ADULT)).rejects.toBeInstanceOf(BridgeValidationError);
  });

  it('does not change any agent→profile ownership', async () => {
    await seedOwners();
    const before = {
      adult: agentProfileId('agent:adult-tutor:main'),
      mir: agentProfileId('agent:mir-tutor:main'),
      scribe: agentProfileId('agent:mir-scribe:main'),
    };
    const bridge = await activeBridge();
    expect(agentProfileId('agent:adult-tutor:main')).toBe(before.adult);
    expect(agentProfileId('agent:mir-tutor:main')).toBe(before.mir);
    expect(agentProfileId('agent:mir-scribe:main')).toBe(before.scribe);
    // No agent gained a second home, and no cross-profile group appeared.
    expect(bridge.fromAgentIds).not.toEqual(expect.arrayContaining(bridge.toAgentIds));
    expect((await getRoster(MIR)).groups).toHaveLength(0);
    expect((await getRoster(ADULT)).groups).toHaveLength(0);
  });
});

describe('dual approval gate', () => {
  it('cannot send before BOTH approvals', async () => {
    await seedOwners();
    const bridge = await createBridge({
      toProfileId: MIR,
      fromAgentIds: ['agent:adult-tutor:main'],
      toAgentIds: ['agent:mir-tutor:main'],
      reason: 'r',
    }, ADULT);

    // Adult side tries to send before Mir accepts.
    await expect(assertBridgeSendAllowed(bridge.id, ADULT, 'agent:adult-tutor:main'))
      .rejects.toBeInstanceOf(BridgeNotApprovedError);
    // And so does the remote side — the bridge is not active yet.
    await expect(assertBridgeSendAllowed(bridge.id, MIR, 'agent:mir-tutor:main'))
      .rejects.toBeInstanceOf(BridgeNotApprovedError);
  });

  it('rejects an accept from the profile that created the bridge', async () => {
    await seedOwners();
    const bridge = await createBridge({
      toProfileId: MIR,
      fromAgentIds: ['agent:adult-tutor:main'],
      toAgentIds: ['agent:mir-tutor:main'],
      reason: 'r',
    }, ADULT);
    await expect(acceptBridge(bridge.id, ADULT)).rejects.toBeInstanceOf(BridgeNotRemoteError);
    // Still not approved, so it still cannot send.
    expect((await getBridge(bridge.id, ADULT)).remoteApprovedAt).toBeNull();
    await expect(assertBridgeSendAllowed(bridge.id, ADULT, 'agent:adult-tutor:main'))
      .rejects.toBeInstanceOf(BridgeNotApprovedError);
  });

  it('becomes active only after the remote side accepts', async () => {
    await seedOwners();
    const bridge = await activeBridge();
    expect(bridge.status).toBe('active');
    expect(bridge.remoteApprovedAt).not.toBeNull();
    await expect(assertBridgeSendAllowed(bridge.id, ADULT, 'agent:adult-tutor:main')).resolves.toBeTruthy();
  });
});

describe('pair scope', () => {
  it('refuses an agent on the sender side that is not listed', async () => {
    await seedOwners();
    const bridge = await activeBridge();
    // Mir owns mir-scribe, but this bridge only lists mir-tutor.
    await expect(assertBridgeSendAllowed(bridge.id, MIR, 'agent:mir-scribe:main'))
      .rejects.toBeInstanceOf(BridgePairForbiddenError);
  });

  it('matches the listed agent in either id form', async () => {
    await seedOwners();
    const bridge = await activeBridge();
    await expect(assertBridgeSendAllowed(bridge.id, MIR, 'mir-tutor')).resolves.toBeTruthy();
  });

  it('refuses a third party that is not a participant at all', async () => {
    await seedOwners();
    const bridge = await activeBridge();
    await expect(assertBridgeSendAllowed(bridge.id, ADULT, 'agent:stranger:main'))
      .rejects.toBeInstanceOf(BridgePairForbiddenError);
  });
});

describe('time box and revocation', () => {
  it('cannot send after expiry, and expiry is a persisted transition', async () => {
    await seedOwners();
    const bridge = await activeBridge();
    // Force the clock past expiry.
    const file = path.join(tmpDir, 'bridges.json');
    const raw = JSON.parse(await fsp.readFile(file, 'utf-8')) as { bridges: Array<{ id: string; expiresAt: number }> };
    raw.bridges[0].expiresAt = Date.now() - 1000;
    await fsp.writeFile(file, JSON.stringify(raw));

    await expect(assertBridgeSendAllowed(bridge.id, ADULT, 'agent:adult-tutor:main'))
      .rejects.toBeInstanceOf(BridgeNotApprovedError);
    const after = await getBridge(bridge.id, ADULT);
    expect(after.status).toBe('expired');
    expect(after.log.map((e) => e.event)).toContain('expired');
  });

  it('cannot send after revoke, and either side may revoke', async () => {
    await seedOwners();
    const bridge = await activeBridge();
    const revoked = await revokeBridge(bridge.id, MIR, 'changed my mind');
    expect(revoked.status).toBe('revoked');
    await expect(assertBridgeSendAllowed(bridge.id, ADULT, 'agent:adult-tutor:main'))
      .rejects.toBeInstanceOf(BridgeNotApprovedError);
    await expect(assertBridgeSendAllowed(bridge.id, MIR, 'agent:mir-tutor:main'))
      .rejects.toBeInstanceOf(BridgeNotApprovedError);
  });

  it('revoking from the adult side also closes it', async () => {
    await seedOwners();
    const bridge = await activeBridge();
    await revokeBridge(bridge.id, ADULT);
    await expect(assertBridgeSendAllowed(bridge.id, MIR, 'agent:mir-tutor:main'))
      .rejects.toBeInstanceOf(BridgeNotApprovedError);
  });
});

describe('visibility', () => {
  it('shows the bridge to both sides so the remote agent can accept', async () => {
    await seedOwners();
    const bridge = await activeBridge();
    expect((await listBridgesForProfile(ADULT)).map((b) => b.id)).toContain(bridge.id);
    expect((await listBridgesForProfile(MIR)).map((b) => b.id)).toContain(bridge.id);
    // An unrelated profile sees nothing.
    await createProfile({ name: 'Other' });
    expect(await listBridgesForProfile('other')).toHaveLength(0);
  });

  it('logs creates, accepts, sends and revokes', async () => {
    await seedOwners();
    const bridge = await activeBridge();
    await assertBridgeSendAllowed(bridge.id, ADULT, 'agent:adult-tutor:main');
    await revokeBridge(bridge.id, ADULT, 'done');
    const events = (await getBridge(bridge.id, ADULT)).log.map((e) => e.event);
    expect(events).toContain('created');
    expect(events).toContain('accepted');
    expect(events.some((e) => e.startsWith('message:'))).toBe(true);
    expect(events.some((e) => e.startsWith('revoked'))).toBe(true);
  });
});

/* ── THE critical guarantee: a bridge never opens a read path ───────── */

describe('talk only — a bridge must not unlock any read', () => {
  it('still refuses cross-profile reads while a bridge is ACTIVE', async () => {
    await seedOwners();
    const bridge = await activeBridge();
    expect(bridge.status).toBe('active');

    // The guard that backs memories / file-browser / workspace is unchanged.
    expect(() => assertAgentInProfile('agent:mir-tutor:main', ADULT)).toThrow(CrossProfileForbiddenError);
    expect(() => assertAgentInProfile('mir-tutor', ADULT)).toThrow(CrossProfileForbiddenError);
    expect(() => assertAgentInProfile('agent:adult-tutor:main', MIR)).toThrow(CrossProfileForbiddenError);
  });

  it('refuses a cross-profile MEMORY READ over HTTP while a bridge is active', async () => {
    const homeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bridge-mem-'));
    const dataDir = path.join(homeDir, 'data');
    const workspace = path.join(homeDir, '.openclaw', 'workspace');
    await fsp.mkdir(path.join(workspace, 'memory'), { recursive: true });
    await fsp.mkdir(dataDir, { recursive: true });
    // Mir's agent really does have a memory file — the 403 must come from the
    // profile guard, not from a missing file.
    await fsp.writeFile(path.join(workspace, 'MEMORY.md'), '# MEMORY.md\n\n- secret\n');

    await fsp.writeFile(path.join(dataDir, 'profiles.json'), JSON.stringify({
      version: 1,
      profiles: [
        { id: ADULT, name: 'Korg-e', color: '#C46443', emoji: null, order: 0, createdAt: 1 },
        { id: MIR, name: 'Mir', color: '#0A84FF', emoji: null, order: 1, createdAt: 1 },
      ],
      agentLocks: {},
    }));
    await fsp.writeFile(path.join(dataDir, 'roster.json'), JSON.stringify({
      version: 2,
      bots: [
        { id: 'a1', profileId: ADULT, agentId: 'agent:adult-tutor:main', name: 'Adult', sectionId: null, avatar: '', title: '', description: '', color: '#000', pinned: false, hidden: false, notifications: true, enabledSkills: [], createdAt: 1, updatedAt: 1 },
        { id: 'm1', profileId: MIR, agentId: 'agent:mir-tutor:main', name: 'Mir Tutor', sectionId: null, avatar: '', title: '', description: '', color: '#000', pinned: false, hidden: false, notifications: true, enabledSkills: [], createdAt: 1, updatedAt: 1 },
      ],
      groups: [],
      sections: [],
    }));
    const previousDataDir = process.env.NERVE_DATA_DIR;
    process.env.NERVE_DATA_DIR = dataDir;

    try {
      // Activate a bridge between the two profiles against this data.
      const bridge = await createBridge({
        toProfileId: MIR,
        fromAgentIds: ['agent:adult-tutor:main'],
        toAgentIds: ['agent:mir-tutor:main'],
        reason: 'r',
      }, ADULT);
      await acceptBridge(bridge.id, MIR);
      expect((await getBridge(bridge.id, ADULT)).status).toBe('active');

      vi.resetModules();
      vi.doMock('../lib/config.js', () => ({
        config: {
          auth: false, port: 3000, host: '127.0.0.1',
          home: homeDir,
          memoryPath: path.join(workspace, 'MEMORY.md'),
          memoryDir: path.join(workspace, 'memory'),
        },
        SESSION_COOKIE_NAME: 'nerve_session_3000',
      }));
      vi.doMock('../middleware/rate-limit.js', () => ({
        rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
      }));
      vi.doMock('../lib/gateway-client.js', () => ({ invokeGatewayTool: vi.fn(async () => ({})) }));
      vi.doMock('./events.js', () => ({ broadcast: vi.fn() }));

      const mod = await import('../routes/memories.js');
      const app = new Hono();
      app.route('/', mod.default);

      // The adult profile, with a live bridge, still cannot read Mir's memory.
      const res = await app.request('/api/memories?agentId=mir-tutor', {
        headers: { 'x-nerve-profile': ADULT },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'cross_profile_forbidden' });

      // And the bridge does not make the agent readable from the other side
      // either — each side reads only its own.
      const mirror = await app.request('/api/memories?agentId=adult-tutor', {
        headers: { 'x-nerve-profile': MIR },
      });
      expect(mirror.status).toBe(403);
    } finally {
      vi.resetModules();
      vi.doUnmock('../lib/config.js');
      process.env.NERVE_DATA_DIR = previousDataDir;
      await fsp.rm(homeDir, { recursive: true, force: true });
    }
  });
});
