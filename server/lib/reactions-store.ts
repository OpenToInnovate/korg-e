/**
 * Reactions store — lightweight emoji acknowledgements on messages.
 *
 * Reactions are a Nerve-side overlay keyed by `(sessionKey, messageTimestamp)`,
 * so they work on any gateway transcript without protocol changes. Single
 * user: each emoji tracks a count plus whether "I" reacted.
 * Persisted in `${NERVE_DATA_DIR:-~/.nerve}/reactions.json` with
 * mutex-protected atomic writes.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withMutex } from './mutex.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

export interface ReactionSummary {
  [emoji: string]: { count: number; mine: boolean };
}

export type SessionReactions = Record<string, ReactionSummary>;
export type ReactionData = Record<string, SessionReactions>;

export class ReactionValidationError extends Error {}

const MAX_EMOJI_LENGTH = 12;
const MAX_SESSION_KEY_LENGTH = 300;

function dataFile(): string {
  const base = process.env.NERVE_DATA_DIR || path.join(os.homedir(), '.nerve');
  return path.join(base, 'reactions.json');
}

function legacyCandidates(): string[] {
  return [
    path.join(PROJECT_ROOT, 'server-dist', 'data', 'reactions.json'),
    path.join(PROJECT_ROOT, 'server', 'data', 'reactions.json'),
  ];
}

function readData(): ReactionData {
  const file = dataFile();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as ReactionData;
    return raw && typeof raw === 'object' ? raw : {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    for (const legacy of legacyCandidates()) {
      try {
        const raw = JSON.parse(fs.readFileSync(legacy, 'utf-8')) as ReactionData;
        const data = raw && typeof raw === 'object' ? raw : {};
        writeData(data);
        return data;
      } catch { /* try next */ }
    }
    return {};
  }
}

function writeData(data: ReactionData): void {
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

export function validateReactionInput(sessionKey: string, messageTs: number, emoji: string): void {
  if (!sessionKey || sessionKey.length > MAX_SESSION_KEY_LENGTH) {
    throw new ReactionValidationError('Invalid sessionKey');
  }
  if (!Number.isInteger(messageTs) || messageTs < 0) {
    throw new ReactionValidationError('Invalid messageTs');
  }
  if (!emoji || [...emoji].length > MAX_EMOJI_LENGTH) {
    throw new ReactionValidationError('Invalid emoji');
  }
}

/** Reactions for one session (messageTs → summary). */
export async function getSessionReactions(sessionKey: string): Promise<SessionReactions> {
  return withMutex('reactions', async () => readData()[sessionKey] ?? {});
}

/** Toggle my reaction; returns the updated summary for the message. */
export async function toggleReaction(sessionKey: string, messageTs: number, emoji: string): Promise<ReactionSummary> {
  validateReactionInput(sessionKey, messageTs, emoji);
  return withMutex('reactions', async () => {
    const data = readData();
    const key = String(messageTs);
    data[sessionKey] ??= {};
    data[sessionKey][key] ??= {};
    const entry = data[sessionKey][key];
    const current = entry[emoji];
    if (current?.mine) {
      const count = current.count - 1;
      if (count <= 0) delete entry[emoji];
      else entry[emoji] = { count, mine: false };
    } else {
      entry[emoji] = { count: (current?.count ?? 0) + 1, mine: true };
    }
    if (Object.keys(entry).length === 0) delete data[sessionKey][key];
    writeData(data);
    return { ...(data[sessionKey]?.[key] ?? {}) };
  });
}
