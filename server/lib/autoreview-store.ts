/**
 * Auto Review rules store — GrokBot-style approval boundaries.
 *
 * Rules match case-insensitive substrings against an action description
 * (task title + description, routine message). Kinds:
 * - `require`: matching actions stop for explicit approval.
 * - `allow`: matching actions may proceed when no `require` rule matches.
 *   When both kinds match, `require` wins.
 *
 * Persisted in `${NERVE_DATA_DIR:-~/.nerve}/autoreview.json` with
 * mutex-protected atomic writes.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { withMutex } from './mutex.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

export type AutoReviewKind = 'require' | 'allow';

export interface AutoReviewRule {
  id: string;
  kind: AutoReviewKind;
  /** Case-insensitive substring matched against the action description. */
  pattern: string;
  createdAt: number;
}

export interface AutoReviewData {
  rules: AutoReviewRule[];
}

export class AutoReviewValidationError extends Error {}
export class AutoReviewNotFoundError extends Error {}

export interface ReviewVerdict {
  /** True when a require-rule matched and no covering approval was given. */
  blocked: boolean;
  matchedRequire: AutoReviewRule[];
  matchedAllow: AutoReviewRule[];
}

function dataFile(): string {
  const base = process.env.NERVE_DATA_DIR || path.join(os.homedir(), '.nerve');
  return path.join(base, 'autoreview.json');
}

function legacyCandidates(): string[] {
  return [
    path.join(PROJECT_ROOT, 'server-dist', 'data', 'autoreview.json'),
    path.join(PROJECT_ROOT, 'server', 'data', 'autoreview.json'),
  ];
}

function readData(): AutoReviewData {
  const file = dataFile();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<AutoReviewData>;
    return { rules: Array.isArray(raw.rules) ? raw.rules : [] };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    for (const legacy of legacyCandidates()) {
      try {
        const raw = JSON.parse(fs.readFileSync(legacy, 'utf-8')) as Partial<AutoReviewData>;
        const data: AutoReviewData = { rules: Array.isArray(raw.rules) ? raw.rules : [] };
        writeData(data);
        return data;
      } catch { /* try next */ }
    }
    return { rules: [] };
  }
}

function writeData(data: AutoReviewData): void {
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/** List all rules. */
export async function listAutoReviewRules(): Promise<AutoReviewRule[]> {
  return withMutex('autoreview', async () => readData().rules);
}

/** Add a rule. */
export async function addAutoReviewRule(kind: AutoReviewKind, pattern: string): Promise<AutoReviewRule> {
  const clean = pattern.trim();
  if (!clean || clean.length > 300) {
    throw new AutoReviewValidationError('Pattern must be 1–300 characters');
  }
  if (kind !== 'require' && kind !== 'allow') {
    throw new AutoReviewValidationError('Kind must be require or allow');
  }
  return withMutex('autoreview', async () => {
    const data = readData();
    if (data.rules.length >= 100) {
      throw new AutoReviewValidationError('Rule limit reached (100)');
    }
    const rule: AutoReviewRule = {
      id: crypto.randomUUID(),
      kind,
      pattern: clean,
      createdAt: Date.now(),
    };
    data.rules.push(rule);
    writeData(data);
    return rule;
  });
}

/** Delete a rule. */
export async function deleteAutoReviewRule(id: string): Promise<void> {
  return withMutex('autoreview', async () => {
    const data = readData();
    const index = data.rules.findIndex((r) => r.id === id);
    if (index < 0) throw new AutoReviewNotFoundError(`Rule not found: ${id}`);
    data.rules.splice(index, 1);
    writeData(data);
  });
}

/**
 * Evaluate rules against an action description. Pure (no I/O) so route
 * handlers can call it after loading rules once.
 */
export function evaluateAutoReview(rules: AutoReviewRule[], description: string): ReviewVerdict {
  const haystack = description.toLowerCase();
  const matchedRequire = rules.filter((r) => r.kind === 'require' && haystack.includes(r.pattern.toLowerCase()));
  const matchedAllow = rules.filter((r) => r.kind === 'allow' && haystack.includes(r.pattern.toLowerCase()));
  return { blocked: matchedRequire.length > 0, matchedRequire, matchedAllow };
}

/**
 * Check whether an explicit approve-once covers every matched require rule.
 */
export function approvalCovers(verdict: ReviewVerdict, approvedRuleIds: string[] | undefined): boolean {
  if (!verdict.blocked) return true;
  const approved = new Set(approvedRuleIds ?? []);
  return verdict.matchedRequire.every((r) => approved.has(r.id));
}
