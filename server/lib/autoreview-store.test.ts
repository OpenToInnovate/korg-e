/** Tests for autoreview-store: evaluation precedence and CRUD. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  listAutoReviewRules,
  addAutoReviewRule,
  deleteAutoReviewRule,
  evaluateAutoReview,
  approvalCovers,
  AutoReviewValidationError,
  AutoReviewNotFoundError,
} from './autoreview-store.js';

let tmpDir: string;
let originalNerveDataDir: string | undefined;

beforeEach(async () => {
  originalNerveDataDir = process.env.NERVE_DATA_DIR;
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'autoreview-test-'));
  process.env.NERVE_DATA_DIR = tmpDir;
});

afterEach(async () => {
  if (originalNerveDataDir === undefined) delete process.env.NERVE_DATA_DIR;
  else process.env.NERVE_DATA_DIR = originalNerveDataDir;
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('autoreview', () => {
  it('starts empty and persists', async () => {
    expect(await listAutoReviewRules()).toEqual([]);
    await addAutoReviewRule('require', 'send email');
    expect(fs.existsSync(path.join(tmpDir, 'autoreview.json'))).toBe(true);
    expect((await listAutoReviewRules())).toHaveLength(1);
  });

  it('validates input', async () => {
    await expect(addAutoReviewRule('require', '  ')).rejects.toBeInstanceOf(AutoReviewValidationError);
    await expect(deleteAutoReviewRule('missing')).rejects.toBeInstanceOf(AutoReviewNotFoundError);
  });

  it('blocks on require matches (case-insensitive)', async () => {
    const rules = [await addAutoReviewRule('require', 'Send Email')];
    const verdict = evaluateAutoReview(rules, 'please SEND EMAIL to the team');
    expect(verdict.blocked).toBe(true);
    expect(verdict.matchedRequire).toHaveLength(1);
  });

  it('lets require win over allow', async () => {
    const rules = [
      await addAutoReviewRule('allow', 'git status'),
      await addAutoReviewRule('require', 'production'),
    ];
    const verdict = evaluateAutoReview(rules, 'run git status on production');
    expect(verdict.blocked).toBe(true);
    expect(verdict.matchedAllow).toHaveLength(1);
  });

  it('passes when nothing matches', async () => {
    const rules = [await addAutoReviewRule('require', 'production')];
    expect(evaluateAutoReview(rules, 'read the docs').blocked).toBe(false);
  });

  it('approve-once must cover every matched rule', async () => {
    const a = await addAutoReviewRule('require', 'email');
    const b = await addAutoReviewRule('require', 'external');
    const verdict = evaluateAutoReview([a, b], 'send external email');
    expect(approvalCovers(verdict, [a.id])).toBe(false);
    expect(approvalCovers(verdict, [a.id, b.id])).toBe(true);
    expect(approvalCovers(evaluateAutoReview([a], 'read docs'), [])).toBe(true);
  });

  it('deletes rules', async () => {
    const rule = await addAutoReviewRule('allow', 'git status');
    await deleteAutoReviewRule(rule.id);
    expect(await listAutoReviewRules()).toEqual([]);
  });
});
