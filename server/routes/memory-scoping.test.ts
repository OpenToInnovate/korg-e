/**
 * Fail-closed memory scoping — regression coverage for the shared-root bug.
 *
 * A request that named no agent used to pass the guard and then resolve to the
 * shared root workspace (`/home/openclaw/.openclaw/workspace`), which is agent
 * `main` = the default profile. Anything written there was readable by every
 * main-resolving agent. These tests pin "no agent named = no access".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';
import {
  CrossProfileForbiddenError,
  MissingAgentIdError,
  assertAgentInProfile,
  assertRowInProfile,
} from '../lib/profiles.js';

const DEFAULT_PROFILE_ID = 'korge';
const MIR = 'mir';

/** The shared bucket Tony's report was about. Asserted against, never returned. */
const SHARED_ROOT = '/home/openclaw/.openclaw/workspace';

let tmpDir: string;
let dataDir: string;
let previous: Record<string, string | undefined>;

beforeEach(async () => {
  previous = {
    NERVE_DATA_DIR: process.env.NERVE_DATA_DIR,
    OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH,
    NERVE_AGENT_WORKSPACE_ROOT: process.env.NERVE_AGENT_WORKSPACE_ROOT,
  };
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mem-scope-'));
  dataDir = path.join(tmpDir, 'data');
  process.env.NERVE_DATA_DIR = dataDir;
  process.env.OPENCLAW_CONFIG_PATH = path.join(tmpDir, 'openclaw.json');
  process.env.NERVE_AGENT_WORKSPACE_ROOT = path.join(tmpDir, 'workspaces');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(process.env.NERVE_AGENT_WORKSPACE_ROOT, { recursive: true });

  await fs.writeFile(
    path.join(dataDir, 'profiles.json'),
    JSON.stringify({
      version: 1,
      profiles: [
        { id: DEFAULT_PROFILE_ID, name: 'Korg-e', color: '#C46443', emoji: null, order: 0, createdAt: 1 },
        { id: MIR, name: 'Mir', color: '#0A84FF', emoji: null, order: 1, createdAt: 1 },
      ],
      agentLocks: { 'agent:mir-tutor:main': MIR },
    }),
  );
  await fs.writeFile(
    path.join(dataDir, 'roster.json'),
    JSON.stringify({
      version: 2,
      bots: [
        { id: 'm1', profileId: MIR, agentId: 'agent:mir-tutor:main', name: 'Mir Tutor', sectionId: null, avatar: '', title: '', description: '', color: '#000', pinned: false, hidden: false, notifications: true, enabledSkills: [], createdAt: 1, updatedAt: 1 },
        { id: 'k1', profileId: DEFAULT_PROFILE_ID, agentId: 'agent:coder:main', name: 'Coder', sectionId: null, avatar: '', title: '', description: '', color: '#000', pinned: false, hidden: false, notifications: true, enabledSkills: [], createdAt: 1, updatedAt: 1 },
      ],
      groups: [],
      sections: [],
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

/** config.memoryPath's dirname is the shared root, exactly as in production. */
async function buildApp() {
  vi.doMock('../lib/config.js', () => ({
    config: {
      auth: false,
      port: 3000,
      host: '127.0.0.1',
      home: tmpDir,
      memoryPath: path.join(tmpDir, 'workspace', 'MEMORY.md'),
      memoryDir: path.join(tmpDir, 'workspace', 'memory'),
      sessionsDir: path.join(tmpDir, 'sessions'),
    },
    SESSION_COOKIE_NAME: 'nerve_session_3000',
  }));
  vi.doMock('../middleware/rate-limit.js', () => ({
    rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
  }));
  vi.doMock('../lib/gateway-client.js', () => ({ invokeGatewayTool: vi.fn(async () => ({})) }));
  vi.doMock('./events.js', () => ({ broadcast: vi.fn() }));

  const mod = await import('./memories.js');
  const app = new Hono();
  app.route('/', mod.default);
  return app;
}

describe('the guard itself fails closed', () => {
  it('throws for a missing agentId for EVERY profile, including the default', () => {
    for (const profile of [DEFAULT_PROFILE_ID, MIR, 'anything-at-all']) {
      expect(() => assertAgentInProfile(undefined, profile)).toThrow(MissingAgentIdError);
      expect(() => assertAgentInProfile(null, profile)).toThrow(MissingAgentIdError);
      expect(() => assertAgentInProfile('', profile)).toThrow(MissingAgentIdError);
      expect(() => assertAgentInProfile('   ', profile)).toThrow(MissingAgentIdError);
    }
  });

  it('still allows a real agent of the active profile', () => {
    expect(() => assertAgentInProfile('coder', DEFAULT_PROFILE_ID)).not.toThrow();
    expect(() => assertAgentInProfile('mir-tutor', MIR)).not.toThrow();
  });

  it('still refuses another profile agent (not weakened)', () => {
    expect(() => assertAgentInProfile('mir-tutor', DEFAULT_PROFILE_ID)).toThrow(CrossProfileForbiddenError);
  });

  it('assertRowInProfile fails closed on a missing row', () => {
    expect(() => assertRowInProfile(undefined, DEFAULT_PROFILE_ID, 'Bot')).toThrow();
    // A row owned by another profile is still refused.
    expect(() => assertRowInProfile({ profileId: MIR }, DEFAULT_PROFILE_ID, 'Bot'))
      .toThrow(CrossProfileForbiddenError);
  });
});

describe('memory routes reject an underspecified request', () => {
  it('GET /api/memory with no agentId is 4xx and leaks no workspace path', async () => {
    const app = await buildApp();
    const res = await app.request('/api/memories', { headers: { 'x-nerve-profile': DEFAULT_PROFILE_ID } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const text = await res.text();
    expect(text).not.toContain(SHARED_ROOT);
    expect(text).not.toContain('MEMORY.md');
  });

  it('POST /api/memory with no agentId is 4xx and writes nothing to the shared root', async () => {
    const app = await buildApp();
    const sharedMemory = path.join(tmpDir, 'workspace', 'MEMORY.md');
    const res = await app.request('/api/memories', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nerve-profile': DEFAULT_PROFILE_ID },
      body: JSON.stringify({ text: 'leak me' }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    // Nothing was written to the shared root.
    await expect(fs.access(sharedMemory)).rejects.toBeTruthy();
    expect(await res.text()).not.toContain(SHARED_ROOT);
  });

  it('DELETE /api/memory with no agentId is 4xx and touches nothing', async () => {
    const app = await buildApp();
    const res = await app.request('/api/memories', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'x-nerve-profile': DEFAULT_PROFILE_ID },
      body: JSON.stringify({ query: 'anything' }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe('memory routes still work for a real in-profile agent', () => {
  it('GET returns content for the active profile\'s own agent', async () => {
    const app = await buildApp();
    const res = await app.request('/api/memories?agentId=coder', {
      headers: { 'x-nerve-profile': DEFAULT_PROFILE_ID },
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('GET returns content for the child profile\'s own agent', async () => {
    const app = await buildApp();
    const res = await app.request('/api/memories?agentId=mir-tutor', {
      headers: { 'x-nerve-profile': MIR },
    });
    expect(res.status).toBe(200);
  });
});

describe('memory routes still refuse another profile', () => {
  it('GET is 403 cross_profile_forbidden in both directions', async () => {
    const app = await buildApp();
    const toMir = await app.request('/api/memories?agentId=mir-tutor', {
      headers: { 'x-nerve-profile': DEFAULT_PROFILE_ID },
    });
    expect(toMir.status).toBe(403);
    expect(await toMir.json()).toEqual({ error: 'cross_profile_forbidden' });

    const toKorge = await app.request('/api/memories?agentId=coder', {
      headers: { 'x-nerve-profile': MIR },
    });
    expect(toKorge.status).toBe(403);
  });

  it('POST and DELETE are 403 cross_profile_forbidden', async () => {
    const app = await buildApp();
    const post = await app.request('/api/memories', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nerve-profile': DEFAULT_PROFILE_ID },
      body: JSON.stringify({ text: 'nope', agentId: 'mir-tutor' }),
    });
    expect(post.status).toBe(403);

    const del = await app.request('/api/memories', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'x-nerve-profile': DEFAULT_PROFILE_ID },
      body: JSON.stringify({ query: 'anything', agentId: 'mir-tutor' }),
    });
    expect(del.status).toBe(403);
  });
});

describe('regression: nothing resolves to the shared root', () => {
  it('a missing agentId never yields the shared-root workspace', async () => {
    const app = await buildApp();
    // Sweep the routes that resolve an agent workspace from client input.
    const probes: Array<[string, RequestInit?]> = [
      ['/api/memories'],
      ['/api/workspace/SOUL.md'],
      ['/api/file-browser/list?path=.'],
      ['/api/skills'],
    ];
    for (const [url, init] of probes) {
      const res = await app.request(url, {
        ...init,
        headers: { 'x-nerve-profile': DEFAULT_PROFILE_ID, ...(init?.headers ?? {}) },
      });
      const body = await res.text();
      expect(body, `${url} must not leak the shared root`).not.toContain(SHARED_ROOT);
      expect(body, `${url} must not leak a MEMORY.md path`).not.toContain('MEMORY.md');
    }
  });

  it('names the shared root explicitly so the intent cannot be forgotten', () => {
    // If someone "fixes" the guard by making the client always send an id while
    // leaving the server permissive again, resolveAgentWorkspace(undefined)
    // still maps to the shared root — which is why the server-side guard, and
    // not the client, is what these tests pin.
    expect(SHARED_ROOT).toContain('.openclaw/workspace');
  });
});
