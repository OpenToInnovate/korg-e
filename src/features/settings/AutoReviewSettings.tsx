import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { AutoReviewKind } from '@/features/auto-review/types';

interface AutoReviewRule {
  id: string;
  kind: AutoReviewKind;
  pattern: string;
  createdAt: number;
}

/**
 * Auto Review settings — approval boundaries for task runs and routine
 * test runs. Require-approval rules stop matching actions for an explicit
 * approve-once; allow rules document what may proceed. When both match,
 * require wins. Enforced by the server on execute/run.
 */
export function AutoReviewSettings() {
  const [rules, setRules] = useState<AutoReviewRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<AutoReviewKind>('require');
  const [pattern, setPattern] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auto-review/rules');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { rules: AutoReviewRule[] };
      setRules(body.rules ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = async () => {
    const clean = pattern.trim();
    if (!clean || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/auto-review/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, pattern: clean }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      setPattern('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/auto-review/rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold">Auto Review ✋</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Write narrow rules around a known action and scope — e.g. “send any external email”.
          Matching task runs and routine test runs stop for your approval. Avoid broad rules like
          “allow everything in the browser”.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setKind('require')}
            aria-pressed={kind === 'require'}
            className={`shell-chip min-h-11 flex-1 justify-center text-xs font-semibold ${kind === 'require' ? 'border-destructive/50 text-destructive' : ''}`}
          >
            Require approval
          </button>
          <button
            type="button"
            onClick={() => setKind('allow')}
            aria-pressed={kind === 'allow'}
            className={`shell-chip min-h-11 flex-1 justify-center text-xs font-semibold ${kind === 'allow' ? 'border-green/50 text-green' : ''}`}
          >
            Always allow
          </button>
        </div>
        <div className="flex gap-2">
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add();
            }}
            placeholder={kind === 'require' ? 'e.g. send any external email' : 'e.g. git status in /workspace/reports'}
            maxLength={300}
            aria-label="Rule pattern"
            className="cockpit-input min-h-11 flex-1 rounded-xl px-3 text-base"
          />
          <button
            type="button"
            onClick={() => void add()}
            disabled={!pattern.trim() || saving}
            className="cockpit-toolbar-button min-h-11 justify-center px-4 text-xs font-semibold disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}

      <div>
        {loading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">Loading rules…</div>
        ) : rules.length === 0 ? (
          <div className="rounded-2xl border border-border/60 px-4 py-6 text-center text-xs leading-5 text-muted-foreground">
            No rules yet. The pack runs free until you add boundaries. 🐶
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center gap-2.5 rounded-2xl border border-border/60 px-3 py-2.5">
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-2xs font-bold ${
                    rule.kind === 'require' ? 'bg-destructive/15 text-destructive' : 'bg-green/15 text-green'
                  }`}
                >
                  {rule.kind === 'require' ? 'Approval' : 'Allow'}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{rule.pattern}</span>
                <button
                  type="button"
                  onClick={() => void remove(rule.id)}
                  aria-label={`Delete rule ${rule.pattern}`}
                  className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-destructive"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
