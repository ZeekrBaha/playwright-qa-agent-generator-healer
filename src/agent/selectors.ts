import type { Locator, Page } from '@playwright/test';
import type { CascadeLevel } from './trace.ts';

export type { CascadeLevel };

export interface ResolvedLocator {
  locator: Locator;
  level: CascadeLevel;
  arg: string | { role: string; name: string };
}

export interface ResolveSpec {
  intent: string;
  role?: string;
  label?: string;
  testid?: string;
  css?: string;
}

const ROLE_PATTERNS: Array<[RegExp, string]> = [
  [/button|submit|sign\s*(in|up)|log\s*(in|out)|continue|next|cancel/i, 'button'],
  [/(check|tick)box/i, 'checkbox'],
  [/radio/i, 'radio'],
  [/select|dropdown|combo/i, 'combobox'],
  [/link|anchor/i, 'link'],
  [/textbox|input|field|email|password|user(name)?/i, 'textbox'],
];

export function guessRole(intent: string): string | undefined {
  for (const [re, role] of ROLE_PATTERNS) {
    if (re.test(intent)) return role;
  }
  return undefined;
}

async function exists(loc: Locator): Promise<boolean> {
  try {
    return (await loc.count()) > 0;
  } catch {
    return false;
  }
}

export async function resolve(page: Page, spec: ResolveSpec): Promise<ResolvedLocator | null> {
  const role = spec.role ?? guessRole(spec.intent);

  // Try role with variants (full intent, then stripped of common suffixes)
  if (role) {
    const variants = [
      spec.intent,
      spec.intent.replace(/\s+(button|input|field|link|checkbox|radio)$/i, '').trim(),
    ];
    for (const name of variants) {
      if (!name) continue;
      const byRole = page.getByRole(role as Parameters<Page['getByRole']>[0], { name });
      if (await exists(byRole)) {
        return {
          locator: byRole.first(),
          level: 'role',
          arg: { role, name },
        };
      }
    }
  }

  // Try label from spec or intent
  if (spec.label) {
    const byLabel = page.getByLabel(spec.label);
    if (await exists(byLabel)) {
      return {
        locator: byLabel.first(),
        level: 'label',
        arg: spec.label,
      };
    }
  }
  const byLabelFromIntent = page.getByLabel(spec.intent);
  if (await exists(byLabelFromIntent)) {
    return {
      locator: byLabelFromIntent.first(),
      level: 'label',
      arg: spec.intent,
    };
  }

  // Try testid
  if (spec.testid) {
    const byTestId = page.getByTestId(spec.testid);
    if (await exists(byTestId)) {
      return {
        locator: byTestId.first(),
        level: 'testid',
        arg: spec.testid,
      };
    }
  }

  // Try css as last resort
  if (spec.css) {
    const byCss = page.locator(spec.css);
    if (await exists(byCss)) {
      return {
        locator: byCss.first(),
        level: 'css',
        arg: spec.css,
      };
    }
  }

  return null;
}

export function emitLocatorCall(level: CascadeLevel, arg: ResolvedLocator['arg']): string {
  switch (level) {
    case 'role': {
      const a = arg as { role: string; name: string };
      return `page.getByRole(${JSON.stringify(a.role)}, { name: ${JSON.stringify(a.name)} })`;
    }
    case 'label':
      return `page.getByLabel(${JSON.stringify(arg as string)})`;
    case 'testid':
      return `page.getByTestId(${JSON.stringify(arg as string)})`;
    case 'css':
      return `page.locator(${JSON.stringify(arg as string)})`;
  }
}
