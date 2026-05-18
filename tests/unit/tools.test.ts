import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createContext, runTool, TOOL_DEFS } from '../../src/agent/tools.ts';

let browser: Browser;
let page: Page;

beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser.close(); });

beforeEach(async () => {
  const ctx = await browser.newContext();
  page = await ctx.newPage();
  await page.setContent(`
    <html><body>
      <h1>Login</h1>
      <input aria-label="Username" />
      <input aria-label="Password" type="password" />
      <button>Sign in</button>
    </body></html>
  `);
});

describe('TOOL_DEFS', () => {
  it('exposes the 10 expected tools', () => {
    const names = TOOL_DEFS.map((t) => t.name).sort();
    expect(names).toEqual([
      'assert', 'begin_scenario', 'click', 'end_scenario', 'fill',
      'finish', 'get_dom', 'navigate', 'press', 'wait',
    ]);
  });
});

describe('runTool', () => {
  it('begin_scenario creates a scenario', async () => {
    const ctx = createContext(page, 40);
    const r = await runTool(ctx, { name: 'begin_scenario', input: { name: 'logged in', category: 'happy' } });
    expect(r.ok).toBe(true);
    expect(ctx.current?.name).toBe('logged in');
  });

  it('end_scenario refuses to close without assertions', async () => {
    const ctx = createContext(page, 40);
    await runTool(ctx, { name: 'begin_scenario', input: { name: 'x', category: 'happy' } });
    const r = await runTool(ctx, { name: 'end_scenario', input: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no assertions/i);
  });

  it('click records a SelectorRecord with the winning cascade level', async () => {
    const ctx = createContext(page, 40);
    await runTool(ctx, { name: 'begin_scenario', input: { name: 'x', category: 'happy' } });
    const r = await runTool(ctx, { name: 'click', input: { intent: 'sign in button' } });
    expect(r.ok).toBe(true);
    expect(ctx.current?.steps[0]).toMatchObject({ kind: 'click', target: { level: 'role' } });
    expect(ctx.cascadeStats.role).toBe(1);
  });

  it('fill records intent + value', async () => {
    const ctx = createContext(page, 40);
    await runTool(ctx, { name: 'begin_scenario', input: { name: 'x', category: 'happy' } });
    const r = await runTool(ctx, { name: 'fill', input: { intent: 'Username', value: 'baha' } });
    expect(r.ok).toBe(true);
    expect(ctx.current?.steps[0]).toMatchObject({ kind: 'fill', value: 'baha' });
  });

  it('get_dom returns truncation signal when over caps (W3)', async () => {
    const ctx = createContext(page, 40);
    const html = '<body>' + Array.from({ length: 80 }).map((_, i) => `<button>Btn${i}</button>`).join('') + '</body>';
    await page.setContent(html);
    const r = await runTool(ctx, { name: 'get_dom', input: {} });
    expect(r.ok).toBe(true);
    const data = r.data as { truncated: boolean; counts: { buttons: { shown: number; total: number } } };
    expect(data.truncated).toBe(true);
    expect(data.counts.buttons.total).toBe(80);
    expect(data.counts.buttons.shown).toBe(60);
  });

  it('get_dom returns truncated:false when under all caps', async () => {
    const ctx = createContext(page, 40);
    const r = await runTool(ctx, { name: 'get_dom', input: {} });
    expect(r.ok).toBe(true);
    const data = r.data as { truncated: boolean };
    expect(data.truncated).toBe(false);
  });

  it('assert toBeVisible records an assertion step', async () => {
    const ctx = createContext(page, 40);
    await runTool(ctx, { name: 'begin_scenario', input: { name: 'x', category: 'happy' } });
    const r = await runTool(ctx, { name: 'assert', input: { type: 'toBeVisible', intent: 'Sign in' } });
    expect(r.ok).toBe(true);
    expect(ctx.current?.steps[0]).toMatchObject({ kind: 'assert' });
  });

  it('step budget exhaustion returns an error', async () => {
    const ctx = createContext(page, 1);
    await runTool(ctx, { name: 'begin_scenario', input: { name: 'x', category: 'happy' } });
    const r = await runTool(ctx, { name: 'click', input: { intent: 'sign in button' } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/budget exceeded/i);
  });

  it('finish closes the run', async () => {
    const ctx = createContext(page, 40);
    const r = await runTool(ctx, { name: 'finish', input: { summary: 'done' } });
    expect(r.ok).toBe(true);
  });
});
