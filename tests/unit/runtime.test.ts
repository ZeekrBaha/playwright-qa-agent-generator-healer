import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { explore } from '../../src/agent/runtime.ts';
import { mockOpenAISequence } from '../fixtures/openai-mock.ts';
import type OpenAI from 'openai';

let outDir: string;
let cwd: string;

beforeEach(() => {
  cwd = process.cwd();
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veriplay-runtime-'));
  process.chdir(outDir); // memory writes are cwd-relative
});
afterEach(() => {
  process.chdir(cwd);
  fs.rmSync(outDir, { recursive: true, force: true });
});

// Helper: a mock that handles the full Planner → Explorer → Critic flow.
// mockOpenAISequence emits each entry as the next response regardless of which
// tool name was actually requested in the API call. The runtime's Explorer
// tolerates unknown tool names (runTool returns ok:false), so it just costs one
// extra turn when a non-explorer tool slips in.
function makeFullPipelineMock(opts: {
  plannerScenarios: Array<{
    name: string;
    category: 'happy' | 'negative' | 'edge' | 'a11y';
    rationale: string;
  }>;
  explorerSequence: Array<{ tool: string; args: unknown }>;
  criticVerdicts: Array<{
    scenario: string;
    verdict: 'ship' | 'weak' | 'fix';
    reason: string;
  }>;
}): OpenAI {
  return mockOpenAISequence([
    // 1 planner call (skipped via skipPlan in tests, but kept here in case)
    { tool: 'submit_plan', args: { scenarios: opts.plannerScenarios } },
    // explorer tool calls
    ...opts.explorerSequence,
    // 1 critic call
    {
      tool: 'submit_verdicts',
      args: { verdicts: opts.criticVerdicts, summary: 'OK' },
    },
  ]);
}

describe('explore', () => {
  it('runs the full pipeline and writes run-report.json', async () => {
    const openai = makeFullPipelineMock({
      plannerScenarios: [
        { name: 'happy path', category: 'happy', rationale: 'core' },
        { name: 'negative path', category: 'negative', rationale: 'error' },
        { name: 'a11y check', category: 'a11y', rationale: 'wcag' },
      ],
      explorerSequence: [
        { tool: 'begin_scenario', args: { name: 'happy path', category: 'happy' } },
        { tool: 'navigate', args: { url: 'about:blank' } },
        { tool: 'assert', args: { type: 'toHaveURL', pattern: 'about:blank' } },
        { tool: 'end_scenario', args: {} },
        {
          tool: 'begin_scenario',
          args: { name: 'negative path', category: 'negative' },
        },
        { tool: 'assert', args: { type: 'toHaveURL', pattern: 'about:blank' } },
        { tool: 'end_scenario', args: {} },
        {
          tool: 'begin_scenario',
          args: { name: 'a11y check', category: 'a11y' },
        },
        { tool: 'assert', args: { type: 'toHaveURL', pattern: 'about:blank' } },
        { tool: 'end_scenario', args: {} },
        { tool: 'finish', args: { summary: 'done' } },
      ],
      criticVerdicts: [
        { scenario: 'happy path', verdict: 'ship', reason: 'good' },
        { scenario: 'negative path', verdict: 'ship', reason: 'good' },
        { scenario: 'a11y check', verdict: 'ship', reason: 'good' },
      ],
    });

    const result = await explore({
      url: 'about:blank',
      language: 'ts',
      openai,
      outDir,
      skipPlan: true, // skip planner snapshot (avoids real planner browser nav)
    });
    if ('paused' in result) throw new Error('unexpected pause');
    expect(result.scenarios.length).toBe(3);
    expect(fs.existsSync(path.join(outDir, 'run-report.json'))).toBe(true);
  });

  it('skipPlan + skipCritic option short-circuits both stages', async () => {
    const openai = mockOpenAISequence([
      { tool: 'begin_scenario', args: { name: 'x', category: 'happy' } },
      { tool: 'navigate', args: { url: 'about:blank' } },
      { tool: 'assert', args: { type: 'toHaveURL', pattern: 'about:blank' } },
      { tool: 'end_scenario', args: {} },
      { tool: 'finish', args: { summary: 'done' } },
      // W6 follow-ups will fire because we only have 'happy', no negative/a11y
      { tool: 'begin_scenario', args: { name: 'neg', category: 'negative' } },
      { tool: 'assert', args: { type: 'toHaveURL', pattern: 'about:blank' } },
      { tool: 'end_scenario', args: {} },
      { tool: 'finish', args: { summary: 'done' } },
      { tool: 'begin_scenario', args: { name: 'a11y', category: 'a11y' } },
      { tool: 'assert', args: { type: 'toHaveURL', pattern: 'about:blank' } },
      { tool: 'end_scenario', args: {} },
      { tool: 'finish', args: { summary: 'done' } },
    ]);
    const result = await explore({
      url: 'about:blank',
      language: 'ts',
      openai,
      outDir,
      skipPlan: true,
      skipCritic: true,
    });
    if ('paused' in result) throw new Error('unexpected pause');
    expect(result.review).toBeUndefined();
    expect(result.plan).toBeUndefined();
  });

  it('W6: enforces negative scenario coverage with one follow-up turn', async () => {
    // Explorer initially produces only a happy scenario. Runtime should dispatch
    // one follow-up turn requesting a negative scenario, then another for a11y.
    const openai = mockOpenAISequence([
      // Initial Explorer turns: only happy
      { tool: 'begin_scenario', args: { name: 'happy', category: 'happy' } },
      { tool: 'navigate', args: { url: 'about:blank' } },
      { tool: 'assert', args: { type: 'toHaveURL', pattern: 'about:blank' } },
      { tool: 'end_scenario', args: {} },
      { tool: 'finish', args: { summary: 'done' } },
      // W6 follow-up for missing negative:
      {
        tool: 'begin_scenario',
        args: { name: 'rejected invalid input', category: 'negative' },
      },
      { tool: 'assert', args: { type: 'toHaveURL', pattern: 'about:blank' } },
      { tool: 'end_scenario', args: {} },
      { tool: 'finish', args: { summary: 'done' } },
      // W6 follow-up for missing a11y:
      {
        tool: 'begin_scenario',
        args: { name: 'a11y landmark visible', category: 'a11y' },
      },
      { tool: 'assert', args: { type: 'toHaveURL', pattern: 'about:blank' } },
      { tool: 'end_scenario', args: {} },
      { tool: 'finish', args: { summary: 'done' } },
    ]);
    const result = await explore({
      url: 'about:blank',
      language: 'ts',
      openai,
      outDir,
      skipPlan: true,
      skipCritic: true,
    });
    if ('paused' in result) throw new Error('unexpected pause');
    expect(result.scenarios.some((s) => s.category === 'negative')).toBe(true);
    expect(result.scenarios.some((s) => s.category === 'a11y')).toBe(true);
  });
});
