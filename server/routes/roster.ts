/**
 * Roster API Routes — Korg-e Bot profiles + group chats.
 *
 * GET    /api/roster                    — Full roster (bots + groups)
 * POST   /api/roster/bots               — Create a bot profile
 * PATCH  /api/roster/bots/:id           — Update a bot profile
 * POST   /api/roster/bots/:id/duplicate — Copy profile + skills (no history)
 * DELETE /api/roster/bots/:id           — Delete a bot (?deleteRoutines=true removes owned cron jobs)
 * POST   /api/roster/groups             — Create a group chat (2–6 bots)
 * PATCH  /api/roster/groups/:id         — Update a group chat
 * DELETE /api/roster/groups/:id         — Delete a group chat
 * @module
 */

import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import { gatewayRpcCall } from '../lib/gateway-rpc.js';
import {
  assertCoreMutationAllowed,
  assertOpenclawArgsAllowed,
  CoreUpdateGuardError,
  isAgentIdSafe,
} from '../lib/core-update-guard.js';
import { execFile, type ExecFileException } from 'node:child_process';
import { dirname } from 'node:path';
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
} from '../lib/roster-store.js';
import {
  CrossProfileForbiddenError,
  ProfileValidationError,
  ProfileNotFoundError,
  createProfile,
  deleteProfile,
  listProfiles,
  profileCookieHeader,
  resolveActiveProfileId,
  updateProfile,
} from '../lib/profiles.js';

const app = new Hono();

/** Active profile for this request: `x-nerve-profile` → cookie → default. */
function activeProfileId(c: Context): Promise<string> {
  return resolveActiveProfileId(c.req.header('x-nerve-profile') ?? null, c.req.header('cookie') ?? null);
}

const nodeDir = dirname(process.execPath);
const enrichedEnv = { ...process.env, PATH: `${nodeDir}:${process.env.PATH || ''}` };
const WIRE_TIMEOUT_MS = 90_000;

function runOpenclaw(args: string[]): Promise<void> {
  // Defense in depth: never let a roster call escape into core lifecycle
  // subcommands or outside the allowlisted config subtree.
  assertOpenclawArgsAllowed(args);
  return new Promise((resolve, reject) => {
    execFile('openclaw', args, {
      timeout: WIRE_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
      env: enrichedEnv,
    }, (err: ExecFileException | null, _stdout, stderr) => {
      if (err) {
        const line = stderr.trim().split('\n').find(Boolean);
        return reject(new Error(line || err.message));
      }
      resolve();
    });
  });
}

/** `agent:<id>:main` → `<id>` (the OpenClaw config entries key). */
function agentIdFromSessionKey(sessionKey: string): string | null {
  const m = /^agent:([^:]+):/.exec(sessionKey);
  return m ? m[1] : null;
}

/**
 * Wire OpenClaw's native team delegation so the Alpha can route work to
 * members: `agents.entries.<alpha>.subagents.allowAgents = [members]` with
 * `delegationMode: "prefer"` (prompt guidance, not a scheduler), and members
 * get an empty allowlist so they never re-delegate. Per
 * docs.openclaw.ai/concepts/multi-agent (Team preset).
 */
async function wireTeamDelegation(alphaAgentId: string, memberAgentIds: string[]): Promise<void> {
  const uniqueMembers = [...new Set(memberAgentIds.filter((id) => id && id !== alphaAgentId))];
  // Agent ids are interpolated into `config set` paths — reject anything that
  // could escape the allowlisted `agents.entries.<id>.subagents.*` subtree.
  for (const id of [alphaAgentId, ...uniqueMembers]) {
    if (!isAgentIdSafe(id)) {
      throw new CoreUpdateGuardError(`Refusing team wiring for unsafe agent id "${id}".`);
    }
  }
  // Never rewrite live config while a core update is activating.
  await assertCoreMutationAllowed();
  await runOpenclaw([
    'config', 'set', `agents.entries.${alphaAgentId}.subagents.allowAgents`,
    JSON.stringify(uniqueMembers), '--strict-json',
  ]);
  await runOpenclaw([
    'config', 'set', `agents.entries.${alphaAgentId}.subagents.delegationMode`,
    JSON.stringify('prefer'), '--strict-json',
  ]);
  for (const memberId of uniqueMembers) {
    await runOpenclaw([
      'config', 'set', `agents.entries.${memberId}.subagents.allowAgents`,
      JSON.stringify([]), '--strict-json',
    ]);
  }
}

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a #rrggbb hex value');
const avatarSchema = z.string().regex(/^[a-z0-9-]{0,40}$/, 'Invalid avatar id');
const idSchema = z.string().min(1).max(120);

