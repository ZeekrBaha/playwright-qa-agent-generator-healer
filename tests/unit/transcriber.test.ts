import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { transcribe } from '../../src/agent/transcriber.ts';
import type { RunReport } from '../../src/agent/trace.ts';

let outDir: string;

beforeEach(() => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veriplay-trans-'));
});
afterEach(() => {
  fs.rmSync(outDir, { recursive: true, force: true });
});

function makeReport(overrides: Partial<RunReport> = {}): RunReport {
  return {
    url: 'https://example.com/login',
    language: 'ts',
    scenarios: [
      {
        name: 'logged in with valid creds',
        category: 'happy',
        steps: [
          { kind: 'navigate', url: 'https://example.com/login' },
          { kind: 'fill', target: { intent: 'username input', level: 'role', arg: { role: 'textbox', name: 'Username' } }, value: 'baha' },
          { kind: 'fill', target: { intent: 'password input', level: 'role', arg: { role: 'textbox', name: 'Password' } }, value: 'pw' },
          { kind: 'click', target: { intent: 'login button', level: 'role', arg: { role: 'button', name: 'Sign in' } } },
          { kind: 'assert', name: 'URL matches /inventory/', assertion: { type: 'toHaveURL', pattern: 'inventory' } },
        ],
      },
    ],
    cascadeStats: { role: 4, label: 0, testid: 0, css: 0 },
    cost: { inputTokens: 100, outputTokens: 50, cachedTokens: 0, usd: 0.001 },
    steps: 5,
    startedAt: '2026-05-17T00:00:00Z',
    finishedAt: '2026-05-17T00:01:00Z',
    ...overrides,
  };
}

describe('transcribe (POM mode)', () => {
  it('writes BasePage.ts, page object, and spec file', () => {
    transcribe({ report: makeReport(), outDir, name: 'login' });
    expect(fs.existsSync(path.join(outDir, 'pages', 'BasePage.ts'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'pages'))).toBe(true);
    const pageFiles = fs.readdirSync(path.join(outDir, 'pages'));
    expect(pageFiles.some(f => f.endsWith('Page.ts') && f !== 'BasePage.ts')).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'tests', 'login.spec.ts'))).toBe(true);
  });

  it('generated spec contains getByRole call from cascade record', () => {
    transcribe({ report: makeReport(), outDir, name: 'login' });
    // In POM mode the getByRole call lives in the page object; check the
    // whole generated bundle to verify the cascade record reached emission.
    const spec = fs.readFileSync(path.join(outDir, 'tests', 'login.spec.ts'), 'utf8');
    const pageFile = fs.readdirSync(path.join(outDir, 'pages'))
      .filter(f => f !== 'BasePage.ts')[0];
    const pageSrc = fs.readFileSync(path.join(outDir, 'pages', pageFile!), 'utf8');
    expect(spec + pageSrc).toContain('getByRole');
  });

  it('generated page object has typed Locator fields', () => {
    transcribe({ report: makeReport(), outDir, name: 'login' });
    const pageFile = fs.readdirSync(path.join(outDir, 'pages'))
      .filter(f => f !== 'BasePage.ts')[0];
    const src = fs.readFileSync(path.join(outDir, 'pages', pageFile!), 'utf8');
    expect(src).toContain('readonly');
    expect(src).toContain('Locator');
  });

  it('javascript mode emits .js files with no types', () => {
    transcribe({ report: { ...makeReport(), language: 'js' }, outDir, name: 'login' });
    expect(fs.existsSync(path.join(outDir, 'tests', 'login.spec.js'))).toBe(true);
  });

  it('--no-pom mode emits a single inline spec file', () => {
    transcribe({ report: makeReport(), outDir, name: 'login', pom: false });
    expect(fs.existsSync(path.join(outDir, 'login.spec.ts'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'pages'))).toBe(false);
  });
});
