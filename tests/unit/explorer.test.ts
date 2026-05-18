import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { runExplorerLoop } from '../../src/agent/explorer.ts';
import { createContext } from '../../src/agent/tools.ts';
import { mockOpenAISequence } from '../fixtures/openai-mock.ts';

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
});

beforeEach(async () => {
  const c = await browser.newContext();
  page = await c.newPage();
  await page.setContent(`
    <html><body>
      <h1>Login</h1>
      <input aria-label="Username" />
      <button>Sign in</button>
    </body></html>
  `);
});

describe('runExplorerLoop', () => {
  it('executes a sequence of tool calls and stops on finish', async () => {
    const openai = mockOpenAISequence([
      { tool: 'begin_scenario', args: { name: 'logged in', category: 'happy' } },
      { tool: 'fill', args: { intent: 'Username', value: 'baha' } },
      { tool: 'assert', args: { type: 'toBeVisible', intent: 'Sign in' } },
      { tool: 'end_scenario', args: {} },
      { tool: 'finish', args: { summary: 'done' } },
    ]);
    const ctx = createContext(page, 40);
    const cost = await runExplorerLoop({
      openai,
      model: 'gpt-4o-mini',
      ctx,
      url: 'about:blank',
      systemBlocks: ['rules'],
      plan: [],
      maxUsd: 2,
    });

    expect(ctx.scenarios).toHaveLength(1);
    expect(ctx.scenarios[0]?.name).toBe('logged in');
    expect(cost.inputTokens).toBeGreaterThan(0);
    expect(cost.outputTokens).toBeGreaterThan(0);
  });

  it('throws on cost ceiling exceeded', async () => {
    const openai = mockOpenAISequence(
      Array.from({ length: 30 }).map(() => ({
        tool: 'begin_scenario',
        args: { name: 'x', category: 'happy' as const },
      })),
    );
    const ctx = createContext(page, 100);
    // Near-zero ceiling trips after the first call.
    await expect(
      runExplorerLoop({
        openai,
        model: 'gpt-4o-mini',
        ctx,
        url: 'about:blank',
        systemBlocks: ['rules'],
        plan: [],
        maxUsd: 0.00001,
      }),
    ).rejects.toThrow(/cost ceiling/i);
  });

  it('stops when finish_reason is stop (model declines to call tools)', async () => {
    const openai = mockOpenAISequence([]); // empty sequence -> immediate stop
    const ctx = createContext(page, 40);
    const cost = await runExplorerLoop({
      openai,
      model: 'gpt-4o-mini',
      ctx,
      url: 'about:blank',
      systemBlocks: ['rules'],
      plan: [],
      maxUsd: 2,
    });
    expect(ctx.scenarios).toHaveLength(0);
    expect(cost.inputTokens).toBeGreaterThan(0); // at least one call was made
  });

  it('emits onEvent for tool calls', async () => {
    const events: Array<{ type: string; name?: string }> = [];
    const openai = mockOpenAISequence([{ tool: 'finish', args: { summary: 'done' } }]);
    const ctx = createContext(page, 40);
    await runExplorerLoop({
      openai,
      model: 'gpt-4o-mini',
      ctx,
      url: 'about:blank',
      systemBlocks: ['rules'],
      plan: [],
      maxUsd: 2,
      onEvent: (e) => events.push(e),
    });
    expect(events.some((e) => e.type === 'tool_call' && e.name === 'finish')).toBe(true);
    expect(events.some((e) => e.type === 'tool_result' && e.name === 'finish')).toBe(true);
  });
});
