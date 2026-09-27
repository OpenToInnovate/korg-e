/** Tests for GET /api/roster/agents/available — the "free to bind" agent picker. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';

const MIR = 'mir';
const KORGE = 'korge';

let tmpDir: string;
let dataDir: string;
let configPath: string;
let previous: Record<string, string | undefined>;

async function seedFiles(opts: { boundAgent?: string; boundProfile?: string; agents?: Record<string, unknown> } = {}) {
  const boundAgent = opts.boundAgent ?? 'mir-tutor';
  const boundProfile = opts.boundProfile ?? MIR;
  const agents = opts.agents ?? {
    'mir-tutor': { name: 'Mir Tutor', workspace: '/tmp/ws-mir-tutor' },
    'free-agent': { name: 'Free Agent' },
    'korge-coder': { identity: { name: 'Korg-e Coder' } },
  };

  await fs.writeFile(
    path.join(dataDir, 'profiles.json'),
    JSON.stringify({
      version: 1,
      profiles: [
        { id: KORGE, name: 'Korg-e', color: '#C46443', emoji: null, order: 0, createdAt: 1 },
        { id: MIR, name: 'Mir', color: '#0A84FF', emoji: null, order: 1, createdAt: 1 },
      ],
      agentLocks: { [`agent:${boundAgent}:main`]: boundProfile },
    }),
    'utf8',
  );

  await fs.writeFile(
    path.join(dataDir, 'roster.json'),
    JSON.stringify({
      version: 2,
      bots: [{
        id: 'm1',
        profileId: boundProfile,
        agentId: `agent:${boundAgent}:main`,
        name: 'Bound Bot',
        sectionId: null,
        avatar: '',
        title: '',
        description: '',
        color: '#000',
        pinned: false,
        hidden: false,
        notifications: true,
        enabledSkills: [],
        createdAt: 1,
        updatedAt: 1,
      }],
      groups: [],
      sections: [],
    }),
    'utf8',
  );

  await fs.writeFile(
    configPath,
    JSON.stringify({ agents: { defaults: {}, entries: agents } }, null, 2),
    'utf8',
  );
}

beforeEach(async () => {
  previous = {
    NERVE_DATA_DIR: process.env.NERVE_DATA_DIR,
    OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH,
  };
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roster-agents-'));
  dataDir = path.join(tmpDir, 'data');
  configPath = path.join(tmpDir, 'openclaw.json');
  process.env.NERVE_DATA_DIR = dataDir;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  await fs.mkdir(dataDir, { recursive: true });
  await seedFiles();
  vi.resetModules();
});

afterEach(async () => {
  for (const [k, v] of Object.entries(previous)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function buildApp() {
  vi.doMock('../lib/config.js', () => ({
    config: {
      auth: false, port: 3000, host: '127.0.0.1',
      home: tmpDir,
      sessionSecret: 'test-secret',
      sessionTtlMs: 60_000,
      memoryPath: path.join(tmpDir, 'MEMORY.md'),
      memoryDir: path.join(tmpDir, 'memory'),
    },
    SESSION_COOKIE_NAME: 'nerve_session_3000',
  }));
  vi.doMock('../middleware/rate-limit.js', () => ({
    rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
  }));
  vi.doMock('../lib/gateway-rpc.js', () => ({ gatewayRpcCall: vi.fn(async () => ({})) }));

  const mod = await import('./roster.js');
  const app = new Hono();
  app.route('/', mod.default);
  return app;
}

describe('GET /api/roster/agents/available', () => {
  it('omits an agent bound to another profile and returns the free ones', async () => {
    const app = await buildApp();
    const res = await app.request('/api/roster/agents/available', {
      headers: { 'x-nerve-profile': KORGE },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { agents: Array<{ id: string; name: string }> };

    // Bound to Mir — must never be offered, in any profile.
    expect(body.agents.map((a) => a.id)).not.toContain('mir-tutor');
    // Free agents are offered.
    expect(body.agents.map((a) => a.id)).toEqual(expect.arrayContaining(['free-agent', 'korge-coder']));
  });

  it('returns BARE ids, never session keys', async () => {
    const app = await buildApp();
    const res = await app.request('/api/roster/agents/available', {
      headers: { 'x-nerve-profile': KORGE },
    });
    const body = await res.json() as { agents: Array<{ id: string }> };
    for (const agent of body.agents) {
      expect(agent.id.startsWith('agent:')).toBe(false);
      expect(agent.id).not.toContain(':');
    }
  });

  it('includes a readable human name for each agent', async () => {
    const app = await buildApp();
    const res = await app.request('/api/roster/agents/available', {
      headers: { 'x-nerve-profile': KORGE },
    });
    const body = await res.json() as { agents: Array<{ id: string; name: string }> };
    const byId = new Map(body.agents.map((a) => [a.id, a.name]));
    // Configured name wins.
    expect(byId.get('free-agent')).toBe('Free Agent');
    // Falls back to identity.name.
    expect(byId.get('korge-coder')).toBe('Korg-e Coder');
  });

  it('still omits another profile\'s agent when queried as that profile', async () => {
    const app = await buildApp();
    const res = await app.request('/api/roster/agents/available', {
      headers: { 'x-nerve-profile': MIR },
    });
    const body = await res.json() as { agents: Array<{ id: string }> };
    // Mir's own agent is bound, so it is not re-offered.
    expect(body.agents.map((a) => a.id)).not.toContain('mir-tutor');
    expect(body.agents.map((a) => a.id)).toContain('free-agent');
  });

  it('returns 200 with an empty list when every agent is bound', async () => {
    await seedFiles({
      boundAgent: 'mir-tutor',
      agents: { 'mir-tutor': { name: 'Mir Tutor' } },
    });
    const app = await buildApp();
    const res = await app.request('/api/roster/agents/available', {
      headers: { 'x-nerve-profile': KORGE },
    });
    // An empty picker is a valid state, not a 404.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ agents: [] });
  });

  it('refuses a client-asserted profileId that is not the active one', async () => {
    const app = await buildApp();
    const res = await app.request(`/api/roster/agents/available?profileId=${MIR}`, {
      headers: { 'x-nerve-profile': KORGE },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'cross_profile_forbidden' });
  });

  it('accepts a profileId matching the active profile', async () => {
    const app = await buildApp();
    const res = await app.request(`/api/roster/agents/available?profileId=${KORGE}`, {
      headers: { 'x-nerve-profile': KORGE },
    });
    expect(res.status).toBe(200);
  });

  it('treats a roster row with no profileId as bound (fails closed)', async () => {
    await seedFiles({
      agents: { 'orphan': { name: 'Orphan' }, 'free-agent': { name: 'Free Agent' } },
    });
    // Written AFTER seedFiles, which would otherwise restore a well-formed row.
    // A malformed row must never make the agent look free.
    await fs.writeFile(
      path.join(dataDir, 'roster.json'),
      JSON.stringify({
        version: 2,
        bots: [{ id: 'bad', agentId: 'agent:orphan:main', name: 'Orphan' }],
        groups: [],
        sections: [],
      }),
      'utf8',
    );
    const app = await buildApp();
    const res = await app.request('/api/roster/agents/available', {
      headers: { 'x-nerve-profile': KORGE },
    });
    const body = await res.json() as { agents: Array<{ id: string }> };
    expect(body.agents.map((a) => a.id)).not.toContain('orphan');
    expect(body.agents.map((a) => a.id)).toContain('free-agent');
  });
});
