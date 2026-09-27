import { describe, it, expect, vi } from 'vitest';
import { createBotWithAgent, type BotProvisioningApi } from './createBotWithAgent';
import type { RosterBot } from './types';

function makeBot(over: Partial<RosterBot> = {}): RosterBot {
  return {
    id: 'b1', agentId: 'agent:builder:main', sectionId: null, avatar: 'classic', name: 'Builder',
    title: '', description: '', color: '#0A84FF', pinned: false, hidden: false,
    notifications: false, enabledSkills: [], createdAt: 1, updatedAt: 1,
    ...over,
  };
}

function makeApi(over: Partial<BotProvisioningApi> = {}) {
  // Merge first, then hand back the EFFECTIVE mocks, so a test that passes an
  // override and then asserts on it is looking at the function actually used.
  const api: BotProvisioningApi = {
    provisionBot: vi.fn(async () => ({ bot: makeBot({ id: 'b1' }), sessionKey: 'agent:builder:main' })),
    createBot: vi.fn(async () => makeBot({ id: 'row-1', agentId: null })),
    linkBotAgent: vi.fn(async () => ({ bot: makeBot({ id: 'row-1' }), sessionKey: 'agent:designer:main' })),
    updateBot: vi.fn(async () => ({ ok: true })),
    deleteBot: vi.fn(async () => ({ ok: true })),
    ...over,
  };
  return { api, ...(api as unknown as Record<string, ReturnType<typeof vi.fn>>) };
}

describe('createBotWithAgent — create a new agent (atomic provision)', () => {
  it('uses the provision endpoint, which creates the agent AND the row in one call', async () => {
    const { api, provisionBot, createBot } = makeApi();
    await createBotWithAgent({ roster: api, values: { name: 'Builder' }, profileId: 'p1' });

    expect(provisionBot).toHaveBeenCalledTimes(1);
    expect(provisionBot).toHaveBeenCalledWith(expect.objectContaining({ name: 'Builder' }));
    // No separate row creation: the server does it atomically.
    expect(createBot).not.toHaveBeenCalled();
  });

  it('omits agentId so the server derives the slug itself', async () => {
    const { api, provisionBot } = makeApi();
    await createBotWithAgent({ roster: api, values: { name: 'Bot Maintainer' }, profileId: 'p1' });

    const input = provisionBot.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.agentId).toBeNull();
  });

  it('forwards a pre-chosen agentId as a bare id when the user supplied one', async () => {
    const { api, provisionBot } = makeApi();
    await createBotWithAgent({
      roster: api,
      values: { name: 'Builder', agentId: 'agent:custom-id:main' },
      profileId: 'p1',
    });
    expect((provisionBot.mock.calls[0]?.[0] as Record<string, unknown>).agentId).toBe('custom-id');
  });

  it('returns a bot whose agentId is a FULL session key', async () => {
    const { api } = makeApi({
      // A bare id from the server must never reach storage.
      provisionBot: vi.fn(async () => ({ bot: makeBot({ agentId: 'builder' }), sessionKey: 'builder' })),
    });
    const bot = await createBotWithAgent({ roster: api, values: { name: 'Builder' }, profileId: 'p1' });
    expect(bot.agentId).toBe('agent:builder:main');
  });

  it('never sends a client-asserted profile id — the server owns the binding', async () => {
    const { api, provisionBot } = makeApi();
    await createBotWithAgent({ roster: api, values: { name: 'Builder' }, profileId: 'p1' });
    expect(Object.keys(provisionBot.mock.calls[0]?.[0] as object)).not.toContain('profileId');
  });

  it('applies enabledSkills with a follow-up PATCH (provision has no such field)', async () => {
    const { api, updateBot } = makeApi();
    await createBotWithAgent({
      roster: api,
      values: { name: 'Builder', enabledSkills: ['kanban'] },
      profileId: 'p1',
    });
    expect(updateBot).toHaveBeenCalledWith('b1', { enabledSkills: ['kanban'] });
  });

  it('skips the PATCH when there are no skills', async () => {
    const { api, updateBot } = makeApi();
    await createBotWithAgent({ roster: api, values: { name: 'Builder' }, profileId: 'p1' });
    expect(updateBot).not.toHaveBeenCalled();
  });

  it('does not delete a working bot if only the skills PATCH fails', async () => {
    const { api, deleteBot } = makeApi({
      updateBot: vi.fn(async () => { throw new Error('patch failed'); }),
    });
    const bot = await createBotWithAgent({
      roster: api,
      values: { name: 'Builder', enabledSkills: ['kanban'] },
      profileId: 'p1',
    });
    expect(bot.agentId).toBe('agent:builder:main');
    expect(deleteBot).not.toHaveBeenCalled();
  });

  it('surfaces the real provisioning reason and creates nothing', async () => {
    const { api, createBot } = makeApi({
      provisionBot: vi.fn(async () => { throw new Error('Agent already exists: builder'); }),
    });
    await expect(
      createBotWithAgent({ roster: api, values: { name: 'Builder' }, profileId: 'p1' }),
    ).rejects.toThrow('Agent already exists: builder');
    expect(createBot).not.toHaveBeenCalled();
  });
});

