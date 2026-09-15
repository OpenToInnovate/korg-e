/** Shared Auto Review approval-gate error (thrown when require-rules match). */

export interface AutoReviewRuleRef {
  id: string;
  pattern: string;
}

export class AutoReviewRequiredError extends Error {
  rules: AutoReviewRuleRef[];
  constructor(rules: AutoReviewRuleRef[], message?: string) {
    super(message ?? `Auto Review requires approval for: ${rules.map((r) => `"${r.pattern}"`).join(', ')}`);
    this.name = 'AutoReviewRequiredError';
    this.rules = rules;
  }
}

/** Extract an approval gate from an API error body, if present. */
export function approvalRulesFromBody(body: unknown): AutoReviewRuleRef[] | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { error?: unknown; rules?: unknown };
  if (b.error !== 'approval_required' || !Array.isArray(b.rules)) return null;
  const rules = b.rules.filter(
    (r): r is AutoReviewRuleRef =>
      !!r && typeof r === 'object' && typeof (r as { id: unknown }).id === 'string' && typeof (r as { pattern: unknown }).pattern === 'string',
  );
  return rules;
}
