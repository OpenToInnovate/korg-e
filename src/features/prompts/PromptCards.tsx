import { useMemo, useRef, useState } from 'react';
import { KeyRound, HelpCircle, X } from 'lucide-react';
import { useSessionContext } from '@/contexts/SessionContext';
import { usePendingPrompts } from './usePendingPrompts';
import type { PendingPromptRecord, PromptQuestionItem } from './types';

/**
 * Interactive prompt cards docked above the composer (stock Control UI
 * parity): masked-input cards for OpenClaw `secrets` credential requests and
 * question chips for `ask_user` prompts. Pending prompts are polled from the
 * Nerve server (which proxies the Gateway's `question.list` / `question.resolve`
 * WS RPCs). Secret values are held only in an uncontrolled input and forwarded
 * directly to the Gateway secret store — never logged, stored, or sent to chat.
 */
export function PromptCards() {
  const { currentSession } = useSessionContext();
  const { prompts, error, answerPrompt, submitSecret, skipPrompt } = usePendingPrompts(currentSession);
  const [busyId, setBusyId] = useState<string | null>(null);

  const visible = useMemo(
    () => prompts.filter((p) => p.status === 'pending' && p.questions.length > 0),
    [prompts],
  );

  if (visible.length === 0) return null;

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    try {
      await fn();
    } catch (err) {
      console.warn('[prompts] action failed:', err instanceof Error ? err.message : err);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="border-t border-border/60 bg-card/60 px-3 py-2" role="region" aria-label="Pending prompts">
      <div className="mb-1.5 text-2xs font-semibold text-muted-foreground">
        {visible.length === 1 ? '⏳ 1 prompt waiting for you' : `⏳ ${visible.length} prompts waiting for you`}
      </div>
      <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
        {visible.map((p) => (
          <PromptCard
            key={p.id}
            prompt={p}
            busy={busyId === p.id}
            onAnswer={(answers) => act(p.id, () => answerPrompt(p.id, answers))}
            onSecret={(questionId, value, hosts) => act(p.id, () => submitSecret(p.id, questionId, value, hosts))}
            onSkip={() => act(p.id, () => skipPrompt(p.id))}
          />
        ))}
      </div>
      {error && <div className="mt-1.5 text-xs text-destructive">{error}</div>}
    </div>
  );
}

interface PromptCardProps {
  prompt: PendingPromptRecord;
  busy: boolean;
  onAnswer: (answers: Record<string, string[]>) => Promise<void>;
  onSecret: (secretQuestionId: string, value: string, allowedHosts?: string[]) => Promise<void>;
  onSkip: () => Promise<void>;
}

function PromptCard({ prompt, busy, onAnswer, onSecret, onSkip }: PromptCardProps) {
  const isSecret = prompt.questions.some((q) => q.secretStore || q.isSecret);
  return isSecret ? (
    <SecretRequestCard prompt={prompt} busy={busy} onSecret={onSecret} onSkip={onSkip} />
  ) : (
    <QuestionCard prompt={prompt} busy={busy} onAnswer={onAnswer} onSkip={onSkip} />
  );
}

/** Stepper index state shared by multi-question cards. */
function useQuestionStepper(count: number) {
  const [step, setStep] = useState(0);
  const clamped = Math.min(step, Math.max(0, count - 1));
  return {
    step: clamped,
    next: () => setStep((s) => Math.min(s + 1, count - 1)),
    prev: () => setStep((s) => Math.max(0, s - 1)),
  };
}

function CardShell({ icon, title, meta, children, onSkip, busy }: {
  icon: React.ReactNode;
  title: string;
  meta: string;
  children?: React.ReactNode;
  onSkip: () => Promise<void>;
  busy: boolean;
}) {
  return (
    <div className="rounded-2xl border border-primary/25 bg-background px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-primary">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium leading-5">{title}</div>
          <div className="truncate text-xs text-muted-foreground">{meta}</div>
        </div>
        <button
          type="button"
          onClick={() => void onSkip()}
          disabled={busy}
          aria-label="Skip prompt"
          title="Skip (the agent continues without an answer)"
          className="shell-icon-button min-h-9 min-w-9 justify-center rounded-xl"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  );
}

// ── Masked-input card for `secrets` credential requests ──────────────

