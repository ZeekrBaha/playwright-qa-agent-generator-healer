import type OpenAI from 'openai';

export type MockToolResponse = Record<string, (args: unknown) => unknown>;

export function mockOpenAI(handlers: MockToolResponse, opts?: { failFirst?: boolean }): OpenAI {
  let callCount = 0;
  return {
    chat: {
      completions: {
        create: async (req: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming) => {
          callCount++;
          const tool = (req.tools ?? [])[0];
          if (!tool || tool.type !== 'function') throw new Error('mock: no tool to invoke');
          const name = tool.function.name;
          const handler = handlers[name];
          if (!handler) throw new Error(`mock: no handler for tool ${name}`);
          if (opts?.failFirst && callCount === 1) {
            return {
              id: 'mock', model: req.model, object: 'chat.completion',
              created: Date.now(),
              usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
              choices: [{
                index: 0, finish_reason: 'tool_calls',
                message: {
                  role: 'assistant', content: null,
                  tool_calls: [{ id: 't', type: 'function', function: { name, arguments: '{invalid json' } }],
                },
              }],
            } as unknown as OpenAI.Chat.ChatCompletion;
          }
          const args = handler({});
          return {
            id: 'mock', model: req.model, object: 'chat.completion',
            created: Date.now(),
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
            choices: [{
              index: 0, finish_reason: 'tool_calls',
              message: {
                role: 'assistant', content: null,
                tool_calls: [{ id: 't', type: 'function', function: { name, arguments: JSON.stringify(args) } }],
              },
            }],
          } as unknown as OpenAI.Chat.ChatCompletion;
        },
      },
    },
  } as unknown as OpenAI;
}
