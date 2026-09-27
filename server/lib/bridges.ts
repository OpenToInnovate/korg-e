/**
 * Bridges — narrow, dual-approved, talk-only links between two profiles.
 *
 * A bridge lets named agents on each side exchange *messages* and nothing else.
 * It deliberately unlocks no read path: memories, files and sessions stay
 * refused across profiles by {@link assertAgentInProfile} even while a bridge is
 * active. The bridge is also not a back door for the profile invariant — it
 * never moves an agent between profiles and never creates cross-profile groups.
 *
 * Persisted in `${NERVE_DATA_DIR:-~/.nerve}/bridges.json` with mutex-protected
 * atomic writes, the same discipline as the profile file.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { withMutex } from './mutex.js';
import {
  agentIdentityMatches,
  agentProfileId,
  resolveActiveProfileIdSync,
} from './profiles.js';
import { toSessionKey } from './agent-provisioning.js';

export type BridgeScope = 'talk';
export type BridgeStatus = 'pending_remote' | 'active' | 'revoked' | 'expired';

export interface BridgeLogEntry {
  ts: number;
  event: string;
}

export interface Bridge {
  id: string;
  fromProfileId: string;
  toProfileId: string;
  fromAgentIds: string[];
  toAgentIds: string[];
  /** Fixed to 'talk'. Any other value is rejected on read and on write. */
  scope: BridgeScope;
  status: BridgeStatus;
  /** Set when the adult profile creates the bridge. */
  adultApprovedAt: number | null;
  /** Set only when the OTHER profile's agent accepts. */
  remoteApprovedAt: number | null;
  expiresAt: number;
  reason: string;
  createdAt: number;
  /**
   * Session that created the bridge. A bridge needs approval from BOTH sides, so
   * the creating session cannot also be the accepting side — otherwise one
   * session could self-approve the handshake.
   */
  createdBySid: string | null;
  log: BridgeLogEntry[];
}

export const BRIDGE_MAX_AGENTS_PER_SIDE = 3;
export const BRIDGE_MIN_TTL_HOURS = 1;
export const BRIDGE_MAX_TTL_HOURS = 168;
export const BRIDGE_DEFAULT_TTL_HOURS = 24;
const BRIDGE_SCHEMA_VERSION = 1;

export class BridgeValidationError extends Error {}
export class BridgeNotFoundError extends Error {}
/** 403 bridge_not_fully_approved — a side has not approved, or it was revoked/expired. */
export class BridgeNotApprovedError extends Error {
  readonly code = 'bridge_not_fully_approved';
  constructor(detail: string) {
    super(`bridge_not_fully_approved: ${detail}`);
    this.name = 'BridgeNotApprovedError';
  }
}
/** 403 — the caller is not a listed participant on its own side. */
export class BridgePairForbiddenError extends Error {
  readonly code = 'bridge_pair_forbidden';
  constructor(detail: string) {
    super(`bridge_pair_forbidden: ${detail}`);
    this.name = 'BridgePairForbiddenError';
  }
}
/** 403 — only the remote profile may accept. */
export class BridgeNotRemoteError extends Error {
  readonly code = 'bridge_accept_requires_remote_profile';
  constructor(detail: string) {
    super(`bridge_accept_requires_remote_profile: ${detail}`);
    this.name = 'BridgeNotRemoteError';
  }
}

interface BridgeFile {
  version: number;
  bridges: Bridge[];
}

function dataDir(): string {
  return process.env.NERVE_DATA_DIR || path.join(os.homedir(), '.nerve');
}

function bridgesFile(): string {
  return path.join(dataDir(), 'bridges.json');
}

function logEntry(event: string): BridgeLogEntry {
  return { ts: Date.now(), event };
}

/**
 * Upgrade stored agent ids to FULL session keys (`agent:<id>:main`).
 *
 * A bare id never resolves to a gateway session, so a bridge built from one
 * fails to deliver. Normalising on BOTH write and read means a legacy/bare
 * value is upgraded rather than passed through to `chat.send`.
 */
function normalizeAgentList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      const key = toSessionKey(value);
      if (!out.includes(key)) out.push(key);
    } catch {
      // Unparseable id — drop it rather than passing garbage to the gateway.
    }
  }
  return out;
}

