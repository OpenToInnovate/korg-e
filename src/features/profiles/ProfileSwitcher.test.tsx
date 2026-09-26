import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ProfileSwitcher } from './ProfileSwitcher';
import { useProfiles, type Profile } from './useProfiles';
import { useSessionContext } from '@/contexts/SessionContext';

vi.mock('@/contexts/SessionContext', () => ({
  useSessionContext: () => ({ markSessionRead: vi.fn(), markSessionUnread: vi.fn() }),
}));

const PROFILE_A: Profile = { id: 'p1', name: 'Sam', color: '#0A84FF', emoji: null, order: 0, createdAt: 1 };
const PROFILE_B: Profile = { id: 'p2', name: 'Alex', color: '#30D158', emoji: '🐺', order: 1, createdAt: 2 };

type FetchCall = { url: string; init?: RequestInit };

function jsonRes(data: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => (data === undefined ? '' : JSON.stringify(data)),
  } as unknown as Response;
}

function Harness({ onProfileActivated }: { onProfileActivated?: () => void | Promise<void> }) {
  const profiles = useProfiles({ onProfileActivated });
  return <ProfileSwitcher profiles={profiles} />;
}

describe('ProfileSwitcher', () => {
  let calls: FetchCall[];

  beforeEach(() => { calls = []; });

  afterEach(() => { vi.restoreAllMocks(); });

  function mockFetch(handler: (call: FetchCall) => Response) {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      return handler(call);
    }));
  }

  async function renderSwitcher(handler: (call: FetchCall) => Response, opts: { onProfileActivated?: () => void } = {}) {
    mockFetch(handler);
    render(<Harness onProfileActivated={opts.onProfileActivated} />);
    await waitFor(() => expect(screen.getByTestId('profile-switcher-trigger')).not.toBeDisabled());
  }

  const defaultHandler = (call: FetchCall) => {
    if (call.url === '/api/profiles' && (!call.init || call.init.method === undefined)) {
      return jsonRes({ profiles: [PROFILE_A, PROFILE_B], activeProfileId: 'p1' });
    }
    if (call.url === '/api/profiles/activate') return jsonRes({ ok: true, activeProfileId: 'p2' });
    if (call.url === '/api/profiles' && call.init?.method === 'POST') {
      return jsonRes({ id: 'p3', name: 'Robin', color: '#FF9F0A', emoji: '🦊', order: 2, createdAt: 3 });
    }
    if (call.url.startsWith('/api/profiles/') && call.init?.method === 'DELETE') {
      return jsonRes({ error: 'last profile' }, { ok: false, status: 409 });
    }
    if (call.url.startsWith('/api/profiles/') && call.init?.method === 'PATCH') {
      return jsonRes({ ...PROFILE_A, name: 'Samantha' });
    }
    return jsonRes({ error: 'unexpected' }, { ok: false, status: 500 });
  };

  it('shows the active profile name on the trigger', async () => {
    await renderSwitcher(defaultHandler);
    const trigger = screen.getByTestId('profile-switcher-trigger');
    expect(trigger).toHaveTextContent('Sam');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('lists every profile and marks the active one', async () => {
    await renderSwitcher(defaultHandler);
    fireEvent.click(screen.getByTestId('profile-switcher-trigger'));

    const menu = await screen.findByTestId('profile-switcher-menu');
    expect(menu).toBeInTheDocument();
    expect(screen.getByTestId('profile-row-p1')).toHaveTextContent('Sam');
    expect(screen.getByTestId('profile-row-p2')).toHaveTextContent('Alex');
    expect(screen.getByTestId('profile-row-p1')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('profile-row-p2')).toHaveAttribute('aria-current', 'false');
  });

  it('switches profile, closes the menu, and tells the host to wipe state', async () => {
    const onProfileActivated = vi.fn();
    await renderSwitcher(defaultHandler, { onProfileActivated });

    fireEvent.click(screen.getByTestId('profile-switcher-trigger'));
    fireEvent.click(await screen.findByTestId('profile-row-p2'));

    await waitFor(() => expect(onProfileActivated).toHaveBeenCalledWith('p2'));
    await waitFor(() => expect(screen.queryByTestId('profile-switcher-menu')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('profile-switcher-trigger')).toHaveTextContent('Alex'));
  });

  it('does not re-activate the profile that is already active', async () => {
    const onProfileActivated = vi.fn();
    await renderSwitcher(defaultHandler, { onProfileActivated });

    fireEvent.click(screen.getByTestId('profile-switcher-trigger'));
    fireEvent.click(await screen.findByTestId('profile-row-p1'));

    await waitFor(() => expect(screen.queryByTestId('profile-switcher-menu')).not.toBeInTheDocument());
    expect(calls.filter((c) => c.url === '/api/profiles/activate')).toHaveLength(0);
    expect(onProfileActivated).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    await renderSwitcher(defaultHandler);
    fireEvent.click(screen.getByTestId('profile-switcher-trigger'));
    await screen.findByTestId('profile-switcher-menu');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('profile-switcher-menu')).not.toBeInTheDocument());
  });

  it('renames a profile inline', async () => {
    await renderSwitcher(defaultHandler);
    fireEvent.click(screen.getByTestId('profile-switcher-trigger'));

    fireEvent.click(await screen.findByRole('button', { name: 'Rename Alex' }));
    const input = screen.getByLabelText('Rename Alex');
    fireEvent.change(input, { target: { value: 'Alexandra' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      const patch = calls.find((c) => c.init?.method === 'PATCH');
      expect(patch && JSON.parse(String(patch.init?.body))).toEqual({ name: 'Alexandra' });
    });
  });

  it('asks for confirmation before deleting', async () => {
    await renderSwitcher(defaultHandler);
    fireEvent.click(screen.getByTestId('profile-switcher-trigger'));

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Alex' }));
    const confirm = await screen.findByTestId('profile-confirm-p2');
    expect(confirm).toHaveTextContent(/Remove/);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(true));
  });

  it('shows a friendly inline message when the server refuses (409 last profile)', async () => {
    await renderSwitcher(defaultHandler);
    fireEvent.click(screen.getByTestId('profile-switcher-trigger'));

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Alex' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    const alert = await screen.findByTestId('profile-menu-error');
    expect(alert).toHaveTextContent(/at least one profile/i);
    // No raw HTTP jargon.
    expect(alert).not.toHaveTextContent(/409/);
  });

  it('creates a profile through the dialog', async () => {
    await renderSwitcher(defaultHandler);
    fireEvent.click(screen.getByTestId('profile-switcher-trigger'));
    fireEvent.click(await screen.findByTestId('profile-new'));

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Robin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Icon 🦊' }));
    fireEvent.click(screen.getByRole('button', { name: 'Color #FF9F0A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      const post = calls.find((c) => c.init?.method === 'POST');
      expect(post && JSON.parse(String(post.init?.body))).toEqual({ name: 'Robin', color: '#FF9F0A', emoji: '🦊' });
    });
  });

  it('rejects a blank profile name inline', async () => {
    await renderSwitcher(defaultHandler);
    fireEvent.click(screen.getByTestId('profile-switcher-trigger'));
    fireEvent.click(await screen.findByTestId('profile-new'));

    fireEvent.click(await screen.findByRole('button', { name: 'Create' }));

    expect(await screen.findByTestId('profile-create-error')).toHaveTextContent(/name/i);
    expect(calls.filter((c) => c.init?.method === 'POST')).toHaveLength(0);
  });
});
