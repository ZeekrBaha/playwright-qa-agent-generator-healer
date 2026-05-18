import { describe, it, expect } from 'vitest';
import { critique } from '../../src/agent/critic.ts';
import { mockOpenAI } from '../fixtures/openai-mock.ts';

describe('critique', () => {
  it('returns verdicts from submit_verdicts tool call', async () => {
    const openai = mockOpenAI({
      submit_verdicts: () => ({
        verdicts: [
          { scenario: 'logged in', verdict: 'ship', reason: 'good assertion' },
          { scenario: 'edge case', verdict: 'weak', reason: 'no specific check' },
        ],
        summary: 'Decent coverage, one weak assertion.',
      }),
    });
    const r = await critique({
      url: 'https://example.com',
      scenarios: [
        { name: 'logged in', category: 'happy', steps: [{ kind: 'assert', name: 'x', assertion: { type: 'toHaveURL', pattern: '/inventory' } }] },
        { name: 'edge case', category: 'edge',  steps: [{ kind: 'assert', name: 'y', assertion: { type: 'toHaveURL', pattern: '/' } }] },
      ],
      openai,
    });
    expect(r.verdicts).toHaveLength(2);
    expect(r.summary).toMatch(/coverage/i);
  });

  it('returns empty when no scenarios (skips OpenAI call)', async () => {
    const openai = mockOpenAI({ submit_verdicts: () => ({ verdicts: [], summary: '' }) });
    const r = await critique({ url: 'https://example.com', scenarios: [], openai });
    expect(r.verdicts).toEqual([]);
    expect(r.costUsd).toBe(0);
  });

  it('retries on invalid JSON', async () => {
    const openai = mockOpenAI(
      {
        submit_verdicts: () => ({
          verdicts: [{ scenario: 'x', verdict: 'ship', reason: 'ok' }],
          summary: 'ok',
        }),
      },
      { failFirst: true },
    );
    const r = await critique({
      url: 'https://example.com',
      scenarios: [{ name: 'x', category: 'happy', steps: [{ kind: 'assert', name: 'a', assertion: { type: 'toHaveURL', pattern: '/' } }] }],
      openai,
    });
    expect(r.verdicts).toHaveLength(1);
  });
});
