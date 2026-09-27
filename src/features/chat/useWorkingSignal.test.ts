import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWorkingSignal } from './useWorkingSignal';
import type { Session } from '@/types';

const ALPHA: Session = { sessionKey: 'agent:alpha:main' };
const SUBAGENT: Session = { sessionKey: 'agent:alpha:subagent:build' };
const MEMBER: Session = { sessionKey: 'agent:designer:main' };
const UNRELATED: Session = { sessionKey: 'agent:unrelated-bot:main' };

function run(opts: Partial<Parameters<typeof useWorkingSignal>[0]> = {}) {
  return renderHook(() => useWorkingSignal({
    currentSession: ALPHA.sessionKey as string,
    sessions: [ALPHA, SUBAGENT, MEMBER, UNRELATED],
    busyState: {},
    isGenerating: false,
    ...opts,
  })).result.current;
}

describe('useWorkingSignal', () => {
  it('is off when nothing is happening', () => {
    expect(run().working).toBe(false);
  });

  it('is on while this conversation is generating', () => {
    expect(run({ isGenerating: true }).working).toBe(true);
  });

  it('is on when the open session itself is busy', () => {
    const result = run({ busyState: { 'agent:alpha:main': true } });
    expect(result.working).toBe(true);
    expect(result.busySessionKeys).toEqual(['agent:alpha:main']);
  });

  it('is on for a squad run where a sub-agent of this chat is busy', () => {
    // This is the gap Tony hit: the Alpha delegates, this panel is idle, and
    // nothing was shown at all.
    const result = run({ busyState: { 'agent:alpha:subagent:build': true } });
    expect(result.working).toBe(true);
    expect(result.busySessionKeys).toEqual(['agent:alpha:subagent:build']);
  });

  it('is on when an explicit group-chat member is busy', () => {
    const result = run({
      memberSessionKeys: ['agent:designer:main'],
      busyState: { 'agent:designer:main': true },
    });
    expect(result.working).toBe(true);
    expect(result.busySessionKeys).toEqual(['agent:designer:main']);
  });

  it('does not light up for an unrelated bot working elsewhere', () => {
    // No false positives: another family's bot must not imply this one works.
    expect(run({ busyState: { 'agent:unrelated-bot:main': true } }).working).toBe(false);
  });

  it('REGRESSION: is NOT working once the response has arrived', () => {
    // Run finished -> gateway reports IDLE/DONE, generation over. The signal
    // must be off, not stuck spinning.
    const result = run({ busyState: {}, isGenerating: false });
    expect(result.working).toBe(false);
    expect(result.busySessionKeys).toEqual([]);
  });

  it('clears on abort: generation stopped and busy flag dropped', () => {
    const working = run({ busyState: { 'agent:alpha:main': true }, isGenerating: true }).working;
    expect(working).toBe(true);

    // Abort -> AbortController fires, busy clears.
    const afterAbort = run({ busyState: {}, isGenerating: false });
    expect(afterAbort.working).toBe(false);
  });

  it('clears on error: run ends without producing output', () => {
    const result = run({ busyState: { 'agent:alpha:main': false }, isGenerating: false });
    expect(result.working).toBe(false);
  });

  it('is off with no open session', () => {
    expect(run({ currentSession: '', isGenerating: true }).working).toBe(false);
  });

  it('tracks multiple busy sessions at once', () => {
    const result = run({
      memberSessionKeys: ['agent:designer:main'],
      busyState: { 'agent:alpha:main': true, 'agent:designer:main': true },
    });
    expect(result.working).toBe(true);
    expect(result.busySessionKeys).toHaveLength(2);
  });
});
