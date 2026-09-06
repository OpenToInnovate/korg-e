import { useEffect, useRef } from 'react';

const TAU = Math.PI * 2;

// Cleatus palette — FOX robot: gunmetal, FOX red, electric blue eyes, leather football
const METAL_TOP = [74, 82, 92];
const METAL_BOTTOM = [38, 43, 49];
const METAL_EDGE = [120, 132, 145];
const VISOR = [10, 14, 19];
const EYE = [91, 209, 255];
const ANTENNA_RED = [238, 21, 21];
const DIM = [70, 78, 87];

function rgba(c: number[], a: number) {
  return `rgba(${c[0]},${c[1]},${c[2]},${Math.min(a, 1)})`;
}

/** Props for {@link CleatusLogo}. */
interface CleatusLogoProps {
  /** Logical size in CSS pixels (canvas is rendered at 2× for retina). @default 28 */
  size?: number;
  /** Tuck a football under his arm — for large renderings like the login hero. */
  withFootball?: boolean;
}

/**
 * Animated canvas logo for the Cleatus Bot brand.
 *
 * A little gunmetal robot head in the Cleatus spirit: glowing electric-blue
 * eyes that blink on a loop, a pulsing red antenna bulb, and a gentle idle
 * bob. With `withFootball`, he holds a leather football. Cycle ≈ 4 s.
 * Respects prefers-reduced-motion (single static frame).
 */
