import { describe, it, expect } from 'vitest';
import { plan } from '../../src/agent/planner.ts';
import { mockOpenAI } from '../fixtures/openai-mock.ts';

describe('plan', () => {
  it('returns scenarios from submit_plan tool call', async () => {
    const openai = mockOpenAI({
      submit_plan: () => ({
        scenarios: [
          { name: 'logged in with valid creds', category: 'happy',    rationale: 'core flow' },
          { name: 'rejects invalid password',   category: 'negative', rationale: 'error state' },
          { name: 'shows label landmarks',      category: 'a11y',     rationale: 'wcag' },
        ],
      }),
    });
    const r = await plan({
      url: 'https://example.com', openai,
      snapshot: { title: 'Login', url: 'https://example.com', headings: [], inputs: [], buttons: [] },
    });
    expect(r.scenarios).toHaveLength(3);
    expect(r.scenarios[0]).toMatchObject({ category: 'happy' });
  });

  it('retries once on invalid JSON, succeeds on second call', async () => {
    const openai = mockOpenAI(
      { submit_plan: () => ({ scenarios: [{ name: 'x', category: 'happy', rationale: 'y' }] }) },
      { failFirst: true },
    );
    const r = await plan({
      url: 'https://example.com', openai,
      snapshot: { title: 't', url: 'u', headings: [], inputs: [], buttons: [] },
    });
    expect(r.scenarios).toHaveLength(1);
  });

  it('throws if both attempts fail validation', async () => {
    const openai = mockOpenAI({ submit_plan: () => ({ not_scenarios: true }) });
    await expect(
      plan({
        url: 'https://example.com', openai,
        snapshot: { title: 't', url: 'u', headings: [], inputs: [], buttons: [] },
      }),
    ).rejects.toThrow(/plan validation/i);
  });
});
