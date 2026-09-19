/**
 * usePendingPrompts - Polls Nerve's /api/prompts/pending for the current
 * session's pending OpenClaw prompts (secrets credential requests + ask_user
 * questions) and exposes answer/cancel actions.
 *
 * Refresh triggers: mount, interval, session switch, gateway WS events
 * (question.requested / question.resolved), and after each answer.
 *
 * SECURITY: secret values are never kept here — the caller passes the value
 * straight into submitSecret(), which forwards it to the server route and
 * discards it. Nothing is logged or stored.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useGateway } from '@/contexts/GatewayContext';
import type { PendingPromptRecord } from './types';

const POLL_INTERVAL_MS = 5_000;

export interface UsePendingPromptsReturn {
  prompts: PendingPromptRecord[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Resolve a structured ask_user prompt. */
  answerPrompt: (id: string, answers: Record<string, string[]>) => Promise<void>;
  /** Resolve a store-bound secret request (value forwarded, never stored). */
  submitSecret: (
    id: string,
    secretQuestionId: string,
    value: string,
    allowedHosts?: string[],
  ) => Promise<void>;
  /** Decline/skip a prompt (gateway cancel → no_answer for the agent). */
  skipPrompt: (id: string) => Promise<void>;
}

async function fetchPending(sessionKey: string): Promise<PendingPromptRecord[]> {
  const url = sessionKey
    ? `/api/prompts/pending?sessionKey=${encodeURIComponent(sessionKey)}`
    : '/api/prompts/pending';
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = (await resp.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Failed to fetch prompts (${resp.status})`);
  }
  const json = (await resp.json()) as { prompts?: PendingPromptRecord[] };
  return json.prompts ?? [];
}

export function usePendingPrompts(currentSession: string): UsePendingPromptsReturn {
  const { subscribe } = useGateway();
  const [prompts, setPrompts] = useState<PendingPromptRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionKeyRef = useRef(currentSession);
  const inFlightRef = useRef(false);

  useEffect(() => {
    sessionKeyRef.current = currentSession;
  }, [currentSession]);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const list = await fetchPending(sessionKeyRef.current);
      setPrompts(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch prompts');
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, []);

  // Poll while the session is active; refresh immediately on session switch.
  useEffect(() => {
    if (!currentSession) {
      setPrompts([]);
      return;
    }
    void refresh();
    const iv = setInterval(() => {
      if (document.hidden) return;
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [currentSession, refresh]);

  // Instant refresh when gateway question events arrive (best effort — the
  // 5s poll is the reliability net if event scoping drops them).
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.event === 'question.requested' || msg.event === 'question.resolved') {
        void refresh();
      }
    });
  }, [subscribe, refresh]);

  const postAnswer = useCallback(async (body: Record<string, unknown>) => {
    const resp = await fetch('/api/prompts/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!resp.ok || !json.ok) throw new Error(json.error || `Answer failed (${resp.status})`);
    await refresh();
  }, [refresh]);

  const answerPrompt = useCallback(async (id: string, answers: Record<string, string[]>) => {
    await postAnswer({ id, answers, resolvedBy: 'nerve' });
  }, [postAnswer]);

  const submitSecret = useCallback(async (
    id: string,
    secretQuestionId: string,
    value: string,
    allowedHosts?: string[],
  ) => {
    await postAnswer({
      id,
      secretQuestionId,
      secretValue: value,
      ...(allowedHosts !== undefined ? { secretStoreAllowedHosts: allowedHosts } : {}),
      resolvedBy: 'nerve',
    });
  }, [postAnswer]);

  const skipPrompt = useCallback(async (id: string) => {
    await postAnswer({ id, cancel: true });
  }, [postAnswer]);

  return { prompts, loading, error, refresh, answerPrompt, submitSecret, skipPrompt };
}
