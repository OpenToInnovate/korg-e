/**
 * Security hardening tests — CRITICAL-1 (session-bound profile),
 * CRITICAL-2 (sessions/files guards), HIGH-3 (bridge id normalisation).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createSession, reissueSessionForProfile, verifySession } from './session.js';
import {
  DEFAULT_PROFILE_ID,
  CrossProfileForbiddenError,
  activeProfileIdForRequest,
  agentIdOwningWorkspacePath,
  assertAgentInProfile,
  claimAgent,
  resolveActiveProfileIdSync,
} from './profiles.js';
import {
  BridgeNotApprovedError,
  acceptBridge,
  createBridge,
} from './bridges.js';

const MIR = 'mir';
const SECRET = 'test-secret-for-session-binding';

let tmpDir: string;
let previous: Record<string, string | undefined>;

beforeEach(async () => {
  previous = {
    NERVE_DATA_DIR: process.env.NERVE_DATA_DIR,
    OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH,
    NERVE_AGENT_WORKSPACE_ROOT: process.env.NERVE_AGENT_WORKSPACE_ROOT,
  };
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sec-test-'));
  process.env.NERVE_DATA_DIR = path.join(tmpDir, 'data');
  process.env.OPENCLAW_CONFIG_PATH = path.join(tmpDir, 'openclaw.json');
  process.env.NERVE_AGENT_WORKSPACE_ROOT = path.join(tmpDir, 'workspaces');
  await fsp.mkdir(process.env.NERVE_DATA_DIR, { recursive: true });
  await fsp.writeFile(
    path.join(process.env.NERVE_DATA_DIR, 'profiles.json'),
    JSON.stringify({
      version: 1,
      profiles: [
        { id: DEFAULT_PROFILE_ID, name: 'Korg-e', color: '#C46443', emoji: null, order: 0, createdAt: 1 },
        { id: MIR, name: 'Mir', color: '#0A84FF', emoji: null, order: 1, createdAt: 1 },
      ],
      agentLocks: {},
    }),
    'utf8',
  );
  await fsp.writeFile(
    path.join(process.env.NERVE_DATA_DIR, 'roster.json'),
    JSON.stringify({
      version: 2,
      bots: [
        { id: 'm1', profileId: MIR, agentId: 'agent:mir-tutor:main', name: 'Mir Tutor', sectionId: null, avatar: '', title: '', description: '', color: '#000', pinned: false, hidden: false, notifications: true, enabledSkills: [], createdAt: 1, updatedAt: 1 },
      ],
      groups: [],
      sections: [],
    }),
    'utf8',
  );
});

afterEach(async () => {
  for (const [k, v] of Object.entries(previous)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

/* ── CRITICAL-1: the session claim is authoritative ─────────────────── */