function normalizeBridge(raw: Partial<Bridge>): Bridge | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  const scope: BridgeScope = 'talk'; // Fixed. A persisted non-'talk' value is coerced, never trusted.
  return {
    id: raw.id,
    fromProfileId: String(raw.fromProfileId ?? ''),
    toProfileId: String(raw.toProfileId ?? ''),
    fromAgentIds: normalizeAgentList(raw.fromAgentIds),
    toAgentIds: normalizeAgentList(raw.toAgentIds),
    scope,
    status: (['pending_remote', 'active', 'revoked', 'expired'] as const).includes(raw.status as BridgeStatus)
      ? (raw.status as BridgeStatus)
      : 'pending_remote',
    adultApprovedAt: typeof raw.adultApprovedAt === 'number' ? raw.adultApprovedAt : null,
    remoteApprovedAt: typeof raw.remoteApprovedAt === 'number' ? raw.remoteApprovedAt : null,
    // 0 = unknown expiry, which fails CLOSED (see approvalsComplete) rather than
    // being treated as "never expires".
    expiresAt: typeof raw.expiresAt === 'number' && raw.expiresAt > 0 ? raw.expiresAt : 0,
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    createdBySid: typeof raw.createdBySid === 'string' && raw.createdBySid ? raw.createdBySid : null,
    log: Array.isArray(raw.log) ? raw.log.filter((e) => e && typeof e.event === 'string') : [],
  };
}

function readBridgeFile(): BridgeFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(bridgesFile(), 'utf-8')) as Partial<BridgeFile>;
    const bridges = Array.isArray(parsed.bridges)
      ? parsed.bridges.map(normalizeBridge).filter((b): b is Bridge => b !== null)
      : [];
    return { version: BRIDGE_SCHEMA_VERSION, bridges };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return { version: BRIDGE_SCHEMA_VERSION, bridges: [] };
  }
}

function writeBridgeFile(data: BridgeFile): void {
  const file = bridgesFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * Apply time-based expiry. Expiry is a state transition, not a read-time filter:
 * the transition is persisted and logged so the bridge can never be used again.
 */
function expireIfDue(bridge: Bridge): boolean {
  if (bridge.status === 'revoked' || bridge.status === 'expired') return false;
  // expiresAt <= 0 means "unknown expiry" (hand-edited/legacy) — treat as
  // expired, never as "never expires".
  if (bridge.expiresAt <= 0 || Date.now() > bridge.expiresAt) {
    bridge.status = 'expired';
    bridge.log.push(logEntry('expired'));
    return true;
  }
  return false;
}

/**
 * Both sides have approved and the bridge has not expired. Deliberately does
 * NOT look at `status` — that is what it decides, so folding status in here
 * would make the promotion below unsatisfiable.
 *
 * Fails CLOSED: a missing/zero `expiresAt` (hand-edited or legacy data) counts
 * as expired rather than "never expires".
 */
function approvalsComplete(bridge: Bridge): boolean {
  return bridge.adultApprovedAt !== null
    && bridge.remoteApprovedAt !== null
    && bridge.expiresAt > 0
    && Date.now() <= bridge.expiresAt;
}

function isActive(bridge: Bridge): boolean {
  return bridge.status === 'active' && approvalsComplete(bridge);
}

function assertAgentList(list: unknown, label: string): string[] {
  if (!Array.isArray(list) || list.length < 1 || list.length > BRIDGE_MAX_AGENTS_PER_SIDE) {
    throw new BridgeValidationError(`${label} must list 1–${BRIDGE_MAX_AGENTS_PER_SIDE} agents`);
  }
  // Stored as FULL session keys so delivery resolves a real gateway session.
  const cleaned: string[] = [];
  for (const value of list) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BridgeValidationError(`${label} contains an invalid agent id`);
    }
    let key: string;
    try {
      key = toSessionKey(value);
    } catch {
      throw new BridgeValidationError(`${label} contains an invalid agent id`);
    }
    if (!cleaned.includes(key)) cleaned.push(key);
  }
  return cleaned;
}

export interface CreateBridgeInput {
  toProfileId: string;
  fromAgentIds: string[];
  toAgentIds: string[];
  reason: string;
  ttlHours?: number;
}

/**
 * Create a bridge from the active (adult) profile. Sets `adultApprovedAt` and
 * leaves the bridge `pending_remote` until the other profile accepts.
 *
 * Never changes agent→profile ownership: each listed agent is verified to
 * already belong to its side, using the read-only {@link agentProfileId}.
 */
