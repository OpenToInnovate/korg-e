import { sanitizeHtml } from '@/lib/sanitize';
import { formatElapsed } from '../utils';

interface StreamingMessageProps {
  html: string;
  elapsedMs: number;
  agentName?: string;
}

/**
 * Streaming message display with live content — Grokbot-style assistant bubble.
 */
export function StreamingMessage({ html, elapsedMs }: StreamingMessageProps) {
  return (
    <div className="msg msg-assistant streaming relative my-1.5 flex justify-start px-3 sm:px-6">
      <div className="grok-bubble grok-bubble-assistant min-w-0 max-w-full sm:max-w-[80%]">
        <div
          className="msg-body whitespace-pre-wrap text-foreground"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
        />
        {elapsedMs > 0 && (
          <div className="mt-1 text-right font-mono text-[0.625rem] tabular-nums text-muted-foreground/60">
            {formatElapsed(elapsedMs)}
          </div>
        )}
      </div>
    </div>
  );
}
