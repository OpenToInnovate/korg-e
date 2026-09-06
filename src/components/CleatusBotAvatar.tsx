import { useEffect, useRef } from 'react';

const TAU = Math.PI * 2;

// Cleatus palette variants — antenna bulb + ring accent per agent identity
const VARIANTS = [
  { bulb: [238, 21, 21], accent: [238, 21, 21] },   // FOX red
  { bulb: [29, 155, 240], accent: [29, 155, 240] }, // FOX blue
  { bulb: [217, 123, 41], accent: [217, 123, 41] }, // football leather
  { bulb: [192, 198, 204], accent: [192, 198, 204] }, // gunmetal silver
] as const;

const METAL_TOP = [74, 82, 92];
const METAL_BOTTOM = [38, 43, 49];
const METAL_EDGE = [120, 132, 145];
const VISOR = [10, 14, 19];
const EYE = [91, 209, 255];
const DIM = [70, 78, 87];

function rgba(c: readonly number[], a: number) {
  return `rgba(${c[0]},${c[1]},${c[2]},${Math.min(a, 1)})`;
}

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

/** Visual state of an agent avatar. */
export type CleatusAvatarState = 'idle' | 'working';

interface CleatusBotAvatarProps {
  /** Seed (session key / agent name) — picks the color variant + blink phase. */
  name: string;
  /** Logical size in CSS px. @default 30 */
  size?: number;
  /** idle = calm bob + slow glow; working = darting eyes, fast blink, loader ring. */
  state?: CleatusAvatarState;
  className?: string;
}

/**
 * Cleatus-inspired animated agent avatar.
 *
 * A mini gunmetal robot head (visor, glowing eyes, antenna bulb) in the FOX
 * robot's spirit, with a per-agent color variant. When `state` is "working"
 * the eyes dart, the antenna blinks fast and a rotating loader ring sweeps
 * the head — Grokbot-style "bot is on it" feedback.
 *
 * Idle animates at ~20fps, working at full rAF rate; rAF pauses itself when
 * the tab is hidden and reduced-motion renders a single static frame.
 */
