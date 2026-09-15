/**
 * Best-effort importer for a Grok Bot configuration.
 *
 * Grok Bot's share format is not publicly documented, so this accepts a pasted
 * JSON config (or the JSON body behind a share link) and maps the common
 * fields we can recognise. Anything unrecognised is reported, never guessed
 * into the profile. The caller shows a preview before creating anything.
 */

export interface GrokImportResult {
  name?: string;
  title?: string;
  description?: string;
  skills: string[];
  routineCount: number;
  /** Field names that were found in the payload (for the preview UI). */
  matched: string[];
  /** Field names present in the payload that we ignored. */
  ignored: string[];
}

export type GrokImportOutcome =
  | { ok: true; result: GrokImportResult }
  | { ok: false; error: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function namesFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) out.push(item.trim());
    else {
      const rec = asRecord(item);
      const name = firstString(rec.name, rec.slug, rec.id, rec.displayName);
      if (name) out.push(name);
    }
  }
  return out;
}

function unwrap(root: Record<string, unknown>): Record<string, unknown> {
  for (const key of ['bot', 'agent', 'data', 'config', 'profile']) {
    const inner = root[key];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner as Record<string, unknown>;
  }
  return root;
}

/** Parse pasted Grok Bot config JSON into a partial bot profile. */
export function parseGrokBot(input: string): GrokImportOutcome {
  const text = input.trim();
  if (!text) return { ok: false, error: 'Paste a Grok Bot config or share JSON first.' };
  if (/^https?:\/\//i.test(text)) {
    return { ok: false, error: 'Share URLs need a login and cannot be read automatically. Open the share page, export/copy the bot config JSON, and paste that here.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That is not valid JSON. Paste the bot config JSON (starting with { ).' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Expected a JSON object describing one bot.' };
  }

  const root = asRecord(parsed);
  const bot = unwrap(root);
  const source = Object.keys(bot).length ? bot : root;

  const name = firstString(source.name, source.displayName, source.identityName);
  const title = firstString(source.title, source.role, source.job, source.tagline);
  const description = firstString(
    source.description,
    source.instructions,
    source.persona,
    source.systemPrompt,
    source.system_prompt,
    source.prompt,
    source.summary,
  );
  const skills = namesFrom(source.skills);
  const routines = Array.isArray(source.routines)
    ? source.routines
    : Array.isArray(source.schedules)
      ? source.schedules
      : Array.isArray(source.automations)
        ? source.automations
        : [];

  const matched: string[] = [];
  if (name) matched.push('name');
  if (title) matched.push('title');
  if (description) matched.push('description');
  if (skills.length) matched.push('skills');
  if (routines.length) matched.push('routines');

  const known = new Set(['name', 'displayName', 'identityName', 'title', 'role', 'job', 'tagline', 'description', 'instructions', 'persona', 'systemPrompt', 'system_prompt', 'prompt', 'summary', 'skills', 'routines', 'schedules', 'automations']);
  const ignored = Object.keys(source).filter((k) => !known.has(k)).slice(0, 12);

  if (matched.length === 0) {
    return { ok: false, error: 'No usable fields found. Expected at least a name, description, or skills list.' };
  }

  return {
    ok: true,
    result: { name, title, description, skills, routineCount: routines.length, matched, ignored },
  };
}