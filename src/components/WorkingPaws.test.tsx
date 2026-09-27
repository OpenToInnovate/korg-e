import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import WorkingPaws from './WorkingPaws';

function stubMotion(prefersReduced: boolean) {
  const mql = {
    matches: prefersReduced,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => mql));
  Object.defineProperty(window, 'matchMedia', { value: vi.fn(() => mql), configurable: true });
  return mql;
}

describe('WorkingPaws', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders an accessible working signal with four paws', () => {
    stubMotion(false);
    render(<WorkingPaws />);

    const signal = screen.getByTestId('working-paws');
    expect(signal).toBeInTheDocument();
    expect(signal).toHaveAttribute('role', 'status');
    expect(signal).toHaveAttribute('aria-live', 'polite');
    expect(signal).toHaveAttribute('data-motion', 'animated');
    // Four animated paws, staggered.
    expect(signal.querySelectorAll('.working-paw')).toHaveLength(4);
  });

  it('exposes an agent-specific accessible label', () => {
    stubMotion(false);
    render(<WorkingPaws label="Alpha is working" />);
    expect(screen.getByLabelText('Alpha is working')).toBeInTheDocument();
  });

  it('renders the static fallback under prefers-reduced-motion', () => {
    stubMotion(true);
    render(<WorkingPaws />);

    const signal = screen.getByTestId('working-paws');
    expect(signal).toHaveAttribute('data-motion', 'static');
    // Still a paw row — just not moving.
    expect(signal.querySelectorAll('svg')).toHaveLength(4);
    expect(signal.querySelectorAll('.working-paw')).toHaveLength(0);
  });

  it('honours an explicit static override', () => {
    stubMotion(false);
    render(<WorkingPaws static />);
    expect(screen.getByTestId('working-paws')).toHaveAttribute('data-motion', 'static');
  });

  it('staggers paws with increasing animation delays', () => {
    stubMotion(false);
    const { container } = render(<WorkingPaws />);
    const paws = [...container.querySelectorAll<HTMLElement>('.working-paw')];
    const delays = paws.map((p) => p.style.animationDelay);
    expect(delays).toEqual(['0ms', '170ms', '340ms', '510ms']);
  });
});
