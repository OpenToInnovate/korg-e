/**
 * SkillsTab — Plugins browser (Marketplace + Yours) with per-bot enablement.
 *
 * Installed skills come from the gateway; the linked Korg-e bot profile
 * controls which skills are enabled for the current bot.
 */

import { useMemo, useState, useCallback } from 'react';
import { RefreshCw, Circle, ExternalLink, ChevronDown, ChevronRight, Puzzle } from 'lucide-react';
import { useSkills, type Skill, type SkillMissing } from '../hooks/useSkills';
import { useRoster } from '@/features/roster/useRoster';
import { MarketplaceBrowser } from '@/features/marketplace/MarketplaceBrowser';
import { Switch } from '@/components/ui/switch';

/** Format missing requirements into a human-readable string. */
function formatMissing(missing: SkillMissing): string {
  const parts: string[] = [];
  if (missing.bins?.length) parts.push(`bins: [${missing.bins.join(', ')}]`);
  if (missing.anyBins?.length) parts.push(`anyBins: [${missing.anyBins.join(', ')}]`);
  if (missing.env?.length) parts.push(`env: [${missing.env.join(', ')}]`);
  if (missing.config?.length) parts.push(`config: [${missing.config.join(', ')}]`);
  if (missing.os?.length) parts.push(`os: [${missing.os.join(', ')}]`);
  return parts.join(', ');
}

/** Source badge color. */
function sourceColor(source: string): string {
  switch (source) {
    case 'bundled': return 'bg-purple/20 text-purple';
    case 'workspace': return 'bg-blue/20 text-blue';
    case 'clawhub': return 'bg-green/20 text-green';
    default: return 'bg-muted/30 text-muted-foreground';
  }
}

