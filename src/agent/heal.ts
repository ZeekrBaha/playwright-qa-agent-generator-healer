import fs from 'node:fs';

export interface FailureContext {
  testTitle: string;
  url: string;
  error: string;
  errorValue: string;
  selectorRaw?: string;
}

interface RawReport {
  config?: {
    projects?: Array<{ name: string; use?: { baseURL?: string } }>;
  };
  suites?: unknown[];
}

const SELECTOR_PATTERNS = [
  /page\.getByRole\(([^)]+)\)/,
  /page\.getByLabel\(([^)]+)\)/,
  /page\.getByTestId\(([^)]+)\)/,
  /page\.locator\(([^)]+)\)/,
];

export function parseReport(reportPath: string): FailureContext[] {
  if (!fs.existsSync(reportPath)) return [];
  let data: RawReport;
  try {
    data = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as RawReport;
  } catch {
    return [];
  }

  const failures: FailureContext[] = [];
  walkSuites(data.suites ?? [], data, failures);
  return failures.filter(isSelectorMissFromFailure);
}

function walkSuites(suites: unknown[], root: RawReport, out: FailureContext[]): void {
  for (const s of suites) {
    const suite = s as { specs?: unknown[]; suites?: unknown[] };
    for (const spec of suite.specs ?? []) {
      const sp = spec as { title: string; tests?: unknown[] };
      for (const t of sp.tests ?? []) {
        const test = t as { results?: unknown[] };
        for (const r of test.results ?? []) {
          const result = r as { status?: string; error?: { message?: string; stack?: string; value?: string } };
          if (result.status !== 'failed' && result.status !== 'timedOut') continue;
          const error = result.error?.message ?? '';
          const stack = result.error?.stack ?? '';
          const errorValue = result.error?.value ?? '';
          const selectorRaw = extractSelectorFromError(`${error}\n${stack}`);
          const ctx: FailureContext = {
            testTitle: sp.title,
            url: extractUrlFromReport(root, stack),
            error,
            errorValue,
          };
          if (selectorRaw !== undefined) ctx.selectorRaw = selectorRaw;
          out.push(ctx);
        }
      }
    }
    if (suite.suites) walkSuites(suite.suites, root, out);
  }
}

export function extractUrlFromReport(report: RawReport, stack: string): string {
  // W7 fix: prefer config.use.baseURL
  const project = report.config?.projects?.[0];
  if (project?.use?.baseURL) return project.use.baseURL;
  // Fallback: page.goto regex
  const m = stack.match(/page\.goto\(['"`](https?:\/\/[^'"`]+)['"`]/);
  return m && m[1] ? m[1] : '';
}

export function isSelectorMiss(input: { error: string; errorValue: string }): boolean {
  // W7 fix: typed error classification + targeted keyword checks
  if (input.errorValue === 'TimeoutError') return true;
  if (input.errorValue === 'AssertionError') return false; // not a selector miss
  const e = input.error.toLowerCase();
  if (e.includes('element not found')) return true;
  if (e.includes('expected to be visible')) return true;
  if (e.includes('expected count')) return true;
  return false;
}

function isSelectorMissFromFailure(f: FailureContext): boolean {
  return isSelectorMiss({ error: f.error, errorValue: f.errorValue });
}

function extractSelectorFromError(text: string): string | undefined {
  for (const re of SELECTOR_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return undefined;
}
