/**
 * Corgi variant registry.
 *
 * Each variant is an original SVG corgi driven by CSS animations (no
 * third-party art). A variant pairs a palette, an eye style, an optional
 * accessory, idle/working animation shorthands, and working-state effects.
 * Keyframes live in `index.css` and are shared across all instances.
 */

export type CorgiVariantId =
  | 'classic'
  | 'sploot'
  | 'zoomies'
  | 'sleepy'
  | 'party'
  | 'chef'
  | 'cardigan'
  | 'toast';

export type CorgiEyeStyle = 'round' | 'sleepy' | 'sparkle';
export type CorgiAccessory = 'none' | 'shades' | 'chef' | 'bandana';
export type CorgiEffect = 'ring' | 'steam' | 'zzz' | 'confetti' | 'speed' | 'hearts' | 'sparkles';

export interface CorgiPalette {
  fur: string;
  furDark: string;
  blaze: string;
  earInner: string;
  nose: string;
  accent: string;
}

export interface CorgiVariant {
  id: CorgiVariantId;
  name: string;
  blurb: string;
  palette: CorgiPalette;
  eyes: CorgiEyeStyle;
  accessory: CorgiAccessory;
  /** Blue-merle style coat patches (Cardigan). */
  patches?: boolean;
  /** CSS animation shorthand applied to the whole avatar while idle. */
  idleAnim: string;
  /** CSS animation shorthand applied to the whole avatar while working. */
  workingAnim: string;
  /** Extra effects shown while working. */
  effects: CorgiEffect[];
}

export const CORGI_VARIANTS: Record<CorgiVariantId, CorgiVariant> = {
  classic: {
    id: 'classic',
    name: 'Classic',
    blurb: 'Tan and white, always happy to see you.',
    palette: { fur: '#D99A55', furDark: '#B07A3F', blaze: '#FFF7EC', earInner: '#E8B98A', nose: '#26211C', accent: '#0A84FF' },
    eyes: 'round',
    accessory: 'bandana',
    idleAnim: 'corgi-bounce 2.4s ease-in-out infinite',
    workingAnim: 'corgi-pant 0.7s ease-in-out infinite',
    effects: ['hearts'],
  },
  sploot: {
    id: 'sploot',
    name: 'Sploot',
    blurb: 'Flat on the floor, ears down, maximum chill.',
    palette: { fur: '#C98A4B', furDark: '#A0642F', blaze: '#FFF7EC', earInner: '#E7B384', nose: '#26211C', accent: '#30D158' },
    eyes: 'round',
    accessory: 'bandana',
    idleAnim: 'corgi-breathe 4.2s ease-in-out infinite',
    workingAnim: 'corgi-squash 0.55s ease-in-out infinite',
    effects: ['sparkles'],
  },
  zoomies: {
    id: 'zoomies',
    name: 'Zoomies',
    blurb: 'Runs everywhere at 3am. Fastest pup alive.',
    palette: { fur: '#E0A55C', furDark: '#B87A36', blaze: '#FFFFFF', earInner: '#F2C089', nose: '#26211C', accent: '#FF375F' },
    eyes: 'round',
    accessory: 'none',
    idleAnim: 'corgi-bounce 1.4s ease-in-out infinite',
    workingAnim: 'corgi-zoom 0.4s ease-in-out infinite',
    effects: ['speed', 'ring'],
  },
  sleepy: {
    id: 'sleepy',
    name: 'Sleepy Loaf',
    blurb: 'Perks up only when there is real work to do.',
    palette: { fur: '#D7A06A', furDark: '#B07A3F', blaze: '#FFF7EC', earInner: '#E8C0A0', nose: '#3A3128', accent: '#BF5AF2' },
    eyes: 'sleepy',
    accessory: 'none',
    idleAnim: 'corgi-breathe 5s ease-in-out infinite',
    workingAnim: 'corgi-bounce 1s ease-in-out infinite',
    effects: ['zzz'],
  },
  party: {
    id: 'party',
    name: 'Party',
    blurb: 'Wears shades indoors. Ships on Fridays.',
    palette: { fur: '#D99A55', furDark: '#B07A3F', blaze: '#FFF7EC', earInner: '#E8B98A', nose: '#26211C', accent: '#FF375F' },
    eyes: 'sparkle',
    accessory: 'shades',
    idleAnim: 'corgi-bop 2s ease-in-out infinite',
    workingAnim: 'corgi-bop 0.7s ease-in-out infinite',
    effects: ['confetti', 'hearts'],
  },
  chef: {
    id: 'chef',
    name: 'Chef',
    blurb: 'Runs the kitchen. Will cook up a plan.',
    palette: { fur: '#E0B07A', furDark: '#C08A4A', blaze: '#FFFFFF', earInner: '#EFCB9A', nose: '#26211C', accent: '#30D158' },
    eyes: 'round',
    accessory: 'chef',
    idleAnim: 'corgi-bounce 2.6s ease-in-out infinite',
    workingAnim: 'corgi-pant 0.9s ease-in-out infinite',
    effects: ['steam'],
  },
  cardigan: {
    id: 'cardigan',
    name: 'Cardigan',
    blurb: 'Blue merle coat, big tail, steady as a rock.',
    palette: { fur: '#8CA3B8', furDark: '#5E7387', blaze: '#FFFFFF', earInner: '#B7C7D6', nose: '#2A2F36', accent: '#0A84FF' },
    eyes: 'round',
    accessory: 'none',
    patches: true,
    idleAnim: 'corgi-tilt 3.6s ease-in-out infinite',
    workingAnim: 'corgi-bounce 1s ease-in-out infinite',
    effects: ['sparkles', 'ring'],
  },
  toast: {
    id: 'toast',
    name: 'Toast',
    blurb: 'Pale little loaf. Head tilts at every question.',
    palette: { fur: '#E8C79A', furDark: '#C9A274', blaze: '#FFFFFF', earInner: '#F2DCBE', nose: '#3A3128', accent: '#64D2FF' },
    eyes: 'round',
    accessory: 'none',
    idleAnim: 'corgi-tilt 3s ease-in-out infinite',
    workingAnim: 'corgi-bop 0.85s ease-in-out infinite',
    effects: ['hearts'],
  },
};

export const CORGI_VARIANT_IDS = Object.keys(CORGI_VARIANTS) as CorgiVariantId[];

export function isCorgiVariant(value: unknown): value is CorgiVariantId {
  return typeof value === 'string' && value in CORGI_VARIANTS;
}

/** Deterministic fallback so sessions without a bot profile still get a pup. */
export function corgiFromSeed(seed: string): CorgiVariantId {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return CORGI_VARIANT_IDS[h % CORGI_VARIANT_IDS.length];
}