describe('createBotWithAgent — link an existing agent', () => {
  it('creates the row, then links it (the only link path the server implements)', async () => {
    const order: string[] = [];
    const { api, createBot, linkBotAgent, provisionBot } = makeApi({
      createBot: vi.fn(async () => { order.push('create'); return makeBot({ id: 'row-1', agentId: null }); }),
      linkBotAgent: vi.fn(async () => { order.push('link'); return { bot: makeBot({ id: 'row-1' }), sessionKey: 'agent:designer:main' }; }),
    });

    const bot = await createBotWithAgent({
      roster: api,
      values: { name: 'Builder', agentMode: 'link', agentId: 'designer' },
      profileId: 'p1',
    });

    expect(order).toEqual(['create', 'link']);
    expect(provisionBot).not.toHaveBeenCalled();
    // The row's own id addresses the link endpoint.
    expect(linkBotAgent).toHaveBeenCalledWith({ botId: 'row-1', agentId: 'designer' });
    expect(bot.agentId).toBe('agent:designer:main');
  });

  it('normalises a full session key down to a bare id for the link call', async () => {
    const { api, linkBotAgent } = makeApi();
    await createBotWithAgent({
      roster: api,
      values: { name: 'Builder', agentMode: 'link', agentId: 'agent:designer:main' },
      profileId: 'p1',
    });
    expect(linkBotAgent).toHaveBeenCalledWith({ botId: 'row-1', agentId: 'designer' });
  });

  it('REGRESSION: a failed link rolls the row back, leaving no shell', async () => {
    const { api, deleteBot } = makeApi({
      linkBotAgent: vi.fn(async () => { throw new Error('That agent already belongs to another profile.'); }),
    });

    await expect(
      createBotWithAgent({
        roster: api,
        values: { name: 'Builder', agentMode: 'link', agentId: 'designer' },
        profileId: 'p1',
      }),
    ).rejects.toThrow(/already belongs to another profile/);

    expect(deleteBot).toHaveBeenCalledWith('row-1', true);
  });

  it('falls back to provision when agentMode is link but no agent was chosen', async () => {
    const { api, provisionBot, linkBotAgent } = makeApi();
    await createBotWithAgent({
      roster: api,
      values: { name: 'Builder', agentMode: 'link', agentId: null },
      profileId: 'p1',
    });
    expect(provisionBot).toHaveBeenCalled();
    expect(linkBotAgent).not.toHaveBeenCalled();
  });
});

describe('createBotWithAgent — guards', () => {
  it('refuses to create a bot with no active profile', async () => {
    const { api, provisionBot, createBot } = makeApi();
    await expect(
      createBotWithAgent({ roster: api, values: { name: 'Builder' }, profileId: null }),
    ).rejects.toThrow(/active profile/i);
    expect(provisionBot).not.toHaveBeenCalled();
    expect(createBot).not.toHaveBeenCalled();
  });

  it('calls onLinked after a successful create', async () => {
    const { api } = makeApi();
    const onLinked = vi.fn();
    await createBotWithAgent({ roster: api, values: { name: 'Builder' }, profileId: 'p1', onLinked });
    expect(onLinked).toHaveBeenCalledTimes(1);
  });
});