export async function createBridge(
  input: CreateBridgeInput,
  activeProfileId: string,
  sessionId: string | null = null,
): Promise<Bridge> {
  const toProfileId = String(input.toProfileId ?? '').trim();
  if (!toProfileId) throw new BridgeValidationError('toProfileId is required');
  if (toProfileId === activeProfileId) {
    throw new BridgeValidationError('A bridge must connect two different profiles');
  }
  const fromAgentIds = assertAgentList(input.fromAgentIds, 'fromAgentIds');
  const toAgentIds = assertAgentList(input.toAgentIds, 'toAgentIds');
  const reason = String(input.reason ?? '').trim();
  if (!reason || reason.length > 500) throw new BridgeValidationError('reason must be 1–500 characters');

  const ttlRaw = input.ttlHours ?? BRIDGE_DEFAULT_TTL_HOURS;
  if (!Number.isFinite(ttlRaw) || ttlRaw < BRIDGE_MIN_TTL_HOURS || ttlRaw > BRIDGE_MAX_TTL_HOURS) {
    throw new BridgeValidationError(`ttlHours must be ${BRIDGE_MIN_TTL_HOURS}–${BRIDGE_MAX_TTL_HOURS}`);
  }

  // Read-only ownership checks. Read-only, so creating a bridge can never move
  // an agent between profiles or create a cross-profile group.
  for (const agentId of fromAgentIds) {
    if (agentProfileId(agentId) !== activeProfileId) {
      throw new BridgeValidationError(`agent ${agentId} is not owned by the active profile`);
    }
  }
  for (const agentId of toAgentIds) {
    if (agentProfileId(agentId) !== toProfileId) {
      throw new BridgeValidationError(`agent ${agentId} is not owned by profile ${toProfileId}`);
    }
  }

  return withMutex('bridges', async () => {
    const data = readBridgeFile();
    const now = Date.now();
    const bridge: Bridge = {
      id: `bridge-${crypto.randomBytes(6).toString('hex')}`,
      fromProfileId: activeProfileId,
      toProfileId,
      fromAgentIds,
      toAgentIds,
      scope: 'talk',
      status: 'pending_remote',
      adultApprovedAt: now,
      remoteApprovedAt: null,
      expiresAt: now + ttlRaw * 3_600_000,
      reason,
      createdAt: now,
      createdBySid: sessionId,
      log: [logEntry('created')],
    };
    data.bridges.push(bridge);
    writeBridgeFile(data);
    return bridge;
  });
}

/** Bridges where the active profile is either side, with expiry applied. */
export async function listBridgesForProfile(activeProfileId: string): Promise<Bridge[]> {
  return withMutex('bridges', async () => {
    const data = readBridgeFile();
    let changed = false;
    for (const b of data.bridges) {
      if (b.fromProfileId === activeProfileId || b.toProfileId === activeProfileId) {
        if (expireIfDue(b)) changed = true;
      }
    }
    if (changed) writeBridgeFile(data);
    return data.bridges
      .filter((b) => b.fromProfileId === activeProfileId || b.toProfileId === activeProfileId)
      .sort((a, b) => b.createdAt - a.createdAt);
  });
}

function loadBridge(data: BridgeFile, id: string): Bridge {
  const bridge = data.bridges.find((b) => b.id === id);
  if (!bridge) throw new BridgeNotFoundError(`Bridge not found: ${id}`);
  if (expireIfDue(bridge)) writeBridgeFile(data);
  return bridge;
}

/** A bridge is visible to both sides; the remote agent needs to see it to accept. */
export async function getBridge(id: string, activeProfileId: string): Promise<Bridge> {
  return withMutex('bridges', async () => {
    const data = readBridgeFile();
    const bridge = loadBridge(data, id);
    if (bridge.fromProfileId !== activeProfileId && bridge.toProfileId !== activeProfileId) {
      throw new BridgeNotFoundError(`Bridge not found: ${id}`);
    }
    return bridge;
  });
}

/**
 * Accept a bridge. Only the REMOTE profile may accept — an accept from the
 * profile that created it is rejected, so one side cannot self-approve.
 */
