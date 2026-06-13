# Test-Engineer Review — Cycle 3 (run-8 c2 fan-out)

**HEAD:** `ada92ba5` · **Date:** 2026-06-13 · **Scope:** test-coverage / flakiness / TDD-opportunity

## Baseline (fresh run)

```
cd apps/web && npx vitest run
Test Files  213 passed (213)
     Tests  2060 passed (2060)
  Duration  146.26s
```

All green on a cold run — no failures, so no flake re-runs were required for red tests. The stderr noise in the output is expected negative-path logging (`sales-refund-convergence`, `gallery-config` fallback) from tests that assert on thrown/logged errors. e2e (Playwright) not run (requires a live server + browser; out of scope for this unit pass).

## Verdict on the tests ADDED this cycle (prior-cycle deliverables)

I verified each new/changed test would FAIL if its fix were reverted, and is not a tautology. **All five hold up — no slop, no passing-for-wrong-reason.**

| New test | Pins | Robust? | Anti-tautology guard present? |
|---|---|---|---|
| `og-sanitize.test.ts` + `sanitize-for-og-global.test.ts` | shared `sanitizeForOg` global-strip (replace-ALL bidi/zero-width + C0) | Yes — behavioral on the real fn + structural import grep | Yes (multi-occurrence cases; forbids non-global `.replace(UNICODE_FORMAT_CHARS`) |
| `admin-backfill-runner-fatal-counters.test.ts` (mixed-run, AGG-R8-10) | `processed===1 && errors===1` coexist; `lastError` set; no `processed` inflation | Yes — drives the real runner via fire-and-forget + `vi.waitFor` on `running` | Yes (partitions fatal-only vs mixed; asserts `processImageFormats` actually called) |
| `migrate-reconcile-coverage.test.ts` (index tripwire, AGG-R8-10/TRC-1) | every `CREATE INDEX` in drizzle SQL mirrored in `migrate.js` reconcile | Yes — introspects schema + scans SQL | Yes ("scanner sanity": `indexNames.length ≥ 10`, spot-checks known names — would not pass vacuously) |
| `migration-journal-monotonicity.test.ts` (AGG-7) | journal `when` strictly advances except allowlist | Yes | Yes (allowlist-staleness check: each allowlisted idx must STILL be a real inversion) |
| `client-server-only-boundary.test.ts` (AGG-R8-01 de-flake) | memoized reads + 60s timeout; assertion unchanged | Yes — still walks full closure, still fails on a real leak | Yes (`clientFiles.length > 0` sanity; explicit photo-title.ts pin) |
| `touch-target-audit.test.ts` raw-checkbox (AGG-R8-03) | raw `<input type=checkbox/radio>` 44px floor | Yes — `scanRawCheckboxes` has violation + min-h-11 fix + radio + shadcn-no-false-positive fixtures | Partial (see TEST-5 for an untested window-distance edge) |

The cycle-2 `home-metadata-title.test.ts` additions (AGG-R8-02 home og:image → per-photo OG card, NOT oversized base JPEG) are also solid and behavioral. Do not re-open these.

---

## Findings

### TEST-1 — Home OG route's `sanitizeForOg` application is UNGUARDED (the exact cycle-2 fix is not pinned for the home route). Confidence: High

**Where:** `src/app/api/og/route.tsx:82-88` applies `sanitizeForOg` to `topicLabel`, `siteTitle`, and each `tagList` entry — this is the symmetry-gap fix landed in commit `d5399742`. The only test that references this file is `src/__tests__/og-route-source-contracts.test.ts`, which asserts ONLY:
```js
expect(source).not.toContain('rollbackOgAttempt');
expect(source).toContain("return new Response('Topic not found'");
```
It does **not** assert the route imports/uses `sanitizeForOg`.

`sanitize-for-og-global.test.ts:54-67` pins the strip for the PHOTO route (`api/og/photo/[id]/route.tsx`) and the photo PAGE (`p/[id]/page.tsx`) via `it.each`, but the home/site route is absent from that list. I confirmed **zero tests import or invoke the home route's `GET` handler** (grep: only `og-route-source-contracts` + `og-sanitize` reference the file, neither exercises the handler). By contrast the photo route has 6 referencing tests (`og-photo-fallback`, `og-image-icc`, `photo-og-metadata`, etc.).

