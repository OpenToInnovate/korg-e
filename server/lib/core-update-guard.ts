/**
 * Core-update guard — keeps Nerve (a UI layer) from interfering with
 * OpenClaw core lifecycle operations.
 *
 * Background: a core update triggered from a Control UI session
 * (`trigger: control-ui`) failed in its `activating` phase and left a stale
 * activation lease behind. Any concurrent core mutation from Nerve —
 * `gateway restart`, `plugins install`, or `config set` — during a future
 * update's requested/activating window risks the same
 * `post-core-update-failed` / `runtime-verification-failed` outcome.
 *
 * This module is the single choke point for Nerve's live-core writes:
 * - `assertCoreMutationAllowed()` refuses (409) while a core update is
 *   actively running (lastRun phase not `finished`).
 * - `assertConfigSetPathAllowed()` restricts `config set` to the narrow
 *   agent-delegation subtree Nerve actually needs, so a bad/malicious agent
 *   id can never rewrite `gateway.*`, `channels.*`, `plugins`, etc.
 * - `assertOpenclawArgsAllowed()` blocklists core-lifecycle subcommands
 *   (`update`, `doctor`, `triage`, `gateway install/uninstall`) that Nerve
 *   must never invoke — core updates belong in a terminal, never in a
 *   gateway-hosted session that the update itself will restart.
 *
 * Update-status detection is best-effort and fails OPEN (with a warning):
 * blocking the UI restart button because a status probe flaked would be a
 * worse failure mode than the race it guards against.
 * @module
 */

import { execFile } from 'node:child_process';
import { resolveOpenclawBin } from './openclaw-bin.js';

export class CoreUpdateGuardError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'CoreUpdateGuardError';
  }
}

/** Core-lifecycle subcommands Nerve must never invoke. */
const BLOCKED_SUBCOMMANDS = new Set(['update', 'doctor', 'triage']);

/**
 * `config set` paths Nerve is allowed to write (live config).
 * Today that's only the team-delegation subtree managed by the roster:
 * `agents.entries.<agentId>.subagents.allowAgents|delegationMode`.
 */
const CONFIG_SET_ALLOWLIST =
  /^agents\.entries\.[A-Za-z0-9_-]+\.subagents\.(allowAgents|delegationMode)$/;

/** Agent ids that may appear inside a config path (no dots, no spaces). */
const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const STATUS_TIMEOUT_MS = 10_000;
const STATUS_CACHE_MS = 15_000;

let cachedStatusAt = 0;
let cachedActive: { active: boolean; detail: string } | null = null;

/** @internal — reset the status cache (tests). */
export function _resetCoreUpdateGuardCache(): void {
  cachedStatusAt = 0;
  cachedActive = null;
}

export function isAgentIdSafe(agentId: string): boolean {
  return AGENT_ID_PATTERN.test(agentId);
}

/** True when a `config set <path>` target is inside Nerve's allowed subtree. */
export function isConfigSetPathAllowed(path: string): boolean {
  return CONFIG_SET_ALLOWLIST.test(path);
}

/** Throw unless every `config set` path in `args` is allowlisted. */
export function assertConfigSetPathAllowed(configPath: string): void {
  if (!isConfigSetPathAllowed(configPath)) {
    throw new CoreUpdateGuardError(
      `Refusing to write core config path "${configPath}" — Nerve may only manage ` +
        '`agents.entries.<agent>.subagents.allowAgents|delegationMode`. ' +
        'Change core config from a terminal instead.',
    );
  }
}

/** Throw when `args` invoke a core-lifecycle subcommand Nerve must not run. */
export function assertOpenclawArgsAllowed(args: string[]): void {
  const [sub, ...rest] = args;
  if (sub && BLOCKED_SUBCOMMANDS.has(sub)) {
    throw new CoreUpdateGuardError(
      `Refusing to run \`openclaw ${sub}\` from Nerve — core lifecycle operations ` +
        'belong in a terminal, never in a gateway-hosted session.',
    );
  }
  if (sub === 'gateway' && (rest[0] === 'install' || rest[0] === 'uninstall')) {
    throw new CoreUpdateGuardError(
      `Refusing to run \`openclaw gateway ${rest[0]}\` from Nerve — service installation ` +
        'belongs in a terminal.',
    );
  }
  if (sub === 'config' && rest[0] === 'set' && typeof rest[1] === 'string') {
    assertConfigSetPathAllowed(rest[1]);
  }
}

interface UpdateStatusJson {
  lastRun?: {
    phase?: string;
    status?: string;
    reason?: string;
    target?: { version?: string };
  };
}

function runUpdateStatus(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      resolveOpenclawBin(),
      ['update', 'status', '--json'],
      { timeout: STATUS_TIMEOUT_MS, maxBuffer: 512 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout);
      },
    );
  });
}

/**
 * Check whether a core update is actively running. Result is cached briefly.
 * Never throws — on any detection failure returns `{ active: false }` and
 * logs a warning (fail-open: a flaky probe must not brick UI actions).
 */
export async function isCoreUpdateActive(): Promise<{ active: boolean; detail: string }> {
  const now = Date.now();
  if (cachedActive && now - cachedStatusAt < STATUS_CACHE_MS) return cachedActive;

  try {
    const parsed = JSON.parse(await runUpdateStatus()) as UpdateStatusJson;
    const lastRun = parsed.lastRun;
    if (lastRun && lastRun.phase && lastRun.phase !== 'finished') {
      cachedActive = {
        active: true,
        detail:
          `core update ${lastRun.status ?? ''} in phase "${lastRun.phase}"` +
          (lastRun.target?.version ? ` (target ${lastRun.target.version})` : ''),
      };
    } else {
      cachedActive = { active: false, detail: '' };
    }
  } catch (err) {
    console.warn('[core-update-guard] update-status probe failed (fail-open):', (err as Error).message);
    cachedActive = { active: false, detail: '' };
  }
  cachedStatusAt = now;
  return cachedActive;
}

/**
 * Throw (409) when a core update is actively running. Call before any
 * live-core mutation: `gateway restart`, `plugins install`, `skills install`,
 * or `config set`.
 */
export async function assertCoreMutationAllowed(): Promise<void> {
  const { active, detail } = await isCoreUpdateActive();
  if (active) {
    throw new CoreUpdateGuardError(
      `Refusing core mutation while ${detail} — retry after the update finishes. ` +
        'Core updates must run from a terminal, never from a Nerve session.',
    );
  }
}
