import { useState } from 'react';
import { Download, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { useMarketplace } from './useMarketplace';

interface MarketplaceBrowserProps {
  /** Agent id used when installing skills into an agent workspace. */
  agentId?: string;
  /** Called after a successful install so callers can refresh installed lists. */
  onInstalled?: () => void;
}

function fmtDownloads(n?: number): string | null {
  if (typeof n !== 'number') return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * OpenClaw/ClawHub marketplace browser: the plugin marketplace feed, plugin
 * search, and ClawHub skill search, with in-app install.
 */
export function MarketplaceBrowser({ agentId, onInstalled }: MarketplaceBrowserProps) {
  const m = useMarketplace();
  const [confirmSpec, setConfirmSpec] = useState<{ kind: 'plugin' | 'skill'; spec: string; title: string } | null>(null);

  const doInstall = async () => {
    if (!confirmSpec) return;
    const target = confirmSpec;
    setConfirmSpec(null);
    if (target.kind === 'plugin') await m.installPlugin(target.spec);
    else await m.installSkill(target.spec, agentId);
    onInstalled?.();
  };

  const list = m.mode === 'plugins' ? m.plugins : m.skills;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Controls */}
      <div className="shrink-0 space-y-2 px-3 pt-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={m.query}
              onChange={(e) => m.setQuery(e.target.value)}
              placeholder={m.mode === 'plugins' ? 'Search plugins' : 'Search skills'}
              aria-label={m.mode === 'plugins' ? 'Search plugins' : 'Search skills'}
              className="cockpit-input cockpit-input--leading-icon w-full rounded-2xl py-2.5 pr-3 text-sm"
            />
          </div>
          {m.mode === 'plugins' && (
            <button
              type="button"
              onClick={() => void m.refreshFeed()}
              disabled={m.loading}
              aria-label="Refresh marketplace feed"
              title="Refresh feed"
              className="shell-icon-button min-h-11 min-w-11 justify-center rounded-full"
            >
              <RefreshCw size={16} className={m.loading ? 'animate-spin' : ''} />
            </button>
          )}
        </div>

        {/* Segmented control */}
        <div className="flex items-center gap-1 rounded-full border border-border/70 bg-[var(--surface-2)] p-1">
          {(['plugins', 'skills'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => m.setMode(mode)}
              aria-pressed={m.mode === mode}
              className={`pressable flex-1 rounded-full py-2 text-xs font-semibold capitalize ${
                m.mode === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {m.notice && (
        <div className="mx-3 mt-2 rounded-2xl border border-green/30 bg-green/10 px-3 py-2 text-xs text-green">{m.notice}</div>
      )}
      {m.error && (
        <div className="mx-3 mt-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{m.error}</div>
      )}

      {/* Results */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-2">
        {m.loading && list.length === 0 ? (
          <div className="space-y-2 py-2">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted/20" />)}
          </div>
        ) : list.length === 0 ? (
          <div className="px-3 py-10 text-center text-sm text-muted-foreground">
            {m.query ? 'No matches.' : m.mode === 'plugins' ? 'No marketplace entries.' : 'Search ClawHub for a skill.'}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {m.mode === 'plugins'
              ? m.plugins.map((p) => (
                <li key={p.key} className="flex items-start gap-3 rounded-2xl border border-border/60 bg-[var(--surface-2)] px-3 py-3">
                  {p.icon ? (
                    <img src={p.icon} alt="" width={32} height={32} className="mt-0.5 h-8 w-8 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-sm font-bold text-primary">
                      {p.title.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 truncate text-sm font-semibold">{p.title}</span>
                      {p.official && <ShieldCheck size={13} className="shrink-0 text-primary" aria-label="Official" />}
                    </div>
                    {p.summary && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.summary}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
                      <span className="font-mono truncate">{p.name}</span>
                      {p.version && <span>v{p.version}</span>}
                      {fmtDownloads(p.downloads) && <span>{fmtDownloads(p.downloads)} downloads</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={m.installing === p.installSpec}
                    onClick={() => setConfirmSpec({ kind: 'plugin', spec: p.installSpec, title: p.title })}
                    className="cockpit-toolbar-button min-h-11 shrink-0 px-3 text-xs font-semibold"
                  >
                    <Download size={13} /> {m.installing === p.installSpec ? 'Installing…' : 'Install'}
                  </button>
                </li>
              ))
              : m.skills.map((s) => (
                <li key={s.key} className="flex items-start gap-3 rounded-2xl border border-border/60 bg-[var(--surface-2)] px-3 py-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info/15 text-sm font-bold text-info">
                    {s.title.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="min-w-0 truncate text-sm font-semibold">{s.title}</span>
                    {s.summary && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{s.summary}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
                      {s.owner && <span>@{s.owner}</span>}
                      {fmtDownloads(s.downloads) && <span>{fmtDownloads(s.downloads)} downloads</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={m.installing === s.installRef}
                    onClick={() => setConfirmSpec({ kind: 'skill', spec: s.installRef, title: s.title })}
                    className="cockpit-toolbar-button min-h-11 shrink-0 px-3 text-xs font-semibold"
                  >
                    <Download size={13} /> {m.installing === s.installRef ? 'Installing…' : 'Install'}
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>

      {/* Install confirm (portal-free: this panel is not inside a backdrop-filter) */}
      {confirmSpec && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Confirm install">
          <div className="glass-strong w-full max-w-sm rounded-3xl p-5">
            <h3 className="t-title">Install {confirmSpec.kind}?</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This runs <span className="font-mono text-xs">openclaw {confirmSpec.kind === 'plugin' ? 'plugins' : 'skills'} install</span> on the host and grants the agent new capabilities. Only install sources you trust.
            </p>
            <p className="mt-2 truncate rounded-xl border border-border/60 bg-[var(--surface-2)] px-3 py-2 font-mono text-xs">{confirmSpec.spec}</p>
            <div className="mt-4 flex gap-2">
              <button type="button" className="cockpit-toolbar-button flex-1 justify-center" onClick={() => setConfirmSpec(null)}>Cancel</button>
              <button type="button" className="cockpit-toolbar-button flex-1 justify-center" onClick={() => void doInstall()}>Install</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}