**Why it matters:** This is the precise regression the cycle-2 work closed — the home card previously rendered `siteTitle`/`topicLabel`/tags RAW while the photo route stripped them. If a future edit drops the `sanitizeForOg(...)` wrappers from `route.tsx:82-88` (e.g. a refactor that inlines `clampDisplayText` and forgets the strip), the symmetry gap silently re-opens with no failing test. Admin-controlled + validator-rejected at write time, so not a live exploit — but the whole point of the defense-in-depth fix was the guarantee that BOTH OG surfaces strip; that guarantee is currently unenforced on the surface the fix was added to.

**Test to add (cheapest, highest-leverage):** extend the `it.each` in `sanitize-for-og-global.test.ts` to include the home route:
```js
['src/app/api/og/route.tsx', /from\s+['"]@\/lib\/og-sanitize['"]/],
```
and add to `og-route-source-contracts.test.ts` a structural assertion that every rendered string passes through `sanitizeForOg` (e.g. `expect(source).toMatch(/sanitizeForOg\(clampDisplayText\(topicRecord\.label/)`, the `seo.title` line, and that the `tagList` map calls `sanitizeForOg`). Stronger still (optional): a behavioral test that mocks `getTopicBySlug`/`getSeoSettings` to return a label containing two bidi-override chars and asserts the rendered `ImageResponse` element tree (Satori accepts a React element you can introspect) contains no bidi chars — mirrors how `photo-og-metadata.test.ts` invokes the handler.

---

### TEST-2 — AGG-R8-09 backfill width re-validation skip path has NO test. Confidence: High

**Where:** `src/lib/admin-backfill-runner.ts:430-436` — the cycle-2 guard that re-validates `row.width > 0` BEFORE `processImageFormats` and returns `{ ok: false, reason: 'encode-failed' }` (no version bump, distinct log) for a corrupt/legacy `width <= 0` row.

All four `admin-backfill-runner-*.test.ts` files feed `width: 100` (valid) — confirmed by grep. The width<=0 branch is uncovered: no test drives a row with `width: 0` / `width: -1` / `width: NaN` through `reprocessOne`.

**Why it matters (data-integrity, the classification is load-bearing):** The whole correctness claim is "classified `encode-failed` so it stays idempotent — NO version bump — and remains a candidate for a future run after the row is repaired." If a future refactor mis-classified this as a `skip` (which in some accounting advances past the row) or accidentally let it fall through to a `processed++`, a corrupt-width row would be **falsely reported as re-encoded** and never retried — the exact dishonesty class the AGG-1 fatal-counter work fought. There is also a subtle ordering risk: the width guard sits *before* `acquireImageProcessingClaim`, so a regression that moves it after the claim would leak the claim connection on the early return.

**Test to add:** in `admin-backfill-runner-fatal-counters.test.ts` (it already has the full mock harness), add a describe that returns one candidate row with `width: 0`. Assert after drain: `s.encodeFailures` reflects it (or the documented counter), `s.processed === 0`, **`processImageFormats` was NOT called** (the guard short-circuits before encode), and the `pipeline_version` UPDATE was never issued (no version bump → still a candidate). A second case with `width: -1` and `width: NaN` (the `!Number.isFinite` arm).

---

### TEST-3 — SW bounded-HEAD timeout (AGG-R8-05) is not pinned by the template-contract test. Confidence: High

**Where:** `public/sw.template.js:213-248` adds `signal: AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` (`= 300`, line 38) to the synchronous cached-image HEAD ETag probe — the cycle-2 display-path latency bound (commit `9b7bb240`).

`src/__tests__/sw-template-contract.test.ts` pins the LRU accounting, the lazy-revalidate closure, the 304 branch, the offline-HTML marker — but has **no assertion** that the HEAD probe carries an abort timeout. The unit-tested reference impl `lib/sw-cache.ts` does not implement HEAD probing at all (grep: zero `AbortSignal`/`HEAD`/`timeout` matches), so the only copy of this logic is the shipped template, and nothing locks it.

