# veriplay — Design Spec

**Status:** Approved
**Date:** 2026-05-17
**Local folder:** `~/Desktop/llm-ai-projects/playwright-qa-agent-generator-healer/`
**GitHub repo:** `veriplay`
**Author:** Baha

---

## 1. Overview

veriplay is an autonomous QA agent that opens a real browser, drives a web app
through a tool-use loop powered by OpenAI, has a second model review the trace,
and emits a Playwright test suite where every line corresponds to an action that
already executed successfully against the live page.

A three-stage pipeline (planner → explorer → critic) makes the architecture
explicit and the failure modes inspectable. Nine specific design decisions
(structured tool calls, explicit DOM truncation, atomic memory writes,
runtime-enforced category coverage, typed report parsing, shared retry,
MCP progress notifications, externalised pricing, TDD-first) make the output
durable and the runtime debuggable. The decisions are the primary deliverable;
the architecture is the framing for them.

---

## 2. Goals and non-goals

### Goals (v1)

- Generate a working Playwright test suite from a single URL via a real browser session.
- Repair a broken spec when selectors drift after a UI change.
- Expose both workflows over CLI and MCP.
- Demonstrate disciplined engineering: typed tool calls, unit tests, atomic
  writes, retries, transparent cost tracking.
- Ship something a senior reviewer can scan and conclude "this person knows
  what they're doing."

### Non-goals (v1)

- Web UI / WebSocket gateway.
- Generate-from-story workflow (no-browser path).
- Multi-page POM emission (one Page class per host is sufficient).
- Telegram / Slack / Discord integration.
- Eval harness across multiple sites.
- Pre-commit hook tooling (Husky / lint-staged).
- Semantic-release / changesets.

---

## 3. Architecture

### High-level flow

```
                              ┌─── per-host memory ────┐
                              │ .veriplay/sites/*.json │
                              │ atomic writes [W5]     │
                              │ intent decay (30d)     │
                              └───────────┬────────────┘
                                          │ cached system block
            ┌─────────────────────────────┼─────────────────────────────┐
            ▼                             ▼                             ▼
  ┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
  │ PLANNER          │         │ EXPLORER         │         │ CRITIC           │
  │ gpt-4o-mini      │ plan    │ gpt-4o-mini      │ trace   │ gpt-4o-mini      │
  │                  ├────────▶│ tool-use loop    ├────────▶│ structured       │
  │ submit_plan()    │         │ navigate/click/  │         │ submit_verdicts()│
  │ tool call  [W1]  │         │ fill/assert/...  │         │ tool call   [W1] │
  │                  │         │ get_dom signals  │         │                  │
  │                  │         │ truncation [W3]  │         │ + force category │
  │ retry+backoff    │         │ retry+backoff    │         │   coverage [W6]  │
  │   [W8]           │         │   [W8]           │         │                  │
  └──────────────────┘         └─────────┬────────┘         └─────────┬────────┘
                                         │                            │
                                         ▼                            │
                              ┌──────────────────────┐                │
                              │  Cascade resolver    │                │
                              │  role→label→testid   │                │
                              │  →css                │                │
                              └──────────┬───────────┘                │
                                         │ verified trace             │
                                         ▼                            │
                               ┌─────────────────────────────────────┐│
                               │  TRANSCRIBER  (deterministic)       │◀┘
                               │  trace → BasePage.ts + <Page>.ts +  │
                               │  <name>.spec.ts +                   │
                               │  a11y/landing.a11y.spec.ts +        │
                               │  run-report.json                    │
                               └─────────────────┬───────────────────┘
                                                 │
                                                 ▼
                                  output/<run-id>/  (shipped suite)
                                                 │
                                                 │ on Playwright failure
                                                 ▼
                                       ┌────────────────────┐
                                       │ HEALER             │
                                       │ gpt-4o-mini        │
                                       │ structured proposal│
                                       │ + 1-element verify │
                                       │ + robust URL       │
                                       │   extraction  [W7] │
                                       └────────────────────┘
```

### Surfaces

| Surface | Entry | Use case |
|---|---|---|
| CLI `npm run explore -- <url>` | `src/cli/explore.ts` | Local dev, CI |
| CLI `npm run heal -- <spec>` | `src/cli/heal.ts` | Fix selectors after UI drift |
| MCP server `npm run mcp` | `src/mcp/server.ts` | Claude Desktop, Cursor, etc. |

All three converge on the same `explore()` and `heal()` functions in `src/agent/`.

---

## 4. Components

