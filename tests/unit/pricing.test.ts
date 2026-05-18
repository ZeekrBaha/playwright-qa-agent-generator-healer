import { describe, it, expect, vi } from 'vitest';
import { priceFor, computeCost } from '../../src/agent/pricing';

describe('priceFor', () => {
  it('returns price for known model', () => {
    const p = priceFor('gpt-4o-mini');
    expect(p).toEqual({ in: 0.15, out: 0.60, cachedIn: 0.075 });
  });

  it('returns null and warns for unknown model', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = priceFor('gpt-99-imaginary');
    expect(p).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Unknown model "gpt-99-imaginary"'),
    );
    warn.mockRestore();
  });
});

describe('computeCost', () => {
  it('computes USD from tokens at the model rate', () => {
    const usd = computeCost('gpt-4o-mini', {
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cachedTokens: 0,
    });
    expect(usd).toBeCloseTo(0.15 + 0.30, 6);
  });

  it('returns null for unknown model (no silent fallback)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const usd = computeCost('gpt-99', {
      inputTokens: 1,
      outputTokens: 1,
      cachedTokens: 0,
    });
    expect(usd).toBeNull();
    warn.mockRestore();
  });
});
