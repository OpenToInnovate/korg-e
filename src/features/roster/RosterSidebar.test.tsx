import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RosterSidebar } from './RosterSidebar';
import { ProfileSwitcher } from '@/features/profiles/ProfileSwitcher';
import type { ProfilesApi, Profile } from '@/features/profiles/useProfiles';
import type { RosterApi } from './useRoster';
import type { RosterBot, RosterData } from './types';

vi.mock('@/contexts/SessionContext', () => ({
  useSessionContext: () => ({ markSessionRead: vi.fn(), markSessionUnread: vi.fn() }),
}));

const PROFILE: Profile = { id: 'p1', name: 'Sam', color: '#0A84FF', emoji: '🐺', order: 0, createdAt: 1 };

function makeBot(over: Partial<RosterBot> = {}): RosterBot {
  return {
    id: 'b1', agentId: 'agent:builder:main', sectionId: null, avatar: '', name: 'Builder',
    title: '', description: '', color: '#0A84FF', pinned: false, hidden: false,
    notifications: false, enabledSkills: [], createdAt: 1, updatedAt: 1,
    ...over,
  };
}

/** Minimal real ProfilesApi — the switcher reads the whole list for its menu. */
function makeProfilesApi(): ProfilesApi {
  return {
    profiles: [PROFILE],
    activeProfile: PROFILE,
    activeProfileId: PROFILE.id,
    loading: false,
    switching: false,
    error: null,
    refresh: vi.fn(async () => undefined),
    createProfile: vi.fn(),
    updateProfile: vi.fn(),
    deleteProfile: vi.fn(),
    activateProfile: vi.fn(async () => undefined),
  } as unknown as ProfilesApi;
}

function makeRosterApi(data: Partial<RosterData> = {}, ownedAgentIds: string[] = [], access: 'unknown' | 'ok' | 'denied' | 'error' = 'ok'): RosterApi {
  const roster: RosterData = {
    version: 2,
    bots: [],
    groups: [],
    sections: [],
    profileId: PROFILE.id,
    ...data,
  };
  return {
    roster,
    ownedAgentIds,
    access,
    loading: false,
    error: null,
    refresh: vi.fn(async () => undefined),
    clearForProfileSwitch: vi.fn(),
    createBot: vi.fn(),
    updateBot: vi.fn(),
    duplicateBot: vi.fn(),
    deleteBot: vi.fn(),
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
    createSection: vi.fn(),
    renameSection: vi.fn(),
    deleteSection: vi.fn(),
    moveBotToSection: vi.fn(),
    kickoffGroup: vi.fn(),
    chatWithGroup: vi.fn(),
    handoffToBot: vi.fn(),
  } as unknown as RosterApi;
}

function renderSidebar(props: Partial<React.ComponentProps<typeof RosterSidebar>> = {}) {
  return render(
    <RosterSidebar
      sessions={[]}
      currentSession=""
      busyState={{}}
      onSelect={vi.fn()}
      onRefresh={vi.fn()}
      roster={makeRosterApi()}
      onNewBot={vi.fn()}
      onNewGroup={vi.fn()}
      onEditBot={vi.fn()}
      onEditGroup={vi.fn()}
      onEditSection={vi.fn()}
      {...props}
    />,
  );
}

describe('RosterSidebar — profile header slot', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('shows the brand title when no slot is provided (desktop)', () => {
    renderSidebar();
    expect(screen.getByText('Korg-e Bot')).toBeInTheDocument();
  });

  it('replaces the title with the provided slot when given one (mobile)', () => {
    renderSidebar({ headerSlot: <button type="button">switch me</button> });
    expect(screen.getByRole('button', { name: 'switch me' })).toBeInTheDocument();
    // Exactly one leading element — no duplicated-looking header.
    expect(screen.queryByText('Korg-e Bot')).not.toBeInTheDocument();
  });

  it('renders a real ProfileSwitcher in the slot', () => {
    renderSidebar({ headerSlot: <ProfileSwitcher profiles={makeProfilesApi()} /> });
    const trigger = screen.getByTestId('profile-switcher-trigger');
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent('Sam');
  });

  it('invites the first bot in an empty profile, naming the profile', () => {
    renderSidebar({ profile: PROFILE });
    const empty = screen.getByTestId('roster-empty-state');
    expect(empty).toHaveTextContent(/No bots in Sam yet/);
    expect(empty).toHaveTextContent(/first bot/i);
    expect(screen.getByRole('button', { name: /Add the first bot/i })).toBeInTheDocument();
  });

  it('falls back to the generic empty state with no profile', () => {
    renderSidebar();
    expect(screen.getByTestId('roster-empty-state')).toHaveTextContent(/No bots yet/);
  });
});

