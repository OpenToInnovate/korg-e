/**
 * Agent id / session-key helpers.
 *
 * Mirrors the server's `agent-provisioning.ts` (`toSessionKey` / `toBareAgentId`)
 * so the client never stores or sends a bare agent id.
 *
 * Why this matters: a roster row whose `agentId` is a bare id (`mir-tutor`)
 * renders fine but resolves to no gateway session, so the bot cannot be
 * selected or messaged — the "shell bot" Tony hit. The only value that works
 * is the full session key `agent:<id>:main`.
 * @module
 */

/** Matches `agent:<id>:…`, capturing the bare id. */
const SESSION_KEY_RE = /^agent:([^:]+):/;

/** Server-equivalent id validation (lowercase, alnum + dashes, 1–64 chars). */
export const AGENT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** `mir-tutor` or `agent:mir-tutor:main` → `agent:mir-tutor:main`. */
export function toAgentSessionKey(agentIdOrSessionKey: string | null | undefined): string {
  const trimmed = (agentIdOrSessionKey ?? '').trim();
  if (!trimmed) return '';
  const match = SESSION_KEY_RE.exec(trimmed);
  const bare = match ? match[1] : trimmed;
  return `agent:${bare}:main`;
}

/** `agent:mir-tutor:main` → `mir-tutor`; a bare id is returned unchanged. */
export function toBareAgentId(agentIdOrSessionKey: string | null | undefined): string {
  const trimmed = (agentIdOrSessionKey ?? '').trim();
  if (!trimmed) return '';
  const match = SESSION_KEY_RE.exec(trimmed);
  return match ? match[1] : trimmed;
}

/** True when the value is already a full `agent:<id>:<...>` session key. */
export function isAgentSessionKey(value: string | null | undefined): boolean {
  return SESSION_KEY_RE.test((value ?? '').trim());
}

/** A roster row with no backing agent at all — a shell that cannot be used. */
export function isUnlinkedBot(agentId: string | null | undefined): boolean {
  return !toBareAgentId(agentId);
}

/**
 * Turn a bot name into a valid agent id: `Bot Maintainer` → `bot-maintainer`.
 * Falls back to `agent` if nothing usable survives.
 */
export function slugifyAgentId(name: string): string {
  const slug = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return AGENT_ID_PATTERN.test(slug) ? slug : 'agent';
}
