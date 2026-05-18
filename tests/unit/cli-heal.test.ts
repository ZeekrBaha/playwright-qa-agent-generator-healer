import { describe, it, expect } from 'vitest';
import { parseHealArgs } from '../../src/cli/heal.ts';

describe('parseHealArgs', () => {
  it('parses spec path as first positional', () => {
    expect(parseHealArgs(['output/run/login.spec.ts']).specPath).toBe('output/run/login.spec.ts');
  });
  it('parses --report flag', () => {
    expect(parseHealArgs(['x.spec.ts', '--report', '/tmp/r.json']).reportPath).toBe('/tmp/r.json');
  });
  it('parses --base-url flag', () => {
    expect(parseHealArgs(['x.spec.ts', '--base-url', 'https://stg.example.com']).baseUrl).toBe(
      'https://stg.example.com',
    );
  });
});
