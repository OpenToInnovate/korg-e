/** Tests for the core-update guard (Nerve/core-update isolation). */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

let execFileImpl: (bin: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string) => void) => void;

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const mock = {
    ...actual,
    execFile: (bin: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string) => void) =>
      execFileImpl(bin, args, opts, cb),
  };
  return { ...mock, default: mock };
});

vi.mock('./openclaw-bin.js', () => ({
  resolveOpenclawBin: () => '/usr/bin/openclaw',
}));

import {
  assertConfigSetPathAllowed,
  assertCoreMutationAllowed,
  assertOpenclawArgsAllowed,
  CoreUpdateGuardError,
  isAgentIdSafe,
  isConfigSetPathAllowed,
  isCoreUpdateActive,
  _resetCoreUpdateGuardCache,
} from './core-update-guard.js';

function statusJson(lastRun: unknown): string {
  return JSON.stringify({ lastRun });
}

describe('core-update-guard', () => {
  beforeEach(() => {
    _resetCoreUpdateGuardCache();
    execFileImpl = (_bin, _args, _opts, cb) => cb(null, statusJson({ phase: 'finished', status: 'ok' }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('agent id validation', () => {
    it('accepts plain agent ids', () => {
      expect(isAgentIdSafe('main')).toBe(true);
      expect(isAgentIdSafe('korg-e-squad-alpha')).toBe(true);
      expect(isAgentIdSafe('agent_1')).toBe(true);
    });

    it('rejects path traversal and injection', () => {
      expect(isAgentIdSafe('')).toBe(false);
      expect(isAgentIdSafe('../x')).toBe(false);
      expect(isAgentIdSafe('a.b')).toBe(false);
      expect(isAgentIdSafe('a b')).toBe(false);
      expect(isAgentIdSafe('a/b')).toBe(false);
      expect(isAgentIdSafe('a;rm -rf ~')).toBe(false);
      expect(isAgentIdSafe('$(id)')).toBe(false);
    });
  });

  describe('config set allowlist', () => {
    it('allows the roster delegation subtree', () => {
      expect(isConfigSetPathAllowed('agents.entries.alpha.subagents.allowAgents')).toBe(true);
      expect(isConfigSetPathAllowed('agents.entries.alpha.subagents.delegationMode')).toBe(true);
    });

    it('rejects core paths', () => {
      for (const p of [
        'gateway.auth.token',
        'gateway.bind',
        'gateway.controlUi.allowedOrigins',
        'channels',
        'plugins.entries.parallel.enabled',
        'agents.defaults.workspace',
        'agents.entries.alpha.subagents.allowAgents.extra',
        'agents.entries..subagents.allowAgents',
        'agents.entries.a b.subagents.allowAgents',
      ]) {
        expect(isConfigSetPathAllowed(p)).toBe(false);
        expect(() => assertConfigSetPathAllowed(p)).toThrow(CoreUpdateGuardError);
      }
    });
  });

  describe('subcommand blocklist', () => {
    it('blocks core lifecycle subcommands', () => {
      for (const args of [
        ['update'],
        ['update', 'repair'],
        ['doctor'],
        ['doctor', '--fix'],
        ['triage'],
        ['gateway', 'install'],
        ['gateway', 'uninstall'],
      ]) {
        expect(() => assertOpenclawArgsAllowed(args)).toThrow(CoreUpdateGuardError);
      }
    });

    it('allows UI-safe operations', () => {
      expect(() => assertOpenclawArgsAllowed(['gateway', 'restart'])).not.toThrow();
      expect(() => assertOpenclawArgsAllowed(['gateway', 'status'])).not.toThrow();
      expect(() => assertOpenclawArgsAllowed(['plugins', 'install', 'clawhub:foo'])).not.toThrow();
      expect(() => assertOpenclawArgsAllowed(['skills', 'list', '--json'])).not.toThrow();
      expect(() =>
        assertOpenclawArgsAllowed(['config', 'set', 'agents.entries.alpha.subagents.allowAgents', '[]', '--strict-json']),
      ).not.toThrow();
    });

    it('blocks config set outside the allowlist', () => {
      expect(() => assertOpenclawArgsAllowed(['config', 'set', 'gateway.bind', '"lan"'])).toThrow(
        CoreUpdateGuardError,
      );
    });
  });

  describe('update-activity detection', () => {
    it('reports inactive when the last run finished', async () => {
      await expect(isCoreUpdateActive()).resolves.toEqual({ active: false, detail: '' });
      await expect(assertCoreMutationAllowed()).resolves.toBeUndefined();
    });

    it('reports active while a run is in a non-finished phase', async () => {
      execFileImpl = (_bin, _args, _opts, cb) =>
        cb(null, statusJson({ phase: 'activating', status: 'running', target: { version: '2026.9.5' } }));
      const state = await isCoreUpdateActive();
      expect(state.active).toBe(true);
      expect(state.detail).toContain('activating');
      await expect(assertCoreMutationAllowed()).rejects.toThrow(CoreUpdateGuardError);
    });

    it('fails open when the status probe errors', async () => {
      execFileImpl = (_bin, _args, _opts, cb) => cb(new Error('ENOENT'), '');
      await expect(isCoreUpdateActive()).resolves.toEqual({ active: false, detail: '' });
      await expect(assertCoreMutationAllowed()).resolves.toBeUndefined();
    });

    it('fails open on unparsable output', async () => {
      execFileImpl = (_bin, _args, _opts, cb) => cb(null, 'not json');
      await expect(isCoreUpdateActive()).resolves.toEqual({ active: false, detail: '' });
    });
  });
});
