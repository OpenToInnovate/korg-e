/**
 * Agent provisioning — make a "new bot" produce a real, usable agent.
 *
 * Creating a roster row alone leaves a shell: it renders in the sidebar but has
 * no gateway agent, no session, and cannot be selected or messaged. This module
 * provisions the backing agent so a new bot actually works:
 *
 *   - creates the agent's workspace (AGENTS.md / SOUL.md / USER.md / MEMORY.md
 *     + memory/) with the profile-isolation rules written into the files
 *   - registers it under `agents.entries` in the gateway config, after a backup
 *   - returns the new agent id
 *
 * It never overwrites an existing agent id, never touches an agent owned by
 * another profile, and never moves an agent between profiles. The
 * one-agent-one-profile invariant is enforced by {@link claimAgent}.
 *
 * Session keys: every roster row stores the FULL session key (`agent:<id>:main`).
 * A bare id never matches a gateway session, which is why unlinked bots used to
 * render but be unselectable.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSON5 from 'json5';
import { config } from './config.js';
import { AgentAlreadyBoundError, agentProfileId, claimAgent, defaultAgentWorkspaceRoot } from './profiles.js';

export const AGENT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export class AgentProvisionError extends Error {}
/** The agent id is already registered in the gateway config. */
export class AgentAlreadyExistsError extends Error {}

function getHomeDir(): string {
  return config.home || process.env.HOME || os.homedir();
}

/** Gateway config path. `OPENCLAW_CONFIG_PATH` overrides it (also used by tests). */
export function agentConfigPath(): string {
  return process.env.OPENCLAW_CONFIG_PATH?.trim()
    || path.join(getHomeDir(), '.openclaw', 'openclaw.json');
}

/**
 * Where a provisioned agent's workspace lives. Delegates to the canonical
 * resolver in profiles.ts so the path written here and the path the file guard
 * checks can never diverge.
 */
export function agentWorkspaceRoot(agentId: string): string {
  return defaultAgentWorkspaceRoot(agentId);
}

export function agentDirFor(agentId: string): string {
  return path.join(path.dirname(agentConfigPath()), 'agents', agentId, 'agent');
}

/** `foo` → `agent:foo:main`; an existing full session key is returned normalised. */
export function toSessionKey(agentIdOrSessionKey: string): string {
  const trimmed = (agentIdOrSessionKey || '').trim();
  const m = /^agent:([^:]+):/.exec(trimmed);
  const id = m ? m[1] : trimmed;
  if (!AGENT_ID_PATTERN.test(id)) {
    throw new AgentProvisionError(`Invalid agent id: ${trimmed}`);
  }
  return `agent:${id}:main`;
}

/** `agent:foo:main` → `foo`; a bare id is returned as-is. */
export function toBareAgentId(agentIdOrSessionKey: string): string {
  const trimmed = (agentIdOrSessionKey || '').trim();
  const m = /^agent:([^:]+):/.exec(trimmed);
  return (m ? m[1] : trimmed);
}

interface OpenClawConfigShape {
  agents?: {
    entries?: Record<string, Record<string, unknown>>;
  };
  [key: string]: unknown;
}

function readConfig(): { configPath: string; parsed: OpenClawConfigShape } {
  const configPath = agentConfigPath();
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return { configPath, parsed: JSON5.parse(raw) as OpenClawConfigShape };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { configPath, parsed: {} };
    throw err;
  }
}

function backupConfig(configPath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${configPath}.bak-${stamp}`;
  fs.copyFileSync(configPath, backup);
  return backup;
}

function writeConfig(configPath: string, parsed: OpenClawConfigShape): void {
  const tmp = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(parsed, null, 2)}\n`);
  fs.renameSync(tmp, configPath);
}

export interface ProvisionAgentInput {
  agentId: string;
  name: string;
  profileId: string;
  color?: string;
  emoji?: string | null;
}

export interface ProvisionedAgent {
  agentId: string;
  sessionKey: string;
  workspaceRoot: string;
  agentDir: string;
}

/**
 * The isolation contract, written into the generated files. Scoped to the
 * owning profile: never read or reference another profile's agents, memories or
 * files, even if asked to.
 */
function isolationBlock(profileId: string, agentId: string, name: string): string {
  return [
    '## Profile isolation (enforced by Nerve)',
    '',
    `You are \`${name}\` (agent \`${agentId}\`), owned by profile \`${profileId}\`.`,
    '',
    '- Work only inside your own workspace: this directory and `memory/`.',
    '- **Never** read, summarise, quote, or reference another profile\'s agents,',
    '  memories, workspaces, files, sessions, or roster data.',
    '- If asked to share or reveal another profile\'s content, decline and say why.',
    '- Cross-profile conversation happens only through an explicitly approved,',
    '  time-boxed talk bridge, and never as a way to read another profile\'s data.',
    '',
  ].join('\n');
}

