import { useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Sparkles, Trash2, UserPlus, Users } from 'lucide-react';
import type { RosterBot, RosterGroup } from './types';
import type { BotFormValues } from './BotDialog';
import CorgiSvg from '@/components/corgi/CorgiSvg';
import { isCorgiVariant } from '@/components/corgi/corgiVariants';
import { cn } from '@/lib/utils';
import { proposeTeam, type ProposedBot } from './proposeTeam';

export interface GroupFormValues {
  name: string;
  memberBotIds: string[];
  alphaBotId?: string | null;
}

type Step = 'name' | 'team' | 'review';
type ProposalStatus = 'pending' | 'approved' | 'denied';
interface Proposal extends ProposedBot {
  key: string;
  status: ProposalStatus;
}

interface GroupWizardProps {
  group?: RosterGroup;
  bots: RosterBot[];
  onClose: () => void;
  onSave: (values: GroupFormValues) => Promise<void>;
  /** Create a bot (profile + session) — supplied by the shell. */
  createBot: (values: BotFormValues) => Promise<RosterBot>;
  /** Ask the shell to open the full bot builder on top of the wizard. */
  onRequestCreateBot: () => void;
}

const MAX_MEMBERS = 6;

/** Guided group creation: name → team (existing / suggested / Alpha) → review. */
export function GroupWizard({ group, bots, onClose, onSave, createBot, onRequestCreateBot }: GroupWizardProps) {
  const isEdit = Boolean(group);
  const [step, setStep] = useState<Step>(isEdit ? 'team' : 'name');
  const [name, setName] = useState(group?.name ?? '');
  const [blurb, setBlurb] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(group?.memberBotIds ?? []));
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [alphaEnabled, setAlphaEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const botById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const approvedProposals = proposals.filter((p) => p.status === 'approved');
  const totalMembers = selected.size + approvedProposals.length + (alphaEnabled ? 1 : 0);

  const suggest = () => {
    const next = proposeTeam(name, blurb).map((p, i) => ({ ...p, key: `${p.templateId}-${i}`, status: 'pending' as ProposalStatus }));
    setProposals(next);
  };

  const toggleBot = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setProposal = (key: string, status: ProposalStatus) => {
    setProposals((prev) => prev.map((p) => (p.key === key ? { ...p, status } : p)));
  };

  const canContinue = step === 'name' ? name.trim().length > 0 : true;
  const canCreate = name.trim().length > 0 && totalMembers >= 2 && totalMembers <= MAX_MEMBERS;

  const commit = async () => {
    if (!canCreate || busy) return;
    setBusy(true);
    setError(null);
    try {
      const finalIds = [...selected];
      for (const p of approvedProposals) {
        const bot = await createBot({
          name: p.name,
          title: p.title,
          description: p.description,
          color: p.color,
          avatar: p.avatar,
          enabledSkills: p.skills,
        });
        finalIds.push(bot.id);
      }
      let alphaBotId: string | null = null;
      if (alphaEnabled) {
        const team = [...selected]
          .map((id) => {
            const b = botById.get(id);
            if (!b) return null;
            const agentSlug = b.agentId?.split(':')[1] ?? null;
            return agentSlug ? `${b.name} (agentId: ${agentSlug})` : b.name;
          })
          .filter(Boolean)
          .join('; ');
        const alpha = await createBot({
          name: `${name.trim()} Alpha`,
          title: 'Group coordinator',
          description: `You coordinate the "${name.trim()}" group. ${blurb ? blurb + ' ' : ''}Team roster: ${team || 'to be assigned'}. Delegate bounded tasks with sessions_spawn using the teammate's agentId, keep one owner per step, verify their artifacts, then report a coherent result. Never delegate further than this team, and ask for approval before any external action.`,
          color: '#0A84FF',
          avatar: 'cardigan',
        });
        finalIds.push(alpha.id);
        alphaBotId = alpha.id;
      }
      if (finalIds.length < 2 || finalIds.length > MAX_MEMBERS) {
        throw new Error(`Groups need ${2}–${MAX_MEMBERS} bots (got ${finalIds.length})`);
      }
      await onSave({ name: name.trim(), memberBotIds: finalIds, alphaBotId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the group');
      setBusy(false);
    }
  };

  const StepDots = (
    <div className="flex items-center gap-1.5">
      {(['name', 'team', 'review'] as const).map((s) => (
        <span key={s} className={cn('h-1.5 rounded-full transition-all', step === s ? 'w-5 bg-primary' : 'w-1.5 bg-foreground/20')} />
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit group' : 'New group'}>
      <div className="glass-strong animate-sheet-in flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] sm:max-h-[88vh] sm:rounded-[28px]">
        <div className="flex justify-center pt-2.5 sm:hidden">
          <span className="h-1.5 w-10 rounded-full bg-foreground/25" aria-hidden="true" />
        </div>

        <div className="flex shrink-0 items-center justify-between px-5 pt-3">
          <div>
            <h3 className="t-title">{isEdit ? `Edit ${group!.name}` : 'New group chat'}</h3>
            <p className="t-caption mt-0.5">{isEdit ? 'Manage members.' : 'Build a team, review it, then start.'}</p>
          </div>
          {!isEdit && StepDots}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2 pt-3">
          {/* Step: name */}
          {step === 'name' && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="t-caption">Group name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Launch squad" maxLength={100} className="cockpit-input rounded-2xl px-3.5 py-3 text-base" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="t-caption">What is this group for? (optional)</span>
                <textarea
                  value={blurb}
                  onChange={(e) => setBlurb(e.target.value)}
                  placeholder="e.g. Build and launch the marketing site"
                  rows={2}
                  maxLength={500}
                  className="cockpit-textarea rounded-2xl px-3.5 py-3 text-base"
                />
              </label>
            </div>
          )}

          {/* Step: team */}
          {step === 'team' && (
            <div className="flex flex-col gap-4">
              {/* Suggestions */}
              {!isEdit && (
                <div>
                  <div className="flex items-center justify-between">
                    <span className="t-caption">Suggested team</span>
                    <button type="button" onClick={suggest} className="cockpit-toolbar-button min-h-9 px-3 text-xs font-semibold">
                      <Sparkles size={13} /> Suggest
                    </button>
                  </div>
                  {proposals.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">Tap Suggest to get role-based teammates you can approve, edit, or deny.</p>
                  ) : (
                    <ul className="mt-2 flex flex-col gap-2">
                      {proposals.map((p) => (
                        <li key={p.key} className={cn('flex items-center gap-2.5 rounded-2xl border px-3 py-2.5', p.status === 'denied' ? 'border-border/50 opacity-50' : 'border-border/60 bg-[var(--surface-2)]')}>
                          <CorgiSvg variant={p.avatar} collar={p.color} size={34} state={p.status === 'approved' ? 'working' : 'idle'} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">{p.name}</div>
                            <div className="truncate text-2xs text-muted-foreground">{p.title}</div>
                          </div>
                          {p.status === 'pending' ? (
                            <div className="flex shrink-0 gap-1">
                              <button type="button" aria-label={`Approve ${p.name}`} onClick={() => setProposal(p.key, 'approved')} className="flex h-9 w-9 items-center justify-center rounded-full bg-green/15 text-green"><Check size={15} /></button>
                              <button type="button" aria-label={`Deny ${p.name}`} onClick={() => setProposal(p.key, 'denied')} className="flex h-9 w-9 items-center justify-center rounded-full bg-destructive/15 text-destructive"><Trash2 size={15} /></button>
                            </div>
                          ) : (
                            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold', p.status === 'approved' ? 'bg-green/15 text-green' : 'bg-muted text-muted-foreground')}>
                              {p.status}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Existing bots */}
              <div>
                <div className="flex items-center justify-between">
                  <span className="t-caption">Your bots ({selected.size} selected)</span>
                  <button type="button" onClick={onRequestCreateBot} className="cockpit-toolbar-button min-h-9 px-3 text-xs font-semibold">
                    <UserPlus size={13} /> Create bot
                  </button>
                </div>
                {bots.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">No bots yet. Create one to get started.</p>
                ) : (
                  <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {bots.map((b) => {
                      const on = selected.has(b.id);
                      return (
                        <li key={b.id}>
                          <button
                            type="button"
                            onClick={() => toggleBot(b.id)}
                            aria-pressed={on}
                            className={cn('pressable flex w-full items-center gap-2.5 rounded-2xl border px-2.5 py-2 text-left', on ? 'border-primary bg-primary/10' : 'border-border/60 bg-[var(--surface-2)] hover:border-primary/40')}
                          >
                            <CorgiSvg variant={isCorgiVariant(b.avatar) ? b.avatar : undefined} seed={b.id} collar={b.color} size={28} state="idle" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">{b.name}</span>
                              <span className="block truncate text-2xs text-muted-foreground">{b.title || (b.agentId ? 'Linked' : 'No session')}</span>
                            </span>
                            <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-transparent')}><Check size={13} /></span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Alpha toggle */}
              {!isEdit && (
                <button
                  type="button"
                  onClick={() => setAlphaEnabled((v) => !v)}
                  aria-pressed={alphaEnabled}
                  className={cn('pressable flex items-center gap-2.5 rounded-2xl border px-3 py-3 text-left', alphaEnabled ? 'border-primary bg-primary/10' : 'border-border/60 bg-[var(--surface-2)]')}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary"><Users size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">Add an Alpha coordinator</span>
                    <span className="block text-2xs text-muted-foreground">A bot that owns the group and coordinates the team.</span>
                  </span>
                  <span className={cn('flex h-6 w-6 items-center justify-center rounded-full border', alphaEnabled ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-transparent')}><Check size={13} /></span>
                </button>
              )}
            </div>
          )}

          {/* Step: review */}
          {step === 'review' && (
            <div className="flex flex-col gap-3">
              <div>
                <div className="text-sm font-semibold">{name}</div>
                <div className="t-caption">{totalMembers} of {MAX_MEMBERS} bots</div>
              </div>
              <ul className="flex flex-col gap-1.5">
                {[...selected].map((id) => {
                  const b = botById.get(id);
                  if (!b) return null;
                  return (
                    <li key={id} className="flex items-center gap-2.5 rounded-2xl border border-border/60 bg-[var(--surface-2)] px-3 py-2">
                      <CorgiSvg variant={isCorgiVariant(b.avatar) ? b.avatar : undefined} seed={b.id} collar={b.color} size={26} state="idle" />
                      <span className="min-w-0 flex-1 truncate text-sm">{b.name}</span>
                      <span className="text-2xs text-muted-foreground">existing</span>
                    </li>
                  );
                })}
                {approvedProposals.map((p) => (
                  <li key={p.key} className="flex items-center gap-2.5 rounded-2xl border border-border/60 bg-[var(--surface-2)] px-3 py-2">
                    <CorgiSvg variant={p.avatar} collar={p.color} size={26} state="idle" />
                    <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                    <span className="text-2xs text-muted-foreground">new</span>
                  </li>
                ))}
                {alphaEnabled && (
                  <li className="flex items-center gap-2.5 rounded-2xl border border-primary/25 bg-primary/10 px-3 py-2">
                    <CorgiSvg variant="cardigan" collar="#0A84FF" size={26} state="working" />
                    <span className="min-w-0 flex-1 truncate text-sm">{name} Alpha</span>
                    <span className="text-2xs text-primary">coordinator</span>
                  </li>
                )}
              </ul>
              {totalMembers < 2 && <p className="text-xs text-destructive">Add at least 2 bots.</p>}
              {totalMembers > MAX_MEMBERS && <p className="text-xs text-destructive">Groups allow at most {MAX_MEMBERS} bots.</p>}
              {error && <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border/50 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex gap-2">
            {step !== 'name' && !isEdit ? (
              <button type="button" className="cockpit-toolbar-button justify-center px-4" onClick={() => setStep(step === 'review' ? 'team' : 'name')} disabled={busy}>
                <ChevronLeft size={15} /> Back
              </button>
            ) : (
              <button type="button" className="cockpit-toolbar-button flex-1 justify-center" onClick={onClose} disabled={busy}>Cancel</button>
            )}
            {step === 'name' && (
              <button type="button" className="cockpit-toolbar-button flex-1 justify-center" disabled={!canContinue} onClick={() => setStep('team')}>
                Next <ChevronRight size={15} />
              </button>
            )}
            {step === 'team' && !isEdit && (
              <button type="button" className="cockpit-toolbar-button flex-1 justify-center" onClick={() => setStep('review')}>
                Review <ChevronRight size={15} />
              </button>
            )}
            {(isEdit || step === 'review') && (
              <button type="button" className="cockpit-toolbar-button flex-1 justify-center" disabled={isEdit ? selected.size < 2 : !canCreate || busy} onClick={() => (isEdit ? void onSave({ name: name.trim(), memberBotIds: [...selected] }).catch((e) => setError(e instanceof Error ? e.message : 'Save failed')) : void commit())}>
                {busy ? 'Creating…' : isEdit ? 'Save' : 'Create group'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}