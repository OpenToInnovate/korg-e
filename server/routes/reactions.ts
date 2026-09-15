/**
 * Reactions API Routes — emoji acknowledgements on messages.
 *
 * GET  /api/reactions?session=<key>              — Reaction map for a session
 * POST /api/reactions/toggle                     — Toggle my reaction ({sessionKey, messageTs, emoji})
 * @module
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import {
  getSessionReactions,
  toggleReaction,
  ReactionValidationError,
} from '../lib/reactions-store.js';

const app = new Hono();

const toggleSchema = z.object({
  sessionKey: z.string().min(1).max(300),
  messageTs: z.number().int().nonnegative(),
  emoji: z.string().min(1).max(12),
});

app.use('/api/reactions/*', rateLimitGeneral);

app.get('/api/reactions', async (c) => {
  const session = c.req.query('session') ?? '';
  if (!session || session.length > 300) return c.json({ error: 'Invalid session' }, 400);
  return c.json(await getSessionReactions(session));
});

app.post('/api/reactions/toggle', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = toggleSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid reaction' }, 400);
  try {
    const summary = await toggleReaction(parsed.data.sessionKey, parsed.data.messageTs, parsed.data.emoji);
    return c.json({ ok: true, reactions: summary });
  } catch (err) {
    if (err instanceof ReactionValidationError) return c.json({ error: err.message }, 400);
    throw err;
  }
});

export default app;