| Module | Purpose |
|---|---|
| `src/agent/runtime.ts` | Orchestrator: runs the 3 stages, owns budgets, emits `AgentEvent`s |
| `src/agent/planner.ts` | One DOM snapshot → structured plan via `submit_plan` tool call |
| `src/agent/explorer.ts` | The tool-use loop; calls `runTool` for each model-issued tool call |
| `src/agent/critic.ts` | Post-run review via `submit_verdicts` tool call |
| `src/agent/transcriber.ts` | Deterministic trace → POM TypeScript files; no LLM. Also writes a separate `a11y/landing.a11y.spec.ts` that runs `@axe-core/playwright` against the landing page for WCAG 2 AA coverage — auto-injected on every run, no model involvement |
| `src/agent/heal.ts` | Selector self-healing on failed Playwright runs |
| `src/agent/selectors.ts` | The role→label→testid→css cascade |
| `src/agent/memory.ts` | Per-host fingerprints + project memory; atomic writes, lock, decay |
| `src/agent/tools.ts` | Tool definitions for the Explorer (begin/navigate/click/fill/...) |
| `src/agent/pricing.ts` | Loads `prices.json`, warns on unknown model IDs |
| `src/agent/retry.ts` | Shared retry+backoff wrapper for OpenAI + Playwright |
| `src/agent/trace.ts` | Types: `Scenario`, `TraceStep`, `Assertion`, `RunReport` |
| `src/cli/explore.ts` | `npm run explore` entry |
| `src/cli/heal.ts` | `npm run heal` entry |
| `src/mcp/server.ts` | MCP server with progress notifications |

### Module-decomposition rationale

1. `runtime.ts` is the orchestrator only; the tool-use loop is split out into
   `explorer.ts` so each module fits in a single screen.
2. `pricing.ts` and `retry.ts` are dedicated modules for the cross-cutting
   concerns the design decisions depend on.
3. `tests/unit/` covers every pure function in `src/agent/`.

---

## 5. The 9 design decisions

Each decision is enumerated below with the source-file reference. The README's
"Features" section links to the relevant file:line for each.

### W1 — Structured LLM output via tool calls, not regex parsing

Both `planner.ts` and `critic.ts` define an OpenAI tool (`submit_plan`,
`submit_verdicts`) with a JSON Schema validated by `zod`. The model is forced
to return tool-call arguments. If validation fails, one retry; second failure
throws. Eliminates the silent-empty-plan failure mode.

### W2 — Vitest unit tests for every pure function, TDD-first

Tests live in `tests/unit/`. Per the user's project rule, every pure function
gets a failing test before implementation. Coverage target ≥85% on
`src/agent/*` excluding HTTP call sites. Mocked OpenAI client via dependency
injection for runtime-level tests.

### W3 — `get_dom` signals truncation explicitly

Return shape: `{ title, url, headings, inputs, buttons, links, counts: {
inputs: { shown: 60, total: 142 }, ... }, truncated: true }`. The Explorer's
system prompt teaches it to call `get_dom_section(category, offset)` to
paginate when truncated. No silent loss of visibility.

### W4 — Pricing loaded from `prices.json`, loud warning on unknown IDs

`src/agent/pricing.json` checked into the repo. `priceFor(modelId)` reads it
once, caches. Unknown IDs log `console.warn('[veriplay] Unknown model "X" —
cost tracking disabled for this run')` and return `null`. Run report shows
`costUsd: null` instead of a misleading fallback price.

### W5 — Atomic memory writes + per-host advisory lock

`memory.saveRun` writes to `<file>.tmp` then `fs.renameSync` to final (atomic
on POSIX). Acquires a `<file>.lock` PID file before reading; releases after
writing; refuses to start on a fresh lock and breaks stale locks >5 min old.
Adds `lastSeen` timestamps to `KnownIntent`; entries older than 30 days are
dropped at load time.

### W6 — Runtime enforces category coverage, not just the prompt

After the Explorer loop, `runtime.ts` checks that `negative` and `a11y`
scenarios exist. If either is missing, one follow-up turn with a focused
message: "You did not produce a {negative|a11y} scenario. Produce exactly one
now." Hard cap of one follow-up per category to avoid infinite loops. The
promise becomes a runtime invariant, not a prompt suggestion.

### W7 — Healer parses Playwright reports robustly

`extractUrlFromStack` is replaced with a chain: (1) read `baseURL` from the
JSON report's `config` section, (2) check `attachments` for the page URL
Playwright records, (3) fall back to the `page.goto` regex. `isSelectorMiss`
switches from keyword search to checking Playwright's typed error codes
(`error.value === 'TimeoutError'`, etc.). False-positive rate drops sharply.