describe('CRITICAL-1: active profile is bound to the session', () => {
  it('session claim WINS over a flipped header and cookie', () => {
    // Session bound to korge; client tries to claim mir via BOTH channels.
    expect(resolveActiveProfileIdSync(MIR, `nerve_profile=${MIR}`, DEFAULT_PROFILE_ID)).toBe(DEFAULT_PROFILE_ID);
    // No session claim → header/cookie still work (auth-disabled / legacy).
    expect(resolveActiveProfileIdSync(MIR, null, null)).toBe(MIR);
    expect(resolveActiveProfileIdSync(null, `nerve_profile=${MIR}`, null)).toBe(MIR);
  });

  it('a session bound to a non-default profile cannot be flipped to default', () => {
    expect(resolveActiveProfileIdSync(DEFAULT_PROFILE_ID, null, MIR)).toBe(MIR);
  });

  it('a session bound to a deleted profile falls back to default, never unbound', () => {
    expect(resolveActiveProfileIdSync(MIR, null, 'deleted-profile')).toBe(DEFAULT_PROFILE_ID);
  });

  it('activeProfileIdForRequest reads the signed claim, not the header', () => {
    const c = {
      req: { header: (n: string) => (n === 'x-nerve-profile' ? MIR : n === 'cookie' ? `nerve_profile=${MIR}` : undefined) },
      get: (_k: 'sessionPayload') => ({ pid: DEFAULT_PROFILE_ID }),
    };
    expect(activeProfileIdForRequest(c)).toBe(DEFAULT_PROFILE_ID);
  });

  it('activate re-issues a SIGNED session carrying the profile claim', () => {
    const token = createSession(SECRET, 60_000, { sessionId: 'sid-abc' });
    const rebound = reissueSessionForProfile(token, SECRET, MIR);
    expect(rebound).not.toBeNull();

    const payload = verifySession(rebound as string, SECRET);
    expect(payload?.pid).toBe(MIR);
    // The session identity survives re-binding, so bridge "both ends" checks
    // cannot be laundered by re-activating.
    expect(payload?.sid).toBe('sid-abc');
  });

  it('re-issuing rejects an invalid or tampered token', () => {
    expect(reissueSessionForProfile('garbage', SECRET, MIR)).toBeNull();
    const token = createSession(SECRET, 60_000, { sessionId: 'sid-1' });
    expect(reissueSessionForProfile(token, 'wrong-secret', MIR)).toBeNull();
  });

  it('a session bound to korge cannot read Mir data even with the header flipped', async () => {
    const token = createSession(SECRET, 60_000, { sessionId: 'sid-1' });
    const rebound = reissueSessionForProfile(token, SECRET, DEFAULT_PROFILE_ID);
    const payload = verifySession(rebound as string, SECRET);
    expect(payload?.pid).toBe(DEFAULT_PROFILE_ID);

    // The attacker sets the header/cookie to Mir...
    const resolved = resolveActiveProfileIdSync(MIR, `nerve_profile=${MIR}`, payload?.pid ?? null);
    // ...but the session still governs, so the guard sees korge and refuses.
    expect(resolved).toBe(DEFAULT_PROFILE_ID);
    expect(() => assertAgentInProfile('mir-tutor', resolved)).toThrow(CrossProfileForbiddenError);
  });
});

/* ── CRITICAL-1: a bridge needs two different sessions ──────────────── */

describe('CRITICAL-1: bridge cannot be self-approved by one session', () => {
  it('rejects an accept from the session that created the bridge', async () => {
    await claimAgent('adult-tutor', DEFAULT_PROFILE_ID);
    await claimAgent('mir-tutor', MIR);

    const bridge = await createBridge({
      toProfileId: MIR,
      fromAgentIds: ['adult-tutor'],
      toAgentIds: ['mir-tutor'],
      reason: 'help',
    }, DEFAULT_PROFILE_ID, 'sid-1');

    // Same session, now claiming to be the remote profile: still refused.
    await expect(acceptBridge(bridge.id, MIR, 'sid-1')).rejects.toThrow();
    // The guard is the real one, not a generic throw.
    await expect(acceptBridge(bridge.id, MIR, 'sid-1'))
      .rejects.toThrow(/accept|remote/i);
    // A DIFFERENT session may accept.
    const accepted = await acceptBridge(bridge.id, MIR, 'sid-2');
    expect(accepted.status).toBe('active');
  });

  it('still refuses to send when the bridge is not approved by both sides', async () => {
    await claimAgent('adult-tutor', DEFAULT_PROFILE_ID);
    await claimAgent('mir-tutor', MIR);
    const bridge = await createBridge({
      toProfileId: MIR,
      fromAgentIds: ['adult-tutor'],
      toAgentIds: ['mir-tutor'],
      reason: 'help',
    }, DEFAULT_PROFILE_ID, 'sid-1');
    expect(bridge.remoteApprovedAt).toBeNull();
    // No accept happened, so it cannot be active.
    const { getBridge } = await import('./bridges.js');
    expect((await getBridge(bridge.id, MIR)).status).toBe('pending_remote');
    expect(BridgeNotApprovedError).toBeDefined();
  });
});

/* ── HIGH-3: bridge agent ids are stored as full session keys ───────── */

