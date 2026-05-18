import fs from 'node:fs';
import path from 'node:path';
import type { CascadeLevel } from './trace.ts';

const MEMORY_ROOT = '.veriplay';
const SITES_DIR = path.join(MEMORY_ROOT, 'sites');
const MAX_RUNS_KEPT = 5;
const MAX_INTENTS_KEPT = 24;
const DECAY_DAYS = 30;
const LOCK_TTL_MS = 5 * 60 * 1000;

export interface KnownIntent {
  intent: string;
  bestLevel: CascadeLevel;
  hits: number;
  lastSeen: string;
}

export interface SiteFingerprint {
  host: string;
  lastUrl: string;
  updatedAt: string;
  cascadeStats: Record<CascadeLevel, number>;
  knownIntents: KnownIntent[];
  recentRuns: Array<{ at: string; url: string; scenarios: number; cost: number; model: string; durationSec: number }>;
}

export interface RunSummary {
  url: string;
  scenarios: number;
  cost: number;
  model: string;
  durationSec: number;
  cascadeStats: Record<CascadeLevel, number>;
  resolvedIntents: Array<{ intent: string; level: CascadeLevel }>;
}

function ensureDir(p: string): void { fs.mkdirSync(p, { recursive: true }); }
function hostOf(url: string): string { try { return new URL(url).host; } catch { return 'unknown'; } }
function siteFile(host: string): string { return path.join(SITES_DIR, `${host.replace(/[^a-z0-9.-]/gi, '_')}.json`); }

function acquireLock(target: string): void {
  const lockPath = `${target}.lock`;
  if (fs.existsSync(lockPath)) {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs < LOCK_TTL_MS) {
      throw new Error(`Memory lock held for ${target} (pid in lockfile). Wait or remove stale lock.`);
    }
    fs.unlinkSync(lockPath);
  }
  fs.writeFileSync(lockPath, String(process.pid));
}

function releaseLock(target: string): void {
  try { fs.unlinkSync(`${target}.lock`); } catch { /* ignore */ }
}

function atomicWrite(file: string, data: string): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function decayIntents(intents: KnownIntent[]): KnownIntent[] {
  const cutoff = Date.now() - DECAY_DAYS * 86400 * 1000;
  return intents.filter((i) => {
    const seen = i.lastSeen ? Date.parse(i.lastSeen) : 0;
    return seen >= cutoff;
  });
}

export function loadSiteFingerprint(url: string): SiteFingerprint | null {
  const file = siteFile(hostOf(url));
  if (!fs.existsSync(file)) return null;
  try {
    const fp = JSON.parse(fs.readFileSync(file, 'utf8')) as SiteFingerprint;
    fp.knownIntents = decayIntents(fp.knownIntents ?? []);
    return fp;
  } catch { return null; }
}

function mergeIntents(
  existing: KnownIntent[],
  next: Array<{ intent: string; level: CascadeLevel }>,
): KnownIntent[] {
  const now = new Date().toISOString();
  const map = new Map<string, KnownIntent>();
  for (const e of existing) map.set(e.intent.toLowerCase(), { ...e });
  for (const n of next) {
    const key = n.intent.toLowerCase();
    const cur = map.get(key);
    if (cur) { cur.hits += 1; cur.bestLevel = n.level; cur.lastSeen = now; }
    else map.set(key, { intent: n.intent, bestLevel: n.level, hits: 1, lastSeen: now });
  }
  return [...map.values()].sort((a, b) => b.hits - a.hits);
}

function mergeCascade(a: Record<CascadeLevel, number> | undefined, b: Record<CascadeLevel, number>): Record<CascadeLevel, number> {
  const base = a ?? { role: 0, label: 0, testid: 0, css: 0 };
  return { role: base.role + b.role, label: base.label + b.label, testid: base.testid + b.testid, css: base.css + b.css };
}

export function saveRun(summary: RunSummary): void {
  ensureDir(SITES_DIR);
  const host = hostOf(summary.url);
  const file = siteFile(host);

  acquireLock(file);
  try {
    const existing = fs.existsSync(file)
      ? (JSON.parse(fs.readFileSync(file, 'utf8')) as SiteFingerprint)
      : null;

    const merged: SiteFingerprint = {
      host,
      lastUrl: summary.url,
      updatedAt: new Date().toISOString(),
      cascadeStats: mergeCascade(existing?.cascadeStats, summary.cascadeStats),
      knownIntents: mergeIntents(existing?.knownIntents ?? [], summary.resolvedIntents).slice(0, MAX_INTENTS_KEPT),
      recentRuns: [
        {
          at: new Date().toISOString(),
          url: summary.url, scenarios: summary.scenarios,
          cost: summary.cost, model: summary.model, durationSec: summary.durationSec,
        },
        ...(existing?.recentRuns ?? []),
      ].slice(0, MAX_RUNS_KEPT),
    };

    atomicWrite(file, JSON.stringify(merged, null, 2));
  } finally {
    releaseLock(file);
  }
}

export function renderMemoryBlock(url: string): string | null {
  const fp = loadSiteFingerprint(url);
  if (!fp || (fp.knownIntents.length === 0 && fp.recentRuns.length === 0)) return null;
  const parts: string[] = [`Site memory for ${fp.host}:`];
  if (fp.recentRuns[0]) {
    const r = fp.recentRuns[0];
    parts.push(`  Last run: ${r.scenarios} scenarios in ${r.durationSec}s ($${r.cost.toFixed(3)}, model ${r.model}).`);
  }
  if (fp.knownIntents.length > 0) {
    parts.push('  Intents this host resolves cleanly (try first):');
    for (const k of fp.knownIntents.slice(0, 10)) {
      parts.push(`    - "${k.intent}" → ${k.bestLevel} (${k.hits}× successful)`);
    }
  }
  return parts.join('\n');
}