**Why it matters:** The probe sits on the warm-paint DISPLAY path. The documented worst-case bound is the entire point — without the `signal`, a slow/hung network stalls EACH cached masonry tile for the full default fetch timeout before falling through to stale-serve (a visible per-tile hang on flaky networks). If a future SW edit drops the `signal:` line (easy in a `fetch` options refactor), the bound regresses with a green suite. `sw.template.js` is the SHIPPED service worker source; this is a real shippable regression surface, and `scripts/build-sw.ts` stamps it into `sw.js` so it goes straight to production.

**Test to add:** in `sw-template-contract.test.ts`, slice the `staleWhileRevalidateImage` fn and assert the HEAD `fetch` options object contains `signal: AbortSignal.timeout(` and that `HEAD_REVALIDATE_TIMEOUT_MS` is a small finite constant: `expect(TEMPLATE).toMatch(/const HEAD_REVALIDATE_TIMEOUT_MS\s*=\s*\d{2,4};/)` and assert the matched value ≤ 1000. Mirror the existing slice-and-match style (lines 73-110). Cheap, no runtime.

---

### TEST-4 — Home-client 0-width CSS / CLS-reservation fallback has no test (logic inline in render). Confidence: Low

**Where:** `src/components/home-client.tsx` (commit `e8fce327`) — `hasValidDims`, `cardAspectRatio` (`'1 / 1'` fallback), `cardIntrinsicHeight` guard against `aspectRatio: '0 / 0'` / `containIntrinsicSize: 'auto Infinitypx'`. No test (grep: zero references to `cardAspectRatio`/`containIntrinsic`/`hasValidDims`).

**Why it matters:** Correctness of the CLS reservation when `width`/`height` is non-positive — but the guarded condition is "near-impossible given NOT NULL Sharp metadata," so the regression risk is genuinely low. The logic is also inline in the component's `.map()` render, so a unit test would require rendering the component or extracting a pure helper.

**Recommendation:** Only worth a test if the denominator math is extracted to a pure `cardReservation(width, height, estWidth)` helper (the right refactor anyway). Then a 3-line unit test pins `(0, 100, 300) → { aspectRatio: '1 / 1', intrinsicHeight: 300 }`. Low priority — note it, don't block on it.

---

### TEST-5 — Raw-checkbox scanner: window-distance and non-`<label>` wrapper edges untested. Confidence: Low

**Where:** `src/__tests__/touch-target-audit.test.ts:611-640` (`scanRawCheckboxes`). The wrapper back-scan only matches a `<label>` carrying the sizing class within a hardcoded `WINDOW = 4` lines, and ONLY a `<label>` element (not a sizing `<div>`/`<span>` wrapper).

Fixtures (lines 839-867) cover: violation, min-h-11 fix, radio, shadcn-no-false-positive. They do **not** cover: (a) the WINDOW boundary (label exactly 4 vs 5 lines above the input), or (b) a checkbox whose 44px tap area is supplied by a non-`<label>` wrapper.

**Why it matters:** Both are *false-positive* risks (the audit is a blocking gate). A legitimate future pattern — e.g. a checkbox in a `min-h-11 <div>` wrapper, or a label pushed >4 lines up by an inserted comment/`<span className="sr-only">` block — would fail the gate spuriously and require a `KNOWN_VIOLATIONS` exemption for compliant code. The current two raw checkboxes both use the `<label>`-within-2-lines shape (verified against `image-manager.tsx`), so it's fine TODAY, but the scanner's robustness is unproven at its own boundaries.

**Test to add:** two fixtures — (1) `<label min-h-11>` exactly `WINDOW` lines above the input (asserts clean) and `WINDOW+1` lines above (asserts flagged, documenting the boundary); (2) confirm/decide the non-`<label>` wrapper behavior (either broaden the back-scan to any element with the sizing class, or add a fixture asserting it IS flagged so the limitation is explicit). Low priority.

---

