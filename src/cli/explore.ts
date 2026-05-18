import 'dotenv/config';
import OpenAI from 'openai';
import path from 'node:path';
import { explore } from '../agent/runtime.ts';
import { transcribe } from '../agent/transcriber.ts';

export interface CliArgs {
  url?: string;
  language: 'ts' | 'js';
  name?: string;
  pom: boolean;
  review: boolean;
  fromPlan?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { language: 'ts', pom: true, review: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lang') {
      const v = argv[++i];
      if (v === 'js' || v === 'ts') args.language = v;
    } else if (a === '--name') {
      const v = argv[++i];
      if (v !== undefined) args.name = v;
    } else if (a === '--no-pom') {
      args.pom = false;
    } else if (a === '--review') {
      args.review = true;
    } else if (a === '--from-plan') {
      const v = argv[++i];
      if (v !== undefined) args.fromPlan = v;
    } else if (a && !a.startsWith('--') && !args.url) {
      args.url = a;
    }
  }
  return args;
}

export function buildOutDir(url: string, pid: number, now: Date = new Date()): string {
  let host = 'unknown';
  try {
    host = new URL(url).host;
  } catch {
    /* keep default */
  }
  const safeHost = host
    .replace(/[^a-z0-9]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  // ISO: 2026-05-17T20:00:00.000Z → YYYYMMDD-HHMMSS
  const iso = now.toISOString();
  const date = iso.slice(0, 10).replace(/-/g, '');
  const time = iso.slice(11, 19).replace(/:/g, '');
  const ts = `${date}-${time}`;
  return `output/${ts}-${safeHost}-${pid}`;
}

function slug(s: string): string {
  return (
    s
      .replace(/^https?:\/\//, '')
      .replace(/[^a-z0-9-]+/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
      .toLowerCase() || 'run'
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url && !args.fromPlan) {
    console.error(
      'usage: npm run explore -- <url> [--lang ts|js] [--name <slug>] [--no-pom] [--review] [--from-plan <csv>]',
    );
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set. Copy .env.example to .env.');
    process.exit(1);
  }
  const url = args.url ?? '';
  const openai = new OpenAI();
  const outDir = path.resolve(buildOutDir(url, process.pid));

  console.log(`[veriplay] exploring ${url} → ${outDir}`);

  const result = await explore({
    url,
    language: args.language,
    openai,
    outDir,
    review: args.review,
    onEvent: (e) => {
      switch (e.type) {
        case 'plan_started':
          console.log('[planner] starting...');
          break;
        case 'plan_done':
          console.log(`[planner] ${e.scenarios.length} scenarios (cost: $${(e.usd ?? 0).toFixed(4)})`);
          break;
        case 'tool_call':
          console.log(`  ${e.name}(${JSON.stringify(e.input).slice(0, 80)})`);
          break;
        case 'tool_result':
          if (!e.ok) console.log(`    ✗ ${e.error}`);
          break;
        case 'retry':
          console.log(`  retry attempt ${e.attempt} (waiting ${e.waitMs}ms)...`);
          break;
        case 'category_followup':
          console.log(`[runtime] no ${e.missing} scenario — requesting follow-up`);
          break;
        case 'critic_started':
          console.log('[critic] reviewing...');
          break;
        case 'critic_done':
          console.log(`[critic] ${e.verdicts.length} verdicts (cost: $${(e.usd ?? 0).toFixed(4)})`);
          break;
        case 'done':
          console.log(`[done] ${e.scenarios} scenarios → ${outDir}`);
          break;
      }
    },
  });

  if ('paused' in result) {
    console.log(`[review] plan written to ${result.planPath}`);
    console.log(`  edit the CSV, then resume with: npm run explore -- --from-plan ${result.planPath}`);
    return;
  }

  // Emit transcribed POM files
  const name = args.name ?? slug(url);
  transcribe({ report: result, outDir, name, pom: args.pom });
  console.log(`[transcribe] wrote suite to ${outDir}`);
}

const isDirectInvocation = import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) {
  main().catch((err) => {
    console.error('[veriplay] error:', err.message);
    process.exit(1);
  });
}
