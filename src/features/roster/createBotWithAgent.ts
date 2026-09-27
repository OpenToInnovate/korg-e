/**
 * createBotWithAgent — create a roster bot that is actually usable.
 *
 * A roster row with no backing gateway agent renders fine but resolves to no
 * session, so it can never be selected or messaged (the "shell bot" bug).
 *
 * Two real server paths, and only two:
 *
 *  1. Create a new agent — `POST /api/roster/bots/provision`. The server
 *     provisions the agent AND creates the row in one call, so this path is
 *     atomic and needs no rollback.
 *  2. Link an existing agent — `POST /api/roster/bots/:id/link`, which needs a
 *     bot row to already exist. `provision` cannot take an existing agent,
 *     because `provisionAgent()` refuses an id that is already registered. So
 *     linking at creation time is: create the row, then link it, rolling the
 *     row back if the link fails.
 *
 * Either way the stored `agentId` is a full session key `agent:<id>:main`.
 * @module
 */
import { toAgentSessionKey, toBareAgentId } from '@/features/profiles/agentKeys';
import type { RosterBot } from './types';

/**
 * Guarantee the returned row carries a FULL session key. Normalisation also
 * happens in the API layer, but doing it here means the invariant holds for
 * every caller regardless of which layer produced the value.
 */
function withSessionKey(bot: RosterBot, sessionKey?: string): RosterBot {
  const key = toAgentSessionKey(sessionKey || bot.agentId);
  return key ? { ...bot, agentId: key } : bot;
}

/** The subset of the roster API this flow needs. */
export interface BotProvisioningApi {
  /** POST /api/roster/bots/provision — agent + row, atomically. */
  provisionBot: (input: {
    name: string;
    agentId?: string | null;
    title?: string;
    description?: string;
    color?: string;
    avatar?: string;
    sectionId?: string | null;
    emoji?: string | null;
  }) => Promise<{ bot: RosterBot; sessionKey: string }>;
  /** POST /api/roster/bots — row only, no agent. Used as step 1 of linking. */
  createBot: (input: {
    name: string;
    title?: string;
    description?: string;
    color?: string;
    avatar?: string;
    enabledSkills?: string[];
  }) => Promise<RosterBot>;
  /** POST /api/roster/bots/:id/link — bind an existing agent to a row. */
  linkBotAgent: (input: { botId: string; agentId: string }) => Promise<{ bot: RosterBot; sessionKey: string }>;
  /** PATCH /api/roster/bots/:id — `provision` has no enabledSkills field. */
  updateBot: (id: string, patch: { enabledSkills?: string[] }) => Promise<unknown>;
  deleteBot: (id: string, deleteRoutines?: boolean) => Promise<unknown>;
}

/** The bot form's values, reduced to what this flow consumes. */
export interface CreateBotValues {
  name: string;
  title?: string;
  description?: string;
  color?: string;
  avatar?: string;
  sectionId?: string | null;
  agentId?: string | null;
  agentMode?: 'create' | 'link';
  enabledSkills?: string[];
}

export interface CreateBotOptions {
  roster: BotProvisioningApi;
  values: CreateBotValues;
  /**
   * The active profile. Only used as a guard: the server derives the profile
   * from its own session binding, so we never send a client-asserted id.
   */
  profileId: string | null;
  /** Called after a successful create so the new session can appear. */
  onLinked?: () => void | Promise<void>;
}

export async function createBotWithAgent({
  roster,
  values,
  profileId,
  onLinked,
}: CreateBotOptions): Promise<RosterBot> {
  if (!profileId) {
    throw new Error('No active profile — pick a profile before adding a bot.');
  }

  const skills = values.enabledSkills ?? [];

  // Path 2: link an agent that already exists.
  if (values.agentMode === 'link' && values.agentId) {
    // Create the row first — the link endpoint needs a row id.
    const row = await roster.createBot({
      name: values.name,
      title: values.title,
      description: values.description,
      color: values.color,
      avatar: values.avatar,
      enabledSkills: skills,
    });
    try {
      const { bot, sessionKey } = await roster.linkBotAgent({
        botId: row.id,
        agentId: toBareAgentId(values.agentId),
      });
      await onLinked?.();
      return withSessionKey(bot, sessionKey);
    } catch (err) {
      // Never leave a shell behind if the link fails.
      await roster.deleteBot(row.id, true).catch(() => undefined);
      throw err;
    }
  }

  // Path 1: provision a brand-new agent. Atomic — agent and row together.
  const { bot, sessionKey } = await roster.provisionBot({
    name: values.name,
    title: values.title,
    description: values.description,
    color: values.color,
    avatar: values.avatar,
    sectionId: values.sectionId ?? null,
    // Omitted when the user has not chosen one: the server derives the slug.
    // When supplied, send a bare id — never a full session key.
    agentId: values.agentId ? toBareAgentId(values.agentId) : null,
  });

  const created = withSessionKey(bot, sessionKey);

  // `provision` has no enabledSkills field, so apply them with a follow-up
  // PATCH. A failure here must not delete a perfectly good, working bot.
  if (skills.length > 0) {
    await roster.updateBot(created.id, { enabledSkills: skills }).catch(() => undefined);
  }

  await onLinked?.();
  return created;
}

export default createBotWithAgent;
