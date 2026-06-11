# Aggregate Review — Run-5 Cycle-2

**Date:** 2026-06-12
**Inputs:** 11 agent reviews in `.context/reviews/run5-cycle2/` (code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer).
**Diff under extra scrutiny:** `b7d4729b..HEAD` (20 run-5 cycle-1 commits).
**Suppression honored:** plan-315 / plan-316 / plan-317 items were excluded by every lane; cross-references recorded below.

## AGENT FAILURES

None — all 11 agents returned and wrote their review files. (code-reviewer noted two of its internal Explore sub-agents returned empty; it compensated with direct full-file reads.)

## Per-agent raw counts

| Agent | CRIT | HIGH | MED | LOW | Notes |
|---|---|---|---|---|---|
| code-reviewer | 0 | 0 | 3 | 4 | + extensive verified-clean list |
| perf-reviewer | 0 | 0 | 1 | 5 | cycle-1 verdict: ship it |
| security-reviewer | 0 | 0 | 0 | 2 | risk level LOW; full attack-surface table |
| critic | 0 | 1 | 4* | 4* | escalated to adversarial on honesty cluster (counts include MED CRT-R5C2-02/03, LOW -04/-05) |
| verifier | 0 | 0 | 0 | 2 | plan-314 17/17 VERIFIED; 1881 tests green; 3 lint gates green |
| test-engineer | 0 | 4 | 8 | 3 | one HIGH (TEST-R5C2-07) is already-planned plan-315 item 14 |
| tracer | 0 | 0 | 1 | 1 | 13 flows traced; 11 verdicts SAFE |
| architect | 0 | 1 | 0 | 2 | migration 0021 runbook-compliance verified clean |
| debugger | 0 | 3 | 3 | 2 | one MED (BUG-R5C2-06) disproven below |
| document-specialist | 0 | 1 | 5 | 5 | 2 of the MED/LOW already in plan-316; 4 verified-clean INFO |
| designer | 0 | 0 | 1 | 7 | all four cycle-1 a11y fixes VERIFIED FIXED |

**Raw findings: 73 · Merged after dedupe/disproof/already-planned: 48 actionable (6 HIGH, 17 MED, 25 LOW) + 1 disproven + provenance notes.**

---

## MERGED FINDINGS

IDs `AGG-R5C2-NN`. Multi-agent agreement = higher signal. Severity/confidence = max across contributing agents.

### HIGH

#### AGG-R5C2-01 [HIGH/High · confirmed · 3 agents] Semantic-search stub honesty cluster
- **Sources:** CRT-R5C2-01 (HIGH, critic), BUG-R5C2-02 (HIGH, debugger), BUG-R5C2-03 (HIGH, debugger), BUG-R5C2-07 (LOW, debugger), CRT-R5C2-05 (LOW, critic), ARCH-R5C2-03 (LOW, architect).
- **Where:** `apps/web/src/app/api/search/semantic/route.ts:6-19,188`; `apps/web/src/components/search.tsx:414-438`; `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:545-549`; `apps/web/src/lib/gallery-config.ts:65,127,182`; `apps/web/messages/en.json:412`.
- **Problem:** Cycle-1's gate inversion means admin mode `'stub'` lights up a PUBLIC "Semantic search" toggle whose results are random (`embedTextStub`'s own doc says so), with zero visitor-facing disclaimer. Compounding: (a) the route docstring states the OPPOSITE of the code ("rejects when mode is not 'production'" — it now serves only `'stub'`); (b) settings-client renders the `'production'` warning for legacy DB rows that the resolver actually treats as `'disabled'` (warning lies); (c) the `'disabled'|'stub'|'production'` type union retains the unreachable `'production'` value, inviting future misuse; (d) `semanticSearchModeProduction` i18n key orphaned.
- **Fix (per critic, honesty order):** add visitor-facing experimental/approximate disclaimer to the public toggle + results (en/ko), rewrite the route docstring to match the gate, replace the settings-client `'production'` warning with a stale-value explanation (treated as disabled), narrow the type union to `'disabled' | 'stub'` (or annotate the sentinel), prune/pin the orphaned i18n key. The deeper product choice (serve-stub-publicly vs admin-only) is recorded as an open question; the disclaimer path keeps current behavior honest.

