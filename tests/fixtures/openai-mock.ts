import type OpenAI from 'openai';

export type MockToolResponse = Record<string, (args: unknown) => unknown>;

export interface MockSequenceStep {
  tool: string;
  args: unknown;
}

export interface MockOptions {
  failFirst?: boolean;
}

/** Original single-shot mode: emits the first tool defined in req.tools every turn. */
export function mockOpenAI(handlers: MockToolResponse, opts?: MockOptions): OpenAI {
  let callCount = 0;
  return makeClient(async (req) => {
    callCount++;
    const tool = (req.tools ?? [])[0];
    if (!tool || tool.type !== 'function') throw new Error('mock: no tool to invoke');
    const name = tool.function.name;
    const handler = handlers[name];
    if (!handler) throw new Error(`mock: no handler for tool ${name}`);
    if (opts?.failFirst && callCount === 1) return invalidToolCall(req.model, name);
    const args = handler({});
    return validToolCall(req.model, name, args);
  });
}

/** Sequence mode: emits a predetermined sequence of tool calls one per turn. */
export function mockOpenAISequence(steps: MockSequenceStep[]): OpenAI {
  let i = 0;
  return makeClient(async (req) => {
    if (i >= steps.length) {
      return stopResponse(req.model);
    }
    const step = steps[i++];
    if (!step) return stopResponse(req.model);
    return validToolCall(req.model, step.tool, step.args);
  });
}

function makeClient(
  handler: (
    req: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  ) => Promise<OpenAI.Chat.ChatCompletion>,
): OpenAI {
  return {
    chat: { completions: { create: handler } },
  } as unknown as OpenAI;
}

function validToolCall(model: string, name: string, args: unknown): OpenAI.Chat.ChatCompletion {
  return {
    id: 'mock',
    model,
    object: 'chat.completion',
    created: Date.now(),
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    choices: [
      {
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: `t${Math.random()}`,
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  } as unknown as OpenAI.Chat.ChatCompletion;
}

function invalidToolCall(model: string, name: string): OpenAI.Chat.ChatCompletion {
  return {
    id: 'mock',
    model,
    object: 'chat.completion',
    created: Date.now(),
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    choices: [
      {
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 't', type: 'function', function: { name, arguments: '{invalid json' } },
          ],
        },
      },
    ],
  } as unknown as OpenAI.Chat.ChatCompletion;
}

function stopResponse(model: string): OpenAI.Chat.ChatCompletion {
  return {
    id: 'mock',
    model,
    object: 'chat.completion',
    created: Date.now(),
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'done' },
      },
    ],
  } as unknown as OpenAI.Chat.ChatCompletion;
}
