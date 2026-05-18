import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { proposeNewSelector } from '../../src/agent/heal.ts';
import { mockOpenAI } from '../fixtures/openai-mock.ts';

let browser: Browser;
let page: Page;

beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser.close(); });

async function setHtml(html: string): Promise<void> {
  const ctx = await browser.newContext();
  page = await ctx.newPage();
  await page.setContent(html);
}

describe('proposeNewSelector', () => {
  it('returns a proposal when model emits one resolving to exactly 1 element', async () => {
    await setHtml('<button>Sign in</button>');
    const openai = mockOpenAI({
      propose_selector: () => ({ intent: 'sign in', role: 'button', confidence: 0.9 }),
    });
    const r = await proposeNewSelector({
      openai, page,
      oldCall: { raw: 'page.getByRole("button", { name: "Login" })', line: 1, col: 0, level: 'role' },
      failure: { testTitle: 't', url: 'about:blank', error: 'not found', errorValue: 'Error' },
    });
    expect(r).not.toBeNull();
    expect(r?.confidence).toBeGreaterThan(0.5);
  });

  it('returns null when confidence < 0.4', async () => {
    await setHtml('<button>Sign in</button>');
    const openai = mockOpenAI({
      propose_selector: () => ({ intent: 'sign in', role: 'button', confidence: 0.2 }),
    });
    const r = await proposeNewSelector({
      openai, page,
      oldCall: { raw: 'page.getByRole("button", { name: "X" })', line: 1, col: 0, level: 'role' },
      failure: { testTitle: 't', url: 'about:blank', error: 'not found', errorValue: 'Error' },
    });
    expect(r).toBeNull();
  });
});
