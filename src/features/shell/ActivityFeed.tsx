import { useMemo, useState } from 'react';
import { Bell, Check, Clock, ExternalLink, X } from 'lucide-react';
import type { Session } from '@/types';
import { getSessionKey } from '@/types';
import { getSessionDisplayLabel } from '@/features/sessions/sessionKeys';
import { useProposals } from '@/features/kanban/hooks/useProposals';
import { useCrons } from '@/features/workspace/hooks/useCrons';

interface ActivityFeedProps {
  sessions: Session[];
  unreadSessions?: Record<string, boolean>;
  onSelectSession: (key: string) => void;
  onOpenTasks: () => void;
}

function relTime(ts?: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/**
 * Activity — the real home for approvals, unread results, and routine runs.
 * Replaces the old hover-only proposal popover so nothing is a dead end.
 */
export function ActivityFeed({ sessions, unreadSessions, onSelectSession, onOpenTasks }: ActivityFeedProps) {
  const { proposals, approveProposal, rejectProposal } = useProposals();
  const { jobs, isLoading: cronsLoading } = useCrons();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const unread = useMemo(
    () => sessions.filter((s) => unreadSessions?.[getSessionKey(s)]),
    [sessions, unreadSessions],
  );

  const activeRoutines = useMemo(
    () =>
      jobs
        .filter((j) => j.enabled)
        .sort((a, b) => {
          const at = a.nextRun ? new Date(a.nextRun).getTime() : Infinity;
          const bt = b.nextRun ? new Date(b.nextRun).getTime() : Infinity;
          return at - bt;
        })
        .slice(0, 6),
    [jobs],
  );

  const act = async (id: string, fn: (id: string) => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await fn(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  const heading = 'px-3 pt-4 pb-1 text-2xs font-bold text-muted-foreground/80';
  const empty = 'px-3 py-3 text-sm text-muted-foreground';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/60 px-3 py-3">
        <h2 className="t-title-lg">Activity</h2>
        <p className="text-xs text-muted-foreground">Approvals, unread results, and routines at a glance.</p>
      </div>

      {error && <div className="mx-3 mt-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {/* Approvals */}
        <div className={heading}>Needs your approval {proposals.length > 0 && <span className="text-primary">· {proposals.length}</span>}</div>
        {proposals.length === 0 ? (
          <div className={empty}>Nothing waiting. 🐾</div>
        ) : (
          <div className="flex flex-col gap-2 px-3">
            {proposals.map((p) => {
              const title = p.type === 'create'
                ? String(p.payload.title ?? 'New task')
                : `Update ${String(p.payload.taskId ?? p.payload.title ?? 'task')}`;
              return (
                <div key={p.id} className="rounded-2xl border border-primary/25 bg-background px-3 py-3">
                  <div className="text-sm font-medium leading-5">{title}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {p.proposedBy} · {relTime(p.proposedAt)}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyId === p.id}
                      onClick={() => void act(p.id, approveProposal)}
                      className="cockpit-toolbar-button min-h-11 flex-1 justify-center text-xs font-semibold"
                    >
                      {busyId === p.id ? 'Working…' : 'Allow once'}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === p.id}
                      onClick={() => void act(p.id, (id) => rejectProposal(id))}
                      className="cockpit-toolbar-button min-h-11 flex-1 justify-center text-xs"
                      data-tone="danger"
                    >
                      Deny
                    </button>
                  </div>
                </div>
              );
            })}
            <button type="button" onClick={onOpenTasks} className="flex items-center gap-1.5 px-1 py-1 text-xs font-medium text-info hover:underline">
              Open task board <ExternalLink size={12} />
            </button>
          </div>
        )}

        {/* Unread */}
        <div className={heading}>Unread <span className="text-muted-foreground/50">· {unread.length}</span></div>
        {unread.length === 0 ? (
          <div className={empty}>All caught up.</div>
        ) : (
          unread.map((s) => {
            const key = getSessionKey(s);
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelectSession(key)}
                className="pressable flex w-full items-center gap-2.5 px-3 py-3 text-left hover:bg-secondary/60"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Bell size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{getSessionDisplayLabel(s)}</span>
                  <span className="block truncate text-xs text-muted-foreground">New result waiting</span>
                </span>
              </button>
            );
          })
        )}

        {/* Routines */}
        <div className={heading}>Routines</div>
        {cronsLoading && activeRoutines.length === 0 ? (
          <div className={empty}>Loading routines…</div>
        ) : activeRoutines.length === 0 ? (
          <div className={empty}>No active routines.</div>
        ) : (
          activeRoutines.map((j) => (
            <div key={j.id} className="flex items-center gap-2.5 px-3 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                <Clock size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{j.name || j.label || j.id}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {j.nextRun ? `Next ${new Date(j.nextRun).toLocaleString()}` : 'Active'}
                </span>
              </span>
              {j.lastStatus && (
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold ${['success', 'ok', 'finished'].includes(j.lastStatus.toLowerCase()) ? 'bg-green/15 text-green' : 'bg-destructive/15 text-destructive'}`}>
                  {['success', 'ok', 'finished'].includes(j.lastStatus.toLowerCase()) ? <Check size={11} /> : <X size={11} />}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}