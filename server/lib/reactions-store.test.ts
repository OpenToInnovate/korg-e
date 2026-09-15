/** Tests for reactions-store: toggle semantics and per-session isolation. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getSessionReactions,
  toggleReaction,
  ReactionValidationError,
} from './reactions-store.js';

let tmpDir: string;
let originalNerveDataDir: string | undefined;

beforeEach(async () => {
  originalNerveDataDir = process.env.NERVE_DATA_DIR;
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reactions-test-'));
  process.env.NERVE_DATA_DIR = tmpDir;
});

afterEach(async () => {
  if (originalNerveDataDir === undefined) delete process.env.NERVE_DATA_DIR;
  else process.env.NERVE_DATA_DIR = originalNerveDataDir;
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('reactions', () => {
  it('starts empty', async () => {
    expect(await getSessionReactions('agent:main:main')).toEqual({});
  });

  it('toggles mine on and off', async () => {
    const on = await toggleReaction('s1', 123, '🐶');
    expect(on['🐶']).toEqual({ count: 1, mine: true });
    const off = await toggleReaction('s1', 123, '🐶');
    expect(off['🐶']).toBeUndefined();
  });

  it('keeps multiple emoji per message', async () => {
    await toggleReaction('s1', 5, '👍');
    await toggleReaction('s1', 5, '❤️');
    const map = await getSessionReactions('s1');
    expect(Object.keys(map['5'] ?? {})).toHaveLength(2);
  });

  it('isolates sessions', async () => {
    await toggleReaction('s1', 5, '👍');
    expect(await getSessionReactions('s2')).toEqual({});
  });

  it('rejects bad input', async () => {
    await expect(toggleReaction('', 5, '👍')).rejects.toBeInstanceOf(ReactionValidationError);
    await expect(toggleReaction('s1', -1, '👍')).rejects.toBeInstanceOf(ReactionValidationError);
    await expect(toggleReaction('s1', 5, '')).rejects.toBeInstanceOf(ReactionValidationError);
  });

  it('persists to the data file', async () => {
    await toggleReaction('s1', 9, '🎉');
    expect(fs.existsSync(path.join(tmpDir, 'reactions.json'))).toBe(true);
  });
});
