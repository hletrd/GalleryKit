# Run-4 Cycle 6 — test-engineer angle

## Gate baseline (clean tree, before any cycle-6 change)
- vitest: **1628/1628 PASS** (166 files)
- typecheck (`check:js-scripts` + `tsc -p tsconfig.scripts.json` + app tsc): PASS
- eslint: 0 errors / 0 warnings
- lint:api-auth: PASS (2 admin routes wrapped)
- lint:action-origin: PASS (all mutating actions enforce provenance)
- lint:public-route-rate-limit: PASS (4 public routes accounted)
- build / e2e: deferred to PROMPT 3 (run after fixes, as in prior cycles)

## Coverage-gap findings (each folds into its parent fix)

### TEST-R4C6-11 — the shipped service worker has no source-of-truth test; the tested module is a diverged fork
- `lib/sw-cache.ts` is imported ONLY by `sw-cache.test.ts`; the template
  (`public/sw.template.js`) carries the actual shipped logic and has
  drifted (quota-eviction `if (deleted)` accounting exists only there).
  1628 green tests give zero protection over the bytes browsers run.
- Required with the fixes: (a) align lib semantics with the template,
  (b) add a template SOURCE-CONTRACT suite (read
  `public/sw.template.js` as text) pinning: the `deleted`-conditional
  eviction accounting, the new admin-render-header check replacing the
  dead Cookie sniff, the offline-only HTML-cache exemption shape, and
  the 401/403 exclusions — same pattern as the download-route and
  cycle6/8 source-contract suites.

### TEST gaps enabling this cycle's behavioral fixes
- **IME (COR-R4C6-01):** no test anywhere simulates
  `isComposing`/`keyCode 229` key events. Add unit tests for the new
  shared guard (native + React-synthetic shapes) and source-contract
  assertions that each affected handler consults it FIRST (tag-input,
  search, image-manager batch input, topic-manager rename,
  tokens-client create). Pure-logic guard tests are cheap and stable;
  full jsdom IME simulation is brittle — contract + unit split chosen
  deliberately.
- **Timeline truncation (COR-R4C6-02):** `data-timeline.ts` has NO test
  file at all (grep: zero references). Add unit coverage for the new
  truncation-aware helper (limit+1 probe → `truncated` flag; boundary at
  exactly-limit rows) with a mocked db, plus a source-contract pin that
  both pages render the notice when `truncated` is set.
- **Semantic search stale-guard (COR-R4C6-07):** add a request-ordering
  unit test (two interleaved semantic responses; the stale one must not
  clobber) — the existing `search`-related suites cover the keyword
  branch only.
- **Checkout rollback (COR-R4C6-08):** extend the checkout-route suite
  (exists: checkout idempotency tests) with a DB-throw case asserting
  `rollbackCheckoutAttempt` is called and the response is JSON 500 with
  NO_STORE.
- **Audit retention (COR-R4C6-10):** unit case: negative env → cutoff in
  the past (90d default), not the future.
- **Atom author block (STD-R4C6-09):** the existing atom-feed suite pins
  `<name type="text">` — update the fixture expectation in the SAME
  commit as the fix (the test currently locks the wrong behavior; this
  is a fixture correction, not a test weakening).
- **Lightbox (UX-R4C6-03 / A11Y-R4C6-04 / COR-R4C6-12):** add
  source-contract pins: no `aria-label` on the lightbox `<img>`;
  `isEditableTarget` precedes `preventDefault` in the Space branch;
  hide-timer consults `:focus-visible`. Behavioral focus-trap tests in
  jsdom are unreliable (no real focus-visible heuristic) — contracts +
  the existing e2e surface carry this.

## Flake / hygiene sweep
- No `.only`/`.skip` in the suite (grep clean).
- `smart-collection-pagination.test.ts` (new in cycle 5) uses the
  public-actions mock scaffold — deterministic, no timers.
- e2e specs unchanged this cycle so far; `run-e2e-server.mjs` boot path
  untouched by the planned fixes EXCEPT the middleware header addition
  (proxy.ts) — origin-guard.spec and admin.spec exercise middleware
  paths, so e2e in PROMPT 3 is the regression net for that change.
- Vitest import cost remains the dominant runtime (818 s import) — known,
  not worsened by this cycle's additions (new suites are light).
