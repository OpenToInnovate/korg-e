/**
 * KorgeLogo — Korg-e Bot brand mark.
 *
 * Original corgi-face artwork drawn as inline SVG (no external assets):
 * tan head, upright ears, white muzzle blaze, dark eyes that blink on a
 * loop, and a gentle idle bob. Respects prefers-reduced-motion.
 */

interface KorgeLogoProps {
  /** Logical size in CSS pixels. @default 28 */
  size?: number;
  /** Show the happy tongue (large renderings like the login hero). */
  withTongue?: boolean;
  /** Enable idle bob + blink animation. @default true */
  animated?: boolean;
}

export default function KorgeLogo({ size = 28, withTongue = false, animated = true }: KorgeLogoProps) {
  const anim = animated ? 'korge-logo-anim' : undefined;
  return (
    <span
      role="img"
      aria-label="Korg-e Bot logo"
      className={anim}
      style={{ display: 'inline-flex', width: size, height: size }}
    >
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
        {/* ears */}
        <path d="M10 26 L6 8 Q6 5 9 6 L24 14 Z" fill="#B07A3F" />
        <path d="M54 26 L58 8 Q58 5 55 6 L40 14 Z" fill="#B07A3F" />
        <path d="M12 22 L10 11 L20 16 Z" fill="#E8B98A" />
        <path d="M52 22 L54 11 L44 16 Z" fill="#E8B98A" />
        {/* head */}
        <ellipse cx="32" cy="36" rx="22" ry="20" fill="#D99A55" />
        {/* white blaze */}
        <path
          d="M32 20 C26 20 24 28 24 34 C24 44 28 52 32 52 C36 52 40 44 40 34 C40 28 38 20 32 20 Z"
          fill="#FFF7EC"
        />
        {/* eyes */}
        <g className={animated ? 'korge-blink' : undefined} style={{ transformOrigin: '32px 34px' }}>
          <ellipse cx="23" cy="34" rx="3.2" ry="4" fill="#26211C" />
          <ellipse cx="41" cy="34" rx="3.2" ry="4" fill="#26211C" />
          <circle cx="24" cy="32.6" r="1" fill="#FFF7EC" />
          <circle cx="42" cy="32.6" r="1" fill="#FFF7EC" />
        </g>
        {/* nose + mouth */}
        <ellipse cx="32" cy="43" rx="4" ry="3.2" fill="#26211C" />
        <path d="M32 46 Q32 49 28 49 M32 46 Q32 49 36 49" stroke="#26211C" strokeWidth="1.6" strokeLinecap="round" />
        {withTongue && (
          <path
            d="M29 49 Q29 56 32 56 Q35 56 35 49 Z"
            fill="#E86A7A"
            stroke="#C24E5E"
            strokeWidth="1"
          />
        )}
        {/* cheek blush */}
        <ellipse cx="16" cy="42" rx="3.4" ry="2.2" fill="#E86A7A" opacity="0.35" />
        <ellipse cx="48" cy="42" rx="3.4" ry="2.2" fill="#E86A7A" opacity="0.35" />
      </svg>
      <style>{`
        .korge-logo-anim { animation: korge-bob 4s ease-in-out infinite; }
        @keyframes korge-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
        .korge-blink { animation: korge-blink 4s ease-in-out infinite; }
        @keyframes korge-blink { 0%,92%,100% { transform: scaleY(1); } 95% { transform: scaleY(0.08); } }
        @media (prefers-reduced-motion: reduce) {
          .korge-logo-anim, .korge-blink { animation: none; }
        }
      `}</style>
    </span>
  );
}
