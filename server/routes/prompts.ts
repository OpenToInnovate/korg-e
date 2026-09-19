/**
 * Prompt routes — pending interactive prompts (OpenClaw `secrets` requests and
 * `ask_user` questions) for the operator's session.
 *
 * GET  /api/prompts/pending?sessionKey=... — List pending gateway questions
 *                                            (proxied to the gateway's
 *                                            `question.list` WS RPC).
 * POST /api/prompts/answer                 — Resolve a pending question
 *                                            (proxied to `question.resolve`).
 *
 * The gateway exposes pending prompts as "question records" over its WebSocket
 * RPC surface (`question.list`, `question.get`, `question.resolve`) and
 * broadcasts `question.requested` / `question.resolved` events. Secret
 * requests are store-bound questions: the value submitted inside
 * `answers.answers[questionId]` is written straight to the shared secret
 * store by the Gateway and never enters the chat, transcript, or Nerve state.
 *
 * SECURITY: credential values pass through this route in memory only — they
 * are never logged, never stored, and never echoed in responses or errors.
 * @module
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { gatewayRpcCall } from '../lib/gateway-rpc.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const app = new Hono();

const GATEWAY_TIMEOUT_MS = 15_000;

// ── Types (gateway-protocol QuestionRecord subset) ───────────────────

export interface PromptQuestionItem {
  questionId: string;
  header: string;
  question: string;
  url?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
  isSecret?: boolean;
  secretStore?: {
    name: string;
    kind: 'secret' | 'env';
    allowedHosts?: string[];
    reason?: string;
  };
  secretStoreExisting?: {
    updatedAtMs: number;
    updatedBy?: string;
  };
}

export interface PendingPromptRecord {
  id: string;
  questions: PromptQuestionItem[];
  agentId?: string;
  sessionKey?: string;
  runId?: string;
  createdAtMs: number;
  expiresAtMs: number;
  status: string;
}

/** Project a gateway question record down to the fields the UI needs. */
export function sanitizePromptRecord(raw: unknown): PendingPromptRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (!Array.isArray(r.questions) || r.questions.length === 0) return null;

  const questions: PromptQuestionItem[] = [];
  for (const q of r.questions) {
    if (!q || typeof q !== 'object') return null;
    const item = q as Record<string, unknown>;
    if (typeof item.questionId !== 'string' || !item.questionId) return null;
    questions.push({
      questionId: item.questionId,
      header: typeof item.header === 'string' ? item.header : '',
      question: typeof item.question === 'string' ? item.question : '',
      ...(typeof item.url === 'string' && item.url ? { url: item.url } : {}),
      options: Array.isArray(item.options)
        ? (item.options as Array<Record<string, unknown>>).map((o) => ({
            label: typeof o?.label === 'string' ? o.label : '',
            ...(typeof o?.description === 'string' && o.description ? { description: o.description } : {}),
          })).filter((o) => o.label)
        : [],
      ...(item.multiSelect === true ? { multiSelect: true } : {}),
      ...(item.isSecret === true ? { isSecret: true } : {}),
      ...(item.secretStore && typeof item.secretStore === 'object'
        ? {
            secretStore: {
              name: String((item.secretStore as Record<string, unknown>).name ?? ''),
              kind: (item.secretStore as Record<string, unknown>).kind === 'env' ? 'env' as const : 'secret' as const,
              ...(Array.isArray((item.secretStore as Record<string, unknown>).allowedHosts)
                ? { allowedHosts: ((item.secretStore as Record<string, unknown>).allowedHosts as unknown[]).filter((h): h is string => typeof h === 'string') }
                : {}),
              ...(typeof (item.secretStore as Record<string, unknown>).reason === 'string'
                ? { reason: (item.secretStore as Record<string, unknown>).reason as string }
                : {}),
            },
          }
        : {}),
      ...(item.secretStoreExisting && typeof item.secretStoreExisting === 'object'
        ? {
            secretStoreExisting: {
              updatedAtMs: Number((item.secretStoreExisting as Record<string, unknown>).updatedAtMs ?? 0),
              ...(typeof (item.secretStoreExisting as Record<string, unknown>).updatedBy === 'string'
                ? { updatedBy: (item.secretStoreExisting as Record<string, unknown>).updatedBy as string }
                : {}),
            },
          }
        : {}),
    });
  }

  return {
    id: r.id,
    questions,
    ...(typeof r.agentId === 'string' && r.agentId ? { agentId: r.agentId } : {}),
    ...(typeof r.sessionKey === 'string' && r.sessionKey ? { sessionKey: r.sessionKey } : {}),
    ...(typeof r.runId === 'string' && r.runId ? { runId: r.runId } : {}),
    createdAtMs: Number(r.createdAtMs ?? 0),
    expiresAtMs: Number(r.expiresAtMs ?? 0),
    status: typeof r.status === 'string' ? r.status : 'pending',
  };
}

