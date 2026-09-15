import CorgiSvg, { type CorgiState } from './corgi/CorgiSvg';
import type { CorgiVariantId } from './corgi/corgiVariants';

/** Visual state of an agent avatar. */
export type KorgeAvatarState = 'idle' | 'working';

interface KorgeAvatarProps {
  /** Seed (session key / bot id / name) — picks a variant when none is set. */
  name: string;
  /** Explicit corgi variant (from the bot profile). */
  variant?: CorgiVariantId;
  /** Logical size in CSS px. @default 30 */
  size?: number;
  /** idle = calm loop; working = tongue + wag + effects. */
  state?: KorgeAvatarState | CorgiState;
  /** Collar color override. */
  collar?: string;
  className?: string;
}

/**
 * Animated corgi agent avatar. Picks an explicit variant when the bot profile
 * has one, otherwise derives a stable variant from the seed. Animations are
 * pure CSS and respect `prefers-reduced-motion`.
 */
export default function KorgeAvatar({ name, variant, size = 30, state = 'idle', collar, className }: KorgeAvatarProps) {
  return (
    <CorgiSvg
      seed={name}
      variant={variant}
      size={size}
      state={state}
      collar={collar}
      className={className}
    />
  );
}