### W8 — Shared retry+backoff wrapper

`src/agent/retry.ts` exports `withRetry(fn, opts)`. Defaults: 3 attempts,
exponential backoff `[1s, 2s, 4s]`. Retries on Playwright `TimeoutError` and
OpenAI 429/500/502/503/504. Wraps every `page.goto`, every
`openai.chat.completions.create`, every `proposeNewSelector` call in heal.
Surfaces retries via `onEvent({ type: 'retry', attempt, lastError })` so the
CLI can show progress.

### W9 — MCP server streams progress via notifications

The runtime already emits `AgentEvent`s; `src/mcp/server.ts` wires them into
MCP `notifications/progress` per spec. Each tool call sends progress at
Planner-done / per-step / on-retry / Critic-done. Clients that support
progress get a live counter; clients that don't, ignore. Spec-compliant.

### Bonus — Concurrency-safe output directory naming

`output/<run-id>/` uses `<timestamp>-<host>-<pid>` to prevent two parallel
runs against the same host from clobbering each other. ~5 LOC.

---

## 6. Testing strategy

### Three tiers

| Tier | What | When | OpenAI cost |
|---|---|---|---|
| **Unit** | Pure functions: `selectors.resolve`, `memory.merge/save`, `pricing.priceFor`, `retry.backoff`, `heal.parseReport`, `heal.extractUrlFromStack`, `heal.isSelectorMiss`, `transcriber.emitPOM`, zod schema validation | Watch (TDD) + CI | $0 |
| **Integration** | Full pipeline with **mocked OpenAI** fed fixture responses; real Playwright against `tests/fixtures/server.ts` (local HTML) | CI | $0 |
| **E2E** | Real OpenAI key, real `saucedemo.com`. Guarded by `RUN_E2E=1` env var. | Manual, weekly | ~$0.05/run |

### Dependency injection for mocking

`explore()` and `heal()` accept `{ openai }` parameters defaulted to a real
client. Tests inject a stub:

```ts
const openai = mockOpenAI({
  'submit_plan':     () => ({ scenarios: [...] }),
  'submit_verdicts': () => ({ verdicts: [...] }),
});
await explore({ url, outDir, openai });
```

Playwright is **not** mocked. Selector tests use `page.setContent(html)`
against real Chromium with synthetic DOM. Integration tests point at a local
fixture server (no internet dependency, deterministic).

### Coverage target

≥85% on `src/agent/*` excluding HTTP call sites. Anything lower means a
missing test for a pure function, which we treat as a release-blocker.

### Tooling

- **Vitest** — ESM-native, fast, built-in TS, watch mode, clean mocking
- **Biome** — one binary for lint + format, faster than ESLint+Prettier
- **GitHub Actions** — `npm run check` on push/PR; E2E job manual-trigger only

---

## 7. Project layout

```
playwright-qa-agent-generator-healer/   # local folder name
├── .github/
│   └── workflows/
│       ├── ci.yml                       # typecheck + lint + test
│       └── e2e.yml                      # workflow_dispatch only
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-05-17-veriplay-design.md
├── src/
│   ├── agent/
│   │   ├── runtime.ts                   # orchestrator
│   │   ├── planner.ts
│   │   ├── explorer.ts                  # split out from runtime
│   │   ├── critic.ts
│   │   ├── transcriber.ts
│   │   ├── heal.ts
│   │   ├── selectors.ts
│   │   ├── memory.ts
│   │   ├── tools.ts
│   │   ├── pricing.ts                   # NEW
│   │   ├── pricing.json                 # NEW
│   │   ├── retry.ts                     # NEW
│   │   └── trace.ts                     # shared types
│   ├── cli/
│   │   ├── explore.ts
│   │   └── heal.ts
│   └── mcp/
│       └── server.ts
├── tests/
│   ├── unit/
│   │   ├── planner.test.ts
│   │   ├── critic.test.ts
│   │   ├── selectors.test.ts
│   │   ├── memory.test.ts
│   │   ├── heal.test.ts
│   │   ├── retry.test.ts
│   │   ├── pricing.test.ts
│   │   └── transcriber.test.ts
│   ├── integration/
│   │   └── pipeline.test.ts
│   ├── e2e/
│   │   └── saucedemo.test.ts            # guarded by RUN_E2E=1
│   └── fixtures/
│       ├── server.ts                    # local HTML server
│       ├── openai-responses/            # recorded fixtures
│       └── playwright-reports/          # sample report JSON
├── .veriplay/                           # gitignored (per-host memory)
├── output/                              # gitignored (generated suites)
├── .env.example
├── .gitignore
├── biome.json
├── LICENSE                              # MIT
├── package.json                         # name: "veriplay"
├── playwright.config.ts
├── README.md
├── tsconfig.json
└── vitest.config.ts
```

