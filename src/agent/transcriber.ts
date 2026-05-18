import fs from 'node:fs';
import path from 'node:path';
import { emitLocatorCall } from './selectors.ts';
import type { RunReport, Scenario, TraceStep } from './trace.ts';

export interface TranscribeOptions {
  report: RunReport;
  outDir: string;
  name: string;
  pom?: boolean; // default true
}

export function transcribe(opts: TranscribeOptions): void {
  const pom = opts.pom ?? true;
  fs.mkdirSync(opts.outDir, { recursive: true });
  if (pom) {
    emitPOM(opts);
  } else {
    emitInline(opts);
  }
  emitA11ySpec(opts);
}

function emitA11ySpec(opts: TranscribeOptions): void {
  const ext = opts.report.language === 'js' ? 'js' : 'ts';
  fs.mkdirSync(path.join(opts.outDir, 'a11y'), { recursive: true });
  const src = `import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('landing page has no detectable a11y violations (WCAG 2 AA)', async ({ page }) => {
  await page.goto(${JSON.stringify(opts.report.url)});
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
});
`;
  fs.writeFileSync(path.join(opts.outDir, 'a11y', `landing.a11y.spec.${ext}`), src);
}

/* ───── POM mode ───── */

function emitPOM(opts: TranscribeOptions): void {
  const { report, outDir, name } = opts;
  const ext = report.language === 'js' ? 'js' : 'ts';
  const lang = report.language;

  fs.mkdirSync(path.join(outDir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'fixtures'), { recursive: true });

  // BasePage
  fs.writeFileSync(path.join(outDir, 'pages', `BasePage.${ext}`), basePageSource(lang));

  // Page object (one per host)
  const className = pageClassName(report.url);
  const pageFile = path.join(outDir, 'pages', `${className}.${ext}`);
  fs.writeFileSync(pageFile, pageObjectSource(report, className, lang));

  // Fixture that injects the page object into every test
  const fixtureFile = path.join(outDir, 'fixtures', `pages.${ext}`);
  fs.writeFileSync(fixtureFile, fixturesSource(className, lang));

  // Spec
  const specFile = path.join(outDir, 'tests', `${name}.spec.${ext}`);
  fs.writeFileSync(specFile, specSource(report, className, lang));
}

function fixturesSource(className: string, lang: 'ts' | 'js'): string {
  const fieldName = lcFirst(className);
  if (lang === 'ts') {
    return `import { test as base, expect } from '@playwright/test';
import { ${className} } from '../pages/${className}';

type Fixtures = {
  ${fieldName}: ${className};
};

export const test = base.extend<Fixtures>({
  ${fieldName}: async ({ page }, use) => {
    await use(new ${className}(page));
  },
});

export { expect };
`;
  }
  return `import { test as base, expect } from '@playwright/test';
import { ${className} } from '../pages/${className}.js';

export const test = base.extend({
  ${fieldName}: async ({ page }, use) => {
    await use(new ${className}(page));
  },
});

export { expect };
`;
}

function basePageSource(lang: 'ts' | 'js'): string {
  if (lang === 'ts') {
    return `import type { Page } from '@playwright/test';

export class BasePage {
  constructor(protected page: Page) {}
  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }
}
`;
  }
  return `export class BasePage {
  constructor(page) { this.page = page; }
  async goto(url) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }
}
`;
}

function pageClassName(url: string): string {
  try {
    const host = new URL(url).host.replace(/^www\./, '').replace(/[^a-z0-9]/gi, ' ');
    return (
      host
        .split(' ')
        .filter(Boolean)
        .map((s) => s[0]!.toUpperCase() + s.slice(1))
        .join('') + 'Page'
    );
  } catch {
    return 'AppPage';
  }
}

function pageObjectSource(report: RunReport, className: string, lang: 'ts' | 'js'): string {
  // Collect distinct intents from the trace to define as Locator fields
  const intentMap = new Map<string, { fieldName: string; call: string }>();
  for (const s of report.scenarios) {
    for (const step of s.steps) {
      const target =
        step.kind === 'click' || step.kind === 'fill' || step.kind === 'press'
          ? step.target
          : step.kind === 'assert' && step.assertion.type !== 'toHaveURL'
            ? step.assertion.target
            : null;
      if (target) {
        const field = intentToField(target.intent);
        if (!intentMap.has(field)) {
          intentMap.set(field, { fieldName: field, call: emitLocatorCall(target.level, target.arg) });
        }
      }
    }
  }

  const fields = [...intentMap.values()];

  if (lang === 'ts') {
    return `import type { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class ${className} extends BasePage {
  readonly url = ${JSON.stringify(report.url)};
${fields.map((f) => `  readonly ${f.fieldName}: Locator;`).join('\n')}

  constructor(page: Page) {
    super(page);
${fields.map((f) => `    this.${f.fieldName} = ${f.call};`).join('\n')}
  }
}
`;
  }
  return `import { BasePage } from './BasePage.js';

export class ${className} extends BasePage {
  constructor(page) {
    super(page);
    this.url = ${JSON.stringify(report.url)};
${fields.map((f) => `    this.${f.fieldName} = ${f.call};`).join('\n')}
  }
}
`;
}

