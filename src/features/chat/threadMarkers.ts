import type { ChatMsg } from './types';

/** Threaded replies via quote-linked messages (no gateway changes needed). */

function hashParent(msg: ChatMsg): string {
  const ts = msg.timestamp instanceof Date ? msg.timestamp.getTime() : 0;
  const basis = `${ts}:${msg.rawText}`;
  let h = 0;
  for (let i = 0; i < basis.length; i++) h = (h * 31 + basis.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 6).padStart(6, '0');
}

function excerptOf(msg: ChatMsg): string {
  const first = msg.rawText.split('\n').find((line) => line.trim().length > 0) ?? '';
  return first.length > 120 ? `${first.slice(0, 120)}…` : first;
}

/** Prefix for a reply: blockquote so it renders natively in the transcript. */
export function formatReplyPrefix(parent: ChatMsg): string {
  return `> ↩ ${excerptOf(parent)} [${hashParent(parent)}]\n\n`;
}

export interface ParsedReply {
  hash: string;
  rest: string;
}

/** Parse a thread-reply prefix back into its parent hash + body. */
export function parseReplyPrefix(text: string): ParsedReply | null {
  const match = /^>\s*↩\s.*\[([0-9a-z]{6})\]\n\n([\s\S]*)$/.exec(text);
  if (!match) return null;
  return { hash: match[1], rest: match[2] };
}

/** Hash identifying a message as a potential thread parent. */
export function parentHash(msg: ChatMsg): string {
  return hashParent(msg);
}

/** Group messages into threads: parent hash → reply messages. */
export function buildThreadMap(messages: ChatMsg[]): Map<string, ChatMsg[]> {
  const map = new Map<string, ChatMsg[]>();
  for (const msg of messages) {
    const parsed = parseReplyPrefix(msg.rawText);
    if (!parsed) continue;
    const list = map.get(parsed.hash) ?? [];
    list.push(msg);
    map.set(parsed.hash, list);
  }
  return map;
}