function SecretRequestCard({ prompt, busy, onSecret, onSkip }: {
  prompt: PendingPromptRecord;
  busy: boolean;
  onSecret: (secretQuestionId: string, value: string, allowedHosts?: string[]) => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const q: PromptQuestionItem | undefined = prompt.questions.find((item) => item.secretStore) ?? prompt.questions[0];
  const valueRef = useRef<HTMLInputElement>(null);
  const [hosts, setHosts] = useState<string[]>(q?.secretStore?.allowedHosts ?? []);
  const [hostDraft, setHostDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const binding = q?.secretStore;

  if (!q || !binding) return null;

  const existing = q.secretStoreExisting;
  const updatedLabel = existing
    ? `replaces existing entry (updated ${new Date(existing.updatedAtMs).toLocaleString()})`
    : 'new entry';

  const submit = async () => {
    const value = valueRef.current?.value ?? '';
    if (!value.trim()) {
      setError('Enter the credential value.');
      return;
    }
    setError(null);
    try {
      // The value lives only in the DOM input; it is forwarded to the Gateway
      // and the field is cleared immediately after.
      await onSecret(q.questionId, value, hosts);
      if (valueRef.current) valueRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
      return;
    }
  };

  const addHost = () => {
    const h = hostDraft.trim().toLowerCase();
    if (h && !hosts.includes(h) && hosts.length < 128) setHosts([...hosts, h]);
    setHostDraft('');
  };

  return (
    <CardShell
      icon={<KeyRound className="h-4 w-4" />}
      title={binding.kind === 'env' ? `${binding.name} (env)` : binding.name}
      meta={`${prompt.agentId ?? 'agent'} · ${binding.reason || q.question || 'credential request'} · ${updatedLabel}`}
      onSkip={onSkip}
      busy={busy}
    >
      <div className="mt-2 text-xs text-muted-foreground">
        {hosts.length === 0
          ? 'No egress hosts — the credential stays usable via config references only.'
          : 'Allowed hosts (editable):'}
      </div>
      {hosts.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {hosts.map((h) => (
            <span key={h} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-2xs">
              {h}
              <button
                type="button"
                aria-label={`Remove host ${h}`}
                onClick={() => setHosts(hosts.filter((x) => x !== h))}
                className="text-muted-foreground hover:text-destructive"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-1.5 flex gap-1">
        <input
          value={hostDraft}
          onChange={(e) => setHostDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addHost(); } }}
          placeholder="add host (e.g. api.stripe.com)"
          aria-label="Add allowed host"
          className="min-h-9 flex-1 rounded-xl border border-border bg-transparent px-2 text-xs"
        />
        <button type="button" onClick={addHost} className="cockpit-toolbar-button min-h-9 px-3 text-xs">Add</button>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          ref={valueRef}
          type="password"
          autoComplete="off"
          disabled={busy}
          placeholder="Enter value (masked)"
          aria-label={`Value for ${binding.name}`}
          className="min-h-11 flex-1 rounded-xl border border-border bg-transparent px-3 font-mono text-sm"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="cockpit-toolbar-button min-h-11 flex-1 justify-center text-xs font-semibold"
        >
          {busy ? 'Working…' : 'Store'}
        </button>
      </div>
      <div className="mt-1 text-2xs text-muted-foreground">
        The value goes straight to the Gateway secret store — never into the chat.
      </div>
      {error && <div className="mt-1 text-xs text-destructive">{error}</div>}
    </CardShell>
  );
}

// ── Question chips card for `ask_user` prompts ────────────────────────

function QuestionCard({ prompt, busy, onAnswer, onSkip }: {
  prompt: PendingPromptRecord;
  busy: boolean;
  onAnswer: (answers: Record<string, string[]>) => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const { step, next, prev } = useQuestionStepper(prompt.questions.length);
  const q = prompt.questions[step];
  const [selected, setSelected] = useState<string[]>([]);
  const [otherDraft, setOtherDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const collectedRef = useRef<Record<string, string[]>>({});

  if (!q) return null;

  const toggle = (label: string) => {
    if (q.multiSelect) {
      setSelected((prevSel) => prevSel.includes(label) ? prevSel.filter((l) => l !== label) : [...prevSel, label]);
    } else {
      setSelected([label]);
    }
  };

  const confirmStep = async () => {
    setError(null);
    const other = otherDraft.trim();
    const values = other ? [...selected, other] : selected;
    if (values.length === 0) {
      setError('Pick an option or type your own answer.');
      return;
    }
    collectedRef.current = { ...collectedRef.current, [q.questionId]: values };
    setSelected([]);
    setOtherDraft('');

    if (step < prompt.questions.length - 1) {
      next();
      return;
    }
    try {
      await onAnswer(collectedRef.current);
      collectedRef.current = {};
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    }
  };

  return (
    <CardShell
      icon={<HelpCircle className="h-4 w-4" />}
      title={q.header || 'Question'}
      meta={`${prompt.agentId ?? 'agent'}${prompt.questions.length > 1 ? ` · ${step + 1}/${prompt.questions.length}` : ''}`}
      onSkip={onSkip}
      busy={busy}
    >
      <div className="mt-2 text-sm leading-5">{q.question}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {q.options.map((opt) => (
          <button
            key={opt.label}
            type="button"
            disabled={busy}
            title={opt.description}
            onClick={() => toggle(opt.label)}
            className={`cockpit-toolbar-button min-h-11 justify-center px-3 text-xs ${
              selected.includes(opt.label) ? 'border-primary bg-primary/10 font-semibold' : ''
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={otherDraft}
          onChange={(e) => setOtherDraft(e.target.value)}
          disabled={busy}
          placeholder="Other…"
          aria-label="Custom answer"
          className="min-h-11 flex-1 rounded-xl border border-border bg-transparent px-3 text-sm"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void confirmStep()}
          className="cockpit-toolbar-button min-h-11 justify-center px-4 text-xs font-semibold"
        >
          {step < prompt.questions.length - 1 ? 'Next' : 'Answer'}
        </button>
        {prompt.questions.length > 1 && step > 0 && (
          <button type="button" onClick={prev} disabled={busy} className="cockpit-toolbar-button min-h-11 justify-center px-3 text-xs">
            Back
          </button>
        )}
      </div>
      {error && <div className="mt-1 text-xs text-destructive">{error}</div>}
    </CardShell>
  );
}
