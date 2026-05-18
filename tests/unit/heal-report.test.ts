import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { parseReport, extractUrlFromReport, isSelectorMiss } from '../../src/agent/heal.ts';

const FIXTURES = path.resolve(__dirname, '..', 'fixtures', 'playwright-reports');

describe('parseReport', () => {
  it('extracts failures from baseURL-style report', () => {
    const failures = parseReport(path.join(FIXTURES, 'baseURL-failure.json'));
    expect(failures).toHaveLength(1);
    expect(failures[0]?.url).toBe('https://example.com');
    expect(failures[0]?.testTitle).toBe('login flow');
  });

  it('extracts failures from page.goto-style report', () => {
    const failures = parseReport(path.join(FIXTURES, 'page-goto-failure.json'));
    expect(failures).toHaveLength(1);
    expect(failures[0]?.url).toBe('https://checkout.example.com/start');
  });
});

describe('extractUrlFromReport (W7 fix vs qa-core regex-only)', () => {
  it('prefers config.use.baseURL when present', () => {
    const report = {
      config: { projects: [{ name: 'c', use: { baseURL: 'https://from-config.com' } }] },
      stack: 'page.goto("https://from-stack.com/page")',
    };
    expect(extractUrlFromReport(report as never, 'page.goto("https://from-stack.com/page")')).toBe('https://from-config.com');
  });

  it('falls back to page.goto regex when no baseURL', () => {
    const report = { config: { projects: [{ name: 'c', use: {} }] } };
    expect(extractUrlFromReport(report as never, 'foo bar page.goto("https://from-stack.com/page") baz')).toBe('https://from-stack.com/page');
  });

  it('returns empty string when nothing extractable', () => {
    const report = { config: { projects: [] } };
    expect(extractUrlFromReport(report as never, 'no url here')).toBe('');
  });
});

describe('isSelectorMiss (W7 fix vs qa-core keyword search)', () => {
  it('returns true for TimeoutError error.value', () => {
    expect(isSelectorMiss({ error: 'locator timeout', errorValue: 'TimeoutError' })).toBe(true);
  });
  it('returns true for "Element not found" message', () => {
    expect(isSelectorMiss({ error: 'Element not found: x', errorValue: 'Error' })).toBe(true);
  });
  it('returns true for "expected to be visible"', () => {
    expect(isSelectorMiss({ error: 'expected to be visible', errorValue: 'Error' })).toBe(true);
  });
  it('returns false for assertion failures (not a selector miss)', () => {
    expect(isSelectorMiss({ error: 'expected "Welcome" to equal "Hello"', errorValue: 'AssertionError' })).toBe(false);
  });
  it('returns false for unrelated errors', () => {
    expect(isSelectorMiss({ error: 'unhandled rejection', errorValue: 'Error' })).toBe(false);
  });
});
