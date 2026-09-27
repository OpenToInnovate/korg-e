import { describe, it, expect } from 'vitest';
import {
  toAgentSessionKey,
  toBareAgentId,
  isAgentSessionKey,
  isUnlinkedBot,
  slugifyAgentId,
} from './agentKeys';

describe('agentKeys', () => {
  it('converts a bare agent id to a full session key', () => {
    // This is the exact conversion whose absence caused the shell-bot bug.
    expect(toAgentSessionKey('mir-tutor')).toBe('agent:mir-tutor:main');
  });

  it('leaves a full session key unchanged (normalised to :main)', () => {
    expect(toAgentSessionKey('agent:mir-tutor:main')).toBe('agent:mir-tutor:main');
    expect(toAgentSessionKey('agent:mir-tutor:subagent:x')).toBe('agent:mir-tutor:main');
  });

  it('never returns a bare id', () => {
    for (const input of ['mir-tutor', 'agent:mir-tutor:main', '  builder  ']) {
      expect(isAgentSessionKey(toAgentSessionKey(input))).toBe(true);
    }
  });

  it('handles empty and nullish input safely', () => {
    expect(toAgentSessionKey(null)).toBe('');
    expect(toAgentSessionKey(undefined)).toBe('');
    expect(toAgentSessionKey('')).toBe('');
  });

  it('extracts the bare id from a session key', () => {
    expect(toBareAgentId('agent:mir-tutor:main')).toBe('mir-tutor');
    expect(toBareAgentId('mir-tutor')).toBe('mir-tutor');
  });

  it('identifies unlinked bots', () => {
    expect(isUnlinkedBot(null)).toBe(true);
    expect(isUnlinkedBot('')).toBe(true);
    expect(isUnlinkedBot('   ')).toBe(true);
    expect(isUnlinkedBot('mir-tutor')).toBe(false);
    expect(isUnlinkedBot('agent:mir-tutor:main')).toBe(false);
  });

  it('slugifies names into valid agent ids', () => {
    expect(slugifyAgentId('Bot Maintainer')).toBe('bot-maintainer');
    expect(slugifyAgentId('  Data & Pipelines!  ')).toBe('data-pipelines');
    expect(slugifyAgentId('---')).toBe('agent');
    expect(slugifyAgentId('')).toBe('agent');
  });

  it('produces session keys that round-trip through the bare id', () => {
    const key = toAgentSessionKey(slugifyAgentId('Bot Maintainer'));
    expect(key).toBe('agent:bot-maintainer:main');
    expect(toBareAgentId(key)).toBe('bot-maintainer');
  });
});