// ── GET /api/prompts/pending ─────────────────────────────────────────

app.get('/api/prompts/pending', rateLimitGeneral, async (c) => {
  const sessionKey = c.req.query('sessionKey')?.trim() || '';

  try {
    const result = await gatewayRpcCall('question.list', {}, GATEWAY_TIMEOUT_MS) as {
      questions?: unknown[];
    };
    const records = (Array.isArray(result?.questions) ? result.questions : [])
      .map(sanitizePromptRecord)
      .filter((r): r is PendingPromptRecord => r !== null && r.status === 'pending');

    const filtered = sessionKey
      ? records.filter((r) => !r.sessionKey || r.sessionKey === sessionKey)
      : records;

    filtered.sort((a, b) => a.createdAtMs - b.createdAtMs);
    return c.json({ prompts: filtered });
  } catch (err) {
    return c.json({ prompts: [], error: (err as Error).message }, 502);
  }
});

// ── POST /api/prompts/answer ─────────────────────────────────────────

const answerSchema = z.object({
  id: z.string().min(1).max(200),
  // Structured answer for ask_user-style questions: keyed by questionId.
  answers: z.object({
    answers: z.record(z.string().min(1).max(200), z.array(z.string().min(1).max(4096)).min(1)),
  }).optional(),
  // Masked-input secret submission: value goes to the Gateway's secret store.
  secretQuestionId: z.string().min(1).max(200).optional(),
  secretValue: z.string().min(1).max(16384).optional(),
  secretStoreAllowedHosts: z.array(z.string().min(1).max(253)).max(128).optional(),
  resolvedBy: z.string().min(1).max(200).optional(),
  cancel: z.boolean().optional(),
});

type AnswerBody = z.infer<typeof answerSchema>;

/**
 * Build `question.resolve` params from a validated body.
 * Exported for testing.
 */
export function buildResolveParams(body: AnswerBody): Record<string, unknown> | { error: string } {
  if (body.cancel === true) {
    return { id: body.id, cancel: true, ...(body.resolvedBy ? { resolvedBy: body.resolvedBy } : {}) };
  }

  // Store-bound secret question: exactly one value for the secret questionId.
  if (body.secretValue !== undefined) {
    if (!body.secretQuestionId) return { error: 'secretQuestionId is required with secretValue' };
    return {
      id: body.id,
      answers: { answers: { [body.secretQuestionId]: [body.secretValue] } },
      ...(body.secretStoreAllowedHosts !== undefined ? { secretStoreAllowedHosts: body.secretStoreAllowedHosts } : {}),
      ...(body.resolvedBy ? { resolvedBy: body.resolvedBy } : {}),
    };
  }

  if (body.answers) {
    return { id: body.id, answers: body.answers, ...(body.resolvedBy ? { resolvedBy: body.resolvedBy } : {}) };
  }

  return { error: 'Provide answers, secretValue + secretQuestionId, or cancel' };
}

app.post('/api/prompts/answer', rateLimitGeneral, async (c) => {
  let body: AnswerBody;
  try {
    const parsed = answerSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: parsed.error.issues[0]?.message || 'Invalid body' }, 400);
    }
    body = parsed.data;
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const params = buildResolveParams(body);
  if ('error' in params) {
    return c.json({ ok: false, error: params.error }, 400);
  }

  try {
    // Note: never log `params` — it may contain the credential value.
    const result = await gatewayRpcCall('question.resolve', params, GATEWAY_TIMEOUT_MS) as {
      status?: string;
    } | null;
    return c.json({ ok: true, status: result?.status ?? 'answered' });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 502);
  }
});

export default app;