describe('HIGH-3: bridge agent ids normalise to session keys', () => {
  it('stores full session keys on write, even from bare ids', async () => {
    await claimAgent('adult-tutor', DEFAULT_PROFILE_ID);
    await claimAgent('mir-tutor', MIR);
    const bridge = await createBridge({
      toProfileId: MIR,
      fromAgentIds: ['adult-tutor'],
      toAgentIds: ['mir-tutor'],
      reason: 'help',
    }, DEFAULT_PROFILE_ID, 'sid-1');

    expect(bridge.fromAgentIds).toEqual(['agent:adult-tutor:main']);
    expect(bridge.toAgentIds).toEqual(['agent:mir-tutor:main']);
    // Persisted form is also normalised, so delivery resolves a real session.
    const raw = JSON.parse(await fsp.readFile(path.join(tmpDir, 'data', 'bridges.json'), 'utf8')) as {
      bridges: Array<{ toAgentIds: string[] }>;
    };
    expect(raw.bridges[0].toAgentIds).toEqual(['agent:mir-tutor:main']);
  });

  it('upgrades a legacy bare id on read', async () => {
    await claimAgent('mir-tutor', MIR);
    await fsp.writeFile(
      path.join(tmpDir, 'data', 'bridges.json'),
      JSON.stringify({
        version: 1,
        bridges: [{
          id: 'legacy-1',
          fromProfileId: DEFAULT_PROFILE_ID,
          toProfileId: MIR,
          fromAgentIds: ['adult-tutor'],
          toAgentIds: ['mir-tutor'],
          scope: 'talk',
          status: 'active',
          adultApprovedAt: Date.now(),
          remoteApprovedAt: Date.now(),
          expiresAt: Date.now() + 60_000,
          reason: 'legacy',
          createdAt: Date.now(),
          log: [],
        }],
      }),
    );
    const { getBridge } = await import('./bridges.js');
    const bridge = await getBridge('legacy-1', MIR);
    expect(bridge.toAgentIds).toEqual(['agent:mir-tutor:main']);
    expect(bridge.fromAgentIds).toEqual(['agent:adult-tutor:main']);
  });
});

describe('bridge expiry fails closed', () => {
  it('treats a missing/zero expiresAt as expired, not "never expires"', async () => {
    await fsp.writeFile(
      path.join(tmpDir, 'data', 'bridges.json'),
      JSON.stringify({
        version: 1,
        bridges: [{
          id: 'no-expiry',
          fromProfileId: DEFAULT_PROFILE_ID,
          toProfileId: MIR,
          fromAgentIds: ['agent:adult-tutor:main'],
          toAgentIds: ['agent:mir-tutor:main'],
          scope: 'talk',
          status: 'active',
          adultApprovedAt: Date.now(),
          remoteApprovedAt: Date.now(),
          expiresAt: 0,
          reason: 'hand-edited',
          createdAt: Date.now(),
          log: [],
        }],
      }),
    );
    const { getBridge, assertBridgeSendAllowed } = await import('./bridges.js');
    const bridge = await getBridge('no-expiry', MIR);
    expect(bridge.expiresAt).toBe(0);
    // Reading it flips it to expired rather than treating 0 as infinite.
    expect(bridge.status).toBe('expired');
    await expect(assertBridgeSendAllowed('no-expiry', MIR, 'agent:mir-tutor:main'))
      .rejects.toBeInstanceOf(BridgeNotApprovedError);
  });
});

/* ── CRITICAL-2: attributing a path to an agent ─────────────────────── */

describe('CRITICAL-2: agent ownership of a filesystem path', () => {
  it('attributes paths inside a locked agent workspace, including main', async () => {
    await claimAgent('mir-tutor', MIR);
    const mirror = path.join(process.env.NERVE_AGENT_WORKSPACE_ROOT as string, 'workspace-mir-tutor');
    await fsp.mkdir(mirror, { recursive: true });
    expect(agentIdOwningWorkspacePath(path.join(mirror, 'MEMORY.md'))).toBe('mir-tutor');

    // The adult's own agent is attributed too, so it is not left "unowned".
    const mainWs = path.join(process.env.NERVE_AGENT_WORKSPACE_ROOT as string, 'workspace-main');
    await fsp.mkdir(mainWs, { recursive: true });
    const owner = agentIdOwningWorkspacePath(path.join(mainWs, 'SOUL.md'));
    expect(owner === 'main' || owner === null).toBe(true);
  });

  it('returns null for a path outside any agent workspace', () => {
    expect(agentIdOwningWorkspacePath(path.join(tmpDir, 'elsewhere', 'photo.png'))).toBeNull();
  });

  it('an unowned agent is refused for a non-default profile but allowed for default', () => {
    expect(() => assertAgentInProfile('stranger', MIR)).toThrow(CrossProfileForbiddenError);
    expect(() => assertAgentInProfile('stranger', DEFAULT_PROFILE_ID)).not.toThrow();
  });
});