const createBotSchema = z.object({
  name: z.string().min(1).max(100),
  title: z.string().max(140).optional(),
  description: z.string().max(2000).optional(),
  color: colorSchema.optional(),
  agentId: z.string().max(300).nullable().optional(),
  sectionId: z.string().max(120).nullable().optional(),
  avatar: avatarSchema.optional(),
  enabledSkills: z.array(z.string().max(200)).max(100).optional(),
});

const updateBotSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  title: z.string().max(140).optional(),
  description: z.string().max(2000).optional(),
  color: colorSchema.optional(),
  agentId: z.string().max(300).nullable().optional(),
  sectionId: z.string().max(120).nullable().optional(),
  avatar: avatarSchema.optional(),
  pinned: z.boolean().optional(),
  hidden: z.boolean().optional(),
  notifications: z.boolean().optional(),
  enabledSkills: z.array(z.string().max(200)).max(100).optional(),
});

const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  memberBotIds: z.array(idSchema).min(2).max(6),
  alphaBotId: idSchema.nullable().optional(),
});

const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  memberBotIds: z.array(idSchema).min(2).max(6).optional(),
  alphaBotId: idSchema.nullable().optional(),
  pinned: z.boolean().optional(),
  hidden: z.boolean().optional(),
});

function toStatus(err: unknown): { status: 400 | 403 | 404; body: { error: string } } {
  if (err instanceof CrossProfileForbiddenError) {
    return { status: 403, body: { error: 'cross_profile_forbidden' } };
  }
  if (err instanceof RosterNotFoundError) return { status: 404, body: { error: err.message } };
  if (err instanceof RosterValidationError) return { status: 400, body: { error: err.message } };
  if (err instanceof ProfileNotFoundError) return { status: 404, body: { error: err.message } };
  if (err instanceof ProfileValidationError) return { status: 400, body: { error: err.message } };
  throw err;
}

app.use('/api/roster/*', rateLimitGeneral);
app.use('/api/profiles*', rateLimitGeneral);

app.get('/api/roster', async (c) => {
  const profileId = await activeProfileId(c);
  return c.json({ ...(await getRoster(profileId)), profileId });
});

app.post('/api/roster/bots', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createBotSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid bot' }, 400);
  const profileId = await activeProfileId(c);
  try {
    return c.json(await createBot(parsed.data, profileId), 201);
  } catch (err) {
    const { status, body } = toStatus(err);
    return c.json(body, status);
  }
});

app.patch('/api/roster/bots/:id', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateBotSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid bot update' }, 400);
  const profileId = await activeProfileId(c);
  try {
    return c.json(await updateBot(c.req.param('id'), parsed.data, profileId));
  } catch (err) {
    const { status, body } = toStatus(err);
    return c.json(body, status);
  }
});

app.post('/api/roster/bots/:id/duplicate', async (c) => {
  const profileId = await activeProfileId(c);
  try {
    return c.json(await duplicateBot(c.req.param('id'), profileId), 201);
  } catch (err) {
    const { status, body } = toStatus(err);
    return c.json(body, status);
  }
});

app.delete('/api/roster/bots/:id', async (c) => {
  const id = c.req.param('id');
  const deleteRoutines = c.req.query('deleteRoutines') === 'true';
  const profileId = await activeProfileId(c);
  try {
    const roster = await getRoster(profileId);
    const bot = roster.bots.find((b) => b.id === id);
    if (!bot) return c.json({ error: `Bot not found: ${id}` }, 404);
    const result = await deleteBot(id, profileId);
    let routinesRemoved = 0;
    if (deleteRoutines && bot.agentId) {
      try {
        const jobs = (await gatewayRpcCall('cron.list', {}, 15000)) as { jobs?: Array<{ id: string; sessionKey?: string; agentId?: string }> };
        const owned = (jobs.jobs ?? []).filter(
          (j) => j.agentId === bot.agentId || (typeof j.sessionKey === 'string' && j.sessionKey.includes(`:${bot.agentId}:`)),
        );
        for (const job of owned) {
          try {
            await gatewayRpcCall('cron.remove', { id: job.id }, 15000);
            routinesRemoved++;
          } catch { /* best-effort per job */ }
        }
      } catch { /* gateway down — profile still deleted */ }
    }
    return c.json({ ok: true, removedFromGroups: result.removedFromGroups, routinesRemoved });
  } catch (err) {
    const { status, body } = toStatus(err);
    return c.json(body, status);
  }
});

