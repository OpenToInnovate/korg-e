import { useState } from 'react';
import type { RosterBot, RosterGroup } from './types';
import KorgeAvatar from '@/components/KorgeAvatar';
import { isCorgiVariant } from '@/components/corgi/corgiVariants';

/** Group kickoff composer — fans a message out to every linked member bot. */
export function KickoffDialog(props: {
  group: RosterGroup;
  bots: RosterBot[];
  onClose: () => void;
  onSend: (text: string) => Promise<{ ok: boolean; results: Record<string, { ok: boolean; error?: string; skipped?: boolean }> }>;
}) {
  const { group, bots, onClose, onSend } = props;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<Record<string, { ok: boolean; error?: string; skipped?: boolean }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const members = group.memberBotIds
    .map((id) => bots.find((b) => b.id === id))
    .filter((b): b is RosterBot => !!b);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await onSend(text.trim());
      setResults(res.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kickoff failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={`Message ${group.name}`}>
      <div className="shell-panel flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2.5">
          <span className="flex -space-x-2">
            {members.slice(0, 3).map((m) => (
              <KorgeAvatar key={m.id} name={m.id} variant={isCorgiVariant(m.avatar) ? m.avatar : undefined} collar={m.color} size={28} state="idle" />
            ))}
          </span>
          <div>
            <h3 className="text-base font-semibold">{group.name}</h3>
            <p className="text-xs text-muted-foreground">Kickoff goes to {members.length} bots</p>
          </div>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Tip: give each bot an owner line, e.g. <span className="font-mono">@Researcher gather sources. @Writer draft. Do not publish.</span>
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe the shared outcome and who owns the next step…"
          rows={4}
          className="cockpit-textarea mt-3 rounded-2xl px-3 py-3 text-base"
        />
        {results && (
          <div className="mt-3 max-h-40 overflow-y-auto rounded-2xl border border-border/60 p-2">
            {members.map((m) => {
              const r = results[m.id];
              return (
                <div key={m.id} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                  <KorgeAvatar name={m.id} variant={isCorgiVariant(m.avatar) ? m.avatar : undefined} collar={m.color} size={20} state="idle" />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <span className={r?.ok ? 'text-green' : 'text-muted-foreground'}>
                    {r?.ok ? 'sent ✓' : r?.skipped ? 'skipped (unlinked)' : `failed: ${r?.error ?? '?'}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {error && <div className="mt-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
        <div className="mt-4 flex gap-2">
          <button type="button" className="cockpit-toolbar-button flex-1 justify-center" onClick={onClose}>
            {results ? 'Done' : 'Cancel'}
          </button>
          {!results && (
            <button type="button" className="cockpit-toolbar-button flex-1 justify-center" disabled={!text.trim() || sending} onClick={send}>
              {sending ? 'Sending…' : 'Send to pack'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
