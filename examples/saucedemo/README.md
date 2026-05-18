# Example: saucedemo.com

This directory contains the **actual, unmodified output** of running:

```bash
npm run explore -- https://www.saucedemo.com
```

against [saucedemo.com](https://www.saucedemo.com/) on 2026-05-18. It is
checked in so you can see what veriplay emits without having to run it
yourself.

By default the agent writes runs to `output/<timestamp>-<host>-<pid>/`, which
is gitignored — this is a snapshot of one such run, copied into the repo for
reference.

## Contents

| File | What |
|---|---|
| [`pages/BasePage.ts`](pages/BasePage.ts) | Base Page Object class (shared `goto`) |
| [`pages/SaucedemoComPage.ts`](pages/SaucedemoComPage.ts) | Page Object with cascade-chosen locators |
| [`fixtures/pages.ts`](fixtures/pages.ts) | Custom Playwright fixture — injects the Page Object into every test so the spec never has to call `new SaucedemoComPage(page)` |
| [`tests/www-saucedemo-com.spec.ts`](tests/www-saucedemo-com.spec.ts) | The generated Playwright spec — imports `test`/`expect` from the fixture |
| [`a11y/landing.a11y.spec.ts`](a11y/landing.a11y.spec.ts) | axe-core WCAG 2 AA check auto-injected by the transcriber |
| [`run-report.json`](run-report.json) | Agent trace, cascade stats, critic verdicts, cost breakdown |

## This run

| | |
|---|---|
| Date | 2026-05-18 |
| Scenarios emitted | 3 (verdicts: 1 ship, 2 fix — see `run-report.json` `review.verdicts`) |
| Plan size | 5 scenarios (planner asked for `happy`, `negative`, `a11y`, `negative`, `negative`) |
| Cascade | 15/15 intents resolved at `getByRole` level |
| Cost | $0.023 (106k input tokens, 83k cached, 1.9k output) |
| Models | `gpt-4o-mini` for planner, explorer, critic |
| Live result | `npx playwright test --project=chromium` → **3 passed (1.3s)** |

## Honest notes

The model exhausted the explorer step budget (40 steps, raised once via
`category_followup` for the missing `a11y` scenario, then exhausted again).
It kept trying to click an intent it called `"login-button"` — the cascade
couldn't resolve that exact string, but `"login button"` would have. The
plan had 5 scenarios; only 3 produced enough useful trace to survive the
critic.

This is the authentic output of a fresh run, not a curated one. The point of
checking it in is for reviewers to see what the tool actually produces, warts
and all — not just a best-case demo.

## What to look at

- **`pages/SaucedemoComPage.ts`** — every locator is `page.getByRole(...)`.
  That's because the cascade resolver's first level (`getByRole`) succeeded
  for every intent during the explore run. If saucedemo lost ARIA roles,
  the transcriber would emit `getByLabel` / `getByPlaceholder` / `getByTestId`
  / `page.locator(css)` instead, depending on which level resolved.
- **`fixtures/pages.ts`** — the Playwright fixture pattern. Tests destructure
  `{ page, saucedemoComPage }` and the Page Object is constructed once per
  test by the fixture function. When you add a second page object later,
  it's one new entry here — the test bodies don't change.
- **`run-report.json`** — `cascadeStats` shows how many intents resolved at
  each level; `cost` shows the run cost; `review.verdicts` shows the critic's
  ship/weak/fix grade per scenario; `plan` shows what the planner asked for
  vs what the explorer actually produced (the delta is informative).