export default function CleatusLogo({ size = 28, withFootball = false }: CleatusLogoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 2;
    const PAD = 1.6; // padding so glow never clips
    canvas.width = size * dpr * PAD;
    canvas.height = size * dpr * PAD;
    canvas.style.width = `${size * PAD}px`;
    canvas.style.height = `${size * PAD}px`;
    canvas.style.margin = `${(-size * (PAD - 1)) / 2}px`;

    const W = canvas.width;
    const S = W / (size * PAD);
    const CYCLE = 4;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function draw(time: number) {
      if (!ctx) return;
      const t = (time / 1000) % CYCLE;
      ctx.clearRect(0, 0, W, W);

      // Idle bob (±0.8px logical)
      const bob = prefersReducedMotion ? 0 : Math.sin((t / CYCLE) * TAU * 2) * 0.8 * S;
      const cx = W / 2;
      const cy = W / 2 + bob;

      const headW = W * 0.56;
      const headH = W * 0.46;
      const hx = cx - headW / 2;
      const hy = cy - headH / 2 + W * 0.03;
      const r = headW * 0.18;

      // ── Antenna ────────────────────────────────────────────────
      const ax = cx;
      const ayTop = hy - W * 0.115;
      ctx.strokeStyle = rgba(DIM, 0.9);
      ctx.lineWidth = 1.6 * S;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ax, hy + 2 * S);
      ctx.lineTo(ax, ayTop);
      ctx.stroke();

      const bulbPulse = 0.5 + 0.5 * Math.sin((t / CYCLE) * TAU * 5);
      ctx.save();
      ctx.shadowBlur = (6 + bulbPulse * 5) * S;
      ctx.shadowColor = rgba(ANTENNA_RED, 0.9);
      ctx.fillStyle = rgba(ANTENNA_RED, 0.75 + bulbPulse * 0.25);
      ctx.beginPath();
      ctx.arc(ax, ayTop, 2.1 * S, 0, TAU);
      ctx.fill();
      ctx.restore();

      // ── Head shell (gunmetal gradient) ─────────────────────────
      const grad = ctx.createLinearGradient(0, hy, 0, hy + headH);
      grad.addColorStop(0, rgba(METAL_TOP, 1));
      grad.addColorStop(1, rgba(METAL_BOTTOM, 1));
      ctx.fillStyle = grad;
      ctx.strokeStyle = rgba(METAL_EDGE, 0.55);
      ctx.lineWidth = 1 * S;
      ctx.beginPath();
      ctx.roundRect(hx, hy, headW, headH, r);
      ctx.fill();
      ctx.stroke();

      // Side bolts ("ears")
      ctx.fillStyle = rgba(METAL_EDGE, 0.7);
      ctx.beginPath();
      ctx.roundRect(hx - 2.4 * S, cy - headH * 0.16, 2.6 * S, headH * 0.32, 1.2 * S);
      ctx.roundRect(hx + headW - 0.2 * S, cy - headH * 0.16, 2.6 * S, headH * 0.32, 1.2 * S);
      ctx.fill();

      // ── Visor ──────────────────────────────────────────────────
      const vx = hx + headW * 0.1;
      const vy = hy + headH * 0.2;
      const vw = headW * 0.8;
      const vh = headH * 0.42;
      ctx.fillStyle = rgba(VISOR, 1);
      ctx.beginPath();
      ctx.roundRect(vx, vy, vw, vh, vh * 0.5);
      ctx.fill();

      // ── Eyes (glow + blink at t ≈ 2.9s) ────────────────────────
      const blinkStart = 2.9;
      const blinkDur = 0.16;
      let blink = 1;
      if (t >= blinkStart && t < blinkStart + blinkDur) {
        const p = (t - blinkStart) / blinkDur;
        blink = Math.abs(1 - 2 * p) * 0.92 + 0.08; // close then reopen
      }
      const eyeGlow = 0.75 + 0.25 * Math.sin((t / CYCLE) * TAU * 3);
      const eyeY = vy + vh / 2;
      const eyeH = vh * 0.52 * blink;
      const eyeRx = vw * 0.13;

      for (const ex of [vx + vw * 0.32, vx + vw * 0.68]) {
        ctx.save();
        ctx.shadowBlur = 5 * S * eyeGlow;
        ctx.shadowColor = rgba(EYE, eyeGlow);
        ctx.fillStyle = rgba(EYE, 0.95);
        ctx.beginPath();
        ctx.roundRect(ex - eyeRx / 2, eyeY - eyeH / 2, eyeRx, Math.max(eyeH, 1.2 * S), eyeRx / 2);
        ctx.fill();
        ctx.restore();
      }

      // ── Mouth grille (three dim slits) ─────────────────────────
      const my = hy + headH * 0.76;
      ctx.strokeStyle = rgba(DIM, 0.85);
      ctx.lineWidth = 1.1 * S;
      for (const dx of [-0.09, 0, 0.09]) {
        ctx.beginPath();
        ctx.moveTo(cx + dx * headW - 1.4 * S, my);
        ctx.lineTo(cx + dx * headW + 1.4 * S, my);
        ctx.stroke();
      }

      // ── Football, tucked under the right arm ───────────────────
      if (withFootball) {
        const fx = hx + headW + W * 0.015;
        const fy = hy + headH * 0.78 + bob * 0.4;
        const fw = W * 0.19;
        const fh = W * 0.125;
        ctx.save();
        ctx.translate(fx, fy);
        ctx.rotate(-0.42);
        // leather body
        const fg = ctx.createLinearGradient(0, -fh / 2, 0, fh / 2);
        fg.addColorStop(0, '#a06a3f');
        fg.addColorStop(1, '#7a4a28');
        ctx.fillStyle = fg;
        ctx.strokeStyle = 'rgba(58,34,16,0.9)';
        ctx.lineWidth = 1.1 * S;
        ctx.beginPath();
        ctx.ellipse(0, 0, fw / 2, fh / 2, 0, 0, TAU);
        ctx.fill();
        ctx.stroke();
        // white seam + lace
        ctx.strokeStyle = 'rgba(245,245,240,0.92)';
        ctx.lineWidth = 0.9 * S;
        ctx.beginPath();
        ctx.moveTo(-fw * 0.32, 0);
        ctx.lineTo(fw * 0.32, 0);
        ctx.stroke();
        ctx.lineWidth = 0.8 * S;
        for (const lx of [-0.12, 0, 0.12]) {
          ctx.beginPath();
          ctx.moveTo(fw * lx, -fh * 0.16);
          ctx.lineTo(fw * lx, fh * 0.16);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    if (prefersReducedMotion) {
      draw(0);
      return;
    }

    let rafId = 0;
    const loop = (time: number) => {
      draw(time);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [size]);

  return <canvas ref={canvasRef} aria-label="Cleatus Bot logo" role="img" style={{ borderRadius: '25%' }} />;
}