### TEST-6 — load-more / settings-client unmount-guard symmetry is undocumented by tests. Confidence: Low

**Where:** `src/components/load-more.tsx` (commit `e8fce327`) adds `mountedRef` + unmount cleanup guarding the post-await `setState`. The comment claims it's "Symmetric with the settings-client backfill unmount guard." Grep finds **zero** tests referencing `mountedRef`/`unmount` anywhere in `__tests__/` — neither the load-more guard nor the settings-client one it mirrors is pinned.

**Why it matters:** Low — the failure mode is a React "setState after unmount" warning on a fast route change, not data loss or a security issue. But two components now carry the same latent-bug guard with no regression test, so a refactor that drops either reintroduces the warning silently.

**Recommendation:** Optional. A jsdom render-then-unmount test that resolves the awaited action after unmount and asserts no `act()` warning fires is possible but heavy for the value. Note and move on.

---

## Areas verified as WELL-COVERED (no gap — do not re-report)

- **NCLX code-2 (unspecified) branch** — `color-detection.test.ts:233-254` has BOTH "maps nclx transfer=2 to unknown" AND the critical AGG-R8-06 "code-2 unspecified transfer/matrix does NOT erase the ICC-derived values." The exact cycle-2 branch is pinned. Full NCLX map (transfer 4/5/6/7/8/11/13/14/15/16/17/18, primaries 11/12, matrix 8/10) is exhaustively tested.
- **Privacy field guards** — `privacy-fields.test.ts` is exemplary: the "symmetric privacy guard" (set-difference `admin − public === SENSITIVE_KEYS` exactly) catches a NEW admin field leaking publicly, plus the `data-timeline` mirror subset check (TEST-R4C9-04). Cross-references real schema keys, not a fixture echo.
- **The 3 lint-gate fixture tests** (`check-api-auth`, `check-action-origin`, `check-public-route-rate-limit`) — behavioral: they exercise the actual scanner functions against synthetic source (function-decl, variable-export, aliased-export, export-specifier forms), not just grep route files. Robust.
- **gps-exif-strip** (`process-image-exif-strip`, `strip-gps-from-original`), **image-processing claim race / advisory locks** (7 queue tests + `advisory-locks.test.ts`), **csv-escape / validation Unicode strip / sanitize** (10 files) — all have dedicated, substantive coverage.
- **home og:image AGG-R8-02** — `home-metadata-title.test.ts:95-115` pins per-photo OG route (1200×630), NOT the oversized base JPEG, on both `openGraph.images` and `twitter.images`.
- **advisory-locks.ts cycle-2 change** — doc-only (added `gallerykit_color_pipeline_backfill` to the blast-radius docblock); no behavior change → no test needed.

## Flakiness scan

No timing-dependent, real-clock, network, or filesystem-order flakes found in the new tests. The two `admin-backfill-runner-fatal-counters` tests use `vi.waitFor` on the authoritative `running` flag with a 20s timeout + 25ms interval (correct — drains the fire-and-forget runner deterministically, not a fixed sleep). The `client-server-only-boundary` de-flake (memoized reads + 60s explicit timeout) is the right fix for a slow-but-correct full-tree scan; the assertion still runs to completion. Filesystem walks (`migrate-reconcile`, `touch-target-audit`, `client-server-only`) sort/iterate `readdirSync` but assert on SETS/membership, not order — order-independent. Whole-suite cold run is 146s; nothing in the suite structure suggests an individual test >10s other than the deliberately-60s-budgeted boundary scan (single-digit seconds warm).

## Top gaps (priority order)

1. **TEST-1** (High) — pin home OG route `sanitizeForOg` (the cycle-2 fix is unguarded on the surface it was added to).
2. **TEST-2** (High) — test the backfill `width<=0` skip classification (data-integrity / no-false-"re-encoded").
3. **TEST-3** (High) — pin the SW HEAD `AbortSignal.timeout` bound (shippable display-path regression).
4. TEST-4/5/6 (Low) — CLS-reservation helper extraction, raw-checkbox scanner boundary fixtures, unmount-guard symmetry.
