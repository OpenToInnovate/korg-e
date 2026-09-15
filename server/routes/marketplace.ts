/**
 * Marketplace API Routes — OpenClaw / ClawHub ecosystem proxy.
 *
 * GET    /api/marketplace/plugins            — OpenClaw plugin marketplace feed
 * GET    /api/marketplace/plugins?q=         — Search ClawHub plugin packages
 * POST   /api/marketplace/plugins/refresh    — Refresh the marketplace feed
 * POST   /api/marketplace/plugins/install    — Install a plugin (clawhub:<pkg> spec)
 * GET    /api/marketplace/skills?q=          — Search ClawHub skills
 * POST   /api/marketplace/skills/install     — Install a skill
 * GET    /api/marketplace/agents             — List OpenClaw agents (adoptable bots)
 * @module
 */

import { Hono, type Context } from 'hono';
import { execFile, type ExecFileException } from 'node:child_process';
import { dirname } from 'node:path';
import { z } from 'zod';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import { resolveOpenclawBin } from '../lib/openclaw-bin.js';
import { assertCoreMutationAllowed, CoreUpdateGuardError } from '../lib/core-update-guard.js';

const app = new Hono();

const nodeDir = dirname(process.execPath);
const enrichedEnv = { ...process.env, PATH: `${nodeDir}:${process.env.PATH || ''}` };

const SEARCH_TIMEOUT_MS = 25_000;
const FEED_TIMEOUT_MS = 25_000;
const INSTALL_TIMEOUT_MS = 180_000;

/** ClawHub refs: @owner/slug, git:<repo>, clawhub:<pkg>, local dirs. No spaces. */
const refSchema = z.string().min(1).max(200).regex(/^[\w@./:+-]+$/, 'Invalid package reference');
const querySchema = z.string().max(120).optional();
const agentSchema = z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, 'Invalid agent id');

class MarketplaceError extends Error {}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new MarketplaceError('Empty CLI output');
  try {
    return JSON.parse(trimmed);
  } catch {
    // tolerate leading warnings / log lines
    const start = trimmed.search(/[[{]/);
    if (start >= 0) {
      try {
        return JSON.parse(trimmed.slice(start));
      } catch {
        /* fall through */
      }
    }
    throw new MarketplaceError('Failed to parse CLI output as JSON');
  }
}

function runOpenclaw(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const bin = resolveOpenclawBin();
    execFile(bin, args, {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      env: enrichedEnv,
    }, (err: ExecFileException | null, stdout, stderr) => {
      if (err) {
        const label = `openclaw ${args.join(' ')}`;
        if (err.code === 'ENOENT') return reject(new MarketplaceError('openclaw CLI not found in PATH'));
        if (err.killed && err.signal === 'SIGTERM') return reject(new MarketplaceError(`${label} timed out`));
        const line = stderr.trim().split('\n').find(Boolean);
        return reject(new MarketplaceError(line ? `${label} failed: ${line}` : `${label} failed: ${err.message}`));
      }
      resolve({ stdout, stderr });
    });
  });
}

function errorResponse(c: Context, err: unknown) {
  if (err instanceof CoreUpdateGuardError) {
    return c.json({ ok: false, error: err.message }, 409);
  }
  const message = err instanceof Error ? err.message : 'Marketplace request failed';
  console.error('[marketplace]', message);
  return c.json({ ok: false, error: message }, err instanceof MarketplaceError ? 502 : 500);
}

// ── Plugins ──────────────────────────────────────────────────────────