function specSource(report: RunReport, className: string, lang: 'ts' | 'js'): string {
  const importLine =
    lang === 'ts'
      ? `import { test, expect } from '../fixtures/pages';`
      : `import { test, expect } from '../fixtures/pages.js';`;
  const tests = report.scenarios.map((s) => emitScenarioTest(s, className)).join('\n\n');
  return `${importLine}

test.describe(${JSON.stringify(`veriplay: ${report.url}`)}, () => {
${tests}
});
`;
}

function emitScenarioTest(s: Scenario, className: string): string {
  const lines: string[] = [];
  const varName = lcFirst(className);
  lines.push(`  test(${JSON.stringify(`[${s.category}] ${s.name}`)}, async ({ page, ${varName} }) => {`);
  // Always navigate to the page URL first. The agent may have called navigate()
  // before begin_scenario(), so the trace might not include it — but the page
  // object already knows the URL.
  const hasExplicitNavigate = s.steps.some((step) => step.kind === 'navigate');
  if (!hasExplicitNavigate) {
    lines.push(`    await ${varName}.goto(${varName}.url);`);
  }
  for (const step of s.steps) {
    lines.push(`    ${emitStep(step, varName)}`);
  }
  lines.push(`  });`);
  return lines.join('\n');
}

function emitStep(step: TraceStep, pageVar: string): string {
  switch (step.kind) {
    case 'navigate':
      return `await ${pageVar}.goto(${JSON.stringify(step.url)});`;
    case 'click':
      return `await ${pageVar}.${intentToField(step.target.intent)}.click();`;
    case 'fill':
      return `await ${pageVar}.${intentToField(step.target.intent)}.fill(${JSON.stringify(step.value)});`;
    case 'press':
      return `await ${pageVar}.${intentToField(step.target.intent)}.press(${JSON.stringify(step.key)});`;
    case 'wait':
      return `await page.waitForTimeout(${step.ms});`;
    case 'assert': {
      const a = step.assertion;
      switch (a.type) {
        case 'toBeVisible':
          return `await expect(${pageVar}.${intentToField(a.target.intent)}).toBeVisible();`;
        case 'toHaveText':
          return `await expect(${pageVar}.${intentToField(a.target.intent)}).toHaveText(${JSON.stringify(a.text)});`;
        case 'toContainText':
          return `await expect(${pageVar}.${intentToField(a.target.intent)}).toContainText(${JSON.stringify(a.text)});`;
        case 'toHaveURL':
          return `await expect(page).toHaveURL(new RegExp(${JSON.stringify(a.pattern)}));`;
        case 'toHaveCount':
          return `await expect(${pageVar}.${intentToField(a.target.intent)}).toHaveCount(${a.count});`;
      }
    }
  }
}

function intentToField(intent: string): string {
  return lcFirst(
    intent
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((s, i) => (i === 0 ? s.toLowerCase() : s[0]!.toUpperCase() + s.slice(1).toLowerCase()))
      .join(''),
  );
}

function lcFirst(s: string): string {
  return s.length === 0 ? s : s[0]!.toLowerCase() + s.slice(1);
}

/* ───── Inline mode (no-pom) ───── */

function emitInline(opts: TranscribeOptions): void {
  const { report, outDir, name } = opts;
  const ext = report.language === 'js' ? 'js' : 'ts';
  const tests = report.scenarios.map((s) => emitScenarioInline(s)).join('\n\n');
  const src = `import { test, expect } from '@playwright/test';

test.describe(${JSON.stringify(`veriplay: ${report.url}`)}, () => {
${tests}
});
`;
  fs.writeFileSync(path.join(outDir, `${name}.spec.${ext}`), src);
}

function emitScenarioInline(s: Scenario): string {
  const lines: string[] = [];
  lines.push(`  test(${JSON.stringify(`[${s.category}] ${s.name}`)}, async ({ page }) => {`);
  for (const step of s.steps) {
    lines.push(`    ${emitStepInline(step)}`);
  }
  lines.push(`  });`);
  return lines.join('\n');
}

function emitStepInline(step: TraceStep): string {
  switch (step.kind) {
    case 'navigate':
      return `await page.goto(${JSON.stringify(step.url)});`;
    case 'click':
      return `await ${emitLocatorCall(step.target.level, step.target.arg)}.click();`;
    case 'fill':
      return `await ${emitLocatorCall(step.target.level, step.target.arg)}.fill(${JSON.stringify(step.value)});`;
    case 'press':
      return `await ${emitLocatorCall(step.target.level, step.target.arg)}.press(${JSON.stringify(step.key)});`;
    case 'wait':
      return `await page.waitForTimeout(${step.ms});`;
    case 'assert': {
      const a = step.assertion;
      switch (a.type) {
        case 'toBeVisible':
          return `await expect(${emitLocatorCall(a.target.level, a.target.arg)}).toBeVisible();`;
        case 'toHaveText':
          return `await expect(${emitLocatorCall(a.target.level, a.target.arg)}).toHaveText(${JSON.stringify(a.text)});`;
        case 'toContainText':
          return `await expect(${emitLocatorCall(a.target.level, a.target.arg)}).toContainText(${JSON.stringify(a.text)});`;
        case 'toHaveURL':
          return `await expect(page).toHaveURL(new RegExp(${JSON.stringify(a.pattern)}));`;
        case 'toHaveCount':
          return `await expect(${emitLocatorCall(a.target.level, a.target.arg)}).toHaveCount(${a.count});`;
      }
    }
  }
}
