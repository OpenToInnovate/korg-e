import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Bot, Check, Sparkles, UserPlus, Users } from 'lucide-react';
import type { RosterBot } from './types';
import CorgiSvg from '@/components/corgi/CorgiSvg';
import {
  CORGI_VARIANTS,
  CORGI_VARIANT_IDS,
  corgiFromSeed,
  isCorgiVariant,
  type CorgiVariantId,
} from '@/components/corgi/corgiVariants';
import { BOT_TEMPLATES, type BotTemplate } from './botTemplates';

const COLORS = ['#0A84FF', '#5E5CE6', '#BF5AF2', '#FF375F', '#FF453A', '#FF9F0A', '#30D158', '#64D2FF'];

export interface BotFormValues {
  name: string;
  title: string;
  description: string;
  color: string;
  avatar: CorgiVariantId;
  /** Link to an existing OpenClaw agent instead of spawning a new session. */
  agentId?: string | null;
  /**
   * How the backing agent is obtained. `create` provisions a brand-new agent
   * (the default, so a new bot just works); `link` binds an existing one.
   */
  agentMode?: 'create' | 'link';
  /** Skills to enable for the new bot. */
  enabledSkills?: string[];
}

interface AgentSummary {
  id: string;
  name?: string;
  identityName?: string;
  identityEmoji?: string;
  model?: string;
  isDefault?: boolean;
}

type CreateMode = 'blank' | 'template' | 'agent' | 'group';

/** Create / edit a bot profile (name, title, description, corgi, collar). */
export interface GroupQuickValues {
  name: string;
  memberBotIds: string[];
  alphaEnabled: boolean;
}