app.get('/api/marketplace/plugins', rateLimitGeneral, async (c) => {
  const q = querySchema.parse(c.req.query('q') ?? undefined);
  try {
    if (q && q.trim()) {
      const { stdout, stderr } = await runOpenclaw(['plugins', 'search', q.trim(), '--json', '--limit', '24'], SEARCH_TIMEOUT_MS);
      const payload = extractJson(stdout.trim() ? stdout : stderr) as { results?: unknown[] };
      return c.json({ ok: true, kind: 'search', results: Array.isArray(payload.results) ? payload.results : [] });
    }
    const offline = c.req.query('refresh') !== '1';
    const args = ['plugins', 'marketplace', 'entries', '--json'];
    if (offline) args.push('--offline');
    const { stdout, stderr } = await runOpenclaw(args, FEED_TIMEOUT_MS);
    const payload = extractJson(stdout.trim() ? stdout : stderr) as { entries?: unknown[]; source?: string };
    return c.json({ ok: true, kind: 'feed', source: payload.source ?? null, results: Array.isArray(payload.entries) ? payload.entries : [] });
  } catch (err) {
    return errorResponse(c, err);
  }
});

app.post('/api/marketplace/plugins/refresh', rateLimitGeneral, async (c) => {
  try {
    await runOpenclaw(['plugins', 'marketplace', 'refresh'], FEED_TIMEOUT_MS);
    const { stdout, stderr } = await runOpenclaw(['plugins', 'marketplace', 'entries', '--json', '--offline'], FEED_TIMEOUT_MS);
    const payload = extractJson(stdout.trim() ? stdout : stderr) as { entries?: unknown[] };
    return c.json({ ok: true, results: Array.isArray(payload.entries) ? payload.entries : [] });
  } catch (err) {
    return errorResponse(c, err);
  }
});

const installPluginSchema = z.object({ spec: refSchema });

app.post('/api/marketplace/plugins/install', rateLimitGeneral, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = installPluginSchema.safeParse(body);
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid spec' }, 400);
  try {
    // Plugin installs mutate the installation — refuse during a core update
    // so version convergence can't race the update's verification phase.
    await assertCoreMutationAllowed();
    const { stdout, stderr } = await runOpenclaw(['plugins', 'install', parsed.data.spec], INSTALL_TIMEOUT_MS);
    return c.json({ ok: true, output: (stdout || stderr).trim().slice(-4000) });
  } catch (err) {
    return errorResponse(c, err);
  }
});

// ── Skills (ClawHub) ─────────────────────────────────────────────────

app.get('/api/marketplace/skills', rateLimitGeneral, async (c) => {
  const q = querySchema.parse(c.req.query('q') ?? undefined);
  try {
    const args = ['skills', 'search', '--json', '--limit', '24'];
    if (q && q.trim()) args.splice(2, 0, q.trim());
    const { stdout, stderr } = await runOpenclaw(args, SEARCH_TIMEOUT_MS);
    const payload = extractJson(stdout.trim() ? stdout : stderr) as { results?: unknown[] };
    return c.json({ ok: true, results: Array.isArray(payload.results) ? payload.results : [] });
  } catch (err) {
    return errorResponse(c, err);
  }
});

const installSkillSchema = z.object({
  ref: refSchema,
  agentId: agentSchema.optional(),
  global: z.boolean().optional(),
});

app.post('/api/marketplace/skills/install', rateLimitGeneral, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = installSkillSchema.safeParse(body);
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid skill ref' }, 400);
  const args = ['skills', 'install', parsed.data.ref];
  if (parsed.data.agentId) args.push('--agent', parsed.data.agentId);
  if (parsed.data.global) args.push('--global');
  try {
    await assertCoreMutationAllowed();
    const { stdout, stderr } = await runOpenclaw(args, INSTALL_TIMEOUT_MS);
    return c.json({ ok: true, output: (stdout || stderr).trim().slice(-4000) });
  } catch (err) {
    return errorResponse(c, err);
  }
});

// ── Agents (adopt an existing OpenClaw agent as a bot) ───────────────

app.get('/api/marketplace/agents', rateLimitGeneral, async (c) => {
  try {
    const { stdout, stderr } = await runOpenclaw(['agents', 'list', '--json'], SEARCH_TIMEOUT_MS);
    const payload = extractJson(stdout.trim() ? stdout : stderr);
    const agents = Array.isArray(payload) ? payload : [];
    return c.json({ ok: true, agents });
  } catch (err) {
    return errorResponse(c, err);
  }
});

export default app;