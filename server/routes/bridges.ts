/**
 * Bridge API routes — narrow, dual-approved, talk-only links between profiles.
 *
 * POST   /api/bridges              — create from the active (adult) profile
 * GET    /api/bridges              — bridges visible to the active profile
 * POST   /api/bridges/:id/accept   — remote profile accepts
 * POST   /api/bridges/:id/revoke   — either side revokes
 * POST   /api/bridges/:id/messages — talk across the bridge (active only)
 *
 * This router never widens a read path. A bridge is a messaging allowance and
 * nothing else: memories, files and sessions remain refused across profiles.
 * @module
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import { gatewayRpcCall } from '../lib/gateway-rpc.js';
import { PROFILE_HEADER } from '../lib/profiles.js';
import {
  BRIDGE_DEFAULT_TTL_HOURS,
  BRIDGE_MAX_TTL_HOURS,
  BRIDGE_MIN_TTL_HOURS,
  BridgeNotApprovedError,
  BridgeNotFoundError,
  BridgeNotRemoteError,
  BridgePairForbiddenError,
  BridgeValidationError,
  acceptBridge,
  assertBridgeSendAllowed,
  bridgeActiveProfileId,
  createBridge,
  listBridgesForProfile,
  recordBridgeMessage,
  revokeBridge,
} from '../lib/bridges.js';

const app = new Hono();

/** Active profile: `x-nerve-profile` → `nerve_profile` cookie → default. */
function activeProfileId(c: { req: { header: (n: string) => string | undefined } }): string {
  return bridgeActiveProfileId(c.req.header(PROFILE_HEADER) ?? null, c.req.header('cookie') ?? null);
}

function toStatus(err: unknown): { status: 400 | 403 | 404; body: { error: string } } {
  if (err instanceof BridgeNotApprovedError) return { status: 403, body: { error: 'bridge_not_fully_approved' } };
  if (err instanceof BridgePairForbiddenError) return { status: 403, body: { error: 'bridge_pair_forbidden' } };
  if (err instanceof BridgeNotRemoteError) {
    return { status: 403, body: { error: 'bridge_accept_requires_remote_profile' } };
  }
  if (err instanceof BridgeNotFoundError) return { status: 404, body: { error: 'not_found' } };
  if (err instanceof BridgeValidationError) return { status: 400, body: { error: err.message } };
  throw err;
}

const agentIdSchema = z.string().min(1).max(300);

const createBridgeSchema = z.object({
  toProfileId: z.string().min(1).max(120),
  fromAgentIds: z.array(agentIdSchema).min(1).max(3),
  toAgentIds: z.array(agentIdSchema).min(1).max(3),
  reason: z.string().min(1).max(500),
  ttlHours: z.number().int().min(BRIDGE_MIN_TTL_HOURS).max(BRIDGE_MAX_TTL_HOURS).optional(),
});

const messageSchema = z.object({
  text: z.string().min(1).max(10_000),
  /** Optional: when given, it must be an agent listed on the caller's side. */
  senderAgentId: agentIdSchema.optional(),
});

app.use('/api/bridges*', rateLimitGeneral);

app.post('/api/bridges', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createBridgeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid bridge' }, 400);
  try {
    return c.json(
      await createBridge({ ...parsed.data, ttlHours: parsed.data.ttlHours ?? BRIDGE_DEFAULT_TTL_HOURS }, activeProfileId(c)),
      201,
    );
  } catch (err) {
    const { status, body: errorBody } = toStatus(err);
    return c.json(errorBody, status);
  }
});

app.get('/api/bridges', async (c) => {
  try {
    return c.json({ bridges: await listBridgesForProfile(activeProfileId(c)) });
  } catch (err) {
    const { status, body: errorBody } = toStatus(err);
    return c.json(errorBody, status);
  }
});

app.post('/api/bridges/:id/accept', async (c) => {
  try {
    return c.json(await acceptBridge(c.req.param('id'), activeProfileId(c)));
  } catch (err) {
    const { status, body: errorBody } = toStatus(err);
    return c.json(errorBody, status);
  }
});

app.post('/api/bridges/:id/revoke', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const reason = typeof (body as { reason?: unknown }).reason === 'string'
    ? (body as { reason: string }).reason
    : undefined;
  try {
    return c.json(await revokeBridge(c.req.param('id'), activeProfileId(c), reason));
  } catch (err) {
    const { status, body: errorBody } = toStatus(err);
    return c.json(errorBody, status);
  }
});

app.post('/api/bridges/:id/messages', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid message' }, 400);
  const profileId = activeProfileId(c);
  const id = c.req.param('id');
  try {
    // No explicit sender: use the only agent on the caller's side. With several,
    // the caller must say which one is speaking.
    const { bridge, senderAgentId, peerAgentIds } = await assertBridgeSendAllowed(
      id,
      profileId,
      parsed.data.senderAgentId ?? null,
    );
    // Route the message to the first reachable peer session. Delivery failure is
    // reported, but the approval gate has already passed at this point.
    let delivered = 0;
    let lastError: string | null = null;
    for (const peer of peerAgentIds) {
      try {
        await gatewayRpcCall('chat.send', {
          sessionKey: peer,
          message: `[bridge ${bridge.id}] ${parsed.data.text}`,
          idempotencyKey: `bridge:${bridge.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        }, 30000);
        delivered += 1;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Delivery failed';
      }
    }
    if (delivered === 0) return c.json({ error: lastError ?? 'Delivery failed' }, 502);
    await recordBridgeMessage(id, profileId, `delivered:${senderAgentId}`);
    return c.json({ ok: true });
  } catch (err) {
    const { status, body: errorBody } = toStatus(err);
    return c.json(errorBody, status);
  }
});

export default app;
