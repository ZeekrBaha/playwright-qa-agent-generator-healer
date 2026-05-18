import fs from 'node:fs';
import path from 'node:path';
import type OpenAI from 'openai';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import { critique } from './critic.ts';
import {
  runExplorerLoop,
  type ExploreLoopEvent,
} from './explorer.ts';
import { renderMemoryBlock, saveRun } from './memory.ts';
import {
  plan,
  type PageSnapshot,
  type PlannedScenario,
} from './planner.ts';
import { createContext } from './tools.ts';
import type {
  CascadeLevel,
  RunReport,
  Scenario,
} from './trace.ts';

const SYSTEM_PROMPT = `You are veriplay, an autonomous QA agent that generates Playwright tests by exploring a web app like an experienced tester would.

Your job:
1. Navigate to the URL.
2. Use get_dom to understand what's on the page.
3. For each meaningful flow, call begin_scenario, then drive Playwright through the steps you would take to verify it, then call assert at least once, then end_scenario.
4. Cover happy paths AND at least one negative case AND one a11y check.
5. Call finish when you have 3-6 well-formed scenarios.

Rules:
- Describe selectors by INTENT first ("username input", "submit button") and let the cascade resolve them.
- Never assert on something you have not seen visible. Every scenario must have at least one assert.
- Stay within your step budget. Be decisive. Do not loop on get_dom.`;

export interface ExploreOptions {
  url: string;
  language: 'ts' | 'js';
  openai: OpenAI;
  outDir: string;
  maxSteps?: number;
  maxUsd?: number;
  model?: string;
  skipPlan?: boolean;
  skipCritic?: boolean;
  review?: boolean;
  fromPlan?: PlannedScenario[];
  onEvent?: (e: AgentEvent) => void;
}

export interface ReviewPaused {
  paused: true;
  planPath: string;
  scenarios: PlannedScenario[];
  outDir: string;
  url: string;
  language: 'ts' | 'js';
}

export type AgentEvent =
  | { type: 'plan_started' }
  | { type: 'plan_done'; scenarios: PlannedScenario[]; usd: number | null }
  | {
      type: 'review_paused';
      planPath: string;
      scenarios: PlannedScenario[];
    }
  | ExploreLoopEvent
  | { type: 'category_followup'; missing: 'negative' | 'a11y' }
  | { type: 'critic_started' }
  | {
      type: 'critic_done';
      verdicts: Array<{ scenario: string; verdict: string; reason: string }>;
      usd: number | null;
    }
  | { type: 'done'; scenarios: number };

