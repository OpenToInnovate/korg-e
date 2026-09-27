/**
 * Sessions router — per-route privacy coverage.
 *
 * Two bugs are pinned here:
 *  1. GET /api/sessions/hidden had NO guard and returned every cron session of
 *     every agent from the global store, so one profile could read another's
 *     session labels, ids, model and token counts. The fix is an ownership
 *     FILTER over the results — a pre-handler guard cannot work here.
 *  2. getAgentIdFromSessionKey coerced any non-conforming key to 'main', which
 *     is unowned and therefore took the permissive default-profile path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';

let tmpDir: string;
let dataDir: string;
let previous: Record<string, string | undefined>;

/** Cron keys must match /^agent:[^:]+:cron:[^:]+(?::run:.+)?$/ to be listed. */
function cronSession(label: string) {
  return {
    sessionId: `sid-${label}`,
    label,
    displayName: `${label} display`,
    updatedAt: Date.now(),
    model: 'test-model',
    thinkingLevel: 'off',
    totalTokens: 1234,
    contextTokens: 5678,
  };
}

beforeEach(async () => {
  previous = {
    NERVE_DATA_DIR: process.env.NERVE_DATA_DIR,
    OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH,
  };
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sess-hidden-'));
  dataDir = path.join(tmpDir, 'data');
  process.env.NERVE_DATA_DIR = dataDir;
  process.env.OPENCLAW_CONFIG_PATH = path.join(tmpDir, 'openclaw.json');
  await fs.mkdir(dataDir, { recursive: true });

  await fs.writeFile(
    path.join(dataDir, 'profiles.json'),
    JSON.stringify({
      version: 1,
      profiles: [
        { id: 'korge', name: 'Korg-e', color: '#C46443', emoji: null, order: 0, createdAt: 1 },
        { id: 'mir', name: 'Mir', color: '#0A84FF', emoji: null, order: 1, createdAt: 1 },
        { id: 'wakana', name: 'Wakana', color: '#FF9F0A', emoji: null, order: 2, createdAt: 1 },
      ],
      agentLocks: {
        'coder': 'korge',
        'agent:coder:main': 'korge',
        'mir-tutor': 'mir',
        'agent:mir-tutor:main': 'mir',
        'mir-club-coach': 'mir',
        'agent:mir-club-coach:main': 'mir',
      },
    }),
  );
  await fs.writeFile(
    path.join(dataDir, 'roster.json'),
    JSON.stringify({ version: 2, bots: [], groups: [], sections: [] }),
  );

  // The GLOBAL store, holding cron sessions for three different owners.
  await fs.writeFile(
    path.join(tmpDir, 'sessions.json'),
    JSON.stringify({
      'agent:mir-tutor:cron:daily': cronSession('mir-tutor-daily'),
      'agent:mir-club-coach:cron:weekly': cronSession('mir-club-weekly'),
      'agent:coder:cron:hourly': cronSession('coder-hourly'),
    }),
  );
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
      auth: false,
      port: 3000,
      host: '127.0.0.1',
      home: tmpDir,
      sessionsDir: tmpDir,               // the GLOBAL store
      memoryPath: path.join(tmpDir, 'workspace', 'MEMORY.md'),
      memoryDir: path.join(tmpDir, 'workspace', 'memory'),
    },
    SESSION_COOKIE_NAME: 'nerve_session_3000',
  }));
  vi.doMock('../middleware/rate-limit.js', () => ({
    rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
  }));
  vi.doMock('../lib/subagent-spawn.js', () => ({ spawnSubagent: vi.fn() }));
  vi.doMock('../lib/gateway-rpc.js', () => ({ gatewayRpcCall: vi.fn(async () => ({})) }));

  const mod = await import('./sessions.js');
  const app = new Hono();
  app.route('/', mod.default);
  return app;
}

