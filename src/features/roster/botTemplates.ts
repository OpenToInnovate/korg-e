import type { CorgiVariantId } from '@/components/corgi/corgiVariants';

export interface BotTemplate {
  id: string;
  /** Short role name used as the default bot name. */
  name: string;
  title: string;
  /** Operational description + boundaries, in the Grok Bot style. */
  description: string;
  avatar: CorgiVariantId;
  color: string;
  /** ClawHub skill names or hints the bot likely wants. */
  suggestedSkills: string[];
}

/**
 * Curated starter roles. These create a normal Korg-e bot with a strong
 * operational prompt; suggested skills are hints the user can install from
 * the marketplace.
 */
export const BOT_TEMPLATES: BotTemplate[] = [
  {
    id: 'researcher',
    name: 'Researcher',
    title: 'Research & synthesis',
    description: 'Research one topic at a time. Use the web and documents I share. Summarize findings with source links, separate facts from inferences, and never change an external service without approval.',
    avatar: 'cardigan',
    color: '#0A84FF',
    suggestedSkills: ['web-search', 'summarize', 'citations'],
  },
  {
    id: 'writer',
    name: 'Writer',
    title: 'Drafting & editing',
    description: 'Turn briefs and findings into clear drafts in my voice. Show a draft before publishing, keep claims linked to sources, and never send or publish anything without approval.',
    avatar: 'classic',
    color: '#BF5AF2',
    suggestedSkills: ['copywriting', 'style-guide'],
  },
  {
    id: 'coder',
    name: 'Coder',
    title: 'Build & debug',
    description: 'Own the repo you are given. Make small, reviewable changes, run tests before reporting, and never push, deploy, or change production without approval.',
    avatar: 'zoomies',
    color: '#30D158',
    suggestedSkills: ['git', 'code-review', 'testing'],
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    title: 'Critical review',
    description: 'Review drafts and diffs against the stated criteria. List only blocking issues with evidence, never rewrite the work yourself, and stop at recommendations.',
    avatar: 'sleepy',
    color: '#FF9F0A',
    suggestedSkills: ['code-review', 'fact-check'],
  },
  {
    id: 'analyst',
    name: 'Analyst',
    title: 'Data & metrics',
    description: 'Analyze the data I provide, cite the query or file behind every number, flag stale or missing data instead of guessing, and keep customer-facing actions behind approval.',
    avatar: 'toast',
    color: '#64D2FF',
    suggestedSkills: ['data-analysis', 'charts'],
  },
  {
    id: 'ops',
    name: 'Ops',
    title: 'Routines & monitoring',
    description: 'Run recurring checks on a schedule, report a short status with links, and require approval before any write, restart, or production change.',
    avatar: 'sploot',
    color: '#5E5CE6',
    suggestedSkills: ['monitoring'],
  },
  {
    id: 'support',
    name: 'Support',
    title: 'Customer replies',
    description: 'Draft replies from the knowledge base with citations. Never contact a customer without approval, and escalate anything you are unsure about.',
    avatar: 'chef',
    color: '#FF375F',
    suggestedSkills: ['knowledge-base'],
  },
  {
    id: 'designer',
    name: 'Designer',
    title: 'Interface & assets',
    description: 'Explore options from real references, produce work I can inspect and edit, and keep brand and licensing constraints in mind.',
    avatar: 'party',
    color: '#AF52DE',
    suggestedSkills: ['design-references'],
  },
];

export const BOT_TEMPLATE_IDS = BOT_TEMPLATES.map((t) => t.id);