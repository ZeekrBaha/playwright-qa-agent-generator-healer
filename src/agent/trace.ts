// CascadeLevel lives here (not in selectors.ts) so trace types have no
// dependency on the selectors module — keeps the dep graph acyclic.
export type CascadeLevel = 'role' | 'label' | 'testid' | 'css';

export type ScenarioCategory = 'happy' | 'negative' | 'edge' | 'a11y';

export interface SelectorRecord {
  intent: string;
  level: CascadeLevel;
  arg: string | { role: string; name: string };
}

export type Assertion =
  | { type: 'toBeVisible';   target: SelectorRecord }
  | { type: 'toHaveText';    target: SelectorRecord; text: string }
  | { type: 'toContainText'; target: SelectorRecord; text: string }
  | { type: 'toHaveURL';     pattern: string }
  | { type: 'toHaveCount';   target: SelectorRecord; count: number };

export type TraceStep =
  | { kind: 'navigate'; url: string }
  | { kind: 'click';    target: SelectorRecord }
  | { kind: 'fill';     target: SelectorRecord; value: string }
  | { kind: 'press';    target: SelectorRecord; key: string }
  | { kind: 'wait';     ms: number }
  | { kind: 'assert';   name: string; assertion: Assertion };

export interface Scenario {
  name: string;
  category: ScenarioCategory;
  steps: TraceStep[];
}

export interface RunCost {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  usd: number | null;          // null when model price is unknown (W4)
  plannerUsd?: number | null;
  criticUsd?: number | null;
}

export interface RunReport {
  url: string;
  language: 'ts' | 'js';
  scenarios: Scenario[];
  cascadeStats: Record<CascadeLevel, number>;
  cost: RunCost;
  steps: number;
  startedAt: string;
  finishedAt: string;
  plan?: Array<{ name: string; category: ScenarioCategory; rationale: string }>;
  review?: {
    verdicts: Array<{ scenario: string; verdict: 'ship' | 'weak' | 'fix'; reason: string }>;
    summary: string;
  };
}
