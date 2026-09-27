/** Tests for the image file serving route (GET /api/files). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// The profile guard reads the profiles/lock files and attributes paths to agent
// workspaces, so isolate both from the developer's real ~/.nerve data.
let isolatedDataDir: string;
let isolatedWorkspaceRoot: string;
let previousDataDir: string | undefined;
let previousWorkspaceRoot: string | undefined;
beforeEach(async () => {
  previousDataDir = process.env.NERVE_DATA_DIR;
  previousWorkspaceRoot = process.env.NERVE_AGENT_WORKSPACE_ROOT;
  isolatedDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'files-datadir-'));
  isolatedWorkspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'files-workspaces-'));
  process.env.NERVE_DATA_DIR = isolatedDataDir;
  process.env.NERVE_AGENT_WORKSPACE_ROOT = isolatedWorkspaceRoot;
  await fs.writeFile(
    path.join(isolatedDataDir, 'profiles.json'),
    JSON.stringify({
      version: 1,
      profiles: [
        { id: 'korge', name: 'Korg-e', color: '#C46443', emoji: null, order: 0, createdAt: 1 },
        { id: 'mir', name: 'Mir', color: '#0A84FF', emoji: null, order: 1, createdAt: 1 },
      ],
      agentLocks: { 'agent:mir-tutor:main': 'mir' },
    }),
  );
});
afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.NERVE_DATA_DIR;
  else process.env.NERVE_DATA_DIR = previousDataDir;
  if (previousWorkspaceRoot === undefined) delete process.env.NERVE_AGENT_WORKSPACE_ROOT;
  else process.env.NERVE_AGENT_WORKSPACE_ROOT = previousWorkspaceRoot;
  await fs.rm(isolatedDataDir, { recursive: true, force: true });
  await fs.rm(isolatedWorkspaceRoot, { recursive: true, force: true });
});

describe('GET /api/files', () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'files-test-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function buildApp() {
    vi.doMock('../lib/config.js', () => ({
      config: {
        auth: false, port: 3000, host: '127.0.0.1', sslPort: 3443,
        memoryDir: tmpDir,
      },
      SESSION_COOKIE_NAME: 'nerve_session_3000',
    }));

    const mod = await import('./files.js');
    const app = new Hono();
    app.route('/', mod.default);
    return app;
  }

  it('returns 400 when path parameter is missing', async () => {
    const app = await buildApp();
    const res = await app.request('/api/files');
    expect(res.status).toBe(400);
  });

  it('returns 403 for non-image file types', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await fs.writeFile(filePath, 'hello');
    const app = await buildApp();
    const res = await app.request(`/api/files?path=${encodeURIComponent(filePath)}`);
    expect(res.status).toBe(403);
  });

  it('serves PNG images with correct content type', async () => {
    const filePath = path.join(tmpDir, 'test.png');
    const fakeData = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
    await fs.writeFile(filePath, fakeData);
    const app = await buildApp();
    const res = await app.request(`/api/files?path=${encodeURIComponent(filePath)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it('serves JPEG images', async () => {
    const filePath = path.join(tmpDir, 'test.jpg');
    await fs.writeFile(filePath, Buffer.from([0xff, 0xd8, 0xff]));
    const app = await buildApp();
    const res = await app.request(`/api/files?path=${encodeURIComponent(filePath)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
  });

  it('returns 404 for non-existent file', async () => {
    const app = await buildApp();
    const fakePath = path.join(tmpDir, 'nope.png');
    const res = await app.request(`/api/files?path=${encodeURIComponent(fakePath)}`);
    expect(res.status).toBe(404);
  });

  it('returns 403 for paths outside allowed prefixes', async () => {
    const app = await buildApp();
    const res = await app.request(`/api/files?path=${encodeURIComponent('/etc/passwd.png')}`);
    expect(res.status).toBe(403);
  });

  it('forces Content-Disposition: attachment for SVGs', async () => {
    const filePath = path.join(tmpDir, 'test.svg');
    await fs.writeFile(filePath, '<svg></svg>');
    const app = await buildApp();
    const res = await app.request(`/api/files?path=${encodeURIComponent(filePath)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment');
  });

  it('sets cache headers', async () => {
    const filePath = path.join(tmpDir, 'test.webp');
    await fs.writeFile(filePath, Buffer.from([0x52, 0x49, 0x46, 0x46]));
    const app = await buildApp();
    const res = await app.request(`/api/files?path=${encodeURIComponent(filePath)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('max-age');
  });
});

/**
 * CRITICAL-2: this route takes no agent, but the allowlist includes ~/.openclaw
 * where every agent workspace lives, so a path inside another profile's agent
 * workspace must be refused.
 */
describe('GET /api/files — cross-profile guard', () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'files-guard-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function buildApp() {
    vi.doMock('../lib/config.js', () => ({
      config: {
        auth: false, port: 3000, host: '127.0.0.1', sslPort: 3443,
        memoryDir: tmpDir,
      },
      SESSION_COOKIE_NAME: 'nerve_session_3000',
    }));
    const mod = await import('./files.js');
    const app = new Hono();
    app.route('/', mod.default);
    return app;
  }

  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  it("refuses an image inside another profile's agent workspace", async () => {
    const ws = path.join(isolatedWorkspaceRoot, 'workspace-mir-tutor');
    await fs.mkdir(ws, { recursive: true });
    const file = path.join(ws, 'photo.png');
    await fs.writeFile(file, PNG);

    const app = await buildApp();
    const res = await app.request(`/api/files?path=${encodeURIComponent(file)}`, {
      headers: { 'x-nerve-profile': 'korge' },
    });
    expect(res.status).toBe(403);

    // The owning profile can still read it.
    const own = await app.request(`/api/files?path=${encodeURIComponent(file)}`, {
      headers: { 'x-nerve-profile': 'mir' },
    });
    expect(own.status).toBe(200);
  });

  it('still serves an image that belongs to no agent workspace', async () => {
    const file = path.join(tmpDir, 'shared.png');
    await fs.writeFile(file, PNG);
    const app = await buildApp();
    const res = await app.request(`/api/files?path=${encodeURIComponent(file)}`, {
      headers: { 'x-nerve-profile': 'korge' },
    });
    expect(res.status).toBe(200);
  });
});