export async function acceptBridge(id: string, activeProfileId: string, sessionId: string | null = null): Promise<Bridge> {
  return withMutex('bridges', async () => {
    const data = readBridgeFile();
    const bridge = loadBridge(data, id);
    if (bridge.fromProfileId === activeProfileId) {
      throw new BridgeNotRemoteError('only the receiving profile may accept this bridge');
    }
    if (bridge.toProfileId !== activeProfileId) {
      throw new BridgeNotFoundError(`Bridge not found: ${id}`);
    }
    // SECURITY: "approved on BOTH ends" is a real control, not advisory. The
    // session that created the bridge cannot also be the accepting side, so one
    // authenticated client cannot self-approve the handshake by flipping the
    // active profile and calling accept.
    if (bridge.createdBySid && sessionId && bridge.createdBySid === sessionId) {
      throw new BridgeNotRemoteError('the session that created this bridge cannot also accept it');
    }
    if (bridge.status === 'revoked' || bridge.status === 'expired') {
      throw new BridgeNotApprovedError(`bridge is ${bridge.status}`);
    }
    if (bridge.remoteApprovedAt === null) {
      bridge.remoteApprovedAt = Date.now();
      bridge.log.push(logEntry('accepted'));
    }
    if (bridge.status === 'pending_remote' && approvalsComplete(bridge)) {
      bridge.status = 'active';
      bridge.log.push(logEntry('active'));
    }
    writeBridgeFile(data);
    return bridge;
  });
}

/** Revoke from either side; takes effect immediately. */
export async function revokeBridge(id: string, activeProfileId: string, reason?: string): Promise<Bridge> {
  return withMutex('bridges', async () => {
    const data = readBridgeFile();
    const bridge = loadBridge(data, id);
    if (bridge.fromProfileId !== activeProfileId && bridge.toProfileId !== activeProfileId) {
      throw new BridgeNotFoundError(`Bridge not found: ${id}`);
    }
    if (bridge.status !== 'revoked') {
      bridge.status = 'revoked';
      bridge.log.push(logEntry(`revoked${reason ? `: ${reason}` : ''}`));
      writeBridgeFile(data);
    }
    return bridge;
  });
}

/**
 * Deliver a bridge message. Enforces, in order: bridge exists and is visible,
 * fully approved on both sides, not revoked/expired, and the sending agent is
 * listed on the caller's own side.
 *
 * Returns the sender's side so the caller can route the message.
 */
export async function assertBridgeSendAllowed(
  id: string,
  activeProfileId: string,
  senderAgentId: string | null,
): Promise<{ bridge: Bridge; side: 'from' | 'to'; senderAgentId: string; peerAgentIds: string[] }> {
  return withMutex('bridges', async () => {
    const data = readBridgeFile();
    const bridge = loadBridge(data, id);
    if (bridge.fromProfileId !== activeProfileId && bridge.toProfileId !== activeProfileId) {
      throw new BridgeNotFoundError(`Bridge not found: ${id}`);
    }
    const side = bridge.fromProfileId === activeProfileId ? 'from' : 'to';
    const own = side === 'from' ? bridge.fromAgentIds : bridge.toAgentIds;
    const peerAgentIds = side === 'from' ? bridge.toAgentIds : bridge.fromAgentIds;

    // Pair scope. With one agent on this side the sender is unambiguous; with
    // several the caller must say which one is speaking.
    let sender: string;
    if (senderAgentId) {
      if (!own.some((a) => agentIdentityMatches(senderAgentId, a))) {
        throw new BridgePairForbiddenError(`agent ${senderAgentId} is not listed on this bridge`);
      }
      sender = senderAgentId;
    } else if (own.length === 1) {
      sender = own[0];
    } else {
      throw new BridgePairForbiddenError('senderAgentId is required for a multi-agent bridge');
    }

    // Dual approval gate. Both sides must have approved; revocation and expiry
    // both close it.
    if (bridge.status === 'revoked') throw new BridgeNotApprovedError('bridge is revoked');
    if (bridge.status === 'expired' || bridge.expiresAt <= 0 || Date.now() > bridge.expiresAt) {
      throw new BridgeNotApprovedError('bridge is expired');
    }
    if (bridge.adultApprovedAt === null || bridge.remoteApprovedAt === null || !isActive(bridge)) {
      throw new BridgeNotApprovedError('bridge is not approved by both sides');
    }

    bridge.log.push(logEntry(`message:${sender}`));
    writeBridgeFile(data);
    return { bridge, side, senderAgentId: sender, peerAgentIds };
  });
}

export interface SendBridgeMessageInput {
  text: string;
  senderAgentId: string;
}

/** Record a send attempt against the bridge log. */
export async function recordBridgeMessage(id: string, activeProfileId: string, event: string): Promise<void> {
  await withMutex('bridges', async () => {
    const data = readBridgeFile();
    const bridge = data.bridges.find((b) => b.id === id);
    if (!bridge) return;
    bridge.log.push(logEntry(event));
    writeBridgeFile(data);
  });
}

/** Resolve the active profile for a request (header → cookie → default). */
export function bridgeActiveProfileId(header?: string | null, cookie?: string | null): string {
  return resolveActiveProfileIdSync(header ?? null, cookie ?? null);
}
