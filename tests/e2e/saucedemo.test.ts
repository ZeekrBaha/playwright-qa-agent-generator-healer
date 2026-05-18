import { describe, it, expect } from 'vitest';
import OpenAI from 'openai';
import { explore } from '../../src/agent/runtime.ts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const runE2E = process.env.RUN_E2E === '1';

describe.skipIf(!runE2E)('E2E: saucedemo', () => {
  it('produces a passing spec against https://www.saucedemo.com/', async () => {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required for E2E');
    const openai = new OpenAI();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veriplay-e2e-'));
    const report = await explore({
      url: 'https://www.saucedemo.com/',
      language: 'ts',
      openai,
      outDir,
    });
    if ('paused' in report) throw new Error('unexpected pause');
    expect(report.scenarios.length).toBeGreaterThanOrEqual(3);
    expect(report.cost.usd ?? 0).toBeLessThan(0.5);
  }, 180_000);
});
