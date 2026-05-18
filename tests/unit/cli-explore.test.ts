import { describe, it, expect } from 'vitest';
import { buildOutDir, parseArgs } from '../../src/cli/explore.ts';

describe('buildOutDir', () => {
  it('includes timestamp, host, and pid (concurrency-safe, Bonus W)', () => {
    const dir = buildOutDir('https://www.example.com/login', 12345, new Date('2026-05-17T20:00:00Z'));
    expect(dir).toBe('output/20260517-200000-www-example-com-12345');
  });

  it('handles URLs without subdomains', () => {
    const dir = buildOutDir('https://example.com/', 99, new Date('2026-05-17T00:00:00Z'));
    expect(dir).toBe('output/20260517-000000-example-com-99');
  });
});

describe('parseArgs', () => {
  it('parses URL as first positional', () => {
    expect(parseArgs(['https://x.com/']).url).toBe('https://x.com/');
  });
  it('parses --lang js', () => {
    expect(parseArgs(['https://x.com/', '--lang', 'js']).language).toBe('js');
  });
  it('parses --no-pom', () => {
    expect(parseArgs(['https://x.com/', '--no-pom']).pom).toBe(false);
  });
  it('parses --name', () => {
    expect(parseArgs(['https://x.com/', '--name', 'checkout']).name).toBe('checkout');
  });
  it('parses --review', () => {
    expect(parseArgs(['https://x.com/', '--review']).review).toBe(true);
  });
  it('parses --from-plan <path>', () => {
    expect(parseArgs(['--from-plan', '/tmp/plan.csv']).fromPlan).toBe('/tmp/plan.csv');
  });
});
