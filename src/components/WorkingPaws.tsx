/**
 * WorkingPaws — the "agent is working" signal.
 *
 * Animated corgi paws tapping in sequence. Tony's problem was that a squad run
 * looked identical to a dead chat, so he nudged the composer to check. These
 * paws answer that: on while a run is genuinely in flight, off the moment
 * output lands or the run ends.
 *
 * Reuses the existing corgi asset system (palette + pure-CSS animation, same
 * convention as CorgiSvg/KorgeLogo) — no new asset pipeline. Animations touch
 * only transform/opacity so they never reflow the streaming transcript.
 * @module
 */
import { useEffect, useState } from 'react';
import { CORGI_VARIANTS, corgiFromSeed } from './corgi/corgiVariants';
import { cn } from '@/lib/utils';

export interface WorkingPawsProps {
  /** Overall row width in CSS px. @default 46 */
  size?: number;
  /** Stable seed for palette selection (session key, bot id, name). */
  seed?: string;
  /** Accessible label announced while working. */
  label?: string;
  className?: string;
  /** Force the static (non-animated) rendering regardless of motion preference. */
  static?: boolean;
}

/** Subscribe to the OS reduced-motion preference. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    if (mq.addEventListener) {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  return reduced;
}

/** One paw: a main pad plus three toe beans, drawn from a corgi palette. */
function Paw({ size, palette, delay, animate }: {
  size: number;
  palette: { fur: string; furDark: string; blaze: string; nose: string };
  delay: number;
  animate: boolean;
}) {
  const s = size;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={animate ? 'working-paw' : undefined}
      style={animate ? { animationDelay: `${delay}ms` } : undefined}
    >
      {/* toe beans */}
      <ellipse cx="9" cy="11" rx="3.1" ry="4" fill={palette.fur} />
      <ellipse cx="16" cy="8.5" rx="3.1" ry="4.1" fill={palette.fur} />
      <ellipse cx="23" cy="11" rx="3.1" ry="4" fill={palette.fur} />
      {/* main pad */}
      <path
        d="M16 15c5 0 9 3.4 9 7.2 0 3.1-2.6 4.8-5.6 4.3-1.6-.3-2.8-.3-3.4-.3s-1.8 0-3.4.3C9.6 27 7 25.3 7 22.2 7 18.4 11 15 16 15Z"
        fill={palette.fur}
      />
      {/* highlight so the paw reads at small sizes */}
      <ellipse cx="12.5" cy="20" rx="2.4" ry="1.7" fill={palette.blaze} opacity="0.5" />
    </svg>
  );
}

/**
 * Animated corgi paws. Rendered only while an agent is genuinely working —
 * the caller owns the state, so the signal can never lie about progress.
 */
export function WorkingPaws({ size = 46, seed = 'working', label = 'Agent is working', className, static: forceStatic = false }: WorkingPawsProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const animate = !forceStatic && !prefersReducedMotion;

  const variant = CORGI_VARIANTS[corgiFromSeed(seed)];
  const pawSize = Math.max(8, Math.round(size * 0.34));
  const gaps = 4;

  return (
    <span
      role="status"
      aria-label={label}
      aria-live="polite"
      data-testid="working-paws"
      data-motion={animate ? 'animated' : 'static'}
      className={cn('inline-flex items-center', className)}
      style={{ gap: gaps }}
    >
      {[0, 1, 2, 3].map((i) => (
        <Paw
          key={i}
          size={pawSize}
          palette={variant.palette}
          delay={i * 170}
          animate={animate}
        />
      ))}
      <style>{`
        .working-paw {
          transform-origin: 50% 85%;
          animation: working-paw-step 900ms cubic-bezier(0.4, 0, 0.2, 1) infinite;
          will-change: transform;
        }
        @keyframes working-paw-step {
          0%, 100% { transform: translateY(0) rotate(0deg) scale(1); }
          28%      { transform: translateY(-14%) rotate(-7deg) scale(1.06); }
          55%      { transform: translateY(2%) rotate(3deg) scale(0.97); }
        }
        @media (prefers-reduced-motion: reduce) {
          .working-paw { animation: none; }
        }
      `}</style>
    </span>
  );
}

export default WorkingPaws;
