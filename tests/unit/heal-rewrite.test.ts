import { describe, it, expect } from 'vitest';
import { writeHealedSpec, extractSelectorCalls } from '../../src/agent/heal.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('extractSelectorCalls', () => {
  it('finds getByRole, getByLabel, getByTestId, locator calls with line+col', () => {
    const src = [
      'import { test } from "@playwright/test";',
      'test("x", async ({ page }) => {',
      '  await page.getByRole("button", { name: "Sign in" }).click();',
      '  await page.getByLabel("Email").fill("a");',
      '});',
    ].join('\n');
    const calls = extractSelectorCalls(src);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.some(c => c.level === 'role')).toBe(true);
    expect(calls.some(c => c.level === 'label')).toBe(true);
  });
});

describe('writeHealedSpec', () => {
  it('writes <spec>.healed.<ext> with annotation comments', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veriplay-heal-'));
    const src = `import { test } from "@playwright/test";
test("x", async ({ page }) => {
  await page.getByRole("button", { name: "Login" }).click();
});`;
    const specPath = path.join(tmp, 'login.spec.ts');
    fs.writeFileSync(specPath, src);
    const edits = [{
      line: 3, col: 9,
      oldRaw: 'page.getByRole("button", { name: "Login" })',
      newRaw: 'page.getByRole("button", { name: "Sign in" })',
    }];
    const healed = writeHealedSpec(specPath, src, edits);
    expect(healed).toBe(path.join(tmp, 'login.healed.spec.ts'));
    const out = fs.readFileSync(healed, 'utf8');
    expect(out).toContain('Sign in');
    expect(out).toContain('veriplay: healed');
    fs.rmSync(tmp, { recursive: true });
  });
});
