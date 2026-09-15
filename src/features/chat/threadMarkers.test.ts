/** Tests for threadMarkers: prefix round-trip and thread grouping. */
import { describe, it, expect } from 'vitest';
import { formatReplyPrefix, parseReplyPrefix, parentHash, buildThreadMap } from './threadMarkers';
import type { ChatMsg } from './types';

function msg(text: string, ts = 1700000000000): ChatMsg {
  return {
    role: 'assistant',
    rawText: text,
    html: text,
    timestamp: new Date(ts),
  } as ChatMsg;
}

describe('threadMarkers', () => {
  it('round-trips a reply prefix', () => {
    const parent = msg('Hello world, this is a result.');
    const prefix = formatReplyPrefix(parent);
    expect(prefix.startsWith('> ↩')).toBe(true);
    const parsed = parseReplyPrefix(`${prefix}my reply`);
    expect(parsed?.hash).toBe(parentHash(parent));
    expect(parsed?.rest).toBe('my reply');
  });

  it('rejects non-replies', () => {
    expect(parseReplyPrefix('just a message')).toBeNull();
    expect(parseReplyPrefix('> a plain quote')).toBeNull();
  });

  it('groups replies under parents', () => {
    const parent = msg('Parent message here');
    const other = msg('Unrelated', 1700000001000);
    const reply = msg(`${formatReplyPrefix(parent)}yes, agreed`, 1700000002000);
    const map = buildThreadMap([parent, other, reply]);
    expect(map.get(parentHash(parent))).toHaveLength(1);
    expect(map.get(parentHash(other)) ?? []).toHaveLength(0);
  });

  it('produces stable hashes', () => {
    const a = msg('Same text', 100);
    const b = msg('Same text', 100);
    expect(parentHash(a)).toBe(parentHash(b));
  });
});