/**
 * The working signal must be visible in the roster so Tony can see which bot
 * is busy without opening it.
 */
describe('RosterSidebar — busy bot working signal', () => {
  it('shows animated paws on a busy bot row', () => {
    renderSidebar({
      roster: makeRosterApi({ bots: [makeBot({ name: 'Builder' })] }, ['builder']),
      busyState: { 'agent:builder:main': true },
    });

    const signal = screen.getByTestId('working-paws');
    expect(signal).toBeInTheDocument();
    expect(signal).toHaveAttribute('data-motion', 'animated');
    expect(screen.getByLabelText('Builder is working')).toBeInTheDocument();
  });

  it('shows no signal on an idle bot', () => {
    renderSidebar({
      roster: makeRosterApi({ bots: [makeBot({ name: 'Builder' })] }, ['builder']),
      busyState: {},
    });

    expect(screen.getByText('Builder')).toBeInTheDocument();
    expect(screen.queryByTestId('working-paws')).toBeNull();
  });

  it('clears the signal once the bot stops being busy', () => {
    const { rerender } = renderSidebar({
      roster: makeRosterApi({ bots: [makeBot({ name: 'Builder' })] }, ['builder']),
      busyState: { 'agent:builder:main': true },
    });
    expect(screen.getByTestId('working-paws')).toBeInTheDocument();

    rerender(
      <RosterSidebar
        sessions={[]}
        currentSession=""
        busyState={{}}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        roster={makeRosterApi({ bots: [makeBot({ name: 'Builder' })] }, ['builder'])}
        onNewBot={vi.fn()}
        onNewGroup={vi.fn()}
        onEditBot={vi.fn()}
        onEditGroup={vi.fn()}
        onEditSection={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('working-paws')).toBeNull();
  });
});
describe('RosterSidebar — cross-profile agent isolation', () => {
  const ADULT = { sessionKey: 'agent:adult-agent:main', label: 'Adult Agent' };
  const MINE = { sessionKey: 'agent:mir-tutor:main', label: 'Mir Tutor' };

  it('drops a session row whose agent is not owned by the active profile', () => {
    const { container } = renderSidebar({
      sessions: [ADULT, MINE],
      roster: makeRosterApi({}, ['mir-tutor', 'agent:mir-tutor:main']),
    });

    // The adult agent's name must appear NOWHERE — not as a row, not greyed
    // out, not under Unassigned, not in any attribute or menu.
    expect(screen.queryByText('Adult Agent')).toBeNull();
    expect(container.textContent ?? '').not.toContain('Adult Agent');
    expect(document.body.textContent ?? '').not.toContain('Adult Agent');

    // Mir's own agent still renders.
    expect(screen.getByText('Mir Tutor')).toBeInTheDocument();
  });

  it('still renders a genuine roster bot with no section under Unassigned', () => {
    const unassignedBot = {
      id: 'b9', agentId: null, sectionId: null, avatar: '', name: 'Mir Loose Bot',
      title: '', description: '', color: '#0A84FF', pinned: false, hidden: false,
      notifications: false, enabledSkills: [], createdAt: 1, updatedAt: 1,
    };
    renderSidebar({
      sessions: [ADULT],
      roster: makeRosterApi({ bots: [unassignedBot] }, ['mir-tutor']),
    });

    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByText('Mir Loose Bot')).toBeInTheDocument();
    // The unowned adult agent is still nowhere.
    expect(document.body.textContent ?? '').not.toContain('Adult Agent');
  });

  it('fails closed: no ownership data means no bare session rows at all', () => {
    renderSidebar({ sessions: [ADULT, MINE], roster: makeRosterApi({}, []) });

    expect(document.body.textContent ?? '').not.toContain('Adult Agent');
    expect(document.body.textContent ?? '').not.toContain('Mir Tutor');
  });

  it('matches ownership by bare agent id alone (no full session key needed)', () => {
    renderSidebar({ sessions: [ADULT, MINE], roster: makeRosterApi({}, ['mir-tutor']) });
    expect(screen.getByText('Mir Tutor')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain('Adult Agent');
  });
});

/**
 * A roster row with no backing agent used to render like a normal, working
 * bot — Tony could see "Bot Maintainer" but could never open it. It must read
 * as incomplete, and offer a way to link an agent.
 */
describe('RosterSidebar — unlinked (shell) bots', () => {
  const GHOST = makeBot({ id: 'ghost', name: 'Bot Maintainer', agentId: null });

  it('renders a bot with no agent as unlinked, not as a working bot', () => {
    renderSidebar({ roster: makeRosterApi({ bots: [GHOST] }, ['mir-tutor']) });

    expect(screen.getByText('Bot Maintainer')).toBeInTheDocument();
    expect(screen.getByText(/Not linked — add an agent to use this bot/)).toBeInTheDocument();

    const row = document.querySelector('[data-unlinked="true"]');
    expect(row).not.toBeNull();
    // It must not masquerade as busy/working.
    expect(screen.queryByTestId('working-paws')).toBeNull();
  });

  it('offers a link action from the row menu', () => {
    renderSidebar({ roster: makeRosterApi({ bots: [GHOST] }, ['mir-tutor']) });

    fireEvent.click(screen.getByRole('button', { name: 'Bot Maintainer actions' }));
    expect(screen.getByRole('button', { name: /Link an agent/ })).toBeInTheDocument();
  });

  it('a linked bot is NOT marked unlinked and shows no link action', () => {
    const linked = makeBot({ id: 'ok', name: 'Builder', agentId: 'agent:builder:main' });
    renderSidebar({ roster: makeRosterApi({ bots: [linked] }, ['builder']) });

    expect(document.querySelector('[data-unlinked="true"]')).toBeNull();
    expect(screen.getByText('Builder')).toBeInTheDocument();
  });

  it('normalises a legacy bare agent id so the row can still open', () => {
    // Rows created before the fix stored `builder` instead of
    // `agent:builder:main`; they must still resolve to a session.
    const legacy = makeBot({ id: 'legacy', name: 'Legacy', agentId: 'builder' });
    renderSidebar({ roster: makeRosterApi({ bots: [legacy] }, ['builder']) });

    expect(document.querySelector('[data-unlinked="true"]')).toBeNull();
    expect(screen.queryByText(/Not linked/)).toBeNull();
  });
});

/**
 * A refusal must never read as "this profile has no bots". The UI has to say
 * the server denied access, loudly, instead of rendering an empty list.
 */
describe('RosterSidebar — access refusal surfacing', () => {
  it('renders a visible denial panel, not the empty state', () => {
    renderSidebar({ roster: makeRosterApi({}, [], 'denied') });

    const denied = screen.getByTestId('roster-access-denied');
    expect(denied).toBeInTheDocument();
    expect(denied).toHaveAttribute('role', 'alert');
    expect(denied).toHaveTextContent(/no access to this profile/i);
    // Crucially: NOT the "no bots yet" empty state.
    expect(screen.queryByTestId('roster-empty-state')).toBeNull();
  });

  it('does not leak any previous profile data while denied', () => {
    renderSidebar({
      roster: makeRosterApi({ bots: [makeBot({ name: 'Mir Bot' })] }, [], 'denied'),
    });

    expect(screen.getByTestId('roster-access-denied')).toBeInTheDocument();
    expect(screen.queryByText('Mir Bot')).toBeNull();
  });

  it('offers a retry so a refused profile is recoverable', () => {
    renderSidebar({ roster: makeRosterApi({}, [], 'denied') });
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('a genuinely empty profile still shows the empty state (denial is distinct)', () => {
    renderSidebar({ roster: makeRosterApi({}, [], 'ok') });
    expect(screen.getByTestId('roster-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('roster-access-denied')).toBeNull();
  });
});
