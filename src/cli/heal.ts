import 'dotenv/config';
import OpenAI from 'openai';
import { heal } from '../agent/heal.ts';

export interface HealCliArgs {
  specPath?: string;
  reportPath?: string;
  baseUrl?: string;
}

export function parseHealArgs(argv: string[]): HealCliArgs {
  const args: HealCliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--report') {
      const v = argv[++i];
      if (v !== undefined) args.reportPath = v;
    } else if (a === '--base-url') {
      const v = argv[++i];
      if (v !== undefined) args.baseUrl = v;
    } else if (a && !a.startsWith('--') && !args.specPath) {
      args.specPath = a;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseHealArgs(process.argv.slice(2));
  if (!args.specPath) {
    console.error('usage: npm run heal -- <spec-path> [--report <report.json>] [--base-url <url>]');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set. Copy .env.example to .env.');
    process.exit(1);
  }

  const openai = new OpenAI();
  const healOpts: Parameters<typeof heal>[0] = { specPath: args.specPath, openai };
  if (args.reportPath !== undefined) healOpts.reportPath = args.reportPath;
  healOpts.onEvent = (e) => {
    switch (e.type) {
      case 'running_spec':
        console.log('[heal] reading report...');
        break;
      case 'failures_found':
        console.log(`[heal] ${e.count} failures found`);
        break;
      case 'healing':
        console.log(`  healing: ${e.selector} on ${e.url}`);
        break;
      case 'healed':
        console.log(`  ✓ ${e.old} → ${e.new} (confidence ${e.confidence.toFixed(2)})`);
        break;
      case 'unhealed':
        console.log(`  ✗ ${e.selector}: ${e.reason}`);
        break;
      case 'done':
        console.log(`[done] healed ${e.healed}/${e.total} → ${e.healedPath ?? '(no changes)'}`);
        break;
    }
  };

  const result = await heal(healOpts);
  if (result.healedPath) {
    console.log(`\nHealed spec written to: ${result.healedPath}`);
  } else {
    console.log('\nNothing to heal.');
  }
}

const isDirectInvocation = import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) {
  main().catch((err) => {
    console.error('[veriplay] error:', err.message);
    process.exit(1);
  });
}