---

## 8. Configuration

### Environment variables

| Var | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | (required) | OpenAI key |
| `OPENAI_MODEL_PLANNER` | `gpt-4o-mini` | Override planner model |
| `OPENAI_MODEL_EXPLORER` | `gpt-4o-mini` | Override explorer model — upgrade this for hard sites |
| `OPENAI_MODEL_CRITIC` | `gpt-4o-mini` | Override critic model |
| `OPENAI_MODEL_HEAL` | `gpt-4o-mini` | Override healer model |
| `VERIPLAY_MAX_STEPS` | `40` | Hard ceiling on tool calls per explore |
| `VERIPLAY_MAX_USD` | `2.00` | Hard ceiling on USD per run; aborts if exceeded |
| `RUN_E2E` | unset | Set to `1` to enable E2E tests |

### `prices.json` shape

```json
{
  "gpt-4o-mini": { "in": 0.15, "out": 0.60 },
  "gpt-4o":      { "in": 2.50, "out": 10.00 },
  "gpt-5-mini":  { "in": 0.30, "out": 1.20 },
  "gpt-5":       { "in": 5.00, "out": 20.00 }
}
```

Prices above are illustrative. The implementation MUST verify current
OpenAI pricing at https://openai.com/api/pricing before relying on cost
tracking, and the README MUST link to that page so users can keep
`prices.json` honest themselves.

Unknown model ID → `costUsd: null` in run report + `console.warn`. No silent
fallback to a wrong default price.

### A note on prompt caching

OpenAI provides automatic prompt caching: any identical prefix ≥1024 tokens
that recurs within ~5 minutes is cached and billed at 50% of input rate.
There is no `cache_control` field to manage — caching is implicit.

What this means for veriplay:
- Memory injection still pays off: the agent skips redundant `get_dom`
  calls because it already knows which intents work on this host. That's
  the bigger win.
- Expect 30-50% cheaper on warm-cache runs (claimed honestly — the actual
  number depends on prompt-prefix stability and the 5-minute TTL).
- Achieving the cache hit requires keeping the prompt prefix stable. The
  runtime composes system messages as `[frozen_rules, memory_block, plan]`
  in that exact order, with memory and plan appended (not prepended) so the
  frozen rules form the longest cacheable prefix.

---

## 9. Repo metadata

| | |
|---|---|
| License | MIT |
| Node | 20+ |
| TypeScript | strict mode, ESM-only, `"type": "module"` |
| Package manager | `npm` |
| Output convention | `output/<timestamp>-<host>-<pid>/` |
| Memory dir | `.veriplay/` (gitignored) |
| GitHub repo name | `veriplay` |
| Local folder name | `playwright-qa-agent-generator-healer` |
| Default branch | `main` |

### Folder/repo asymmetry

The local folder (`playwright-qa-agent-generator-healer/`) does not match
the GitHub repo (`veriplay`). The repo name in `package.json` follows GitHub,
not the folder. The README will note this so future-readers aren't confused.

---

## 10. README structure

The README is the portfolio artifact. Sections:

1. What it does (3 sentences)
2. The killer feature (verified-by-execution + cascade), one paragraph
3. Architecture diagrams (explore flow + heal feedback loop)
4. Quick start
5. What you get (real emitted POM + spec snippet)
6. Commands
7. How it works (3-stage walkthrough)
8. Tech stack (one-line per library, linked)
9. **Features** — each design decision with rationale + `src/file.ts:line` link
10. Project layout
11. Configuration
12. Tests
13. License + author

---

## 11. Out of scope (v1) — explicit list

- Web UI / WebSocket gateway
- `generate` command (story → spec, no browser)
- Multi-page POM emission
- Persona / identity prompt files
- Eval harness
- Telegram / Slack / Discord integrations
- Husky, lint-staged, semantic-release, changesets, commitlint
- npm publishing (binary distribution only via `git clone` in v1)

---

## 12. Open questions

None — all clarifications resolved during brainstorming.

---

## 13. License

MIT-licensed. See `LICENSE`.