export default function CleatusBotAvatar({ name, size = 30, state = 'idle', className }: CleatusBotAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const working = state === 'working';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 2;
    const PAD = 1.25; // room for the loader ring
    canvas.width = size * dpr * PAD;
    canvas.height = size * dpr * PAD;
    canvas.style.width = `${size * PAD}px`;
    canvas.style.height = `${size * PAD}px`;
    canvas.style.margin = `${(-size * (PAD - 1)) / 2}px`;

    const W = canvas.width;
    const S = W / (size * PAD);
    const seed = hashName(name);
    const variant = VARIANTS[seed % VARIANTS.length];
    const blinkOffset = (seed % 1000) / 1000 * 4;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let rafId = 0;
    let frame = 0;

    function draw(time: number) {
      if (!ctx) return;
      const t = time / 1000;
      ctx.clearRect(0, 0, W, W);

      const cx = W / 2;
      const cy = W / 2 + (reduced ? 0 : Math.sin(t * TAU / (working ? 1.4 : 3)) * 0.6 * S);
      const headW = W * 0.62;
      const headH = W * 0.52;
      const hx = cx - headW / 2;
      const hy = cy - headH / 2 + W * 0.02;
      const r = headW * 0.22;

      // ── Loader ring (working only) ─────────────────────────────
      if (working) {
        const sweep = t * 3.4;
        ctx.save();
        ctx.strokeStyle = rgba(variant.accent, 0.9);
        ctx.lineWidth = 1.6 * S;
        ctx.lineCap = 'round';
        ctx.shadowBlur = 3 * S;
        ctx.shadowColor = rgba(variant.accent, 0.8);
        ctx.beginPath();
        ctx.arc(cx, cy, headW * 0.72, sweep, sweep + TAU * 0.3);
        ctx.stroke();
        // faint full track
        ctx.shadowBlur = 0;
        ctx.strokeStyle = rgba(variant.accent, 0.15);
        ctx.beginPath();
        ctx.arc(cx, cy, headW * 0.72, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }

      // ── Antenna ────────────────────────────────────────────────
      const ax = cx;
      const ayTop = hy - W * 0.085;
      ctx.strokeStyle = rgba(DIM, 0.9);
      ctx.lineWidth = 1.3 * S;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ax, hy + 1.5 * S);
      ctx.lineTo(ax, ayTop);
      ctx.stroke();

      const blinkRate = working ? 9 : 2.2;
      const bulbPulse = 0.5 + 0.5 * Math.sin(t * blinkRate);
      ctx.save();
      ctx.shadowBlur = (4 + bulbPulse * 4) * S;
      ctx.shadowColor = rgba(variant.bulb, 0.9);
      ctx.fillStyle = rgba(variant.bulb, 0.7 + bulbPulse * 0.3);
      ctx.beginPath();
      ctx.arc(ax, ayTop, 1.7 * S, 0, TAU);
      ctx.fill();
      ctx.restore();

      // ── Head ───────────────────────────────────────────────────
      const grad = ctx.createLinearGradient(0, hy, 0, hy + headH);
      grad.addColorStop(0, rgba(METAL_TOP, 1));
      grad.addColorStop(1, rgba(METAL_BOTTOM, 1));
      ctx.fillStyle = grad;
      ctx.strokeStyle = rgba(METAL_EDGE, 0.5);
      ctx.lineWidth = 0.9 * S;
      ctx.beginPath();
      ctx.roundRect(hx, hy, headW, headH, r);
      ctx.fill();
      ctx.stroke();

      // ── Visor + eyes ───────────────────────────────────────────
      const vx = hx + headW * 0.1;
      const vy = hy + headH * 0.22;
      const vw = headW * 0.8;
      const vh = headH * 0.42;
      ctx.fillStyle = rgba(VISOR, 1);
      ctx.beginPath();
      ctx.roundRect(vx, vy, vw, vh, vh * 0.5);
      ctx.fill();

      const bt = (t + blinkOffset) % 4;
      let blink = 1;
      if (!working && bt >= 2.9 && bt < 3.06) {
        const p = (bt - 2.9) / 0.16;
        blink = Math.abs(1 - 2 * p) * 0.92 + 0.08;
      }
      const glow = working ? 0.8 + 0.2 * Math.sin(t * 10) : 0.7 + 0.3 * Math.sin(t * TAU / 1.6);
      const dart = working ? Math.sin(t * 8.5) * vw * 0.06 : 0;
      const eyeH = vh * 0.5 * blink;
      const eyeRx = vw * 0.14;

      for (const base of [vx + vw * 0.32, vx + vw * 0.68]) {
        ctx.save();
        ctx.shadowBlur = 4 * S * glow;
        ctx.shadowColor = rgba(EYE, glow);
        ctx.fillStyle = rgba(EYE, 0.95);
        ctx.beginPath();
        ctx.roundRect(base - eyeRx / 2 + dart, vy + vh / 2 - eyeH / 2, eyeRx, Math.max(eyeH, 1 * S), eyeRx / 2);
        ctx.fill();
        ctx.restore();
      }

      // ── Mouth grille ───────────────────────────────────────────
      const my = hy + headH * 0.8;
      ctx.strokeStyle = rgba(DIM, 0.8);
      ctx.lineWidth = 0.9 * S;
      for (const dx of [-0.09, 0, 0.09]) {
        ctx.beginPath();
        ctx.moveTo(cx + dx * headW - 1.1 * S, my);
        ctx.lineTo(cx + dx * headW + 1.1 * S, my);
        ctx.stroke();
      }
    }

    if (reduced) {
      draw(1000); // mid-blink-free static frame
      return;
    }

    const loop = (time: number) => {
      // Idle avatars render at ~20fps to stay cheap in long session lists
      if (working || frame % 3 === 0) draw(time);
      frame++;
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [name, size, working]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`${name} ${state === 'working' ? 'working' : 'idle'}`}
      className={className}
      style={{ borderRadius: '25%' }}
    />
  );
}
