import type OpenAI from 'openai';
import { z } from 'zod';
import { computeCost } from './pricing.ts';
import { withRetry } from './retry.ts';
import type { ScenarioCategory } from './trace.ts';

const ScenarioSchema = z.object({
  name: z.string().min(1),
  category: z.enum(['happy', 'negative', 'edge', 'a11y']),
  rationale: z.string().min(1),
});
const PlanSchema = z.object({ scenarios: z.array(ScenarioSchema).min(1).max(8) });

export interface PlannedScenario {
  name: string;
  category: ScenarioCategory;
  rationale: string;
}

export interface PageSnapshot {
  title: string;
  url: string;
  headings: unknown[];
  inputs: unknown[];
  buttons: unknown[];
}

export interface PlanResult {
  scenarios: PlannedScenario[];
  costUsd: number | null;
}

const SYSTEM = `You are the Planner. Look at a web page and propose 3-6 focused test scenarios.

Constraints:
- At least one happy, one negative, one a11y.
- Scenario names are past-tense and describe the OUTCOME ("rejects invalid password"), not the action.
- Skip scenarios you cannot verify from a single page.

Call the submit_plan tool with your proposal. Do not respond with prose.`;

export async function plan(opts: {
  url: string;
  openai: OpenAI;
  snapshot: PageSnapshot;
  model?: string;
}): Promise<PlanResult> {
  const model = opts.model ?? process.env.OPENAI_MODEL_PLANNER ?? 'gpt-4o-mini';

  const submitToolDef: OpenAI.Chat.ChatCompletionTool = {
    type: 'function',
    function: {
      name: 'submit_plan',
      description: 'Submit the test scenario plan',
      parameters: {
        type: 'object',
        properties: {
          scenarios: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                category: { type: 'string', enum: ['happy', 'negative', 'edge', 'a11y'] },
                rationale: { type: 'string' },
              },
              required: ['name', 'category', 'rationale'],
            },
            minItems: 3, maxItems: 6,
          },
        },
        required: ['scenarios'],
      },
    },
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await withRetry(() =>
      opts.openai.chat.completions.create({
        model,
        max_completion_tokens: 1500,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `URL: ${opts.url}\n\nPage snapshot:\n${JSON.stringify(opts.snapshot, null, 2)}` },
        ],
        tools: [submitToolDef],
        tool_choice: { type: 'function', function: { name: 'submit_plan' } },
      }),
    );

    const call = response.choices[0]?.message?.tool_calls?.[0];
    if (!call) continue;
    try {
      const parsed = PlanSchema.parse(JSON.parse(call.function.arguments));
      const u = response.usage;
      const costUsd = u ? computeCost(model, {
        inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, cachedTokens: 0,
      }) : null;
      return { scenarios: parsed.scenarios, costUsd };
    } catch {
      if (attempt === 1) throw new Error('plan validation failed after 2 attempts');
    }
  }
  throw new Error('plan validation failed after 2 attempts');
}