export async function explore(
  opts: ExploreOptions,
): Promise<RunReport | ReviewPaused> {
  const maxSteps =
    opts.maxSteps ?? Number(process.env.VERIPLAY_MAX_STEPS ?? 40);
  const maxUsd = opts.maxUsd ?? Number(process.env.VERIPLAY_MAX_USD ?? 2);
  const model =
    opts.model ?? process.env.OPENAI_MODEL_EXPLORER ?? 'gpt-4o-mini';

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  // ─────────────────────────────────────────────────────────────
  // Stage 1: Planner
  // ─────────────────────────────────────────────────────────────
  let planResult: { scenarios: PlannedScenario[]; costUsd: number | null } = {
    scenarios: opts.fromPlan ?? [],
    costUsd: 0,
  };

  if (!opts.fromPlan && !opts.skipPlan) {
    opts.onEvent?.({ type: 'plan_started' });
    try {
      const snapshot = await snapshotPage(opts.url);
      const p = await plan({
        url: opts.url,
        openai: opts.openai,
        snapshot,
      });
      planResult = p;
      opts.onEvent?.({
        type: 'plan_done',
        scenarios: p.scenarios,
        usd: p.costUsd,
      });
      if (opts.review) {
        fs.mkdirSync(opts.outDir, { recursive: true });
        const planPath = path.join(opts.outDir, 'plan.csv');
        fs.writeFileSync(planPath, scenariosToCsv(opts.url, p.scenarios));
        opts.onEvent?.({
          type: 'review_paused',
          planPath,
          scenarios: p.scenarios,
        });
        return {
          paused: true,
          planPath,
          scenarios: p.scenarios,
          outDir: opts.outDir,
          url: opts.url,
          language: opts.language,
        };
      }
    } catch {
      // Continue without a plan — Explorer can still run free-form.
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Stage 2: Explorer
  // ─────────────────────────────────────────────────────────────
  let browser: Browser | undefined;
  let bctx: BrowserContext | undefined;
  let scenarios: Scenario[] = [];
  let cascadeStats: Record<CascadeLevel, number> = {
    role: 0,
    label: 0,
    testid: 0,
    css: 0,
  };
  let steps = 0;
  let explorerCost: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    usd: number | null;
  } = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, usd: 0 };

  try {
    browser = await chromium.launch({ headless: true });
    bctx = await browser.newContext();
    const page: Page = await bctx.newPage();

    const ctx = createContext(page, maxSteps);

    const memoryBlock = renderMemoryBlock(opts.url);
    const systemBlocks = [
      SYSTEM_PROMPT,
      ...(memoryBlock ? [memoryBlock] : []),
    ];

    const initial = await runExplorerLoop({
      openai: opts.openai,
      model,
      ctx,
      url: opts.url,
      systemBlocks,
      plan: planResult.scenarios,
      maxUsd,
      onEvent: (e) => opts.onEvent?.(e),
    });

    // Flush any in-progress scenario so it's counted in category coverage.
    if (ctx.current) {
      ctx.scenarios.push(ctx.current);
      ctx.current = null;
    }
    scenarios = ctx.scenarios;
    cascadeStats = ctx.cascadeStats;
    steps = ctx.steps;
    explorerCost = {
      inputTokens: initial.inputTokens,
      outputTokens: initial.outputTokens,
      cachedTokens: initial.cachedTokens,
      usd: initial.usd,
    };

    // W6: enforce category coverage with one follow-up per missing category.
    for (const required of ['negative', 'a11y'] as const) {
      if (!scenarios.some((s) => s.category === required)) {
        opts.onEvent?.({ type: 'category_followup', missing: required });
        const remainingSteps = Math.max(10, maxSteps - steps);
        const ctx2 = createContext(page, remainingSteps);
        try {
          const followupCost = await runExplorerLoop({
            openai: opts.openai,
            model,
            ctx: ctx2,
            url: opts.url,
            systemBlocks: [
              SYSTEM_PROMPT,
              `Follow-up: you did not produce a "${required}" scenario. Produce EXACTLY ONE ${required} scenario now, then call finish.`,
            ],
            plan: [],
            maxUsd: Math.max(0.5, maxUsd),
            onEvent: (e) => opts.onEvent?.(e),
          });
          if (ctx2.current) {
            ctx2.scenarios.push(ctx2.current);
            ctx2.current = null;
          }
          scenarios = scenarios.concat(ctx2.scenarios);
          cascadeStats = mergeCascade(cascadeStats, ctx2.cascadeStats);
          steps += ctx2.steps;
          explorerCost.inputTokens += followupCost.inputTokens;
          explorerCost.outputTokens += followupCost.outputTokens;
          explorerCost.cachedTokens += followupCost.cachedTokens;
          explorerCost.usd =
            (explorerCost.usd ?? 0) + (followupCost.usd ?? 0);
        } catch {
          // A follow-up failure should not abort the whole run.
        }
      }
    }
  } finally {
    await bctx?.close();
    await browser?.close();
  }

  // ─────────────────────────────────────────────────────────────
  // Stage 3: Critic
  // ─────────────────────────────────────────────────────────────
  let review: RunReport['review'];
  let criticUsd: number | null = 0;
  if (!opts.skipCritic && scenarios.length > 0) {
    opts.onEvent?.({ type: 'critic_started' });
    try {
      const c = await critique({
        url: opts.url,
        scenarios,
        openai: opts.openai,
      });
      review = { verdicts: c.verdicts, summary: c.summary };
      criticUsd = c.costUsd;
      opts.onEvent?.({
        type: 'critic_done',
        verdicts: c.verdicts,
        usd: c.costUsd,
      });
    } catch {
      // Critic failure shouldn't fail the whole run.
    }
  }

  const report: RunReport = {
    url: opts.url,
    language: opts.language,
    scenarios,
    cascadeStats,
    cost: {
      inputTokens: explorerCost.inputTokens,
      outputTokens: explorerCost.outputTokens,
      cachedTokens: explorerCost.cachedTokens,
      usd: explorerCost.usd,
      plannerUsd: planResult.costUsd,
      criticUsd,
    },
    steps,
    startedAt,
    finishedAt: new Date().toISOString(),
    ...(planResult.scenarios.length > 0 ? { plan: planResult.scenarios } : {}),
    ...(review !== undefined ? { review } : {}),
  };

  fs.mkdirSync(opts.outDir, { recursive: true });
  fs.writeFileSync(
    path.join(opts.outDir, 'run-report.json'),
    JSON.stringify(report, null, 2),
  );

  // Save per-host memory (best effort).
  try {
    const totalCost =
      (explorerCost.usd ?? 0) +
      (planResult.costUsd ?? 0) +
      (criticUsd ?? 0);
    const resolvedIntents = collectResolvedIntents(scenarios);
    saveRun({
      url: opts.url,
      scenarios: scenarios.length,
      cost: totalCost,
      model,
      durationSec: Math.round((Date.now() - startMs) / 1000),
      cascadeStats,
      resolvedIntents,
    });
  } catch {
    // memory is best-effort
  }

  opts.onEvent?.({ type: 'done', scenarios: scenarios.length });
  return report;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function snapshotPage(url: string): Promise<PageSnapshot> {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return await page.evaluate(() => {
      const pick = (el: Element) => {
        const r = el as HTMLElement;
        const label =
          r.getAttribute('aria-label') ??
          r.getAttribute('placeholder') ??
          r.getAttribute('name') ??
          (r.textContent ?? '').trim().slice(0, 80);
        return {
          tag: r.tagName.toLowerCase(),
          role: r.getAttribute('role') ?? undefined,
          label: label || undefined,
        };
      };
      return {
        title: document.title,
        url: location.href,
        headings: Array.from(document.querySelectorAll('h1, h2, h3'))
          .slice(0, 8)
          .map(pick),
        inputs: Array.from(document.querySelectorAll('input, textarea, select'))
          .slice(0, 25)
          .map(pick),
        buttons: Array.from(
          document.querySelectorAll('button, [role="button"]'),
        )
          .slice(0, 25)
          .map(pick),
      };
    });
  } finally {
    await browser.close();
  }
}