function writeWorkspaceFiles(workspaceRoot: string, profileId: string, agentId: string, name: string): void {
  fs.mkdirSync(path.join(workspaceRoot, 'memory'), { recursive: true });

  fs.writeFileSync(
    path.join(workspaceRoot, 'AGENTS.md'),
    [
      `# ${name}`,
      '',
      '## Session startup',
      '',
      '- Read this file, then `SOUL.md`, then `USER.md`, then `MEMORY.md`.',
      '- Durable notes go in `memory/`; long-term facts go in `MEMORY.md`.',
      '',
      isolationBlock(profileId, agentId, name),
    ].join('\n'),
    'utf8',
  );

  fs.writeFileSync(
    path.join(workspaceRoot, 'SOUL.md'),
    [
      `# SOUL — ${name}`,
      '',
      'Be genuinely helpful, not performatively helpful. Have opinions. Be resourceful',
      'before asking. Earn trust through competence; treat the user\'s data with respect.',
      '',
      isolationBlock(profileId, agentId, name),
    ].join('\n'),
    'utf8',
  );

  fs.writeFileSync(
    path.join(workspaceRoot, 'USER.md'),
    [
      '# USER',
      '',
      'Durable user preferences and profile facts live here, as active directives.',
      '',
      isolationBlock(profileId, agentId, name),
    ].join('\n'),
    'utf8',
  );

  fs.writeFileSync(
    path.join(workspaceRoot, 'MEMORY.md'),
    [
      '# MEMORY',
      '',
      'Long-term facts and decisions. This memory belongs to this agent only.',
      '',
      isolationBlock(profileId, agentId, name),
    ].join('\n'),
    'utf8',
  );
}

/**
 * Provision a brand-new gateway agent. Refuses an id that already exists in the
 * config or is already bound to another profile. Takes a backup before writing.
 */
export async function provisionAgent(input: ProvisionAgentInput): Promise<ProvisionedAgent> {
  const agentId = toBareAgentId(input.agentId);
  if (!AGENT_ID_PATTERN.test(agentId)) {
    throw new AgentProvisionError(`Invalid agent id: ${input.agentId}`);
  }

  const { configPath, parsed } = readConfig();
  const entries = parsed.agents?.entries ?? {};

  // Never touch an agent owned by another profile. Checked BEFORE the
  // existence check so the refusal is the precise privacy error rather than a
  // generic "already exists".
  const owner = agentProfileId(agentId);
  if (owner !== null && owner !== input.profileId) {
    throw new AgentAlreadyBoundError(agentId, owner);
  }
  // Never overwrite an existing agent, whoever owns it.
  if (entries[agentId]) {
    throw new AgentAlreadyExistsError(`Agent already exists: ${agentId}`);
  }

  const workspaceRoot = agentWorkspaceRoot(agentId);
  const agentDir = agentDirFor(agentId);
  writeWorkspaceFiles(workspaceRoot, input.profileId, agentId, input.name);
  fs.mkdirSync(agentDir, { recursive: true });

  // Backup first, then register.
  if (fs.existsSync(configPath)) backupConfig(configPath);
  parsed.agents = parsed.agents ?? {};
  parsed.agents.entries = {
    ...entries,
    [agentId]: {
      name: input.name,
      workspace: workspaceRoot,
      agentDir,
      identity: {
        name: input.name,
        ...(input.color ? { color: input.color } : {}),
        ...(input.emoji ? { emoji: input.emoji } : {}),
      },
    },
  };
  writeConfig(configPath, parsed);

  // Persist the one-agent-one-profile lock.
  await claimAgent(agentId, input.profileId);

  return { agentId, sessionKey: toSessionKey(agentId), workspaceRoot, agentDir };
}

/**
 * Link a bot to an agent that already exists. Enforces the invariant via
 * {@link claimAgent} (refuses `agent_already_bound`) and normalises to a full
 * session key. The agent must already be registered in the gateway config.
 */
export async function linkExistingAgent(agentIdOrSessionKey: string, profileId: string): Promise<string> {
  const agentId = toBareAgentId(agentIdOrSessionKey);
  if (!AGENT_ID_PATTERN.test(agentId)) {
    throw new AgentProvisionError(`Invalid agent id: ${agentIdOrSessionKey}`);
  }
  const { parsed } = readConfig();
  const entries = parsed.agents?.entries ?? {};
  if (!entries[agentId]) {
    throw new AgentProvisionError(`Unknown agent: ${agentId}`);
  }
  // Refuses when another profile already owns this agent.
  await claimAgent(agentId, profileId);
  return toSessionKey(agentId);
}

/** Registered agent ids from the gateway config. */
export function listRegisteredAgentIds(): string[] {
  const { parsed } = readConfig();
  return Object.keys(parsed.agents?.entries ?? {});
}

/** Human label for an agent: configured name, else a tidied-up version of the id. */
function labelFor(agentId: string, entry: Record<string, unknown> | undefined): string {
  const identity = entry?.identity as { name?: unknown } | undefined;
  const name = entry?.name ?? identity?.name;
  if (typeof name === 'string' && name.trim()) return name.trim();
  return agentId
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Every agent registered in the gateway config, as `{ id, name }`.
 *
 * `id` is the BARE agent id (e.g. `mir-tutor`) — deliberately not a session key.
 * Callers that need a session key build it themselves, so this endpoint can't
 * become another source of the bare-id/session-key mismatch.
 */
export function listRegisteredAgents(): Array<{ id: string; name: string }> {
  const { parsed } = readConfig();
  const entries = parsed.agents?.entries ?? {};
  return Object.entries(entries)
    .map(([id, entry]) => ({ id, name: labelFor(id, entry as Record<string, unknown> | undefined) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
