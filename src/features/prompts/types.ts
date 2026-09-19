/** Shared types for OpenClaw pending prompts (question records). */
export interface PromptQuestionItem {
  questionId: string;
  header: string;
  question: string;
  url?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
  isSecret?: boolean;
  secretStore?: {
    name: string;
    kind: 'secret' | 'env';
    allowedHosts?: string[];
    reason?: string;
  };
  secretStoreExisting?: {
    updatedAtMs: number;
    updatedBy?: string;
  };
}

export interface PendingPromptRecord {
  id: string;
  questions: PromptQuestionItem[];
  agentId?: string;
  sessionKey?: string;
  runId?: string;
  createdAtMs: number;
  expiresAtMs: number;
  status: string;
}

export type { PendingPromptRecord as ServerPendingPromptRecord };
