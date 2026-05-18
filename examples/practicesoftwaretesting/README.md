# Example: practicesoftwaretesting.com

A second checked-in example, from a different domain than [`saucedemo/`](../saucedemo/) — a search-driven docs site rather than a login form. Output of:

```bash
npm run explore -- https://practicesoftwaretesting.com/
```

run on 2026-05-18.

## Contents

| File | What |
|---|---|
| [`pages/BasePage.ts`](pages/BasePage.ts) | Base Page Object class |
| [`pages/PracticesoftwaretestingComPage.ts`](pages/PracticesoftwaretestingComPage.ts) | Page Object — note this run resolved 100% via `getByLabel` (no role-accessible names on this site) |
| [`fixtures/pages.ts`](fixtures/pages.ts) | Playwright fixture that injects the Page Object |
| [`tests/practicesoftwaretesting-com.spec.ts`](tests/practicesoftwaretesting-com.spec.ts) | Generated spec |
| [`a11y/landing.a11y.spec.ts`](a11y/landing.a11y.spec.ts) | Auto-injected axe-core WCAG 2 AA check |
| [`run-report.json`](run-report.json) | Trace + critic verdicts + cost |

## This run

| | |
|---|---|
| Date | 2026-05-18 |
| Scenarios planned | 3 (happy, negative, a11y) |
| Scenarios emitted | 3 |
| Cascade | 7/7 intents resolved at `getByLabel` (vs `getByRole` for saucedemo) |
| Cost | $0.024 (113k input, 96k cached, 657 output) |
| Live result | `npx playwright test --project=chromium` → **2 passed, 1 failed** |

## Honest notes

This is the unmodified output of a fresh run. The middle test fails because
the model bound an intent it called `"X"` (an X-close icon it expected to
appear after a search submit) but the icon wasn't there — the locator
`getByLabel("X")` matches nothing on the live page. The other two tests
(search workflow + a11y check) pass.

Why this is informative rather than just a defect:

- **Cascade behaviour differs by site.** Saucedemo resolves everything via
  `getByRole` because its inputs have ARIA roles + accessible names.
  Practicesoftwaretesting resolves everything via `getByLabel` because its
  inputs use `<label>` elements not `aria-label`. Same tool, different
  emission, both correct for the site they're testing.
- **The model's failure mode is visible.** A real CI failure on the
  `[negative]` test would be a heal candidate — `npm run heal` could
  re-open a browser, look at the actual close button, and propose a
  replacement selector.

## Comparison with `examples/saucedemo/`

| | saucedemo | practicesoftwaretesting |
|---|---|---|
| Domain | Login form | Search workflow |
| Cascade level | 15/15 `getByRole` | 7/7 `getByLabel` |
| Tests emitted | 3 | 3 |
| Tests passing | 3/3 | 2/3 |
| Cost | $0.023 | $0.024 |
