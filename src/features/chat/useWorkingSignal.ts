/**
 * useWorkingSignal — derives an honest "this agent is working" boolean.
 *
 * The chat panel's own `isGenerating` only covers *this* conversation. A squad
 * run (an Alpha delegating to member bots, or a chat's sub-agents) keeps the
 * gateway busy while the parent stream is idle — which is exactly the window
 * where the UI looked dead and Tony nudged the composer.
 *
 * So the signal is true when any session belonging to the current conversation
 * is reported busy by the gateway, or when the conversation is generating. It
 * is derived purely from real state: when the run ends, errors, or is aborted,
 * both inputs go false and the signal clears on its own. Nothing here fakes
 * progress or holds state open.
 * @module
 */
import { useMemo } from 'react';
import { getSessionKey, type Session } from '@/types';
import { getRootAgentId } from '@/features/sessions/sessionKeys';

export interface UseWorkingSignalOptions {
  /** The session the chat is currently showing. */
  currentSession: string;
  /** Full session list from the gateway. */
  sessions: Session[];
  /** Per-session busy map from SessionContext (status !== IDLE && !== DONE). */
  busyState: Record<string, boolean>;
  /** This conversation is actively generating. */
  isGenerating: boolean;
  /** Group-chat member session keys, so a squad run shows as working. */
  memberSessionKeys?: string[];
}

export interface WorkingSignal {
  /** Render the paws while true. */
  working: boolean;
  /** Which related sessions the gateway reports busy. */
  busySessionKeys: string[];
}

export function useWorkingSignal({
  currentSession,
  sessions,
  busyState,
  isGenerating,
  memberSessionKeys = [],
}: UseWorkingSignalOptions): WorkingSignal {
  /**
   * Sessions that count as "this conversation": the open session, any
   * sub-agent sharing its root agent, and explicit squad members.
   */
  const relatedKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!currentSession) return keys;
    keys.add(currentSession);

    const root = getRootAgentId(currentSession);
    if (root) {
      for (const session of sessions) {
        const key = getSessionKey(session);
        if (!key || keys.has(key)) continue;
        if (getRootAgentId(key) === root) keys.add(key);
      }
    }

    for (const key of memberSessionKeys) {
      if (typeof key === 'string' && key) keys.add(key);
    }
    return keys;
  }, [currentSession, memberSessionKeys, sessions]);

  const busySessionKeys = useMemo(() => {
    if (!currentSession) return [];
    const busy: string[] = [];
    for (const key of relatedKeys) {
      if (busyState[key]) busy.push(key);
    }
    return busy;
  }, [busyState, currentSession, relatedKeys]);

  return {
    working: Boolean(currentSession) && (isGenerating || busySessionKeys.length > 0),
    busySessionKeys,
  };
}

export default useWorkingSignal;
