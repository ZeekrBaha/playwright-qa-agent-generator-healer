import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('landing page has no detectable a11y violations (WCAG 2 AA)', async ({ page }) => {
  await page.goto("https://www.saucedemo.com/");
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
});
