/**
 * Auto Review API Routes — approval-boundary rules.
 *
 * GET    /api/auto-review/rules — List rules
 * POST   /api/auto-review/rules — Add a rule ({kind: require|allow, pattern})
 * DELETE /api/auto-review/rules/:id — Delete a rule
 * @module
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import {
  listAutoReviewRules,
  addAutoReviewRule,
  deleteAutoReviewRule,
  AutoReviewValidationError,
  AutoReviewNotFoundError,
} from '../lib/autoreview-store.js';

const app = new Hono();

const createSchema = z.object({
  kind: z.enum(['require', 'allow']),
  pattern: z.string().min(1).max(300),
});

app.use('/api/auto-review/*', rateLimitGeneral);

app.get('/api/auto-review/rules', async (c) => {
  return c.json({ rules: await listAutoReviewRules() });
});

app.post('/api/auto-review/rules', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid rule' }, 400);
  try {
    return c.json(await addAutoReviewRule(parsed.data.kind, parsed.data.pattern), 201);
  } catch (err) {
    if (err instanceof AutoReviewValidationError) return c.json({ error: err.message }, 400);
    throw err;
  }
});

app.delete('/api/auto-review/rules/:id', async (c) => {
  try {
    await deleteAutoReviewRule(c.req.param('id'));
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof AutoReviewNotFoundError) return c.json({ error: err.message }, 404);
    throw err;
  }
});

export default app;
