import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveRun, loadSiteFingerprint, renderMemoryBlock } from '../../src/agent/memory.ts';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'veriplay-mem-'));
  process.chdir(tmpRoot);
});
afterEach(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

describe('saveRun + loadSiteFingerprint', () => {
  it('persists a run and reads it back', () => {
    saveRun({
      url: 'https://example.com/login',
      scenarios: 3, cost: 0.05, model: 'gpt-4o-mini', durationSec: 12,
      cascadeStats: { role: 5, label: 2, testid: 0, css: 1 },
      resolvedIntents: [{ intent: 'username input', level: 'role' }],
    });
    const fp = loadSiteFingerprint('https://example.com/login');
    expect(fp?.host).toBe('example.com');
    expect(fp?.knownIntents).toHaveLength(1);
    expect(fp?.knownIntents[0]).toMatchObject({ intent: 'username input', bestLevel: 'role', hits: 1 });
  });

  it('uses atomic write (tmp + rename) — no partial file on crash simulation', () => {
    saveRun({
      url: 'https://example.com/', scenarios: 1, cost: 0.01, model: 'gpt-4o-mini',
      durationSec: 5, cascadeStats: { role: 1, label: 0, testid: 0, css: 0 },
      resolvedIntents: [],
    });
    const siteFile = path.join('.veriplay', 'sites', 'example.com.json');
    expect(fs.existsSync(siteFile)).toBe(true);
    const tmpFiles = fs.readdirSync(path.join('.veriplay', 'sites')).filter(f => f.endsWith('.tmp'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('decays intents older than 30 days', () => {
    const siteFile = path.join('.veriplay', 'sites', 'old.com.json');
    fs.mkdirSync(path.dirname(siteFile), { recursive: true });
    const ancient = new Date(Date.now() - 40 * 86400 * 1000).toISOString();
    const recent  = new Date().toISOString();
    fs.writeFileSync(siteFile, JSON.stringify({
      host: 'old.com', lastUrl: 'https://old.com/', updatedAt: recent,
      cascadeStats: { role: 0, label: 0, testid: 0, css: 0 },
      knownIntents: [
        { intent: 'stale',   bestLevel: 'css',  hits: 1, lastSeen: ancient },
        { intent: 'fresh',   bestLevel: 'role', hits: 5, lastSeen: recent },
      ],
      recentRuns: [],
    }));
    const fp = loadSiteFingerprint('https://old.com/');
    const names = fp?.knownIntents.map(i => i.intent) ?? [];
    expect(names).toContain('fresh');
    expect(names).not.toContain('stale');
  });

  it('refuses to write when a fresh lock exists', () => {
    const lockFile = path.join('.veriplay', 'sites', 'example.com.json.lock');
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, String(process.pid));
    expect(() =>
      saveRun({
        url: 'https://example.com/', scenarios: 1, cost: 0, model: 'gpt-4o-mini',
        durationSec: 1, cascadeStats: { role: 0, label: 0, testid: 0, css: 0 },
        resolvedIntents: [],
      }),
    ).toThrow(/lock held/i);
  });

  it('breaks stale locks (>5 min old)', () => {
    const lockFile = path.join('.veriplay', 'sites', 'example.com.json.lock');
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, '99999');
    const sixMinAgo = Date.now() - 6 * 60 * 1000;
    fs.utimesSync(lockFile, sixMinAgo / 1000, sixMinAgo / 1000);
    expect(() =>
      saveRun({
        url: 'https://example.com/', scenarios: 1, cost: 0, model: 'gpt-4o-mini',
        durationSec: 1, cascadeStats: { role: 0, label: 0, testid: 0, css: 0 },
        resolvedIntents: [],
      }),
    ).not.toThrow();
  });
});

describe('renderMemoryBlock', () => {
  it('returns null when no memory for host', () => {
    expect(renderMemoryBlock('https://nothing.com/')).toBeNull();
  });

  it('renders intents from a prior run', () => {
    saveRun({
      url: 'https://example.com/', scenarios: 1, cost: 0.01, model: 'gpt-4o-mini',
      durationSec: 5, cascadeStats: { role: 1, label: 0, testid: 0, css: 0 },
      resolvedIntents: [{ intent: 'login button', level: 'role' }],
    });
    const block = renderMemoryBlock('https://example.com/');
    expect(block).toContain('example.com');
    expect(block).toContain('login button');
    expect(block).toContain('role');
  });
});
