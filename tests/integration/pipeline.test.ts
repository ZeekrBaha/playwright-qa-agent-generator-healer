import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { explore } from '../../src/agent/runtime.ts';
import { transcribe } from '../../src/agent/transcriber.ts';
import { mockOpenAISequence } from '../fixtures/openai-mock.ts';
import { startFixtureServer } from '../fixtures/server.ts';

let server: Awaited<ReturnType<typeof startFixtureServer>>;
let outDir: string;
let cwd: string;

beforeAll(async () => {
  server = await startFixtureServer();
});
afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  cwd = process.cwd();
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veriplay-int-'));
  process.chdir(outDir);
});
afterEach(() => {
  process.chdir(cwd);
  fs.rmSync(outDir, { recursive: true, force: true });
});

describe('integration: full pipeline with mocked OpenAI + real local server', () => {
  it('runs explore -> transcribe and produces a complete POM suite', async () => {
    const openai = mockOpenAISequence([
      // Explorer turns — happy path
      { tool: 'begin_scenario', args: { name: 'logged in with valid creds', category: 'happy' } },
      { tool: 'navigate', args: { url: server.url } },
      { tool: 'fill', args: { intent: 'Username', value: 'baha' } },
      { tool: 'fill', args: { intent: 'Password', value: 'secret' } },
      { tool: 'click', args: { intent: 'Sign in' } },
      // After submit the DOM becomes `<h1>Welcome to Inventory</h1>`.
      // Provide role=heading hint so the cascade resolves via getByRole.
      {
        tool: 'assert',
        args: { type: 'toContainText', intent: 'Welcome', role: 'heading', text: 'Welcome' },
      },
      { tool: 'end_scenario', args: {} },
      // Negative path
      { tool: 'begin_scenario', args: { name: 'rejects invalid credentials', category: 'negative' } },
      { tool: 'navigate', args: { url: server.url } },
      { tool: 'fill', args: { intent: 'Username', value: 'wrong' } },
      { tool: 'fill', args: { intent: 'Password', value: 'bad' } },
      { tool: 'click', args: { intent: 'Sign in' } },
      // The error div has no role/label/testid — use a css hint to resolve.
      {
        tool: 'assert',
        args: { type: 'toBeVisible', intent: 'Invalid', css: '#error' },
      },
      { tool: 'end_scenario', args: {} },
      // A11y path
      { tool: 'begin_scenario', args: { name: 'login form has accessible labels', category: 'a11y' } },
      { tool: 'navigate', args: { url: server.url } },
      // The Username input carries aria-label="Username" so getByLabel works.
      { tool: 'assert', args: { type: 'toBeVisible', intent: 'Username' } },
      { tool: 'end_scenario', args: {} },
      { tool: 'finish', args: { summary: 'done' } },
      // Critic
      {
        tool: 'submit_verdicts',
        args: {
          verdicts: [
            { scenario: 'logged in with valid creds', verdict: 'ship', reason: 'good' },
            { scenario: 'rejects invalid credentials', verdict: 'ship', reason: 'good' },
            { scenario: 'login form has accessible labels', verdict: 'ship', reason: 'good' },
          ],
          summary: 'OK',
        },
      },
    ]);

    const result = await explore({
      url: server.url,
      language: 'ts',
      openai,
      outDir,
      skipPlan: true, // skip planner snapshot
    });
    if ('paused' in result) throw new Error('unexpected pause');

    expect(result.scenarios.length).toBeGreaterThanOrEqual(2);
    expect(fs.existsSync(path.join(outDir, 'run-report.json'))).toBe(true);

    transcribe({ report: result, outDir, name: 'login' });
    expect(fs.existsSync(path.join(outDir, 'pages', 'BasePage.ts'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'tests', 'login.spec.ts'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'a11y', 'landing.a11y.spec.ts'))).toBe(true);
  }, 60_000);
});
