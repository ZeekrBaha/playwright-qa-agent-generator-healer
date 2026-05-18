import fs from 'node:fs';
import { z } from 'zod';
import { resolve as resolveSelector, type CascadeLevel } from './selectors.ts';
import { withRetry } from './retry.ts';
import type OpenAI from 'openai';
import type { Page } from 'playwright';

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

export interface SelectorCall {
  raw: string;
  line: number;
  col: number;
  level: CascadeLevel;
}

const ProposalSchema = z.object({
  intent: z.string().min(1),
  role: z.string().optional(),
  label: z.string().optional(),
  testid: z.string().optional(),
  css: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

export interface HealProposal {
  intent: string;
  role?: string;
  label?: string;
  testid?: string;
  css?: string;
  confidence: number;
  level: CascadeLevel;
  arg: string | { role: string; name: string };
}

const PROPOSER_SYSTEM = `You are a selector healer. A Playwright selector stopped working because the page changed. Propose a replacement that matches the ORIGINAL INTENT. Prefer role+name; fall back to label; then testid; then CSS as last resort.

Call propose_selector. If no good replacement is visible, return confidence 0.0.`;

export async function proposeNewSelector(opts: {
  openai: OpenAI;
  page: Page;
  oldCall: SelectorCall;
  failure: FailureContext;
  model?: string;
}): Promise<HealProposal | null> {
  const model = opts.model ?? process.env.OPENAI_MODEL_HEAL ?? 'gpt-4o-mini';

  const snapshot = await opts.page.evaluate(() => {
    const pick = (el: Element): { tag: string; role?: string; label?: string; testid?: string } => {
      const r = el as HTMLElement;
      const text = (r.getAttribute('aria-label') ?? r.getAttribute('placeholder') ?? r.getAttribute('name') ?? (r.textContent ?? '').trim().slice(0, 60)) || undefined;
      const out: { tag: string; role?: string; label?: string; testid?: string } = { tag: r.tagName.toLowerCase() };
      const role = r.getAttribute('role');
      if (role) out.role = role;
      if (text) out.label = text;
      const testid = r.getAttribute('data-testid');
      if (testid) out.testid = testid;
      return out;
    };
    return {
      inputs: Array.from(document.querySelectorAll('input, textarea, select')).slice(0, 40).map(pick),
      buttons: Array.from(document.querySelectorAll('button, [role="button"]')).slice(0, 40).map(pick),
      links: Array.from(document.querySelectorAll('a[href]')).slice(0, 30).map(pick),
    };
  });

  const toolDef: OpenAI.Chat.ChatCompletionTool = {
    type: 'function',
    function: {
      name: 'propose_selector',
      description: 'Propose a replacement selector for the failing element',
      parameters: {
        type: 'object',
        properties: {
          intent: { type: 'string' },
          role: { type: 'string' },
          label: { type: 'string' },
          testid: { type: 'string' },
          css: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['intent', 'confidence'],
      },
    },
  };

  const response = await withRetry(() => opts.openai.chat.completions.create({
    model,
    max_completion_tokens: 500,
    messages: [
      { role: 'system', content: PROPOSER_SYSTEM },
      { role: 'user', content: `Original failing call:\n  ${opts.oldCall.raw}\n\nFailure:\n  ${opts.failure.error.slice(0, 400)}\n\nLive page elements:\n${JSON.stringify(snapshot, null, 2)}` },
    ],
    tools: [toolDef],
    tool_choice: { type: 'function', function: { name: 'propose_selector' } },
  }));

  const call = response.choices[0]?.message?.tool_calls?.[0];
  if (!call || call.type !== 'function') return null;
  let parsed: ReturnType<typeof ProposalSchema.parse>;
  try {
    parsed = ProposalSchema.parse(JSON.parse(call.function.arguments));
  } catch {
    return null;
  }
  if (parsed.confidence < 0.4) return null;

  // Verify: must resolve to exactly 1 element
  const resolveOpts: Parameters<typeof resolveSelector>[1] = { intent: parsed.intent };
  if (parsed.role !== undefined) resolveOpts.role = parsed.role;
  if (parsed.label !== undefined) resolveOpts.label = parsed.label;
  if (parsed.testid !== undefined) resolveOpts.testid = parsed.testid;
  if (parsed.css !== undefined) resolveOpts.css = parsed.css;
  const resolved = await resolveSelector(opts.page, resolveOpts);
  if (!resolved) return null;

  return {
    intent: parsed.intent,
    ...(parsed.role !== undefined ? { role: parsed.role } : {}),
    ...(parsed.label !== undefined ? { label: parsed.label } : {}),
    ...(parsed.testid !== undefined ? { testid: parsed.testid } : {}),
    ...(parsed.css !== undefined ? { css: parsed.css } : {}),
    confidence: parsed.confidence,
    level: resolved.level,
    arg: resolved.arg,
  };
}