function scenariosToCsv(url: string, scenarios: PlannedScenario[]): string {
  const header =
    `# veriplay review plan for ${url}\n` +
    `# Set Approve=no on any row you do not want to test, then resume with:\n` +
    `#   npm run explore -- --from-plan <this-file>\n\n`;
  const columns = '#,Category,Scenario,Rationale,Approve\n';
  const rows = scenarios
    .map(
      (s, i) =>
        `${i + 1},${s.category},${JSON.stringify(s.name)},${JSON.stringify(s.rationale)},yes`,
    )
    .join('\n');
  return header + columns + rows + '\n';
}

function mergeCascade(
  a: Record<CascadeLevel, number>,
  b: Record<CascadeLevel, number>,
): Record<CascadeLevel, number> {
  return {
    role: a.role + b.role,
    label: a.label + b.label,
    testid: a.testid + b.testid,
    css: a.css + b.css,
  };
}

function collectResolvedIntents(
  scenarios: Scenario[],
): Array<{ intent: string; level: CascadeLevel }> {
  const out: Array<{ intent: string; level: CascadeLevel }> = [];
  for (const s of scenarios) {
    for (const step of s.steps) {
      if (
        step.kind === 'click' ||
        step.kind === 'fill' ||
        step.kind === 'press'
      ) {
        out.push({ intent: step.target.intent, level: step.target.level });
      } else if (step.kind === 'assert') {
        const a = step.assertion;
        if (a.type !== 'toHaveURL') {
          out.push({ intent: a.target.intent, level: a.target.level });
        }
      }
    }
  }
  return out;
}
