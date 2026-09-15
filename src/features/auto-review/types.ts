/** Shared Auto Review types (mirror server/lib/autoreview-store.ts). */

export type AutoReviewKind = 'require' | 'allow';

export interface AutoReviewRule {
  id: string;
  kind: AutoReviewKind;
  pattern: string;
  createdAt: number;
}
