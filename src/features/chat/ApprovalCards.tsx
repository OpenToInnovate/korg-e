import { useState } from 'react';
import { useProposals } from '@/features/kanban/hooks/useProposals';

/**
 * Inline approval cards above the composer (GrokBot parity: approvals live
 * in the conversation). Approve once / Deny, reusing the kanban proposal
 * pipeline. Desktop additionally offers "Always allow" via the task drawer.
 */
export function ApprovalCards() {
  const { proposals, approveProposal, rejectProposal } = useProposals();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (proposals.length === 0) return null;

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

  return (
    <div className="border-t border-border/60 bg-card/60 px-3 py-2" role="region" aria-label="Pending approvals">
      <div className="mb-1.5 text-2xs font-semibold text-muted-foreground">
        ✋ {proposals.length} waiting for approval
      </div>
      <div className="flex max-h-44 flex-col gap-2 overflow-y-auto">
        {proposals.map((p) => {
          const title = p.type === 'create'
            ? String(p.payload.title ?? 'New task')
            : `Update ${String(p.payload.taskId ?? p.payload.title ?? 'task')}`;
          return (
            <div key={p.id} className="rounded-2xl border border-primary/25 bg-background px-3 py-2.5">
              <div className="text-sm font-medium leading-5">{title}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                Proposed by {p.proposedBy} · {p.type === 'create' ? 'create' : 'update'}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busyId === p.id}
                  onClick={() => void act(p.id, approveProposal)}
                  className="cockpit-toolbar-button min-h-11 flex-1 justify-center text-xs font-semibold"
                >
                  {busyId === p.id ? 'Working…' : 'Approve once'}
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
      </div>
      {error && <div className="mt-1.5 text-xs text-destructive">{error}</div>}
    </div>
  );
}
