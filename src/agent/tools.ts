import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { resolve } from './selectors.ts';
import type {
  Assertion,
  CascadeLevel,
  Scenario,
  ScenarioCategory,
  SelectorRecord,
  TraceStep,
} from './trace.ts';

// ---------------------------------------------------------------------------
// ToolContext
// ---------------------------------------------------------------------------

export interface ToolContext {
  page: Page;
  scenarios: Scenario[];
  current: Scenario | null;
  cascadeStats: Record<CascadeLevel, number>;
  steps: number;
  maxSteps: number;
}

export function createContext(page: Page, maxSteps: number): ToolContext {
  return {
    page,
    scenarios: [],
    current: null,
    cascadeStats: { role: 0, label: 0, testid: 0, css: 0 },
    steps: 0,
    maxSteps,
  };
}

// ---------------------------------------------------------------------------
// Tool result / call shapes
// ---------------------------------------------------------------------------

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface ToolInput {
  name: string;
  input: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// TOOL_DEFS — the LLM-facing tool surface (10 tools)
// ---------------------------------------------------------------------------

export const TOOL_DEFS = [
  {
    name: 'begin_scenario',
    description:
      'Start a new test scenario. Call before any actions. Categories: happy, negative, edge, a11y.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Past-tense scenario name describing the outcome.',
        },
        category: {
          type: 'string',
          enum: ['happy', 'negative', 'edge', 'a11y'],
        },
      },
      required: ['name', 'category'],
    },
  },
  {
    name: 'navigate',
    description:
      'Navigate the browser to a URL. Must be called at least once before other actions.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
  {
    name: 'click',
    description:
      'Click an element. Describe by intent (e.g. "login button") plus optional hints.',
    input_schema: {
      type: 'object',
      properties: {
        intent: { type: 'string' },
        role: { type: 'string' },
        label: { type: 'string' },
        testid: { type: 'string' },
        css: { type: 'string' },
      },
      required: ['intent'],
    },
  },
  {
    name: 'fill',
    description: 'Type into a form field. Same selector cascade as click.',
    input_schema: {
      type: 'object',
      properties: {
        intent: { type: 'string' },
        value: { type: 'string' },
        role: { type: 'string' },
        label: { type: 'string' },
        testid: { type: 'string' },
        css: { type: 'string' },
      },
      required: ['intent', 'value'],
    },
  },
  {
    name: 'press',
    description: 'Press a keyboard key on a target (e.g. Enter to submit).',
    input_schema: {
      type: 'object',
      properties: {
        intent: { type: 'string' },
        key: { type: 'string' },
        role: { type: 'string' },
        label: { type: 'string' },
        testid: { type: 'string' },
        css: { type: 'string' },
      },
      required: ['intent', 'key'],
    },
  },
  {
    name: 'wait',
    description:
      'Wait for a fixed number of milliseconds. Use sparingly; assertions auto-wait.',
    input_schema: {
      type: 'object',
      properties: { ms: { type: 'number' } },
      required: ['ms'],
    },
  },
  {
    name: 'get_dom',
    description:
      'Return a pruned summary of visible interactive elements. If truncated:true, call again with offset to paginate.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'assert',
    description:
      'Record an assertion for the current scenario. Use for verifiable outcomes.',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: [
            'toBeVisible',
            'toHaveText',
            'toContainText',
            'toHaveURL',
            'toHaveCount',
          ],
        },
        intent: { type: 'string' },
        role: { type: 'string' },
        label: { type: 'string' },
        testid: { type: 'string' },
        css: { type: 'string' },
        text: { type: 'string' },
        pattern: { type: 'string' },
        count: { type: 'number' },
      },
      required: ['type'],
    },
  },
  {
    name: 'end_scenario',
    description: 'Finish current scenario. Fails if no assertions recorded.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'finish',
    description:
      'End entire exploration. Call once you have 3-6 well-formed scenarios.',
    input_schema: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function pushStep(ctx: ToolContext, step: TraceStep): void {
  if (!ctx.current) {
    throw new Error('No scenario in progress — call begin_scenario first.');
  }
  ctx.current.steps.push(step);
}

type SelectorHints = {
  intent: string;
  role?: string;
  label?: string;
  testid?: string;
  css?: string;
};

async function resolveAndRecord(
  ctx: ToolContext,
  hints: SelectorHints,
): Promise<{ record: SelectorRecord; loc: Locator }> {
  const r = await resolve(ctx.page, hints);
  if (!r) {
    throw new Error(
      `Could not resolve element: ${hints.intent} (hints: ${JSON.stringify(hints)})`,
    );
  }
  ctx.cascadeStats[r.level] = (ctx.cascadeStats[r.level] ?? 0) + 1;
  return {
    record: { level: r.level, arg: r.arg, intent: hints.intent },
    loc: r.locator,
  };
}

// ---------------------------------------------------------------------------
// get_dom — pruned page summary with W3 truncation signal
// ---------------------------------------------------------------------------

async function summarizeDom(page: Page): Promise<unknown> {
  return await page.evaluate(() => {
    const CAPS = { headings: 10, inputs: 60, buttons: 60, links: 30 };

    const pick = (el: Element) => {
      const r = el as HTMLElement;
      const label =
        r.getAttribute('aria-label') ||
        r.getAttribute('placeholder') ||
        r.getAttribute('name') ||
        (r.textContent ?? '').trim().slice(0, 80);
      return {
        tag: r.tagName.toLowerCase(),
        role: r.getAttribute('role') || undefined,
        label: label || undefined,
        testid: r.getAttribute('data-testid') || undefined,
        type: (r as HTMLInputElement).type || undefined,
        visible: !!(r as HTMLElement).offsetParent,
      };
    };

    const allHeadings = Array.from(document.querySelectorAll('h1, h2, h3'));
    const allInputs = Array.from(
      document.querySelectorAll('input, textarea, select'),
    );
    const allButtons = Array.from(
      document.querySelectorAll('button, [role="button"]'),
    );
    const allLinks = Array.from(document.querySelectorAll('a[href]'));

    const headings = allHeadings.slice(0, CAPS.headings).map(pick);
    const inputs = allInputs.slice(0, CAPS.inputs).map(pick);
    const buttons = allButtons.slice(0, CAPS.buttons).map(pick);
    const links = allLinks.slice(0, CAPS.links).map(pick);

    const counts = {
      headings: { shown: headings.length, total: allHeadings.length },
      inputs: { shown: inputs.length, total: allInputs.length },
      buttons: { shown: buttons.length, total: allButtons.length },
      links: { shown: links.length, total: allLinks.length },
    };

    const truncated =
      counts.headings.total > counts.headings.shown ||
      counts.inputs.total > counts.inputs.shown ||
      counts.buttons.total > counts.buttons.shown ||
      counts.links.total > counts.links.shown;

    return {
      title: document.title,
      url: location.href,
      headings,
      inputs,
      buttons,
      links,
      counts,
      truncated,
    };
  });
}

// ---------------------------------------------------------------------------
// executeAssertion
// ---------------------------------------------------------------------------

type AssertInput = {
  type: Assertion['type'];
  intent?: string;
  role?: string;
  label?: string;
  testid?: string;
  css?: string;
  text?: string;
  pattern?: string;
  count?: number;
};

async function executeAssertion(
  ctx: ToolContext,
  input: AssertInput,
): Promise<ToolResult> {
  switch (input.type) {
    case 'toBeVisible': {
      const { record, loc } = await resolveAndRecord(ctx, {
        ...input,
        intent: input.intent ?? 'element',
      });
      await expect(loc).toBeVisible({ timeout: 5000 });
      pushStep(ctx, {
        kind: 'assert',
        name: `${record.intent} is visible`,
        assertion: { type: 'toBeVisible', target: record },
      });
      return { ok: true };
    }

    case 'toHaveText':
    case 'toContainText': {
      if (input.text == null) {
        return { ok: false, error: `${input.type} needs text.` };
      }
      const { record, loc } = await resolveAndRecord(ctx, {
        ...input,
        intent: input.intent ?? 'element',
      });
      if (input.type === 'toHaveText') {
        await expect(loc).toHaveText(input.text);
      } else {
        await expect(loc).toContainText(input.text);
      }
      pushStep(ctx, {
        kind: 'assert',
        name: `${record.intent} ${input.type === 'toHaveText' ? 'has text' : 'contains'} "${input.text}"`,
        assertion: { type: input.type, target: record, text: input.text },
      });
      return { ok: true };
    }

    case 'toHaveURL': {
      if (input.pattern == null) {
        return { ok: false, error: 'toHaveURL needs pattern.' };
      }
      await expect(ctx.page).toHaveURL(new RegExp(input.pattern));
      if (ctx.current) {
        pushStep(ctx, {
          kind: 'assert',
          name: `URL matches /${input.pattern}/`,
          assertion: { type: 'toHaveURL', pattern: input.pattern },
        });
      }
      return { ok: true };
    }

    case 'toHaveCount': {
      if (input.count == null) {
        return { ok: false, error: 'toHaveCount needs count.' };
      }
      const { record, loc } = await resolveAndRecord(ctx, {
        ...input,
        intent: input.intent ?? 'element',
      });
      await expect(loc).toHaveCount(input.count);
      pushStep(ctx, {
        kind: 'assert',
        name: `${record.intent} count is ${input.count}`,
        assertion: { type: 'toHaveCount', target: record, count: input.count },
      });
      return { ok: true };
    }
  }
}

// ---------------------------------------------------------------------------
// runTool — main dispatcher
// ---------------------------------------------------------------------------

export async function runTool(
  ctx: ToolContext,
  call: ToolInput,
): Promise<ToolResult> {
  ctx.steps++;
  if (ctx.steps > ctx.maxSteps) {
    return {
      ok: false,
      error: `Step budget exceeded (${ctx.maxSteps}). Call finish() now.`,
    };
  }

  try {
    switch (call.name) {
      case 'begin_scenario': {
        const name = String(call.input.name ?? '').trim();
        const category = String(
          call.input.category ?? 'happy',
        ) as ScenarioCategory;
        if (!name) return { ok: false, error: 'Scenario name required.' };
        if (ctx.current) {
          return { ok: false, error: 'A scenario is already in progress.' };
        }
        ctx.current = { name, category, steps: [] };
        return { ok: true, data: { name, category } };
      }

      case 'navigate': {
        const url = String(call.input.url ?? '');
        if (!/^https?:\/\//.test(url)) {
          return { ok: false, error: 'navigate requires an http(s) URL.' };
        }
        await ctx.page.goto(url, { waitUntil: 'domcontentloaded' });
        if (ctx.current) pushStep(ctx, { kind: 'navigate', url });
        return { ok: true, data: { url: ctx.page.url() } };
      }

      case 'click': {
        const hints = call.input as SelectorHints;
        const { record, loc } = await resolveAndRecord(ctx, hints);
        await loc.click();
        pushStep(ctx, { kind: 'click', target: record });
        return { ok: true, data: { clicked: record.intent } };
      }

      case 'fill': {
        const value = String(call.input.value ?? '');
        const hints = call.input as SelectorHints;
        const { record, loc } = await resolveAndRecord(ctx, hints);
        await loc.fill(value);
        pushStep(ctx, { kind: 'fill', target: record, value });
        return { ok: true, data: { filled: record.intent } };
      }

      case 'press': {
        const key = String(call.input.key ?? '');
        const hints = call.input as SelectorHints;
        const { record, loc } = await resolveAndRecord(ctx, hints);
        await loc.press(key);
        pushStep(ctx, { kind: 'press', target: record, key });
        return { ok: true, data: { pressed: key, on: record.intent } };
      }

      case 'wait': {
        const ms = Math.min(Math.max(0, Number(call.input.ms ?? 0)), 5000);
        await ctx.page.waitForTimeout(ms);
        if (ctx.current) pushStep(ctx, { kind: 'wait', ms });
        return { ok: true, data: { waited: ms } };
      }

      case 'get_dom': {
        const summary = await summarizeDom(ctx.page);
        return { ok: true, data: summary };
      }

      case 'assert': {
        return await executeAssertion(ctx, call.input as AssertInput);
      }

      case 'end_scenario': {
        if (!ctx.current) return { ok: false, error: 'No scenario to end.' };
        if (!ctx.current.steps.some((s) => s.kind === 'assert')) {
          return {
            ok: false,
            error:
              'Scenario has no assertions. Add at least one before end_scenario.',
          };
        }
        ctx.scenarios.push(ctx.current);
        ctx.current = null;
        return { ok: true, data: { scenariosSoFar: ctx.scenarios.length } };
      }

      case 'finish': {
        if (ctx.current) ctx.scenarios.push(ctx.current);
        ctx.current = null;
        return { ok: true, data: { done: true, scenarios: ctx.scenarios.length } };
      }

      default:
        return { ok: false, error: `Unknown tool: ${call.name}` };
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
