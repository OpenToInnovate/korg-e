import { useMemo, useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell, BellOff, CheckSquare, ChevronDown, ChevronRight, Copy, Eye, EyeOff,
  FolderInput, Mail, MailOpen, Pencil, Pin, PinOff, Plus, Search, Trash2, Users,
} from 'lucide-react';
import type { Session, GranularAgentState } from '@/types';
import { getSessionKey } from '@/types';
import { useSessionContext } from '@/contexts/SessionContext';
import { buildAgentSidebarTree } from '@/features/sessions/sessionTree';
import { getSessionDisplayLabel } from '@/features/sessions/sessionKeys';
import { getWorkspaceAgentId } from '@/features/workspace/workspaceScope';
import KorgeAvatar from '@/components/KorgeAvatar';
import { isCorgiVariant } from '@/components/corgi/corgiVariants';
import KorgeLogo from '@/components/KorgeLogo';
import WorkingPaws from '@/components/WorkingPaws';
import { cn } from '@/lib/utils';
import type { RosterApi } from './useRoster';
import type { RosterBot, RosterGroup, RosterSection } from './types';

/** Minimal profile shape the sidebar needs (avoids a profiles→roster dep). */
export interface SidebarProfile {
  id: string;
  name: string;
  color: string;
  emoji: string | null;
}

export interface RosterSidebarProps {
  sessions: Session[];
  currentSession: string;
  busyState: Record<string, boolean>;
  unreadSessions?: Record<string, boolean>;
  agentStatus?: Record<string, GranularAgentState>;
  onSelect: (key: string) => void;
  onRefresh: () => void;
  /** Reserved spawn hook (root/subagent creation) used by the shell. */
  onSpawn?: (opts: import('@/contexts/SessionContext').SpawnSessionOpts) => Promise<void | boolean> | void;
  isLoading?: boolean;
  agentName?: string;
  roster: RosterApi;
  onNewBot: () => void;
  onNewGroup: () => void;
  onEditBot: (bot: RosterBot) => void;
  onEditGroup: (group: RosterGroup) => void;
  onEditSection: (section: RosterSection) => void;
  onOpenTasks?: () => void;
  /** Open the group chat (the Alpha bot's session). */
  onOpenGroupChat?: (sessionKey: string) => void;
  /** Search query is lifted so the empty state can explain filtering. */
  className?: string;
  /** Active household profile — drives the accent and the empty state. */
  profile?: SidebarProfile | null;
  /**
   * Optional header control rendered where the brand title sits. The host
   * uses this to surface the profile switcher on phones (where the app's top
   * bar is off-screen while browsing home). When omitted the brand title
   * shows, so the header always has exactly one leading element.
   */
  headerSlot?: ReactNode;
}

function timeAgo(ts?: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function sessionTime(s: Session): number {
  const raw = s.lastActivity ?? s.updatedAt ?? 0;
  const ms = typeof raw === 'string' ? Date.parse(raw) : raw;
  return Number.isFinite(ms) ? (ms as number) : 0;
}

function readCollapsedMap(key: string): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === 'string' && k && typeof v === 'boolean') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeCollapsedMap(key: string, value: Record<string, boolean>) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable/full — collapse state just won't persist.
  }
}

const COLLAPSED_SECTIONS_KEY = 'nerve.roster.collapsedSections';
const COLLAPSED_GROUPS_KEY = 'nerve.roster.collapsedGroups';

