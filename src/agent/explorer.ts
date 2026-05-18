import type OpenAI from 'openai';
import type { PlannedScenario } from './planner.ts';
import { computeCost } from './pricing.ts';
import { withRetry } from './retry.ts';
import { TOOL_DEFS, runTool, type ToolContext } from './tools.ts';

export type ExploreLoopEvent =
  | { type: 'tool_call'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; ok: boolean; data?: unknown; error?: string }
  | { type: 'usage'; usd: number | null; tokens: number }
  | { type: 'retry'; attempt: number; waitMs: number; lastError: unknown };

export interface ExploreLoopArgs {
  openai: OpenAI;
  model: string;
  ctx: ToolContext;
  url: string;
  systemBlocks: string[];
  plan: PlannedScenario[];
  maxUsd: number;
  onEvent?: (e: ExploreLoopEvent) => void;
}

export interface ExploreLoopResult {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  usd: number | null;
}

const MAX_TURNS = 30;

function toolDefsForOpenAI(): OpenAI.Chat.ChatCompletionTool[] {
  return TOOL_DEFS.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}

export async function runExplorerLoop(args: ExploreLoopArgs): Promise<ExploreLoopResult> {
  const { openai, model, ctx, url, systemBlocks, plan, maxUsd, onEvent } = args;

  const cost: ExploreLoopResult = {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    usd: 0,
  };

  // System message: frozen rule blocks first (longest cacheable prefix), then plan.
  const planBlock =
    plan.length > 0
      ? 'Planned scenarios (cover all of these unless impossible from this page):\n' +
        plan
          .map((p, i) => `  ${i + 1}. [${p.category}] ${p.name} — ${p.rationale}`)
          .join('\n')
      : null;
  const systemParts = planBlock != null ? [...systemBlocks, planBlock] : [...systemBlocks];
  const systemContent = systemParts.join('\n\n');

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemContent },
    {
      role: 'user',
      content: `Explore the following URL and produce a Playwright test plan: ${url}`,
    },
  ];

  const tools = toolDefsForOpenAI();

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (cost.usd != null && cost.usd > maxUsd) {
      throw new Error(
        `Cost ceiling exceeded ($${cost.usd.toFixed(5)} > $${maxUsd}). Aborting.`,
      );
    }

    const response = await withRetry(
      () =>
        openai.chat.completions.create({
          model,
          max_completion_tokens: 4000,
          messages,
          tools,
        }),
      {
        onRetry: (info) =>
          onEvent?.({
            type: 'retry',
            attempt: info.attempt,
            waitMs: info.waitMs,
            lastError: info.lastError,
          }),
      },
    );

    const u = response.usage;
    if (u) {
      cost.inputTokens += u.prompt_tokens;
      cost.outputTokens += u.completion_tokens;
      const cached =
        (u as { prompt_tokens_details?: { cached_tokens?: number } }).prompt_tokens_details
          ?.cached_tokens ?? 0;
      cost.cachedTokens += cached;
      const computed = computeCost(model, {
        inputTokens: cost.inputTokens,
        outputTokens: cost.outputTokens,
        cachedTokens: cost.cachedTokens,
      });
      cost.usd = computed;
      onEvent?.({
        type: 'usage',
        usd: computed,
        tokens: cost.inputTokens + cost.outputTokens,
      });
    }

    const choice = response.choices[0];
    if (!choice) break;
    const msg = choice.message;

    // No tool calls -> done.
    if (
      !msg.tool_calls ||
      msg.tool_calls.length === 0 ||
      choice.finish_reason !== 'tool_calls'
    ) {
      break;
    }

    messages.push({
      role: 'assistant',
      content: msg.content ?? null,
      tool_calls: msg.tool_calls,
    });

    let finished = false;
    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue;
      let input: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(call.function.arguments) as unknown;
        if (parsed && typeof parsed === 'object') {
          input = parsed as Record<string, unknown>;
        }
      } catch {
        /* leave empty */
      }
      onEvent?.({ type: 'tool_call', name: call.function.name, input });
      const result = await runTool(ctx, { name: call.function.name, input });
      const event: ExploreLoopEvent = {
        type: 'tool_result',
        name: call.function.name,
        ok: result.ok,
        ...(result.data !== undefined ? { data: result.data } : {}),
        ...(result.error !== undefined ? { error: result.error } : {}),
      };
      onEvent?.(event);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(
          result.ok ? (result.data ?? { ok: true }) : { error: result.error },
        ),
      });
      if (call.function.name === 'finish' && result.ok) finished = true;
    }
    if (finished) break;
  }

  return cost;
}
