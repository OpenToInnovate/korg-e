import { useCallback, useEffect, useState } from 'react';
import { useSessionContext } from '@/contexts/SessionContext';

export interface ReactionEntry {
  count: number;
  mine: boolean;
}

export type ReactionMap = Record<string, ReactionEntry>;

/** Per-session emoji reactions (overlay store, survives navigation). */
export function useReactions() {
  const { currentSession } = useSessionContext();
  const [map, setMap] = useState<Record<string, ReactionMap>>({});

  useEffect(() => {
    if (!currentSession) return;
    let cancelled = false;
    fetch(`/api/reactions?session=${encodeURIComponent(currentSession)}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((body) => {
        if (!cancelled && body && typeof body === 'object') setMap(body as Record<string, ReactionMap>);
      })
      .catch(() => {
        // reactions are best-effort; chat works without them
      });
    return () => {
      cancelled = true;
    };
  }, [currentSession]);

  const toggle = useCallback(
    async (messageTs: number, emoji: string) => {
      if (!currentSession) return;
      try {
        const res = await fetch('/api/reactions/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionKey: currentSession, messageTs, emoji }),
        });
        if (!res.ok) return;
        const body = (await res.json()) as { reactions?: ReactionMap };
        setMap((prev) => ({ ...prev, [String(messageTs)]: body.reactions ?? {} }));
      } catch {
        // best-effort
      }
    },
    [currentSession],
  );

  return { reactionMap: map, toggleReaction: toggle };
}
