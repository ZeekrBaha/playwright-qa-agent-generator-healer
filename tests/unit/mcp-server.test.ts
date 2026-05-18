import { describe, it, expect } from 'vitest';
import { runId, slug, mapEventToProgress } from '../../src/mcp/server.ts';

describe('runId', () => {
  it('produces a sortable timestamp', () => {
    const id = runId();
    expect(id).toMatch(/^\d{14}$/);
  });
});

describe('slug', () => {
  it('extracts a clean slug from a URL', () => {
    expect(slug('https://www.example.com/login?foo=bar')).toBe('www-example-com-login-foo-bar');
  });
  it('caps length at 40 chars', () => {
    const long = 'https://example.com/' + 'x'.repeat(100);
    expect(slug(long).length).toBeLessThanOrEqual(40);
  });
  it('falls back to "run" when nothing usable', () => {
    expect(slug('!!!')).toBe('run');
  });
});

describe('mapEventToProgress', () => {
  it('returns progress text for plan_started', () => {
    expect(mapEventToProgress({ type: 'plan_started' })).toContain('plan');
  });
  it('returns progress text for tool_call', () => {
    expect(mapEventToProgress({ type: 'tool_call', name: 'click', input: {} })).toContain('click');
  });
  it('returns progress text for retry', () => {
    expect(mapEventToProgress({ type: 'retry', attempt: 1, waitMs: 1000, lastError: new Error('x') })).toMatch(/retry/i);
  });
  it('returns null for events with no useful progress text', () => {
    expect(mapEventToProgress({ type: 'usage', usd: 0.01, tokens: 100 })).toBeNull();
  });
});
