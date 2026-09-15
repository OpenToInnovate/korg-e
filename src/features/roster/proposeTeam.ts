import { BOT_TEMPLATES, type BotTemplate } from './botTemplates';

/** A teammate the wizard can propose for approval before creating. */
export interface ProposedBot {
  templateId: string;
  name: string;
  title: string;
  description: string;
  avatar: BotTemplate['avatar'];
  color: string;
  skills: string[];
}

const KEYWORDS: Array<{ test: RegExp; templateId: string }> = [
  { test: /research|find|source|discover|scan/i, templateId: 'researcher' },
  { test: /writ|content|copy|blog|post|draft/i, templateId: 'writer' },
  { test: /code|app|build|engineer|dev|bug|repo|ship/i, templateId: 'coder' },
  { test: /review|qa|test|quality|verify/i, templateId: 'reviewer' },
  { test: /data|metric|analytic|report|number|chart/i, templateId: 'analyst' },
  { test: /support|customer|ticket|help ?desk/i, templateId: 'support' },
  { test: /design|ui|ux|brand|visual/i, templateId: 'designer' },
  { test: /ops|deploy|monitor|routine|infra/i, templateId: 'ops' },
];

const DEFAULT_TEAM = ['researcher', 'writer', 'reviewer'];

function toProposed(t: BotTemplate): ProposedBot {
  return {
    templateId: t.id,
    name: t.name,
    title: t.title,
    description: t.description,
    avatar: t.avatar,
    color: t.color,
    skills: t.suggestedSkills,
  };
}

/**
 * Propose a small team for a group from its name/description. Deterministic and
 * local, so the wizard works without an agent round-trip; the user reviews and
 * approves every proposal before any bot is created.
 */
export function proposeTeam(groupName: string, blurb = '', max = 4): ProposedBot[] {
  const text = `${groupName} ${blurb}`;
  const byId = new Map(BOT_TEMPLATES.map((t) => [t.id, t]));
  const picked: string[] = [];

  for (const { test, templateId } of KEYWORDS) {
    if (test.test(text) && !picked.includes(templateId)) picked.push(templateId);
  }
  for (const id of DEFAULT_TEAM) {
    if (picked.length >= max) break;
    if (!picked.includes(id)) picked.push(id);
  }

  return picked
    .slice(0, max)
    .map((id) => byId.get(id))
    .filter((t): t is BotTemplate => Boolean(t))
    .map(toProposed);
}