#### AGG-R5C2-02 [HIGH/High · confirmed · architect] Client-reachable `photo-title.ts` hard-imports server stub `caption-generator.ts`
- **Source:** ARCH-R5C2-02.
- **Where:** `apps/web/src/lib/photo-title.ts:2` → `apps/web/src/lib/caption-generator.ts:31`; importers: home-client, lightbox, photo-viewer, info-bottom-sheet, tag-filter (all `'use client'`).
- **Problem:** caption-generator's documented deferred fix adds `onnxruntime-node` (~150 MB native) + `@/db`; no `server-only` sentinel. Next WI-P52 commit breaks/bloats the client bundle through this import edge.
- **Fix:** extract `ALT_TEXT_STUB_PREFIX` to a client-safe constants module (e.g. `lib/image-types.ts`), import from there in both files, then add `import 'server-only'` to caption-generator.

#### AGG-R5C2-03 [HIGH/High · confirmed · 3 agents] `admin-backfill-runner-batching.test.ts` is a false-positive test
- **Sources:** BUG-R5C2-01 (HIGH, debugger), CRT-R5C2-04 (LOW, critic), TEST-R5C2-02 (HIGH), BUG-R5C2-04 (MED), TEST-R5C2-15 (MED).
- **Where:** `apps/web/src/__tests__/admin-backfill-runner-batching.test.ts:130-242` (mock dispatch), `:181,193,233` (500 ms wall-clock sleeps).
- **Problem:** the shared `batchIndex` counter cannot distinguish SELECT batches from `reprocessOne` UPDATE calls — the "second batch" assertion is satisfied by the FIRST UPDATE call, the real second fetch returns `[]`, and rows 101-150 are never enqueued; an OFFSET/always-break regression would still pass. The 500 ms sleeps are CI-flaky; assertions read a concurrently-mutated array.
- **Fix:** rewrite the mock to dispatch on SQL content (drizzle `sql` template `queryChunks` — SELECT contains LIMIT, UPDATE contains SET), assert the bound cursor params (0 then 100), and replace sleeps with `vi.waitFor(() => state.running === false)` or an exposed completion promise. The production keyset code itself was verified CORRECT by debugger, critic, perf-reviewer, tracer, architect.

