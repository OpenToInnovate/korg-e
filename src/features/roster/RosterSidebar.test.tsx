import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RosterSidebar } from './RosterSidebar';
import { ProfileSwitcher } from '@/features/profiles/ProfileSwitcher';
import type { ProfilesApi, Profile } from '@/features/profiles/useProfiles';
import type { RosterApi } from './useRoster';
import type { RosterBot, RosterData, RosterGroup, RosterSection } from './types';

vi.mock('@/contexts/SessionContext', () => ({
  useSessionContext: () => ({ markSessionRead: vi.fn(), markSessionUnread: vi.fn() }),
}));

const PROFILE: Profile = { id: 'p1', name: 'Sam', color: '#0A84FF', emoji: '🐺', order: 0, createdAt: 1 };

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

function makeRosterApi(data: Partial<RosterData> = {}, ownedAgentIds: string[] = []): RosterApi {
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
 * PRIVACY REGRESSION — Mir's profile must never render the adult profile's
 * agents. Live bug: orphan session rows (no roster bot record) were swept into
 * the Unassigned bucket, exposing all 19 adult agents under Mir's profile.
 */
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
