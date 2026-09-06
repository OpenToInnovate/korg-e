import { lazy, Suspense } from 'react';
import { formatElapsed } from '../utils';

// Streamdown (OpenBot's streaming markdown renderer) — lazy so Shiki
// grammar bundles only load when a stream actually starts.
const Streamdown = lazy(() =>
  import('streamdown').then(m => ({ default: m.Streamdown })),
);

interface StreamingMessageProps {
  html: string;
  text?: string;
  elapsedMs: number;
  agentName?: string;
}

/**
 * Streaming message display — Grokbot-style assistant bubble rendered
 * with Streamdown when raw markdown is available (proper code blocks,
 * tables, streaming-aware parsing), falling back to the pre-rendered
 * HTML from the gateway for edge cases (error notices, resets).
 */
export function StreamingMessage({ html, text, elapsedMs }: StreamingMessageProps) {
  return (
    <div className="msg msg-assistant streaming relative my-1.5 flex justify-start px-3 sm:px-6">
      <div className="grok-bubble grok-bubble-assistant min-w-0 max-w-full sm:max-w-[80%]">
        {text ? (
          <div className="msg-body text-foreground">
            <Suspense fallback={<div className="text-muted-foreground text-xs">…</div>}>
              <Streamdown
                mode="streaming"
                className="streamdown-body"
                shikiTheme={['github-light', 'github-dark']}
              >
                {text}
              </Streamdown>
            </Suspense>
          </div>
        ) : (
          <div
            className="msg-body whitespace-pre-wrap text-foreground"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
        {elapsedMs > 0 && (
          <div className="mt-1 text-right font-mono text-[0.625rem] tabular-nums text-muted-foreground/60">
            {formatElapsed(elapsedMs)}
          </div>
        )}
      </div>
    </div>
  );
}
