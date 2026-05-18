import { describe, it, expect, vi } from 'vitest';
import { withRetry, isRetryable } from '../../src/agent/retry.ts';

describe('isRetryable', () => {
  it('returns true for Playwright TimeoutError', () => {
    const err = new Error('Timeout');
    err.name = 'TimeoutError';
    expect(isRetryable(err)).toBe(true);
  });

  it('returns true for OpenAI 429', () => {
    expect(isRetryable({ status: 429 })).toBe(true);
  });

  it('returns true for 5xx', () => {
    expect(isRetryable({ status: 503 })).toBe(true);
  });

  it('returns false for 4xx other than 429', () => {
    expect(isRetryable({ status: 401 })).toBe(false);
  });
});

describe('withRetry', () => {
  it('succeeds on first try without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { attempts: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error and eventually succeeds', async () => {
    const err = Object.assign(new Error('rate limited'), { status: 429 });
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValue('ok');
    const result = await withRetry(fn, { attempts: 3, baseMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws non-retryable error immediately', async () => {
    const err = Object.assign(new Error('unauthorized'), { status: 401 });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { attempts: 3, baseMs: 1 })).rejects.toThrow('unauthorized');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after max attempts', async () => {
    const err = Object.assign(new Error('timeout'), { status: 503 });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { attempts: 2, baseMs: 1 })).rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('emits onRetry callback per retry', async () => {
    const onRetry = vi.fn();
    const err = Object.assign(new Error('x'), { status: 503 });
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValue('ok');
    await withRetry(fn, { attempts: 3, baseMs: 1, onRetry });
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      lastError: err,
      waitMs: expect.any(Number),
    });
  });
});
