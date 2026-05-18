import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { resolve, emitLocatorCall, guessRole } from '../../src/agent/selectors.ts';

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser.close();
});

async function setHtml(html: string): Promise<void> {
  if (page) {
    await page.close();
  }
  const ctx = await browser.newContext();
  page = await ctx.newPage();
  await page.setContent(html);
}

describe('guessRole', () => {
  it('maps button-ish intents to button role', () => {
    expect(guessRole('login button')).toBe('button');
    expect(guessRole('submit')).toBe('button');
  });

  it('maps input-ish intents to textbox role', () => {
    expect(guessRole('username input')).toBe('textbox');
    expect(guessRole('email field')).toBe('textbox');
  });

  it('returns undefined for unmatchable intents', () => {
    expect(guessRole('mystery widget')).toBeUndefined();
  });
});

describe('resolve', () => {
  it('resolves by role+accessible name when available', async () => {
    await setHtml('<button>Sign in</button>');
    const r = await resolve(page, { intent: 'sign in button' });
    expect(r?.level).toBe('role');
    expect(r?.arg).toEqual({ role: 'button', name: 'sign in' });
  });

  it('falls back to label when role miss', async () => {
    await setHtml('<label>Email<input type="email" /></label>');
    const r = await resolve(page, { intent: 'mystery widget', label: 'Email' });
    expect(r?.level).toBe('label');
    expect(r?.arg).toBe('Email');
  });

  it('falls back to testid', async () => {
    await setHtml('<div data-testid="custom-x">x</div>');
    const r = await resolve(page, { intent: 'thing', testid: 'custom-x' });
    expect(r?.level).toBe('testid');
    expect(r?.arg).toBe('custom-x');
  });

  it('falls back to css as last resort', async () => {
    await setHtml('<span class="weird-thing">x</span>');
    const r = await resolve(page, { intent: 'thing', css: '.weird-thing' });
    expect(r?.level).toBe('css');
    expect(r?.arg).toBe('.weird-thing');
  });

  it('returns null when nothing resolves', async () => {
    await setHtml('<body></body>');
    const r = await resolve(page, { intent: 'nonexistent button' });
    expect(r).toBeNull();
  });
});

describe('emitLocatorCall', () => {
  it('emits getByRole call', () => {
    expect(emitLocatorCall('role', { role: 'button', name: 'Sign in' }))
      .toBe('page.getByRole("button", { name: "Sign in" })');
  });

  it('emits getByLabel call', () => {
    expect(emitLocatorCall('label', 'Email')).toBe('page.getByLabel("Email")');
  });

  it('emits getByTestId call', () => {
    expect(emitLocatorCall('testid', 'submit')).toBe('page.getByTestId("submit")');
  });

  it('emits locator call', () => {
    expect(emitLocatorCall('css', '.cls')).toBe('page.locator(".cls")');
  });
});