app.post('/api/roster/groups', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createGroupSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid group' }, 400);
  const profileId = await activeProfileId(c);
  try {
    const group = await createGroup(parsed.data, profileId);
    // Native OpenClaw team wiring: alpha delegates to members via sessions_spawn.
    try {
      const alphaBot = group.alphaBotId
        ? (await getRoster(profileId)).bots.find((b) => b.id === group.alphaBotId)
        : undefined;
      if (alphaBot?.agentId) {
        const alphaId = agentIdFromSessionKey(alphaBot.agentId);
        const freshRoster = await getRoster(profileId);
        const memberIds = group.memberBotIds
          .filter((id) => id !== alphaBot.id)
          .map((id) => freshRoster.bots.find((b) => b.id === id))
          .filter((b): b is NonNullable<typeof b> => Boolean(b?.agentId))
          .map((b) => agentIdFromSessionKey(b.agentId as string))
          .filter((id): id is string => Boolean(id));
        if (alphaId && memberIds.length > 0) {
          await wireTeamDelegation(alphaId, memberIds);
        }
      }
    } catch (wireErr) {
      console.warn('[roster] team delegation wiring failed:', (wireErr as Error).message);
      return c.json({ ...group, warning: `Group created, but delegation wiring failed: ${(wireErr as Error).message}` }, 201);
    }
    return c.json(group, 201);
  } catch (err) {
    const { status, body } = toStatus(err);
    return c.json(body, status);
  }
});

app.patch('/api/roster/groups/:id', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateGroupSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid group update' }, 400);
  const profileId = await activeProfileId(c);
  try {
    return c.json(await updateGroup(c.req.param('id'), parsed.data, profileId));
  } catch (err) {
    const { status, body } = toStatus(err);
    return c.json(body, status);
  }
});

app.delete('/api/roster/groups/:id', async (c) => {
  const profileId = await activeProfileId(c);
  try {
    await deleteGroup(c.req.param('id'), profileId);
    return c.json({ ok: true });
  } catch (err) {
    const { status, body } = toStatus(err);
    return c.json(body, status);
  }
});

const sectionNameSchema = z.object({ name: z.string().min(1).max(100) });
const moveBotSchema = z.object({ sectionId: z.string().max(120).nullable() });

// ── Sidebar sections ─────────────────────────────────────────────────

app.post('/api/roster/sections', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = sectionNameSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid section' }, 400);
  const profileId = await activeProfileId(c);
  try {
    return c.json(await createSection(parsed.data.name, profileId), 201);
  } catch (err) {
    const { status, body } = toStatus(err);
    return c.json(body, status);
  }
});

app.patch('/api/roster/sections/:id', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = sectionNameSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid section' }, 400);
  const profileId = await activeProfileId(c);
  try {
    return c.json(await renameSection(c.req.param('id'), parsed.data.name, profileId));
  } catch (err) {
    const { status, body } = toStatus(err);
    return c.json(body, status);
  }
});

app.delete('/api/roster/sections/:id', async (c) => {
  const profileId = await activeProfileId(c);
  try {
    return c.json(await deleteSection(c.req.param('id'), profileId));
  } catch (err) {
    const { status, body } = toStatus(err);
    return c.json(body, status);
  }
});

app.post('/api/roster/bots/:id/section', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = moveBotSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid move' }, 400);
  const profileId = await activeProfileId(c);
  try {
    return c.json(await moveBotToSection(c.req.param('id'), parsed.data.sectionId, profileId));
  } catch (err) {
    const { status, body } = toStatus(err);
    return c.json(body, status);
  }
});

const kickoffSchema = z.object({
  text: z.string().min(1).max(10000),
});