describe('GET /api/sessions/hidden — ownership filter', () => {
  it('returns only the active profile\'s cron sessions (fails against the old unguarded code)', async () => {
    const app = await buildApp();
    const res = await app.request('/api/sessions/hidden', {
      headers: { 'x-nerve-profile': 'mir' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; sessions: Array<{ sessionKey: string }> };

    const keys = body.sessions.map((s) => s.sessionKey);
    // Mir's own two sessions are present...
    expect(keys).toContain('agent:mir-tutor:cron:daily');
    expect(keys).toContain('agent:mir-club-coach:cron:weekly');
    // ...and the other profile's is NOT. The old code returned all three.
    expect(keys).not.toContain('agent:coder:cron:hourly');
  });

  it('leaks nothing in the other direction either', async () => {
    const app = await buildApp();
    const res = await app.request('/api/sessions/hidden', {
      headers: { 'x-nerve-profile': 'korge' },
    });
    const body = await res.json() as { sessions: Array<{ sessionKey: string }> };
    const keys = body.sessions.map((s) => s.sessionKey);
    expect(keys).toEqual(['agent:coder:cron:hourly']);
  });

  it('returns 200 with an empty list when the profile owns none — never 403', async () => {
    const app = await buildApp();
    const res = await app.request('/api/sessions/hidden', {
      headers: { 'x-nerve-profile': 'wakana' },
    });
    // An empty picker is a valid answer, not a permission failure.
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; sessions: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.sessions).toEqual([]);
  });

  it('drops a cron session that cannot be attributed to an agent (fail closed)', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'sessions.json'),
      JSON.stringify({
        // Attributable and owned by korge.
        'agent:coder:cron:hourly': cronSession('coder-hourly'),
        // Attributable but owned by mir — must not appear for korge.
        'agent:mir-tutor:cron:daily': cronSession('mir-tutor-daily'),
      }),
    );
    const app = await buildApp();
    const res = await app.request('/api/sessions/hidden', {
      headers: { 'x-nerve-profile': 'korge' },
    });
    const body = await res.json() as { sessions: Array<{ sessionKey: string }> };
    expect(body.sessions.map((s) => s.sessionKey)).toEqual(['agent:coder:cron:hourly']);
  });
});

describe('non-conforming session keys fail closed', () => {
  it('GET /api/sessions/runtime rejects a key that names no agent', async () => {
    const app = await buildApp();
    for (const badKey of ['main', 'not-a-session-key', 'agent:', 'agent:onlyone']) {
      const res = await app.request(`/api/sessions/runtime?sessionKey=${encodeURIComponent(badKey)}`, {
        headers: { 'x-nerve-profile': 'korge' },
      });
      // Used to resolve to 'main' (unowned → permissive) and answer 200.
      expect(res.status, badKey).toBe(400);
      expect(await res.json(), badKey).toEqual({ error: 'agentId is required' });
    }
  });

  it('GET /api/sessions/media rejects a key that names no agent', async () => {
    const app = await buildApp();
    const res = await app.request(
      `/api/sessions/media?sessionKey=${encodeURIComponent('not-a-session-key')}&timestamp=1&imageIndex=0`,
      { headers: { 'x-nerve-profile': 'korge' } },
    );
    expect(res.status).toBe(400);
  });

  it('still serves a conforming key for its own profile', async () => {
    const app = await buildApp();
    const res = await app.request('/api/sessions/runtime?sessionKey=agent:mir-tutor:main', {
      headers: { 'x-nerve-profile': 'mir' },
    });
    expect(res.status).toBe(200);
  });

  it('still refuses a conforming key from another profile (403 not weakened)', async () => {
    const app = await buildApp();
    const res = await app.request('/api/sessions/runtime?sessionKey=agent:mir-tutor:main', {
      headers: { 'x-nerve-profile': 'korge' },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'cross_profile_forbidden' });
  });
});

describe('POST /api/sessions/spawn-subagent', () => {
  it('refuses to spawn into another profile\'s session', async () => {
    const app = await buildApp();
    const res = await app.request('/api/sessions/spawn-subagent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nerve-profile': 'korge' },
      body: JSON.stringify({ parentSessionKey: 'agent:mir-tutor:main', task: 'do a thing' }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'cross_profile_forbidden' });
  });

  it('refuses a parent key that names no agent', async () => {
    const app = await buildApp();
    const res = await app.request('/api/sessions/spawn-subagent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nerve-profile': 'korge' },
      body: JSON.stringify({ parentSessionKey: 'not-a-session-key', task: 'do a thing' }),
    });
    expect(res.status).toBe(400);
  });
});
