import { useState } from 'react';
import type { RosterSection } from './types';

/** Create / rename a sidebar section (project grouping). */
export function SectionDialog(props: {
  section?: RosterSection;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const { section, onClose, onSave } = props;
  const [name, setName] = useState(section?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={section ? 'Rename section' : 'New section'}>
      <div className="shell-panel w-full max-w-sm rounded-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <h3 className="text-base font-semibold">{section ? 'Rename section' : 'New section'}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Group bots by project or client.</p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
          placeholder="e.g. Rank'em"
          maxLength={100}
          className="cockpit-input mt-3 w-full rounded-xl px-3 py-3 text-base"
        />
        {error && <div className="mt-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
        <div className="mt-4 flex gap-2">
          <button type="button" className="cockpit-toolbar-button flex-1 justify-center" onClick={onClose}>Cancel</button>
          <button type="button" className="cockpit-toolbar-button flex-1 justify-center" disabled={!name.trim() || saving} onClick={save}>
            {saving ? 'Saving…' : section ? 'Rename' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}