async function deliverToAgent(agentId: string, message: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await gatewayRpcCall('chat.send', {
      sessionKey: agentId,
      message,
      idempotencyKey: `roster:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
    }, 30000);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Delivery failed' };
  }
}

/**
 * POST /api/roster/groups/:id/kickoff — fan out a kickoff message to every
 * linked member bot's session. Members without a linked agent are skipped.
 */
app.post('/api/roster/groups/:id/kickoff', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = kickoffSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid kickoff' }, 400);
  const profileId = await activeProfileId(c);
  try {
    const roster = await getRoster(profileId);
    const group = roster.groups.find((g) => g.id === c.req.param('id'));
    if (!group) return c.json({ error: 'Group not found' }, 404);
    // With an Alpha, the group speaks with one voice: route to the coordinator.
    const alpha = group.alphaBotId ? roster.bots.find((b) => b.id === group.alphaBotId) : undefined;
    if (alpha?.agentId) {
      const result = await deliverToAgent(alpha.agentId, parsed.data.text);
      if (!result.ok) return c.json({ error: result.error ?? 'Delivery failed' }, 502);
      return c.json({ ok: true, results: { [alpha.id]: { ok: true } }, routedTo: 'alpha' });
    }
    const results: Record<string, { ok: boolean; error?: string; skipped?: boolean }> = {};
    for (const memberId of group.memberBotIds) {
      const bot = roster.bots.find((b) => b.id === memberId);
      if (!bot) {
        results[memberId] = { ok: false, error: 'Bot no longer exists' };
        continue;
      }
      if (!bot.agentId) {
        results[memberId] = { ok: false, skipped: true, error: 'Bot has no linked agent session' };
        continue;
      }
      results[memberId] = await deliverToAgent(
        bot.agentId,
        `[Group ${group.name}] @${bot.name} ${parsed.data.text}`,
      );
    }
    return c.json({ ok: true, results });
  } catch (err) {
    const { status, body } = toStatus(err);
    return c.json(body, status);
  }
});

/**
 * POST /api/roster/groups/:id/chat — group chat message. Routes to the Alpha
 * bot's session; the Alpha's persistent description carries the team roster
 * and delegation instructions, so per-message context stays group-scoped and
 * members only receive task briefs via spawned runs.
 */
app.post('/api/roster/groups/:id/chat', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = kickoffSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid message' }, 400);
  const profileId = await activeProfileId(c);
  try {
    const roster = await getRoster(profileId);
    const group = roster.groups.find((g) => g.id === c.req.param('id'));
    if (!group) return c.json({ error: 'Group not found' }, 404);
    const alpha = group.alphaBotId ? roster.bots.find((b) => b.id === group.alphaBotId) : undefined;
    if (!alpha?.agentId) {
      return c.json({ error: 'This group has no Alpha coordinator yet. Add one via Edit group.' }, 409);
    }
    const result = await deliverToAgent(alpha.agentId, parsed.data.text);
    if (!result.ok) return c.json({ error: result.error ?? 'Delivery failed' }, 502);
    return c.json({ ok: true });
  } catch (err) {
    const { status, body } = toStatus(err);
    return c.json(body, status);
  }
});

const handoffSchema = z.object({
  text: z.string().min(1).max(10000),
  from: z.string().max(100).optional(),
});

/**
 * POST /api/roster/bots/:id/message — async bot-to-bot handoff: deliver a
 * message to one bot's session. The handoff is visible as a tagged message.
 */
app.post('/api/roster/bots/:id/message', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = handoffSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid handoff' }, 400);
  const profileId = await activeProfileId(c);
  try {
    const roster = await getRoster(profileId);
    const bot = roster.bots.find((b) => b.id === c.req.param('id'));
    if (!bot) return c.json({ error: 'Bot not found' }, 404);
    if (!bot.agentId) return c.json({ error: 'Bot has no linked agent session' }, 400);
    const from = parsed.data.from ? `[handoff from ${parsed.data.from}] ` : '[handoff] ';
    const result = await deliverToAgent(bot.agentId, `${from}@${bot.name} ${parsed.data.text}`);
    if (!result.ok) return c.json({ error: result.error ?? 'Delivery failed' }, 502);
    return c.json({ ok: true });
  } catch (err) {
    const { status, body } = toStatus(err);
    return c.json(body, status);
  }
});

// ── Profiles ────────────────────────────────────────────────────────
// Mounted here rather than in a separate route module so the roster/profile
// surface stays in one file.

const createProfileSchema = z.object({
  name: z.string().min(1).max(60),
  color: colorSchema.optional(),
  emoji: z.string().max(8).nullable().optional(),
});

const updateProfileSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  color: colorSchema.optional(),
  emoji: z.string().max(8).nullable().optional(),
  order: z.number().int().min(0).optional(),
});

const activateProfileSchema = z.object({ id: idSchema });

app.get('/api/profiles', async (c) => {
  return c.json({
    profiles: await listProfiles(),
    activeProfileId: await activeProfileId(c),
  });
});

app.post('/api/profiles', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createProfileSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid profile' }, 400);
  try {
    return c.json(await createProfile(parsed.data), 201);
  } catch (err) {
    if (err instanceof ProfileValidationError && /already exists/.test(err.message)) {
      return c.json({ error: err.message }, 409);
    }
    const { status, body: errorBody } = toStatus(err);
    return c.json(errorBody, status);
  }
});

app.patch('/api/profiles/:id', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid profile update' }, 400);
  try {
    return c.json(await updateProfile(c.req.param('id'), parsed.data));
  } catch (err) {
    const { status, body: errorBody } = toStatus(err);
    return c.json(errorBody, status);
  }
});

app.delete('/api/profiles/:id', async (c) => {
  try {
    await deleteProfile(c.req.param('id'));
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof ProfileValidationError && /last remaining profile/.test(err.message)) {
      return c.json({ error: err.message }, 409);
    }
    const { status, body: errorBody } = toStatus(err);
    return c.json(errorBody, status);
  }
});

app.post('/api/profiles/activate', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = activateProfileSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid profile id' }, 400);
  const profiles = await listProfiles();
  if (!profiles.some((p) => p.id === parsed.data.id)) {
    return c.json({ error: `Profile not found: ${parsed.data.id}` }, 404);
  }
  c.header('Set-Cookie', profileCookieHeader(parsed.data.id));
  return c.json({ ok: true, activeProfileId: parsed.data.id });
});

export default app;
