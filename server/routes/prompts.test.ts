/** Tests for the /api/prompts endpoints. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

describe('/api/prompts', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Build a Hono app with a mocked gateway RPC client. */
  async function buildApp(gatewayRpc = vi.fn()) {
    vi.doMock('../lib/gateway-rpc.js', () => ({
      gatewayRpcCall: gatewayRpc,
    }));
    vi.doMock('../middleware/rate-limit.js', () => ({
      rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
    }));

    const mod = await import('./prompts.js');
    const app = new Hono();
    app.route('/', mod.default);
    return { app, mod, gatewayRpc };
  }

  describe('GET /api/prompts/pending', () => {
    it('lists pending questions and filters by sessionKey', async () => {
      const record = {
        id: 'q1',
        questions: [
          {
            questionId: 'deploy_target',
            header: 'Deploy',
            question: 'Which environment?',
            options: [{ label: 'Staging' }, { label: 'Prod' }],
          },
        ],
        sessionKey: 'agent:main:main',
        createdAtMs: 10,
        expiresAtMs: 9999,
        status: 'pending',
      };
      const resolved = { id: 'q2', questions: [{ questionId: 'x', header: '', question: '', options: [] }], createdAtMs: 1, expiresAtMs: 2, status: 'answered' };
      const other = { ...record, id: 'q3', sessionKey: 'agent:other:main' };
      const { app } = await buildApp(vi.fn(async () => ({ questions: [record, resolved, other] })));

      const res = await app.request('/api/prompts/pending?sessionKey=agent%3Amain%3Amain');
      expect(res.status).toBe(200);
      const json = (await res.json()) as { prompts: Array<{ id: string }> };
      expect(json.prompts.map((p) => p.id)).toEqual(['q1']);
    });

    it('returns 502 when the gateway RPC fails', async () => {
      const { app } = await buildApp(vi.fn(async () => { throw new Error('gateway down'); }));
      const res = await app.request('/api/prompts/pending');
      expect(res.status).toBe(502);
      const json = (await res.json()) as { prompts: unknown[]; error: string };
      expect(json.prompts).toEqual([]);
      expect(json.error).toContain('gateway down');
    });
  });

  describe('POST /api/prompts/answer', () => {
    it('builds question.resolve params for a secret value and never echoes it', async () => {
      const { app, gatewayRpc } = await buildApp(vi.fn(async () => ({ status: 'answered', answers: { answers: { STRIPE_API_KEY: ['stored'] } } })));

      const res = await app.request('/api/prompts/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'q1',
          secretQuestionId: 'STRIPE_API_KEY',
          secretValue: 'sk-super-secret-value',
          secretStoreAllowedHosts: ['api.stripe.com'],
          resolvedBy: 'nerve',
        }),
      });
      expect(res.status).toBe(200);
      const rawResponseText = await res.text();
      const json = JSON.parse(rawResponseText) as { ok: boolean; status: string };
      expect(json.ok).toBe(true);
      expect(json.status).toBe('answered');

      expect(rawResponseText).not.toContain('sk-super-secret-value');
      expect(gatewayRpc).toHaveBeenCalledWith('question.resolve', {
        id: 'q1',
        answers: { answers: { STRIPE_API_KEY: ['sk-super-secret-value'] } },
        secretStoreAllowedHosts: ['api.stripe.com'],
        resolvedBy: 'nerve',
      }, 15_000);
    });

    it('cancels a question with the cancel form', async () => {
      const { app, gatewayRpc } = await buildApp(vi.fn(async () => ({ status: 'cancelled' })));
      const res = await app.request('/api/prompts/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'q1', cancel: true }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; status: string };
      expect(json.status).toBe('cancelled');
      expect(gatewayRpc).toHaveBeenCalledWith('question.resolve', { id: 'q1', cancel: true }, 15_000);
    });

    it('submits structured ask_user answers', async () => {
      const { app, gatewayRpc } = await buildApp(vi.fn(async () => ({ status: 'answered' })));
      const res = await app.request('/api/prompts/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'q1',
          answers: { answers: { deploy_target: ['Staging (Recommended)'] } },
        }),
      });
      expect(res.status).toBe(200);
      expect(gatewayRpc).toHaveBeenCalledWith('question.resolve', {
        id: 'q1',
        answers: { answers: { deploy_target: ['Staging (Recommended)'] } },
      }, 15_000);
    });

    it('rejects a body with no actionable answer', async () => {
      const { app, gatewayRpc } = await buildApp(vi.fn());
      const res = await app.request('/api/prompts/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'q1' }),
      });
      expect(res.status).toBe(400);
      expect(gatewayRpc).not.toHaveBeenCalled();
    });

    it('propagates gateway errors as 502', async () => {
      const { app } = await buildApp(vi.fn(async () => { throw new Error("question 'q1' was not found"); }));
      const res = await app.request('/api/prompts/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'q1', cancel: true }),
      });
      expect(res.status).toBe(502);
    });
  });
});
