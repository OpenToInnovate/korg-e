import type { CSSProperties } from 'react';
import {
  CORGI_VARIANTS,
  corgiFromSeed,
  isCorgiVariant,
  type CorgiVariant,
  type CorgiVariantId,
} from './corgiVariants';

export type CorgiState = 'idle' | 'working' | 'celebrate';

interface CorgiSvgProps {
  /** Explicit variant, or a seed string to derive one deterministically. */
  variant?: CorgiVariantId | string;
  /** Stable seed (used when no explicit variant is given). */
  seed?: string;
  size?: number;
  state?: CorgiState;
  /** Collar color override (defaults to the variant accent). */
  collar?: string;
  className?: string;
}

function resolveVariant(variant?: CorgiVariantId | string, seed?: string): CorgiVariant {
  if (isCorgiVariant(variant)) return CORGI_VARIANTS[variant];
  return CORGI_VARIANTS[corgiFromSeed(seed ?? variant ?? 'corgi')];
}

/**
 * Kawaii corgi avatar — chibi proportions, big glossy eyes, blush, a wagging
 * tail, and pure-CSS animation. All eight variants share this anatomy and
 * differ by palette, eyes, accessory, and motion.
 */
export default function CorgiSvg({
  variant,
  seed,
  size = 32,
  state = 'idle',
  collar,
  className,
}: CorgiSvgProps) {
  const v = resolveVariant(variant, seed);
  const p = v.palette;
  const working = state === 'working';
  const celebrate = state === 'celebrate';
  const anim = working || celebrate ? v.workingAnim : v.idleAnim;
  const collarColor = collar ?? p.accent;

  const wrapperStyle: CSSProperties = {
    display: 'inline-flex',
    width: size,
    height: size,
    position: 'relative',
    animation: anim,
  };

  const showEffect = (effect: string) =>
    v.effects.includes(effect as never) && (effect === 'zzz' ? !working : working || celebrate);

  const eyeHighlight = '#FFFFFF';

  return (
    <span
      role="img"
      aria-label={`${v.name} corgi ${working ? 'working' : celebrate ? 'celebrating' : 'idle'}`}
      className={className ? `corgi ${className}` : 'corgi'}
      data-variant={v.id}
      data-state={state}
      style={wrapperStyle}
    >
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
        {/* tail (wags) */}
        <g style={{ transformOrigin: '52px 46px', animation: working ? 'corgi-tail 0.5s ease-in-out infinite' : 'corgi-tail 1.8s ease-in-out infinite' }}>
          <path d="M48 46 q10 -2 12 -12 q1 -3 3 -1 q2 2 0 6 q-4 12 -14 14 z" fill={p.fur} stroke={p.furDark} strokeWidth="1" strokeLinejoin="round" />
          <path d="M58 34 q1 -3 3 -1 q2 2 0 6 q-1 3 -3 4 z" fill={p.blaze} />
        </g>

        {/* ears */}
        <g style={{ transformOrigin: '22px 18px', animation: 'corgi-ear 3.2s ease-in-out infinite' }}>
          <path d="M12 28 L7 9 Q6 5 11 7 L25 15 Z" fill={p.fur} stroke={p.furDark} strokeWidth="1" strokeLinejoin="round" />
          <path d="M13 24 L10 12 L21 17 Z" fill={p.earInner} />
        </g>
        <g style={{ transformOrigin: '42px 18px', animation: 'corgi-ear 3.2s ease-in-out infinite 0.35s' }}>
          <path d="M52 28 L57 9 Q58 5 53 7 L39 15 Z" fill={p.fur} stroke={p.furDark} strokeWidth="1" strokeLinejoin="round" />
          <path d="M51 24 L54 12 L43 17 Z" fill={p.earInner} />
        </g>

        {/* head */}
        <ellipse cx="32" cy="36" rx="22" ry="19.5" fill={p.fur} />
        {/* fur shine */}
        <path d="M15 28 q6 -8 15 -8" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.22" />
        {/* blue-merle patches (Cardigan) */}
        {v.patches && (
          <>
            <ellipse cx="17" cy="31" rx="7" ry="6" fill={p.furDark} opacity="0.7" />
            <ellipse cx="46" cy="41" rx="6" ry="5" fill={p.furDark} opacity="0.6" />
          </>
        )}
        {/* blaze */}
        <path
          d="M32 19 C26 19 24 28 24 34 C24 44 28 53 32 53 C36 53 40 44 40 34 C40 28 38 19 32 19 Z"
          fill={p.blaze}
        />

        {/* eyes */}
        <g
          style={{
            transformOrigin: '32px 34px',
            animation: !working && !celebrate && v.eyes === 'round' ? 'corgi-blink 4.4s ease-in-out infinite' : undefined,
          }}
        >
          {v.eyes === 'sleepy' && !working ? (
            <>
              <path d="M19 35 Q23 39 27 35" stroke={p.nose} strokeWidth="2" strokeLinecap="round" fill="none" />
              <path d="M37 35 Q41 39 45 35" stroke={p.nose} strokeWidth="2" strokeLinecap="round" fill="none" />
            </>
          ) : (
            <>
              <ellipse cx="23" cy="34.5" rx="5" ry="6" fill={p.nose} />
              <ellipse cx="41" cy="34.5" rx="5" ry="6" fill={p.nose} />
              {/* iris tint + glossy highlights */}
              <ellipse cx="23" cy="36.2" rx="3.4" ry="3" fill={p.accent} opacity="0.85" />
              <ellipse cx="41" cy="36.2" rx="3.4" ry="3" fill={p.accent} opacity="0.85" />
              <circle cx="21.2" cy="32.2" r="2" fill={eyeHighlight} />
              <circle cx="39.2" cy="32.2" r="2" fill={eyeHighlight} />
              <circle cx="24.6" cy="37.6" r="1" fill={eyeHighlight} opacity="0.85" />
              <circle cx="42.6" cy="37.6" r="1" fill={eyeHighlight} opacity="0.85" />
            </>
          )}
        </g>

        {/* blush */}
        <ellipse cx="15" cy="42" rx="3.6" ry="2.3" fill="#FF6B8A" opacity="0.38" />
        <ellipse cx="49" cy="42" rx="3.6" ry="2.3" fill="#FF6B8A" opacity="0.38" />

        {/* shades accessory (over eyes) */}
        {v.accessory === 'shades' && (
          <g>
            <rect x="16" y="30" width="14" height="9" rx="4" fill="#1E1B18" />
            <rect x="34" y="30" width="14" height="9" rx="4" fill="#1E1B18" />
            <path d="M30 33.5 L34 33.5" stroke="#1E1B18" strokeWidth="2" />
            <path d="M19 32 L26 32" stroke="#FFFFFF" strokeWidth="1.3" opacity="0.6" />
            <path d="M37 32 L44 32" stroke="#FFFFFF" strokeWidth="1.3" opacity="0.6" />
          </g>
        )}

        {/* nose + cute ω mouth */}
        <ellipse cx="32" cy="43.5" rx="3.6" ry="2.9" fill={p.nose} />
        <ellipse cx="31" cy="42.7" rx="1" ry="0.7" fill="#FFFFFF" opacity="0.5" />
        {working || celebrate ? (
          <g>
            <path d="M32 46 Q30 49 28 47.5 M32 46 Q34 49 36 47.5" stroke={p.nose} strokeWidth="1.5" strokeLinecap="round" fill="none" />
            <path d="M29 47.5 Q29 55 32 55 Q35 55 35 47.5 Z" fill="#FF6E86" stroke="#D1465F" strokeWidth="1" strokeLinejoin="round" />
          </g>
        ) : (
          <path d="M32 46 Q30 48.5 28.4 47 M32 46 Q34 48.5 35.6 47" stroke={p.nose} strokeWidth="1.5" strokeLinecap="round" fill="none" />
        )}

        {/* collar + tag */}
        <path d="M14 50 Q32 60 50 50 L50 54 Q32 64 14 54 Z" fill={collarColor} />
        <circle cx="32" cy="59" r="2.6" fill="#FFD75E" stroke={p.furDark} strokeWidth="0.8" />
      </svg>

      {/* paws peeking at the bottom */}
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
        <ellipse cx="24" cy="61" rx="5" ry="3.4" fill={p.fur} stroke={p.furDark} strokeWidth="0.8" />
        <ellipse cx="40" cy="61" rx="5" ry="3.4" fill={p.fur} stroke={p.furDark} strokeWidth="0.8" />
      </svg>

      {/* chef hat */}
      {v.accessory === 'chef' && (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
          <path d="M22 16 Q22 7 32 7 Q42 7 42 16 Z" fill="#FFFFFF" />
          <rect x="21" y="15" width="22" height="5" rx="2.5" fill="#F2F2F0" />
        </svg>
      )}

      {/* bandana */}
      {v.accessory === 'bandana' && (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
          <path d="M14 52 L32 64 L50 52 L50 56 L32 68 L14 56 Z" fill={p.accent} opacity="0.95" />
        </svg>
      )}

      {/* working loader ring */}
      {showEffect('ring') && (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" style={{ position: 'absolute', inset: 0, animation: 'corgi-spin 1.6s linear infinite' }}>
          <circle cx="32" cy="32" r="29" stroke={collarColor} strokeWidth="3" strokeLinecap="round" strokeDasharray="46 136" opacity="0.9" />
        </svg>
      )}

      {/* hearts (working / celebrate) */}
      {showEffect('hearts') && (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
          <g fill={p.accent}>
            <path d="M14 12 c2 -3 6 -1.5 6 1.5 c0 2.5 -3 4.5 -6 6.5 c-3 -2 -6 -4 -6 -6.5 c0 -3 4 -4.5 6 -1.5 z" style={{ animation: 'corgi-float 1.8s ease-out infinite' }} />
            <path d="M50 8 c1.6 -2.4 4.8 -1.2 4.8 1.2 c0 2 -2.4 3.6 -4.8 5.2 c-2.4 -1.6 -4.8 -3.2 -4.8 -5.2 c0 -2.4 3.2 -3.6 4.8 -1.2 z" style={{ animation: 'corgi-float 1.8s ease-out infinite 0.6s' }} />
          </g>
        </svg>
      )}

      {/* sparkles */}
      {showEffect('sparkles') && (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
          <path d="M52 6 l1.4 3.6 l3.6 1.4 l-3.6 1.4 l-1.4 3.6 l-1.4 -3.6 l-3.6 -1.4 l3.6 -1.4 z" fill="#FFD75E" style={{ animation: 'corgi-twinkle 1.4s ease-in-out infinite' }} />
          <path d="M10 6 l1.1 2.8 l2.8 1.1 l-2.8 1.1 l-1.1 2.8 l-1.1 -2.8 l-2.8 -1.1 l2.8 -1.1 z" fill="#FFFFFF" style={{ animation: 'corgi-twinkle 1.4s ease-in-out infinite 0.5s' }} />
        </svg>
      )}

      {/* steam (chef) */}
      {showEffect('steam') && (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
          <g stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" opacity="0.75">
            <path d="M28 12 q-20 -6 0 -10" style={{ animation: 'corgi-steam 1.6s ease-out infinite' }} />
            <path d="M36 12 q-20 -6 0 -10" style={{ animation: 'corgi-steam 1.6s ease-out infinite 0.5s' }} />
          </g>
        </svg>
      )}

      {/* zzz (sleepy idle) */}
      {showEffect('zzz') && (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
          <g fill={p.accent} fontFamily="system-ui, sans-serif" fontWeight="700">
            <text x="44" y="18" fontSize="9" style={{ animation: 'corgi-zzz 2.6s ease-in-out infinite' }}>z</text>
            <text x="50" y="10" fontSize="7" style={{ animation: 'corgi-zzz 2.6s ease-in-out infinite 0.6s' }}>z</text>
          </g>
        </svg>
      )}

      {/* confetti (party) */}
      {showEffect('confetti') && (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
          <g>
            <rect x="10" y="10" width="3" height="3" rx="1" fill={p.accent} style={{ animation: 'corgi-confetti 1.4s ease-out infinite' }} />
            <rect x="52" y="14" width="3" height="3" rx="1" fill="#FFD75E" style={{ animation: 'corgi-confetti 1.4s ease-out infinite 0.3s' }} />
            <rect x="20" y="6" width="3" height="3" rx="1" fill="#64D2FF" style={{ animation: 'corgi-confetti 1.4s ease-out infinite 0.6s' }} />
            <rect x="44" y="6" width="3" height="3" rx="1" fill="#30D158" style={{ animation: 'corgi-confetti 1.4s ease-out infinite 0.45s' }} />
          </g>
        </svg>
      )}

      {/* speed lines (zoomies) */}
      {showEffect('speed') && (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
          <g stroke={p.accent} strokeWidth="1.6" strokeLinecap="round" opacity="0.8">
            <path d="M2 30 H16" style={{ animation: 'corgi-speed 0.5s linear infinite' }} />
            <path d="M0 38 H12" style={{ animation: 'corgi-speed 0.5s linear infinite 0.15s' }} />
            <path d="M4 46 H14" style={{ animation: 'corgi-speed 0.5s linear infinite 0.3s' }} />
          </g>
        </svg>
      )}

      {/* celebrate sparkle crown */}
      {celebrate && (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
          <path d="M32 1 l2.2 5 l5 2.2 l-5 2.2 l-2.2 5 l-2.2 -5 l-5 -2.2 l5 -2.2 z" fill="#FFD75E" style={{ animation: 'corgi-twinkle 0.9s ease-in-out infinite' }} />
        </svg>
      )}
    </span>
  );
}