#### AGG-R5C2-04 [HIGH/High · confirmed · document-specialist] CLAUDE.md Firefox `color-gamut` MQ claim factually wrong (FF 110+ supports it)
- **Source:** DOC-R5C2-01 (source: caniuse/MDN, verified 2026-06-12).
- **Where:** CLAUDE.md browser matrix row "Firefox 124+" + "Firefox photographer-visible impact (R10-H4)" prose; `apps/web/src/lib/use-display-capability.ts:64,103` comments.
- **Problem:** Firefox 110 (Jan 2023) shipped `(color-gamut: p3)`. The hook's MQ fallback branch therefore WORKS on Firefox 110+ — P3 badges DO show for FF P3-display users — so the doc's "no implementation as of Firefox 137" claim and both consequences in the R10-H4 section are wrong, and could mislead a maintainer into deleting correct code.
- **Fix:** correct the matrix (`✓ FF 110+` for the MQ; `✗` stays for `screen.colorGamut`), rewrite the R10-H4 prose, fix the two code comments. Verify the claim once more against caniuse before editing (doc-specialist cited https://caniuse.com/mdn-css_at-rules_media_color-gamut).

#### AGG-R5C2-05 [HIGH/High · confirmed · test-engineer] `caption-generator.ts` `generateCaption` has zero behavioral tests
- **Source:** TEST-R5C2-05.
- **Where:** `apps/web/src/lib/caption-generator.ts` (only the constant is imported by an existing test).
- **Problem:** caption output feeds `alt_text_suggested` → site-wide alt/title/OG surfaces; regressions (wrong prefix, broken fallback, swallowed throw) are invisible.
- **Fix:** new `__tests__/caption-generator.test.ts`: prefix+camera-model case, empty-model fallback, error-path behavior, prefix === `ALT_TEXT_STUB_PREFIX`.

#### AGG-R5C2-06 [HIGH/confirmed · test-engineer] checkout unknown-IP idempotency branch untested
- **Source:** TEST-R5C2-01.
- **Where:** `apps/web/src/__tests__/checkout-route.test.ts:46` (IP hardcoded `203.0.113.9`).
- **Problem:** the exact TRC-R5C1-16 defect class (shared `checkout-{id}-unknown-{minute}` key across distinct buyers) has no pin; plan-315 item 6 schedules the FIX — this is the test rider that must land with it.
- **Fix:** implement plan-315 item 6 (omit/uniquify idempotency key when IP is `'unknown'`) WITH the new test branch in the same change.

### MEDIUM

#### AGG-R5C2-07 [MED/High · confirmed · critic] `applyAltSuggested` copies `[AUTO] ` prefix verbatim into admin titles/descriptions
- **Sources:** CRT-R5C2-02 (MED) + CRT-R5C2-03 (MED, misleading "raw value for alt=''" comment — no such consumer exists).
- **Where:** `apps/web/src/app/actions/images.ts:969-986`; `apps/web/src/lib/photo-title.ts:112-113`.
- **Fix:** strip the prefix at the copy site (skip rows stripping to empty), centralize in one exported helper used by both files, delete the false comment, tighten the CRT-R5C1-02 header-comment coverage claim. Add a regression test for the copy path.

#### AGG-R5C2-08 [MED/High · confirmed · tracer] Backfill runner doesn't hold the per-image advisory lock — races a retried queue job
- **Source:** TRC-R5C2-01.
- **Where:** `apps/web/src/lib/admin-backfill-runner.ts:178-281` (`reprocessOne`).
- **Problem:** `retryFailedImage` re-enqueue + concurrent "Re-encode" backfill can both run `processImageFormats` on the same image (queue holds `gallerykit:image-processing:{id}`; backfill doesn't), interleaving derivative writes.
- **Fix:** acquire `getImageProcessingLockName(id)` in `reprocessOne` (skip row if unavailable), release after the UPDATE.

#### AGG-R5C2-09 [MED/High · confirmed · debugger] Embedding hook writes random stub embeddings whenever mode != 'disabled'
- **Source:** BUG-R5C2-05.
- **Where:** `apps/web/src/lib/image-queue.ts:405-434`.
- **Problem:** `'stub'` mode silently accumulates meaningless vectors in `image_embeddings` (and would overwrite real ones via `onDuplicateKeyUpdate` after a future mode flip). Interacts with AGG-R5C2-01's product decision.
- **Fix:** keep writing in stub mode ONLY if that is the deliberate demo posture (then the disclaimer covers it); otherwise gate the hook to a future real-encoder mode. At minimum document the contract at the hook and ensure `CLIP_MODEL_VERSION`/stub provenance is stored so stub rows are distinguishable.

#### AGG-R5C2-10 [MED/Med-High · confirmed · code-reviewer] Backfill observability: skips and encode-failures invisible
- **Sources:** COR-R5C2-01 (MED), COR-R5C2-02 (MED).
- **Where:** `apps/web/src/lib/admin-backfill-runner.ts:178-211, 319-354`.
- **Problem:** missing-original and encode-throw paths neither increment `errors` nor any skip counter; a fully-failed run reports `processed=0 errors=0` "complete".
- **Fix:** return a discriminated result from `reprocessOne`; tally `skippedMissingOriginal` / `encodeFailures`; surface in periodic log, final summary, and `AdminBackfillState`.

#### AGG-R5C2-11 [MED/High · confirmed · perf-reviewer] New analytics index column order defeats loose scan on the `'all'` window
- **Source:** PERF-R5C2-01.
- **Where:** `apps/web/src/db/schema.ts:232-233`; `apps/web/src/lib/analytics-data.ts:93-114,169-190`.
- **Verdict:** strict improvement over no-index; not a regression. **Fix:** document the `'all'`-window temp-table behavior at the query site + tie to the planned retention work (plan-315 item 12); do NOT add more indexes to the hot INSERT table without EXPLAIN evidence (exit criterion below if deferred).

#### AGG-R5C2-12 [MED/Med · likely · code-reviewer] `formatTitleAsTags` splits titles into pseudo-tags incl. empty tokens
- **Source:** COR-R5C2-03. **Where:** `apps/web/src/lib/photo-title.ts:48-50`.
- **Fix:** `.split(/\s+/).filter(Boolean)`; review whether prose titles should be hashtagged at all.

#### AGG-R5C2-13 [MED/High · confirmed · designer] Shared-group "View Gallery" back link ~20 px tall (44 px floor)
- **Source:** DES-R5C2-01. **Where:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:140,172`.
- **Fix:** add `min-h-11` (+ items-center) to both link instances; check the touch-target audit scanner covers raw `<Link>` patterns or add explicitly.

#### AGG-R5C2-14 [MED/confirmed-likely · test-engineer] session-verify test isolation gaps
- **Sources:** TEST-R5C2-03 (MED), TEST-R5C2-16 (MED).
- **Where:** `apps/web/src/__tests__/session-verify.test.ts:46-68`.
- **Fix:** `vi.resetModules()` in `beforeEach` (not only afterEach); unique token bytes per test to defeat React `cache()` dedup.

#### AGG-R5C2-15 [MED/confirmed · test-engineer] sw-cache test 2 ms wall-clock sleep
- **Source:** TEST-R5C2-04. **Where:** `apps/web/src/__tests__/sw-cache.test.ts:191`.
- **Fix:** fake timers / `vi.setSystemTime` to advance the timestamp deterministically.

#### AGG-R5C2-16 [MED/confirmed · test-engineer] `process-topic-image.ts` has no unit tests
- **Source:** TEST-R5C2-08. **Fix:** behavioral tests for processTopicImage / deleteTopicImage / cleanOrphanedTopicTempFiles (tmpdir-based, like the save-original test).

#### AGG-R5C2-17 [MED/confirmed · test-engineer] `gallery-config.ts` resolver merge/coercion logic untested
- **Source:** TEST-R5C2-09. **Fix:** unit tests for DB-override-wins, invalid-value fallback-to-default, numeric/boolean coercion, env override.

#### AGG-R5C2-18 [MED/confirmed · test-engineer] e2e gaps: `/s/[key]` route and 404 page uncovered
- **Source:** TEST-R5C2-10. **Fix:** add the two specs to `e2e/public.spec.ts` (shared-link render; unknown route renders localized 404).

#### AGG-R5C2-19 [MED/confirmed · test-engineer] download GET interstitial has source-contract coverage only
- **Source:** TEST-R5C2-12. **Fix:** behavioral tests: valid token → 200 HTML + CSP + `X-Robots-Tag: noindex`; expired/refunded → 410; localized strings; form action.

#### AGG-R5C2-20 [MED/confirmed · document-specialist] NCLX transfer code 1 doc notation misleading
- **Source:** DOC-R5C2-02. **Fix:** CLAUDE.md: `1=BT.709 (labelled 'srgb' — practical SDR approximation)`; note 13 = canonical sRGB; point at `NCLX_TRANSFER_MAP`.

#### AGG-R5C2-21 [MED/confirmed · document-specialist] `revalidate=0` described as "framework-default no-store" — imprecise for Next 16
- **Source:** DOC-R5C2-05. **Fix:** reword CLAUDE.md + sw.template.js comment to "dynamic rendering; Next emits no-cache headers" without pinning the exact header value.

#### AGG-R5C2-22 [MED/confirmed · document-specialist] `headers()`/public/ precedence description slightly inverted
- **Source:** DOC-R5C2-06. **Fix:** CLAUDE.md clarification: headers config → filesystem (incl. public/) → route handlers.

#### AGG-R5C2-23 [MED/confirmed · document-specialist] Stripe `async_payment_succeeded` gap undocumented for operators
- **Source:** DOC-R5C2-09 (fix itself = plan-316 CRT-R5C1-04, already planned). **Fix here:** one-line operator warning in CLAUDE.md until the handler ships.

### LOW

| ID | Source(s) | Where | Fix sketch |
|---|---|---|---|
| AGG-R5C2-30 | SEC-R5C2-01 (LOW/High) | `lib/session.ts:99-128` | post-HMAC shape assert on `random`/`signature` segments (hardening only) |
| AGG-R5C2-31 | SEC-R5C2-02 (LOW/Med) | `api/og/photo/[id]/route.tsx:246-258` | covered by planned SEC-R5C1-04; optional emit-time scheme assert |
| AGG-R5C2-32 | COR-R5C2-04 (LOW/High) | `lib/data.ts:366-428` | derive `_MapSensitiveKeys` from canonical `PrivacySensitiveKeys` minus lat/lon so the guard can't drift |
| AGG-R5C2-33 | COR-R5C2-06 (LOW/Low) | `api/search/semantic/route.ts:61-64` | optional strict non-number `topK` reject — clamp already total |
| AGG-R5C2-34 | PERF-R5C2-02 (LOW/High) | backfill candidate scan | DEFER: add `(processed, pipeline_version, id)` index only on large-gallery latency evidence |
| AGG-R5C2-35 | PERF-R5C2-03 (LOW/Med, needs-EXPLAIN) | `analytics-data.ts:28-54` | DEFER: `(bot, viewed_at, image_id)` candidate pending EXPLAIN |
| AGG-R5C2-36 | PERF-R5C2-04 (LOW/High) | `sw.template.js:77-117` | fold meta-write coalescing into plan-315 item 16 SW rework |
| AGG-R5C2-37 | TRC-R5C2-03 (LOW/High) | `actions/images.ts:~1090` | also clear `state.claimRetryCounts` in retryFailedImage |
| AGG-R5C2-38 | ARCH-R5C2-04 (LOW/Med) | `admin-backfill-runner.ts:160` | comment documenting non-snapshot keyset invariants |
| AGG-R5C2-39 | BUG-R5C2-08 (LOW/High) | `process-image.ts:856` | comment: assertBlurDataUrl never throws |
| AGG-R5C2-40 | DES-R5C2-02 (LOW/High) | `not-found.tsx:43` | `min-h-11` on recovery link |
| AGG-R5C2-41 | DES-R5C2-03 (LOW/High) | `error.tsx:18` | decorative span + sr-only h1, or raise opacity to ≥3:1 |
| AGG-R5C2-42 | DES-R5C2-04 (LOW/High) | `home-client.tsx:395` | `aria-hidden` on empty-state svg |
| AGG-R5C2-43 | DES-R5C2-05 (LOW/High) | `nav-client.tsx:164` | LOCALE_DISPLAY_NAMES map |
| AGG-R5C2-44 | DES-R5C2-06 (LOW/High) | `photo-viewer.tsx:592` | wire `aria-describedby` or remove dead sr-only block |
| AGG-R5C2-45 | DES-R5C2-07 (LOW/Med) | `upload-dropzone.tsx:490` | confirm non-focusable; no change if so |
| AGG-R5C2-46 | DES-R5C2-08 (LOW/Low, needs-device) | `info-bottom-sheet.tsx` | `dvh` with `vh` fallback for iOS chrome |
| AGG-R5C2-47 | VER-R5C2-02 (LOW/High) | CLAUDE.md index list | add `(uploaded_by)` + migration-0021 indexes to the doc |
| AGG-R5C2-48 | DOC-R5C2-03 (LOW/High) | CLAUDE.md + touch-target test comment | reference WCAG 2.2 (2.5.8 AA / 2.5.5 AAA) |
| AGG-R5C2-49 | DOC-R5C2-04 (LOW/High) | CLAUDE.md GPS note | clarify withMetadata keeps all EXIF per Sharp docs |
| AGG-R5C2-50 | DOC-R5C2-08 (LOW/High) | CLAUDE.md security section | document Argon2id work factors |
| AGG-R5C2-51 | DOC-R5C2-13 (LOW/Med) | CLAUDE.md migration runbook | mark drizzle file:line ref as informational/version-drifting |
| AGG-R5C2-52 | TEST-R5C2-11 (LOW) | `e2e/admin.spec.ts` | failed-login + cookie-set assertions (non-opt-in path) |
| AGG-R5C2-53 | TEST-R5C2-13 (LOW) | `checkout-route.test.ts:82-97` | replace order-dependent select-chain mock |
| AGG-R5C2-54 | TEST-R5C2-14 (LOW) | `lib/utils.ts` | standalone countCodePoints tests (surrogate pairs) |

### DISPROVEN during aggregation

- **BUG-R5C2-06 (debugger, MED "likely")** — claimed `requireSameOriginAdmin()` returns a `Response` so `{error: originError}` double-wraps. **FALSE:** `apps/web/src/lib/action-guards.ts:37` — `requireSameOriginAdmin(): Promise<string | null>` returns a localized STRING; its own docblock prescribes exactly the `if (originError) return { error: originError }` caller pattern used. Independently verified-correct by code-reviewer, security-reviewer, verifier, critic. No action.

### Already-planned cross-references recorded by agents (no new action; do not double-plan)

- TEST-R5C2-07 = plan-315 item 14 (migration-journal vitest guard) — still not created; plan-315 remains the owner.
- TEST-R5C2-06 = plan-315 item 19 — rider: cover all 5 lock constants + `getImageProcessingLockName`, not just LOCK_ADMIN_DELETE.
- VER-R5C2-01 / DOC-R5C2-10 = plan-316 DOC-R5C1-03 (site-config path); DOC-R5C2-07 = plan-316 VER-R5C1-03 (SESSION_SECRET note); SEC-R5C2-02 residual = plan-316 SEC-R5C1-04.
- PERF-R5C2-04 rider on plan-315 item 16 (SW rework).
- COR-R5C2-05 fresh trace of COR-R5C1-02 (plan-316 Unit C); KNOWN section of code-reviewer re-confirms COR-R5C1-01, TRC-R5C1-16/17, CRT-R5C1-04, COR-R5C1-07, PERF-R5C1-03 — all still open in plan-315/316.

### Verified-clean sweeps (this cycle)

- **plan-314: 17/17 items VERIFIED at HEAD** (verifier, with code evidence per item); fresh `npm test` 1881/1881 green; lint:api-auth, lint:action-origin, lint:public-route-rate-limit all green; i18n en/ko parity exact.
- Cycle-1 commits individually re-reviewed by code-reviewer (per-commit verdict table: all Correct), security-reviewer (all sound, net security improvements), perf-reviewer (no regressions; tailwind masonry safelist verified), tracer (13 flows: 11 SAFE verdicts incl. unlink-race impossibility proof, keyset correctness, fail-closed 3-layer defense, session revocation, SW deploy invalidation, restore topology, Stripe idempotency), architect (migration 0021 fully runbook-compliant; no new process-local state; feature-flags removal clean), designer (all four a11y fixes VERIFIED FIXED).
- Security full-surface sweep: 10/10 API routes + 14 action files + db-actions examined; no hardcoded secrets in tree or history; all JSON-LD sinks via safeJsonLd; CSP/nonce/cookie attributes sound.
