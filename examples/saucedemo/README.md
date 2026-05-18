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

## Result

When run against the live site:

```bash
npx playwright test --project=chromium
# 4 passed (4.3s)
```

## What to look at

- **`pages/SaucedemoComPage.ts`** — every locator is `page.getByRole(...)`.
  That's because the cascade resolver's first level (`getByRole`) succeeded
  for every intent during the explore run. If saucedemo lost ARIA roles,
  the transcriber would emit `getByLabel` / `getByPlaceholder` / `getByTestId`
  / `page.locator(css)` instead, depending on which level resolved.
- **`tests/www-saucedemo-com.spec.ts`** — only scenarios the critic graded
  `ship` or `weak` survived. `fix`-graded scenarios are dropped from the
  emitted suite (the rationale lives in `run-report.json` under `verdicts`).
- **`run-report.json`** — `cascadeStats` shows how many intents resolved at
  each level; `costUsd` shows the run cost; `events` shows every tool call
  the explorer made in order.
