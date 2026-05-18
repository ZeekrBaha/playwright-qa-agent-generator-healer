export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  onRetry?: (info: { attempt: number; lastError: unknown; waitMs: number }) => void;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export function isRetryable(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; status?: number; code?: string };
    if (e.name === 'TimeoutError') return true;
    if (e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET') return true;
    if (typeof e.status === 'number' && RETRYABLE_STATUSES.has(e.status)) return true;
  }
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 1000;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === attempts - 1) throw err;
      const waitMs = baseMs * 2 ** attempt;
      opts.onRetry?.({ attempt: attempt + 1, lastError: err, waitMs });
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  throw lastError;
}
