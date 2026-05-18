#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { explore, type AgentEvent } from '../agent/runtime.ts';
import { heal, type HealEvent } from '../agent/heal.ts';
import { transcribe } from '../agent/transcriber.ts';

const PROJECT_ROOT = process.env.VERIPLAY_PROJECT_ROOT ?? process.cwd();

function log(...parts: unknown[]): void {
  // CRITICAL: stderr only. stdout is the MCP wire protocol.
  process.stderr.write('[veriplay/mcp] ' + parts.map(String).join(' ') + '\n');
}

export function runId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function slug(s: string, max = 40): string {
  return (
    s
      .replace(/^https?:\/\//, '')
      .replace(/[^a-z0-9-]+/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, max)
      .toLowerCase() || 'run'
  );
}

/**
 * W9 fix: map an AgentEvent or HealEvent into a human-readable progress string
 * for MCP notifications/progress. Returns null when no useful message.
 */
export function mapEventToProgress(e: AgentEvent | HealEvent): string | null {
  switch (e.type) {
    case 'plan_started':
      return 'Planner: starting plan…';
    case 'plan_done':
      return `Planner: ${e.scenarios.length} scenarios proposed`;
    case 'review_paused':
      return `Review: ${e.scenarios.length} scenarios written to plan.csv`;
    case 'tool_call':
      return `Explorer: ${e.name}`;
    case 'tool_result':
      return e.ok ? null : `Explorer: ${e.name} failed`;
    case 'retry':
      return `Retry attempt ${e.attempt} (waiting ${e.waitMs}ms)…`;
    case 'category_followup':
      return `Runtime: requesting missing ${e.missing} scenario`;
    case 'critic_started':
      return 'Critic: reviewing…';
    case 'critic_done':
      return `Critic: ${e.verdicts.length} verdicts`;
    case 'done':
      // Both AgentEvent and HealEvent share a `done` discriminant; key off shape.
      if ('scenarios' in e && typeof e.scenarios === 'number') {
        return `Done: ${e.scenarios} scenarios`;
      }
      if ('healed' in e && 'total' in e) {
        return `Heal done: ${e.healed}/${e.total} healed`;
      }
      return 'Done';
    case 'running_spec':
      return 'Heal: running spec…';
    case 'failures_found':
      return `Heal: ${e.count} failures found`;
    case 'healing':
      return `Heal: ${e.selector}`;
    case 'healed':
      return `Heal: ${e.old} → ${e.new}`;
    case 'unhealed':
      return `Heal: skipped (${e.reason})`;
    case 'usage':
      return null;
    default:
      return null;
  }
}

function projectFile(...segs: string[]): string {
  return path.join(PROJECT_ROOT, ...segs);
}

function requireApiKey(): void {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set in the MCP server env.');
  }
}

/**
 * Pull a progressToken off RequestHandlerExtra. The MCP SDK exposes it on
 * `extra._meta.progressToken` (per RequestMetaSchema). Returns null if the
 * client didn't request progress (in which case we suppress notifications,
 * since `notifications/progress` requires a token).
 */
function progressTokenFrom(extra: { _meta?: { progressToken?: string | number } }): string | number | null {
  const token = extra._meta?.progressToken;
  return token ?? null;
}

interface SendNotificationCapable {
  sendNotification: (notification: {
    method: 'notifications/progress';
    params: { progressToken: string | number; progress: number; message?: string };
  }) => Promise<void>;
  _meta?: { progressToken?: string | number };
}

function makeProgressEmitter(extra: SendNotificationCapable): (msg: string) => void {
  let n = 0;
  return (msg: string) => {
    const token = progressTokenFrom(extra);
    if (token === null) return;
    n += 1;
    extra
      .sendNotification({
        method: 'notifications/progress',
        params: { progressToken: token, progress: n, message: msg },
      })
      .catch(() => {
        /* best-effort; never let a notification failure abort the tool */
      });
  };
}

async function startServer(): Promise<void> {
  const server = new McpServer(
    { name: 'veriplay', version: '0.1.0' },
    {
      capabilities: { tools: {} },
      instructions: [
        'veriplay is an autonomous QA agent that generates Playwright test suites.',
        '',
        'Use qa_explore when the user gives a URL and wants a verified test suite.',
        'Use qa_heal when an existing spec broke after a UI change.',
        '',
        'Tool calls take 30-120 seconds. Progress notifications stream during execution.',
      ].join('\n'),
    },
  );

  server.tool(
    'qa_explore',
    'Drive a real Chromium browser through a URL and generate a Playwright test suite. The agent runs a 3-stage pipeline (Planner → Explorer → Critic), records every action live, and transcribes the verified session into a spec. Takes 30-120s.',
    {
      url: z.string().describe('URL to explore (http or https)'),
      language: z.enum(['ts', 'js']).default('ts'),
      skipPlan: z.boolean().default(false),
      skipCritic: z.boolean().default(false),
    },
    async ({ url, language, skipPlan, skipCritic }, extra) => {
      requireApiKey();
      const outDir = projectFile('output', `${runId()}-${slug(url)}`);
      log('explore', url, '→', outDir);
      const emit = makeProgressEmitter(extra as SendNotificationCapable);
      const openai = new OpenAI();
      const result = await explore({
        url,
        language,
        openai,
        outDir,
        skipPlan,
        skipCritic,
        onEvent: (e: AgentEvent) => {
          const msg = mapEventToProgress(e);
          if (msg) emit(msg);
        },
      });
      if ('paused' in result) {
        return {
          content: [{ type: 'text', text: `Plan paused. CSV at ${result.planPath}.` }],
          isError: false,
        };
      }
      const name = slug(url);
      transcribe({ report: result, outDir, name });
      const specPath = path.join(outDir, 'tests', `${name}.spec.${language}`);
      const specContent = fs.existsSync(specPath) ? fs.readFileSync(specPath, 'utf8') : '(spec file not found)';
      return {
        content: [
          {
            type: 'text',
            text: `Suite written to ${outDir}\n\nScenarios: ${result.scenarios.length}\nCost: $${(result.cost.usd ?? 0).toFixed(4)}`,
          },
          { type: 'text', text: '```typescript\n' + specContent + '\n```' },
        ],
      };
    },
  );

  server.tool(
    'qa_heal',
    'Re-resolve broken selectors in a spec by reading a Playwright JSON report and proposing replacements verified to resolve to exactly one element on the live page.',
    {
      specPath: z.string().describe('Path to the spec file (.ts or .js)'),
      reportPath: z.string().describe('Path to the Playwright JSON report'),
    },
    async ({ specPath, reportPath }, extra) => {
      requireApiKey();
      log('heal', specPath, 'using report', reportPath);
      const emit = makeProgressEmitter(extra as SendNotificationCapable);
      const openai = new OpenAI();
      const result = await heal({
        specPath,
        reportPath,
        openai,
        onEvent: (e: HealEvent) => {
          const msg = mapEventToProgress(e);
          if (msg) emit(msg);
        },
      });
      return {
        content: [
          {
            type: 'text',
            text: result.healedPath
              ? `Healed ${result.healed}/${result.total} selectors. Patched file: ${result.healedPath}`
              : `No healable failures found.`,
          },
        ],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('MCP server connected via stdio');
}

const isDirectInvocation = import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) {
  startServer().catch((err) => {
    process.stderr.write(`[veriplay/mcp] fatal: ${err.message}\n`);
    process.exit(1);
  });
}