function SkillRow({ skill, enabled, onToggleEnabled }: { skill: Skill; enabled?: boolean; onToggleEnabled?: (on: boolean) => void }) {
  const [expanded, setExpanded] = useState(false);
  const hasMissing = !skill.eligible && skill.missing && formatMissing(skill.missing);

  const handleExpand = useCallback(() => {
    setExpanded(prev => !prev);
  }, []);

  return (
    <div className="border-b border-border/40">
      <div className="px-3 py-2 flex items-start gap-2">
        {/* Status dot */}
        <div className="flex-shrink-0 mt-1">
          <Circle
            size={8}
            fill={skill.eligible ? 'currentColor' : 'none'}
            className={skill.eligible ? 'text-green' : 'text-muted-foreground'}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {skill.emoji && <span className="text-xs">{skill.emoji}</span>}
            <span className="text-xs text-foreground leading-tight truncate font-medium">
              {skill.name}
            </span>
            {/* Source badge */}
            <span className={`text-2xs px-1 py-px rounded-sm leading-tight ${sourceColor(skill.source)}`}>
              {skill.source}
            </span>
          </div>
          {skill.description && (
            <div className="text-2xs text-muted-foreground mt-0.5 line-clamp-2 leading-snug">
              {skill.description}
            </div>
          )}
          {skill.disabled && (
            <div className="text-2xs text-muted-foreground mt-0.5 italic">Disabled</div>
          )}
          {skill.blockedByAllowlist && (
            <div className="text-2xs text-muted-foreground mt-0.5 italic">Blocked by allowlist</div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {onToggleEnabled && skill.eligible && (
            <Switch
              checked={enabled ?? true}
              onCheckedChange={onToggleEnabled}
              aria-label={`Enable ${skill.name} for this bot`}
            />
          )}
          {skill.homepage && (
            <a
              href={skill.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-purple transition-colors focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0 rounded-sm"
              title={`Open ${skill.name} homepage`}
              aria-label={`Open ${skill.name} homepage`}
            >
              <ExternalLink size={10} />
            </a>
          )}
          {hasMissing && (
            <button
              onClick={handleExpand}
              className="bg-transparent border border-transparent text-muted-foreground cursor-pointer p-0.5 focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0 rounded-sm"
              aria-label={expanded ? 'Hide missing requirements' : 'Show missing requirements'}
            >
              {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
          )}
        </div>
      </div>

      {/* Expanded missing requirements */}
      {expanded && hasMissing && (
        <div className="px-3 pb-2 pl-8">
          <div className="text-2xs text-muted-foreground">
            <span className="text-red/70">Missing:</span>{' '}
            {formatMissing(skill.missing!)}
          </div>
        </div>
      )}
    </div>
  );
}

interface SkillsTabProps {
  agentId: string;
}

/** Workspace tab: Plugins marketplace + private skills with per-bot enablement. */
export function SkillsTab({ agentId }: SkillsTabProps) {
  const { skills, isLoading, error, refresh } = useSkills(agentId);
  const { roster, updateBot } = useRoster();
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [showMarketplace, setShowMarketplace] = useState(true);
  const [view, setView] = useState<'installed' | 'discover'>('installed');

  // Bot profile linked to this workspace agent (root session key match).
  const rootKey = `agent:${agentId}:main`;
  const linkedBot = useMemo(
    () => roster.bots.find((b) => b.agentId === rootKey),
    [roster.bots, rootKey],
  );

  const eligibleSkills = useMemo(() => skills.filter(s => s.eligible), [skills]);
  const unavailableSkills = useMemo(() => skills.filter(s => !s.eligible), [skills]);
  const marketplace = useMemo(() => eligibleSkills.filter(s => s.source !== 'workspace'), [eligibleSkills]);
  const yours = useMemo(() => eligibleSkills.filter(s => s.source === 'workspace'), [eligibleSkills]);

  // Empty enabledSkills = everything on. Otherwise the list is the allowlist.
  const isEnabled = useCallback(
    (name: string) => {
      if (!linkedBot || linkedBot.enabledSkills.length === 0) return true;
      return linkedBot.enabledSkills.includes(name);
    },
    [linkedBot],
  );

  const setSkillEnabled = useCallback(
    async (name: string, on: boolean) => {
      if (!linkedBot) return;
      const all = eligibleSkills.map(s => s.name);
      let next: string[];
      if (on) {
        next = linkedBot.enabledSkills.includes(name)
          ? linkedBot.enabledSkills
          : [...linkedBot.enabledSkills, name];
        if (next.length === all.length && all.every(n => next.includes(n))) next = [];
      } else if (linkedBot.enabledSkills.length === 0) {
        next = all.filter(n => n !== name);
      } else {
        next = linkedBot.enabledSkills.filter(n => n !== name);
      }
      await updateBot(linkedBot.id, { enabledSkills: next }).catch(() => undefined);
    },
    [linkedBot, eligibleSkills, updateBot],
  );

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Installed / Discover switch */}
      <div className="shrink-0 px-3 pt-3">
        <div className="flex items-center gap-1 rounded-full border border-border/70 bg-[var(--surface-2)] p-1">
          {(['installed', 'discover'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`pressable flex-1 rounded-full py-2 text-xs font-semibold capitalize ${
                view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === 'discover' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <MarketplaceBrowser agentId={agentId} onInstalled={refresh} />
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto">
        {/* Skills count + Refresh row */}
        {!isLoading && skills.length > 0 && (
          <div className="flex items-center border-b border-border/40">
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs flex-1">
              <span className="shrink-0 text-muted-foreground">
                <Puzzle size={12} />
              </span>
              <span className="text-muted-foreground">
                {eligibleSkills.length} active
                {unavailableSkills.length > 0 && (
                  <span className="text-muted-foreground/50"> / {skills.length} total</span>
                )}
              </span>
            </div>
            <button
              onClick={refresh}
              disabled={isLoading}
              className="shrink-0 px-2 py-1.5 bg-transparent border-0 text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0"
              title="Refresh skills"
              aria-label="Refresh skills"
            >
              <RefreshCw size={10} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        )}

        {/* Per-bot enablement hint */}
        {!isLoading && !linkedBot && skills.length > 0 && (
          <div className="px-3 py-2 text-2xs leading-4 text-muted-foreground border-b border-border/40">
            🐶 Link a bot profile to this agent (roster → Save as bot profile) to enable skills per bot.
          </div>
        )}
        {!isLoading && linkedBot && (
          <div className="px-3 py-2 text-2xs leading-4 text-muted-foreground border-b border-border/40">
            🐶 Skills toggles apply to <span className="font-semibold text-foreground">{linkedBot.name}</span>
            {linkedBot.enabledSkills.length > 0 && (
              <> · {linkedBot.enabledSkills.length} of {eligibleSkills.length} on</>
            )}.
          </div>
        )}

        {/* Error */}
        <div aria-live="polite" aria-atomic="true">
          {error && (
            <div className="px-3 py-2 text-2xs text-red bg-red/10">{error}</div>
          )}
        </div>

        {/* Loading skeleton */}
        {isLoading && !skills.length && !error && (
          <div className="space-y-2 py-2">
            <div className="h-10 bg-muted/20 animate-pulse rounded mx-3" />
            <div className="h-10 bg-muted/20 animate-pulse rounded mx-3" />
            <div className="h-10 bg-muted/20 animate-pulse rounded mx-3" />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !eligibleSkills.length && !error && (
          <div className="text-muted-foreground px-3 py-8 text-center flex flex-col items-center gap-2">
            <Puzzle size={20} className="text-muted-foreground/50" />
            <span className="text-xs">No skills found</span>
          </div>
        )}

        {/* Yours — private workspace skills */}
        {yours.length > 0 && (
          <>
            <div className="px-3 pt-2 pb-1 text-2xs font-semibold text-muted-foreground">
              Yours ({yours.length})
            </div>
            {yours.map(skill => (
              <SkillRow
                key={skill.name}
                skill={skill}
                enabled={isEnabled(skill.name)}
                onToggleEnabled={linkedBot ? (on) => void setSkillEnabled(skill.name, on) : undefined}
              />
            ))}
          </>
        )}

        {/* Marketplace — bundled + shared skills */}
        {marketplace.length > 0 && (
          <>
            <button
              onClick={() => setShowMarketplace(prev => !prev)}
              className="w-full flex items-center gap-1.5 px-3 py-2 bg-transparent border-0 border-t border-border/40 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
              aria-expanded={showMarketplace}
            >
              {showMarketplace ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              <span className="text-2xs">
                Marketplace ({marketplace.length})
              </span>
            </button>
            {showMarketplace && marketplace.map(skill => (
              <SkillRow
                key={skill.name}
                skill={skill}
                enabled={isEnabled(skill.name)}
                onToggleEnabled={linkedBot ? (on) => void setSkillEnabled(skill.name, on) : undefined}
              />
            ))}
          </>
        )}

        {/* Unavailable skills — collapsible section */}
        {unavailableSkills.length > 0 && (
          <div className="border-t border-border/40 mt-1">
            <button
              onClick={() => setShowUnavailable(prev => !prev)}
              className="w-full flex items-center gap-1.5 px-3 py-2 bg-transparent border-0 cursor-pointer text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0 rounded-sm"
            >
              {showUnavailable ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              <span className="text-2xs">
                Unavailable ({unavailableSkills.length})
              </span>
            </button>
            {showUnavailable && (
              <div className="opacity-60">
                {unavailableSkills.map(skill => (
                  <SkillRow key={skill.name} skill={skill} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