export function BotDialog(props: {
  bot?: RosterBot;
  bots?: RosterBot[];
  onClose: () => void;
  onSave: (values: BotFormValues) => Promise<void>;
  /** Quick group builder (Create → Group tab). */
  onCreateGroup?: (values: GroupQuickValues) => Promise<void>;
  /**
   * Agents that exist but are NOT already bound to any profile. When provided,
   * the adopt list is limited to these so Tony can never bind an agent another
   * family member owns.
   */
  linkableAgents?: { id: string; name?: string }[] | null;
  /**
   * Why the available-agents list could not be loaded (e.g. the route does not
   * exist yet). Shown verbatim — we never paper over it with an empty list.
   */
  linkableAgentsError?: string | null;
}) {
  const { bot, onClose, onSave } = props;
  const bots = props.bots ?? [];
  const linkableAgents = props.linkableAgents ?? null;
  const linkableAgentsError = props.linkableAgentsError ?? null;
  const onCreateGroup = props.onCreateGroup;
  const [name, setName] = useState(bot?.name ?? '');
  const [title, setTitle] = useState(bot?.title ?? '');
  const [description, setDescription] = useState(bot?.description ?? '');
  const [color, setColor] = useState(bot?.color ?? COLORS[0]);
  const [avatar, setAvatar] = useState<CorgiVariantId>(() =>
    isCorgiVariant(bot?.avatar) ? bot.avatar : corgiFromSeed(bot?.name ?? 'corgi'),
  );
  const [agentId, setAgentId] = useState<string | null>(bot?.agentId ?? null);
  const [enabledSkills, setEnabledSkills] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Create-mode state
  const [mode, setMode] = useState<CreateMode>('template');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [adoptedAgent, setAdoptedAgent] = useState<AgentSummary | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupSelected, setGroupSelected] = useState<Set<string>>(new Set());
  const [groupAlpha, setGroupAlpha] = useState(true);
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  useEffect(() => () => clearTimeout(previewTimer.current), []);

  // Lazily load OpenClaw agents when the adopt tab is opened.
  useEffect(() => {
    if (bot || mode !== 'agent' || agents !== null) return;
    let cancelled = false;
    fetch('/api/marketplace/agents')
      .then((r) => r.json())
      .then((body: { ok?: boolean; agents?: AgentSummary[]; error?: string }) => {
        if (cancelled) return;
        if (!body.ok) throw new Error(body.error || 'Failed to load agents');
        setAgents(Array.isArray(body.agents) ? body.agents : []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setAgentsError(err instanceof Error ? err.message : 'Failed to load agents');
      });
    return () => { cancelled = true; };
  }, [bot, mode, agents]);

  const preview = () => {
    setPreviewing(true);
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => setPreviewing(false), 1400);
  };

  const pickVariant = (id: CorgiVariantId) => {
    setAvatar(id);
    preview();
  };

  const applyTemplate = (t: BotTemplate) => {
    setTemplateId(t.id);
    setName(t.name);
    setTitle(t.title);
    setDescription(t.description);
    setAvatar(t.avatar);
    setColor(t.color);
    setEnabledSkills(t.suggestedSkills);
    preview();
  };

  const adoptAgent = (a: AgentSummary) => {
    setAdoptedAgent(a);
    setAgentId(a.id);
    setName(a.identityName || a.name || a.id);
    setTitle((prev) => prev || 'OpenClaw agent');
    preview();
  };

  /**
   * The adopt list is limited to agents not already bound to a profile, so a bot
   * can never claim an agent another family member owns.
   *
   * We deliberately do NOT fall back to the unfiltered marketplace list when
   * the available-agents data is missing or errored: that would quietly offer
   * agents other profiles own. Return null so the UI shows the error instead.
   */
  const linkable = useMemo(() => {
    if (!agents) return null;
    if (linkableAgentsError) return null;
    if (!linkableAgents) return null;
    const allowed = new Set(linkableAgents.map((a) => a.id));
    return agents.filter((a) => allowed.has(a.id));
  }, [agents, linkableAgents, linkableAgentsError]);

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        title: title.trim(),
        description: description.trim(),
        color,
        avatar,
        agentId: bot ? bot.agentId : agentId,
        // Adopting an existing agent means "link"; every other path provisions.
        agentMode: bot ? undefined : (mode === 'agent' && agentId ? 'link' : 'create'),
        enabledSkills,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
    }
  };

  const submitGroup = async () => {
    if (!onCreateGroup || !groupName.trim() || groupBusy) return;
    if (groupSelected.size + (groupAlpha ? 1 : 0) < 2) {
      setGroupError('Pick at least 2 bots (or 1 plus an Alpha).');
      return;
    }
    setGroupBusy(true);
    setGroupError(null);
    try {
      await onCreateGroup({
        name: groupName.trim(),
        memberBotIds: [...groupSelected],
        alphaEnabled: groupAlpha,
      });
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : 'Could not create the group');
      setGroupBusy(false);
    }
  };

  const variant = CORGI_VARIANTS[avatar];
  const isEdit = Boolean(bot);

  const modeTab = (key: CreateMode, label: string, Icon: typeof Bot) => (
    <button
      key={key}
      type="button"
      onClick={() => setMode(key)}
      aria-pressed={mode === key}
      className={`pressable flex flex-1 flex-col items-center gap-1 rounded-2xl py-2.5 text-2xs font-semibold ${
        mode === key ? 'bg-primary/15 text-primary' : 'text-muted-foreground'
      }`}
    >
      <Icon size={16} />
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit bot' : 'Create a new bot'}>
      <div className="glass-strong animate-sheet-in flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] sm:max-h-[88vh] sm:rounded-[28px]">
        <div className="flex justify-center pt-2.5 sm:hidden">
          <span className="h-1.5 w-10 rounded-full bg-foreground/25" aria-hidden="true" />
        </div>

        <div className="shrink-0 px-5 pt-3">
          <h3 className="t-title">{isEdit ? `Edit ${bot!.name}` : 'Create a new bot or group'}</h3>
          <p className="t-caption mt-0.5">
            {isEdit ? 'Profile, boundaries, and responsibilities live here.' : 'Pick a starting point, then name your bot. A live session spins up on create.'}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2">
          {/* Starting point (create only) */}
          {!isEdit && (
            <div className="mt-4 flex items-center gap-1 rounded-2xl border border-border/60 bg-[var(--surface-2)] p-1">
              {modeTab('template', 'Template', Sparkles)}
              {modeTab('agent', 'Adopt agent', UserPlus)}
              {modeTab('group', 'Group', Users)}
              {modeTab('blank', 'Blank', Bot)}
            </div>
          )}

          {/* Template picker */}
          {!isEdit && mode === 'template' && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {BOT_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  aria-pressed={templateId === t.id}
                  className={`pressable flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left ${
                    templateId === t.id ? 'border-primary bg-primary/10' : 'border-border/60 bg-[var(--surface-2)] hover:border-primary/40'
                  }`}
                >
                  <CorgiSvg variant={t.avatar} collar={t.color} size={34} state="idle" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{t.name}</span>
                    <span className="block truncate text-2xs text-muted-foreground">{t.title}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Adopt an existing OpenClaw agent */}
          {!isEdit && mode === 'agent' && (
            <div className="mt-3">
              {linkableAgentsError || agentsError ? (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {linkableAgentsError ?? agentsError}
                </div>
              ) : agents === null || linkable === null ? (
                <div className="py-4 text-center text-xs text-muted-foreground">Loading agents…</div>
              ) : linkable.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  No agents available to link. Every existing agent is already bound to a profile.
                </div>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {linkable.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => adoptAgent(a)}
                        aria-pressed={agentId === a.id}
                        className={`pressable flex w-full items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left ${
                          agentId === a.id ? 'border-primary bg-primary/10' : 'border-border/60 bg-[var(--surface-2)] hover:border-primary/40'
                        }`}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-base">
                          {a.identityEmoji || '🤖'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{a.identityName || a.name || a.id}</span>
                          <span className="block truncate font-mono text-2xs text-muted-foreground">{a.id}</span>
                        </span>
                        {a.isDefault && <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-2xs font-semibold text-primary">default</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Quick group builder */}
          {!isEdit && mode === 'group' && (
            <div className="mt-3 flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="t-caption">Group name</span>
                <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="e.g. Launch squad" maxLength={100} className="cockpit-input rounded-2xl px-3.5 py-3 text-base" />
              </label>
              <div>
                <div className="flex items-center justify-between">
                  <span className="t-caption">Members ({groupSelected.size} selected)</span>
                </div>
                {bots.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">Create some bots first, then group them here.</p>
                ) : (
                  <ul className="mt-2 flex max-h-44 flex-col gap-1.5 overflow-y-auto">
                    {bots.map((b) => {
                      const on = groupSelected.has(b.id);
                      return (
                        <li key={b.id}>
                          <button
                            type="button"
                            onClick={() => setGroupSelected((prev) => { const next = new Set(prev); if (next.has(b.id)) next.delete(b.id); else next.add(b.id); return next; })}
                            aria-pressed={on}
                            className={`pressable flex w-full items-center gap-2.5 rounded-2xl border px-2.5 py-2 text-left ${on ? 'border-primary bg-primary/10' : 'border-border/60 bg-[var(--surface-2)] hover:border-primary/40'}`}
                          >
                            <CorgiSvg variant={isCorgiVariant(b.avatar) ? b.avatar : undefined} seed={b.id} collar={b.color} size={26} state="idle" />
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{b.name}</span>
                            <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-transparent')}><Check size={13} /></span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <button
                type="button"
                onClick={() => setGroupAlpha((v) => !v)}
                aria-pressed={groupAlpha}
                className={`pressable flex items-center gap-2.5 rounded-2xl border px-3 py-3 text-left ${groupAlpha ? 'border-primary bg-primary/10' : 'border-border/60 bg-[var(--surface-2)]'}`}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary"><Users size={16} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">Add an Alpha coordinator</span>
                  <span className="block text-2xs text-muted-foreground">Owns the group chat and delegates tasks to members.</span>
                </span>
                <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border', groupAlpha ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-transparent')}><Check size={13} /></span>
              </button>
              {groupError && <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{groupError}</div>}
              <button
                type="button"
                className="cockpit-toolbar-button justify-center py-3 text-xs font-semibold"
                disabled={!groupName.trim() || groupBusy || !onCreateGroup}
                onClick={() => void submitGroup()}
              >
                <Users size={13} /> {groupBusy ? 'Creating…' : 'Create group'}
              </button>
            </div>
          )}

          {/* Preview stage */}
          <button
            type="button"
            onClick={preview}
            className="pressable mt-4 flex w-full flex-col items-center gap-1 rounded-[24px] border border-border/60 bg-[var(--surface-2)] px-4 py-5"
            aria-label="Preview corgi animation"
          >
            <CorgiSvg variant={avatar} collar={color} size={84} state={previewing ? 'working' : 'idle'} />
            <span className="mt-1 t-label" style={{ color }}>{variant.name}</span>
            <span className="t-caption text-center">{variant.blurb}</span>
            <span className="mt-1 text-2xs text-muted-foreground/70">Tap to preview</span>
          </button>

          {/* Variant picker */}
          <div className="mt-4">
            <span className="t-caption">Corgi</span>
            <div className="mt-2 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Corgi variant">
              {CORGI_VARIANT_IDS.map((id) => {
                const v = CORGI_VARIANTS[id];
                const selected = id === avatar;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={v.name}
                    onClick={() => pickVariant(id)}
                    className={`pressable flex flex-col items-center gap-1 rounded-2xl border px-1 py-2.5 ${
                      selected ? 'border-primary bg-primary/10' : 'border-border/60 bg-[var(--surface-2)] hover:border-primary/40'
                    }`}
                  >
                    <CorgiSvg variant={id} collar={color} size={40} state="idle" />
                    <span className={`text-2xs font-medium ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>{v.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Collar */}
          <div className="mt-4">
            <span className="t-caption">Collar</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Collar ${c}`}
                  aria-pressed={color === c}
                  className="pressable h-11 w-11 rounded-full border-2"
                  style={{ backgroundColor: c, borderColor: color === c ? 'var(--color-foreground)' : 'transparent' }}
                />
              ))}
            </div>
          </div>

          {/* Fields */}
          <div className="mt-4 flex flex-col gap-3">
            {adoptedAgent && (
              <div className="rounded-2xl border border-primary/25 bg-primary/10 px-3 py-2 text-xs">
                Adopting OpenClaw agent <span className="font-mono">{adoptedAgent.id}</span> — no new session will be created.
              </div>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="t-caption">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Researcher" maxLength={100} className="cockpit-input rounded-2xl px-3.5 py-3 text-base" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="t-caption">Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Owns paid acquisition" maxLength={140} className="cockpit-input rounded-2xl px-3.5 py-3 text-base" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="t-caption">Description & boundaries</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Never send external messages without approval."
                maxLength={2000}
                rows={3}
                className="cockpit-textarea rounded-2xl px-3.5 py-3 text-base"
              />
            </label>
          </div>

          {error && <div className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
        </div>

        <div className="shrink-0 border-t border-border/50 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex gap-2">
            <button type="button" className="cockpit-toolbar-button flex-1 justify-center" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="cockpit-toolbar-button flex-1 justify-center" disabled={!name.trim() || saving} onClick={save}>
              {saving ? 'Saving…' : isEdit ? 'Save' : 'Create bot'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}