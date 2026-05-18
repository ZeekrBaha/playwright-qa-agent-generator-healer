import type OpenAI from 'openai';
import { z } from 'zod';
import { computeCost } from './pricing.ts';
import { withRetry } from './retry.ts';
import type { Scenario, TraceStep } from './trace.ts';

const VerdictSchema = z.object({
  scenario: z.string().min(1),
  verdict: z.enum(['ship', 'weak', 'fix']),
  reason: z.string().min(1),
});
const VerdictsSchema = z.object({
  verdicts: z.array(VerdictSchema),
  summary: z.string(),
});

export type Verdict = 'ship' | 'weak' | 'fix';

export interface ScenarioVerdict {
  scenario: string;
  verdict: Verdict;
  reason: string;
}

export interface CriticResult {
  verdicts: ScenarioVerdict[];
  summary: string;
  costUsd: number | null;
}

const SYSTEM = `You are the Critic, a senior QA reviewer. You will be shown test scenarios an exploration agent recorded against a live page. Every scenario has actually executed — the actions worked. Judge whether the ASSERTIONS would catch a real bug.

For each scenario, return one verdict:
- ship  → scenario tests something meaningful and assertion is specific enough to fail when broken
- weak  → scenario runs but assertion is too loose
- fix   → assertion is wrong, missing, or tests something orthogonal to the scenario name

Call the submit_verdicts tool. Do not respond with prose.`;

export async function critique(opts: {
  url: string;
  scenarios: Scenario[];
  openai: OpenAI;
  model?: string;
}): Promise<CriticResult> {
  if (opts.scenarios.length === 0) {
    return { verdicts: [], summary: 'No scenarios recorded — nothing to review.', costUsd: 0 };
  }
  const model = opts.model ?? process.env.OPENAI_MODEL_CRITIC ?? 'gpt-4o-mini';

  const submitToolDef: OpenAI.Chat.ChatCompletionTool = {
    type: 'function',
    function: {
      name: 'submit_verdicts',
      description: 'Submit per-scenario verdicts',
      parameters: {
        type: 'object',
        properties: {
          verdicts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                scenario: { type: 'string' },
                verdict: { type: 'string', enum: ['ship', 'weak', 'fix'] },
                reason: { type: 'string' },
              },
              required: ['scenario', 'verdict', 'reason'],
            },
          },
          summary: { type: 'string' },
        },
        required: ['verdicts', 'summary'],
      },
    },
  };

  const traceSummary = opts.scenarios.map((s, i) => {
    const steps = s.steps.map((step) => describeStep(step)).join('\n      ');
    return `${i + 1}. [${s.category}] ${s.name}\n      ${steps}`;
  }).join('\n\n');

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await withRetry(() =>
      opts.openai.chat.completions.create({
        model,
        max_completion_tokens: 1500,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `URL: ${opts.url}\n\nRecorded scenarios:\n\n${traceSummary}` },
        ],
        tools: [submitToolDef],
        tool_choice: { type: 'function', function: { name: 'submit_verdicts' } },
      }),
    );

    const call = response.choices[0]?.message?.tool_calls?.[0];
    if (!call) continue;
    try {
      const parsed = VerdictsSchema.parse(JSON.parse(call.function.arguments));
      const u = response.usage;
      const costUsd = u ? computeCost(model, {
        inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, cachedTokens: 0,
      }) : null;
      return { verdicts: parsed.verdicts, summary: parsed.summary, costUsd };
    } catch {
      if (attempt === 1) throw new Error('critic validation failed after 2 attempts');
    }
  }
  throw new Error('critic validation failed after 2 attempts');
}

function describeStep(step: TraceStep): string {
  switch (step.kind) {
    case 'navigate': return `navigate(${step.url})`;
    case 'click':    return `click(${step.target.intent} via ${step.target.level})`;
    case 'fill':     return `fill(${step.target.intent}, ${JSON.stringify(step.value).slice(0, 30)})`;
    case 'press':    return `press(${step.key} on ${step.target.intent})`;
    case 'wait':     return `wait(${step.ms}ms)`;
    case 'assert': {
      const a = step.assertion;
      switch (a.type) {
        case 'toBeVisible':   return `assert ${a.target.intent} visible`;
        case 'toHaveText':    return `assert ${a.target.intent} has text "${a.text}"`;
        case 'toContainText': return `assert ${a.target.intent} contains "${a.text}"`;
        case 'toHaveURL':     return `assert URL matches /${a.pattern}/`;
        case 'toHaveCount':   return `assert ${a.target.intent} count=${a.count}`;
      }
    }
  }
}