/** Home roster: pinned → groups → sections (bots) → hidden. */
export function RosterSidebar(props: RosterSidebarProps) {
  const { sessions, currentSession, busyState, unreadSessions, onSelect, isLoading, roster, className } = props;
  const { markSessionRead, markSessionUnread } = useSessionContext();
  const profile = props.profile ?? null;
  const profileId = roster.roster.profileId ?? profile?.id ?? null;
  const [query, setQuery] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => readCollapsedMap(COLLAPSED_SECTIONS_KEY));
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => readCollapsedMap(COLLAPSED_GROUPS_KEY));
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'bot' | 'group' | 'section'; id: string; name: string } | null>(null);

  // Profile switch: drop per-view state that referenced the old profile's
  // rows, so a pending menu/confirm/search can never outlive its row.
  // Collapse state is intentionally kept — it is keyed by row id and persists.
  useEffect(() => {
    setMenuFor(null);
    setConfirmDelete(null);
    setQuery('');
    setShowHidden(false);
  }, [profileId]);

  const roots = useMemo(() => buildAgentSidebarTree(sessions), [sessions]);
  const q = query.trim().toLowerCase();
  const matchQ = (text: string) => !q || text.toLowerCase().includes(q);

  const sessionByKey = useMemo(() => {
    const map = new Map<string, Session>();
    for (const s of sessions) map.set(getSessionKey(s), s);
    return map;
  }, [sessions]);

  // PRIVACY: a bare session row (an agent with no roster bot record) may only
  // render if the active profile owns it. Ownership arrives as BOTH bare agent
  // ids (`mir-tutor`) and full session keys (`agent:mir-tutor:main`), so match
  // either. An empty set means the endpoint is unavailable — we then show no
  // session rows at all rather than risk leaking another profile's agents.
  const ownedAgentIds = useMemo(() => new Set(roster.ownedAgentIds), [roster.ownedAgentIds]);
  const isAgentOwned = useCallback((sessionKey: string) => {
    if (ownedAgentIds.size === 0) return false;
    if (ownedAgentIds.has(sessionKey)) return true;
    return ownedAgentIds.has(getWorkspaceAgentId(sessionKey));
  }, [ownedAgentIds]);

  const rows = useMemo(() => {
    const linkedKeys = new Set(roster.roster.bots.map((b) => b.agentId).filter(Boolean) as string[]);
    const out: Array<{ key: string; label: string; bot?: RosterBot; sessionKey?: string; time: number }> = [];
    for (const b of roster.roster.bots) {
      const session = b.agentId ? sessionByKey.get(b.agentId) : undefined;
      out.push({
        key: `bot:${b.id}`,
        label: b.name,
        bot: b,
        sessionKey: b.agentId ?? undefined,
        time: session ? sessionTime(session) : b.updatedAt,
      });
    }
    for (const node of roots) {
      const key = getSessionKey(node.session);
      if (linkedKeys.has(key)) continue;
      // Not owned by this profile -> drop the row entirely. Do not render it,
      // do not grey it out, do not surface its name anywhere.
      if (!isAgentOwned(key)) continue;
      out.push({ key: `session:${key}`, label: getSessionDisplayLabel(node.session), sessionKey: key, time: sessionTime(node.session) });
    }
    return out;
  }, [roots, sessionByKey, roster.roster.bots, isAgentOwned]);

  const pinnedRows = rows.filter((r) => r.bot?.pinned);
  const unpinnedRows = rows.filter((r) => !r.bot?.pinned);

  const sections = useMemo(
    () => [...roster.roster.sections].sort((a, b) => a.order - b.order),
    [roster.roster.sections],
  );

  const botById = useMemo(() => {
    const m = new Map<string, RosterBot>();
    for (const b of roster.roster.bots) m.set(b.id, b);
    return m;
  }, [roster.roster.bots]);

  /** Latest activity per group: member/alpha session activity, falling back to the group's own updatedAt. */
  const groupActivity = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of roster.roster.groups) {
      let latest = g.updatedAt;
      for (const id of g.memberBotIds) {
        const bot = botById.get(id);
        const session = bot?.agentId ? sessionByKey.get(bot.agentId) : undefined;
        if (session) latest = Math.max(latest, sessionTime(session));
      }
      map.set(g.id, latest);
    }
    return map;
  }, [roster.roster.groups, botById, sessionByKey]);

  const visibleGroups = useMemo(
    () =>
      roster.roster.groups
        .filter((g) => matchQ(g.name) && (showHidden || !g.hidden))
        .sort(
          (a, b) =>
            Number(b.pinned) - Number(a.pinned) ||
            (groupActivity.get(b.id) ?? 0) - (groupActivity.get(a.id) ?? 0) ||
            b.updatedAt - a.updatedAt,
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roster.roster.groups, groupActivity, q, showHidden],
  );

  const filterRows = (list: typeof rows) =>
    list.filter((r) => matchQ(r.label) && (showHidden || !(r.bot?.hidden ?? false)));

  const hiddenCount =
    rows.filter((r) => r.bot?.hidden).length + roster.roster.groups.filter((g) => g.hidden).length;

  const renderBotRow = (r: (typeof rows)[number]) => (
    <BotRow
      key={r.key}
      label={r.label}
      bot={r.bot}
      sessionKey={r.sessionKey}
      time={r.time}
      active={r.sessionKey === currentSession}
      busy={r.sessionKey ? !!busyState[r.sessionKey] : false}
      unread={r.sessionKey ? !!unreadSessions?.[r.sessionKey] : false}
      menuOpen={menuFor === r.key}
      onToggleMenu={() => setMenuFor((cur) => (cur === r.key ? null : r.key))}
      onCloseMenu={() => setMenuFor(null)}
      onSelect={() => {
        if (r.sessionKey) onSelect(r.sessionKey);
        else if (r.bot) props.onEditBot(r.bot);
      }}
      onMarkRead={() => r.sessionKey && markSessionRead(r.sessionKey)}
      onMarkUnread={() => r.sessionKey && markSessionUnread(r.sessionKey)}
      sections={sections}
      roster={roster}
      onEdit={() => r.bot && props.onEditBot(r.bot)}
      onDelete={() => r.bot && setConfirmDelete({ kind: 'bot', id: r.bot.id, name: r.bot.name })}
      onNewProfile={() => r.sessionKey && roster.createBot({ name: r.label, agentId: r.sessionKey }).catch(() => undefined)}
    />
  );

  const renderSectionHeader = (section: RosterSection, count: number) => {
    const collapsed = collapsedSections[section.id] ?? false;
    return (
      <div key={section.id} className="group/sec flex items-center gap-1 px-2 pt-2.5">
        <button
          type="button"
          onClick={() => setCollapsedSections((prev) => {
            const next = { ...prev, [section.id]: !collapsed };
            writeCollapsedMap(COLLAPSED_SECTIONS_KEY, next);
            return next;
          })}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-2xs font-bold text-muted-foreground/80"
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <span className="truncate">{section.name}</span>
          <span className="text-muted-foreground/50">{count}</span>
        </button>
        <button
          type="button"
          aria-label={`Section actions for ${section.name}`}
          onClick={() => setMenuFor((cur) => (cur === `section:${section.id}` ? null : `section:${section.id}`))}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          ⋯
        </button>
        {menuFor === `section:${section.id}` && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
            <div className="absolute right-3 z-20 mt-1 w-40 glass-strong animate-menu-in overflow-hidden rounded-2xl">
              <RowAction icon={<Pencil size={14} />} label="Rename" onClick={() => { setMenuFor(null); props.onEditSection(section); }} />
              <RowAction icon={<Trash2 size={14} />} label="Delete section" danger onClick={() => { setMenuFor(null); setConfirmDelete({ kind: 'section', id: section.id, name: section.name }); }} />
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className={cn('relative flex h-full min-h-0 flex-col', className)}>
      {/* Header: brand + search + new */}
      <div className="shrink-0 px-3 pt-3">
        <div className="flex items-center gap-2">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl border bg-background/55"
            style={profile ? { borderColor: `color-mix(in srgb, ${profile.color} 35%, transparent)` } : undefined}
          >
            <KorgeLogo size={22} />
          </span>
          {props.headerSlot ? (
            <div className="min-w-0 flex-1">{props.headerSlot}</div>
          ) : (
            <span className="t-title min-w-0 flex-1 truncate">
              Korg-e Bot
            </span>
          )}
          <button
            type="button"
            onClick={props.onOpenTasks}
            aria-label="Open tasks"
            className="tap flex items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground"
            title="Tasks"
          >
            <CheckSquare size={18} />
          </button>
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search bots and groups"
              className="cockpit-input cockpit-input--leading-icon w-full rounded-xl py-2.5 pr-3 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={props.onNewBot}
            aria-label="New bot or group"
            className="shell-icon-button min-h-11 min-w-11 justify-center rounded-xl"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>

      {roster.error && (
        <div className="mx-3 mt-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {roster.error}
        </div>
      )}

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-1">
        {isLoading || roster.loading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading bots… 🐾</div>
        ) : rows.length === 0 && roster.roster.groups.length === 0 ? (
          <div className="px-4 py-10 text-center" data-testid="roster-empty-state">
            <div
              className="mx-auto flex size-14 items-center justify-center rounded-2xl text-3xl"
              style={profile ? { background: `color-mix(in srgb, ${profile.color} 18%, transparent)` } : undefined}
              aria-hidden="true"
            >
              {profile?.emoji ?? '🐶'}
            </div>
            <div className="mt-3 font-medium text-foreground">
              {profile ? `No bots in ${profile.name} yet` : 'No bots yet'}
            </div>
            <p className="mx-auto mt-1 max-w-[24ch] text-sm leading-6 text-muted-foreground">
              {profile
                ? `This profile starts with a clean slate. Add ${profile.name}'s first bot to get going.`
                : 'Tap + to create your first bot, or start a group.'}
            </p>
            <button
              type="button"
              onClick={props.onNewBot}
              className="shell-chip mt-4 min-h-9 gap-1.5 px-3 text-sm font-semibold"
              data-active="true"
            >
              <Plus size={15} aria-hidden="true" /> Add the first bot
            </button>
          </div>
        ) : (
          <>
            {visibleGroups.length > 0 && (
              <div className="px-2 pt-2 text-2xs font-bold text-muted-foreground/80">
                Groups
              </div>
            )}
            {visibleGroups.map((g) => (
              <GroupRow
                key={g.id}
                group={g}
                botById={botById}
                roster={roster}
                busyState={busyState}
                unreadSessions={unreadSessions}
                onJump={onSelect}
                onOpenChat={props.onOpenGroupChat}
                collapsed={collapsedGroups[g.id] ?? false}
                onToggleCollapsed={() => setCollapsedGroups((prev) => {
                  const next = { ...prev, [g.id]: !(prev[g.id] ?? false) };
                  writeCollapsedMap(COLLAPSED_GROUPS_KEY, next);
                  return next;
                })}
                onEdit={() => props.onEditGroup(g)}
                onDelete={() => setConfirmDelete({ kind: 'group', id: g.id, name: g.name })}
              />
            ))}

            {filterRows(pinnedRows).length > 0 && (
              <div className="px-2 pt-2 text-2xs font-bold text-muted-foreground/80">
                Pinned
              </div>
            )}
            {filterRows(pinnedRows).map(renderBotRow)}

            {sections.map((section) => {
              const sectionRows = filterRows(unpinnedRows).filter((r) => r.bot?.sectionId === section.id);
              if (sectionRows.length === 0) return null;
              return (
                <div key={section.id}>
                  {renderSectionHeader(section, sectionRows.length)}
                  {!(collapsedSections[section.id] ?? false) && sectionRows.map(renderBotRow)}
                </div>
              );
            })}

            {(() => {
              const unassignedRows = filterRows(unpinnedRows).filter((r) => !r.bot?.sectionId || !sections.some((s) => s.id === r.bot?.sectionId));
              if (unassignedRows.length === 0) return null;
              const collapsed = collapsedSections['__unassigned'] ?? false;
              return (
                <div>
                  <div className="group/sec flex items-center gap-1 px-2 pt-2.5">
                    <button
                      type="button"
                      onClick={() => setCollapsedSections((prev) => {
                        const next = { ...prev, __unassigned: !collapsed };
                        writeCollapsedMap(COLLAPSED_SECTIONS_KEY, next);
                        return next;
                      })}
                      className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-2xs font-bold text-muted-foreground/80"
                      aria-expanded={!collapsed}
                    >
                      {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      <span className="truncate">Unassigned</span>
                      <span className="text-muted-foreground/50">{unassignedRows.length}</span>
                    </button>
                  </div>
                  {!collapsed && unassignedRows.map(renderBotRow)}
                </div>
              );
            })()}

            <button
              type="button"
              onClick={props.onNewGroup}
              className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-3 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Users size={15} /> New group chat
            </button>

            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowHidden((v) => !v)}
                className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-3 text-sm text-muted-foreground hover:bg-secondary"
              >
                <Eye size={15} /> {showHidden ? 'Hide hidden chats' : `Show ${hiddenCount} hidden`}
              </button>
            )}
          </>
        )}
      </div>

      {/* Delete confirm (portaled: backdrop-filter ancestors break position:fixed) */}
      {confirmDelete && createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Confirm delete">
          <div className="shell-panel w-full max-w-sm rounded-3xl p-5">
            <h3 className="text-base font-semibold">Remove {confirmDelete.kind} “{confirmDelete.name}”?</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {confirmDelete.kind === 'bot'
                ? 'The profile leaves the pack. Its conversation history stays on the gateway until you delete the session.'
                : confirmDelete.kind === 'section'
                  ? 'Bots in this section move to Unassigned. Nothing is deleted.'
                  : 'Members keep their own conversations. This only removes the group.'}
            </p>
            <div className="mt-4 flex gap-2">
              <button type="button" className="cockpit-toolbar-button flex-1 justify-center" onClick={() => setConfirmDelete(null)}>
                Keep
              </button>
              <button
                type="button"
                className="cockpit-toolbar-button flex-1 justify-center"
                data-tone="danger"
                onClick={() => {
                  const target = confirmDelete;
                  setConfirmDelete(null);
                  if (target.kind === 'bot') void roster.deleteBot(target.id);
                  else if (target.kind === 'group') void roster.deleteGroup(target.id);
                  else void roster.deleteSection(target.id);
                }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function BotRow(props: {
  label: string;
  bot?: RosterBot;
  sessionKey?: string;
  time: number;
  active: boolean;
  busy: boolean;
  unread: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onSelect: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  sections: RosterSection[];
  roster: RosterApi;
  onEdit: () => void;
  onDelete: () => void;
  onNewProfile: () => void;
}) {
  const {
    label, bot, sessionKey, time, active, busy, unread, menuOpen, onToggleMenu, onCloseMenu,
    onSelect, onMarkRead, onMarkUnread, sections, roster, onEdit, onDelete, onNewProfile,
  } = props;
  const [moveOpen, setMoveOpen] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const needsAttention = unread || busy;

  useEffect(() => () => clearTimeout(pressTimer.current), []);

  const startPress = () => {
    pressTimer.current = setTimeout(() => onToggleMenu(), 450);
  };
  const cancelPress = () => clearTimeout(pressTimer.current);

  return (
    <div className="relative" data-has-menu={menuOpen}>
      <button
        type="button"
        onClick={onSelect}
        onTouchStart={startPress}
        onTouchEnd={cancelPress}
        onTouchMove={cancelPress}
        onContextMenu={(e) => {
          e.preventDefault();
          onToggleMenu();
        }}
        className={cn(
          'pressable flex w-full min-w-0 items-center gap-2.5 rounded-2xl py-2.5 pl-2.5 pr-12 text-left',
          active ? 'bg-secondary' : 'hover:bg-secondary/60',
          unread && !active && 'bg-secondary/40',
        )}
      >
        <span className="relative shrink-0">
          <KorgeAvatar
            name={bot?.id ?? label}
            variant={isCorgiVariant(bot?.avatar) ? bot.avatar : undefined}
            collar={bot?.color}
            size={36}
            state={busy ? 'working' : 'idle'}
          />
          {needsAttention && (
            <span
              className={cn('absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-background', unread ? 'bg-primary' : 'bg-green')}
              aria-label={unread ? 'Needs attention' : 'Working'}
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={cn('min-w-0 flex-1 truncate text-base', unread ? 'font-bold text-foreground' : 'font-semibold text-foreground')}>
              {label}
            </span>
            {bot?.pinned && <Pin size={12} className="shrink-0 text-muted-foreground" aria-label="Pinned" />}
            {/* Working signal — driven by real per-session busy state, so a
                bot only shows paws while the gateway says it is running. */}
            {busy && (
              <WorkingPaws
                size={24}
                seed={bot?.id ?? label}
                className="shrink-0"
                label={`${label} is working`}
              />
            )}
            <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{timeAgo(time)}</span>
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {bot?.title || (busy ? 'Working…' : sessionKey ? 'Idle' : 'No session linked')}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={`${label} actions`}
        aria-expanded={menuOpen}
        onClick={(e) => { e.stopPropagation(); onToggleMenu(); }}
        className="absolute right-1.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
      >
        ⋯
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={onCloseMenu} />
          <div className="absolute right-1 top-full z-20 w-52 glass-strong animate-menu-in overflow-hidden rounded-2xl">
            {bot ? (
              <>
                {sessionKey && (unread
                  ? <RowAction icon={<MailOpen size={14} />} label="Mark as read" onClick={() => { onCloseMenu(); onMarkRead(); }} />
                  : <RowAction icon={<Mail size={14} />} label="Mark as unread" onClick={() => { onCloseMenu(); onMarkUnread(); }} />)}
                <RowAction icon={bot.pinned ? <PinOff size={14} /> : <Pin size={14} />} label={bot.pinned ? 'Unpin' : 'Pin'} onClick={() => { onCloseMenu(); void roster.updateBot(bot.id, { pinned: !bot.pinned }); }} />
                <RowAction icon={bot.hidden ? <Eye size={14} /> : <EyeOff size={14} />} label={bot.hidden ? 'Unhide' : 'Hide'} onClick={() => { onCloseMenu(); void roster.updateBot(bot.id, { hidden: !bot.hidden }); }} />
                <RowAction icon={bot.notifications ? <BellOff size={14} /> : <Bell size={14} />} label={bot.notifications ? 'Mute' : 'Unmute'} onClick={() => { onCloseMenu(); void roster.updateBot(bot.id, { notifications: !bot.notifications }); }} />
                <RowAction icon={<FolderInput size={14} />} label="Move to…" onClick={() => setMoveOpen((v) => !v)} />
                {moveOpen && (
                  <div className="border-y border-border/60 bg-secondary/30 py-1">
                    <RowAction icon={<span className="w-3.5" />} label="Unassigned" onClick={() => { onCloseMenu(); setMoveOpen(false); void roster.moveBotToSection(bot.id, null); }} />
                    {sections.map((s) => (
                      <RowAction key={s.id} icon={<span className="w-3.5" />} label={s.name} onClick={() => { onCloseMenu(); setMoveOpen(false); void roster.moveBotToSection(bot.id, s.id); }} />
                    ))}
                    <RowAction
                      icon={<Plus size={14} />}
                      label="New section…"
                      onClick={() => {
                        const name = window.prompt('Section name');
                        if (name && name.trim()) void roster.createSection(name.trim()).catch(() => undefined);
                        onCloseMenu();
                        setMoveOpen(false);
                      }}
                    />
                  </div>
                )}
                <RowAction icon={<Pencil size={14} />} label="Edit profile" onClick={() => { onCloseMenu(); onEdit(); }} />
                <RowAction icon={<Copy size={14} />} label="Duplicate" onClick={() => { onCloseMenu(); void roster.duplicateBot(bot.id); }} />
                <RowAction icon={<Trash2 size={14} />} label="Delete" danger onClick={() => { onCloseMenu(); onDelete(); }} />
              </>
            ) : (
              <>
                {sessionKey && (unread
                  ? <RowAction icon={<MailOpen size={14} />} label="Mark as read" onClick={() => { onCloseMenu(); onMarkRead(); }} />
                  : <RowAction icon={<Mail size={14} />} label="Mark as unread" onClick={() => { onCloseMenu(); onMarkUnread(); }} />)}
                <RowAction icon={<Plus size={14} />} label="Save as bot profile" onClick={() => { onCloseMenu(); onNewProfile(); }} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function GroupRow(props: {
  group: RosterGroup;
  botById: Map<string, RosterBot>;
  roster: RosterApi;
  busyState: Record<string, boolean>;
  unreadSessions?: Record<string, boolean>;
  onJump: (key: string) => void;
  onOpenChat?: (sessionKey: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const { group, botById, busyState, unreadSessions, onJump, onOpenChat, onEdit, onDelete } = props;
  const [localExpanded, setLocalExpanded] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const expanded = props.collapsed === undefined ? localExpanded : !props.collapsed;
  const setExpanded = (update: (v: boolean) => boolean) => {
    if (props.collapsed === undefined) setLocalExpanded(update);
    else props.onToggleCollapsed?.();
  };  const members = group.memberBotIds.map((id) => botById.get(id)).filter((b): b is RosterBot => !!b);
  const anyBusy = members.some((m) => m.agentId && busyState[m.agentId]);
  const anyUnread = members.some((m) => m.agentId && unreadSessions?.[m.agentId]);

  return (
    <div className="rounded-2xl border border-border/60 bg-card/40">
      <div className="relative flex w-full items-center gap-2 px-2.5 py-2.5">
        <button
          type="button"
          onClick={() => {
            const alpha = group.alphaBotId ? botById.get(group.alphaBotId) : undefined;
            if (alpha?.agentId && onOpenChat) onOpenChat(alpha.agentId);
            else setExpanded((v) => !v);
          }}
          className="pressable flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <span className="flex shrink-0 -space-x-2">
            {members.slice(0, 3).map((m) => (
              <KorgeAvatar key={m.id} name={m.id} variant={isCorgiVariant(m.avatar) ? m.avatar : undefined} collar={m.color} size={28} state={m.agentId && busyState[m.agentId] ? 'working' : 'idle'} />
            ))}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold text-foreground">{group.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {members.length} bots{group.alphaBotId ? ' · Alpha' : ''}{anyBusy ? ' · working…' : ''}{anyUnread ? ' · new activity' : ''}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={`${group.name} members`}
          aria-expanded={expanded}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <button
          type="button"
          aria-label={`Group actions for ${group.name}`}
          aria-expanded={actionsOpen}
          onClick={() => setActionsOpen((v) => !v)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          ⋯
        </button>
        {actionsOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setActionsOpen(false)} />
            <div className="absolute right-1 top-full z-20 w-48 glass-strong animate-menu-in overflow-hidden rounded-2xl">
              <RowAction icon={group.pinned ? <PinOff size={14} /> : <Pin size={14} />} label={group.pinned ? 'Unpin' : 'Pin'} onClick={() => { setActionsOpen(false); void props.roster.updateGroup(group.id, { pinned: !group.pinned }); }} />
              <RowAction icon={group.hidden ? <Eye size={14} /> : <EyeOff size={14} />} label={group.hidden ? 'Unhide' : 'Hide'} onClick={() => { setActionsOpen(false); void props.roster.updateGroup(group.id, { hidden: !group.hidden }); }} />
              <RowAction icon={<Pencil size={14} />} label="Edit group" onClick={() => { setActionsOpen(false); onEdit(); }} />
              <RowAction icon={<Trash2 size={14} />} label="Delete group" danger onClick={() => { setActionsOpen(false); onDelete(); }} />
            </div>
          </>
        )}
      </div>
      {expanded && (
        <div className="border-t border-border/50 px-2 py-1">
          {members.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => m.agentId && onJump(m.agentId)}
              className="flex w-full items-center gap-2 rounded-xl px-2 py-2.5 text-left text-sm hover:bg-secondary/60"
            >
              <KorgeAvatar name={m.id} variant={isCorgiVariant(m.avatar) ? m.avatar : undefined} collar={m.color} size={26} state={m.agentId && busyState[m.agentId] ? 'working' : 'idle'} />
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              <span className="text-xs text-muted-foreground">{m.agentId ? 'open →' : 'unlinked'}</span>
            </button>
          ))}
          {members.length === 0 && <div className="px-2 py-2 text-xs text-muted-foreground">All members removed.</div>}
        </div>
      )}
    </div>
  );
}

function RowAction(props: { icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-3 text-left text-sm hover:bg-secondary',
        props.danger ? 'text-destructive' : 'text-foreground',
      )}
    >
      {props.icon} {props.label}
    </button>
  );
}