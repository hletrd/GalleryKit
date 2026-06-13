# Plan 325 — MEDIUM + security + pull-forwards (Run-5 Cycle 3)

**Source:** `.context/reviews/run5-cycle3/_aggregate.md`
**Commit discipline:** identical to plan-324 (GPG-signed, gitmoji, per-item commits, push each).

---

## A. Correctness, security, robustness

### Item 1 — AGG-R5C3-04: surface backfill failure counters to the admin UI; honest run-completion semantics (MED/High)
- **Sources:** COR-R5C3-02 + COR-R5C3-03 (code-reviewer).
- **Where:** `apps/web/src/lib/admin-backfill-runner.ts:96-153, 455-538`; `apps/web/src/app/actions/admin-backfill.ts:64-83`; settings backfill UI component.
- **Change:** extend `getBackfillStatus()` to return `encodeFailures`, `detectionFailures`, `skippedMissingOriginal`, `skippedLocked`, `lastError`, `completedRuns` from `readAdminBackfillState()`; render a last-run summary line (processed / failures / skips + error) in the settings backfill section; make the completion signal distinguish clean vs with-failures (e.g. log includes failure tallies; `completedRuns` increments but a `lastRunHadFailures` boolean or failure counts accompany it — do NOT silently report success on a fully-failed run).
- **Test:** unit test on `getBackfillStatus()` returning the extended shape; runner test asserting a run with only encode-failures exposes non-zero `encodeFailures` via the status action.

### Item 2 — AGG-R5C3-05: backfill pool-connection budget + exhaustion backoff (MED/High · 3 agents)
- **Sources:** PERF-R5C3-01, ARCH-R5C3-02, BUG-R5C3-04; folds AGG-R5C3-17 (COR-R5C3-05 lock-critical acquire→try gap comment).
- **Where:** `apps/web/src/lib/admin-backfill-runner.ts:155-220, 273-396`; `apps/web/src/db/index.ts:13-26`.
- **Change:** (1) export the pool limit from `db/index.ts` (constant), cap effective backfill concurrency at `min(env, max(1, floor((POOL_LIMIT - 2) / 2)))`; (2) wrap the `acquireImageProcessingClaim` call in `reprocessOne` so pool-exhaustion errors are treated as `{ok:false, reason:'locked'}` skip (row stays a candidate; no tight error spin); (3) move/comment the claim acquisition so the acquire→try gap is marked lock-critical; (4) document the connection-budget arithmetic in the runner header + CLAUDE.md backfill section.
- **Test:** unit test pinning the concurrency cap formula; existing batching tests stay green.

### Item 3 — AGG-R5C3-12: EXIF caption path bypasses Unicode bidi/zero-width sanitizer (LOW security — scheduled, not deferrable)
- **Source:** SEC-R5C3-01 (security-reviewer).
- **Where:** `apps/web/src/lib/process-image.ts:565-574` (`cleanMetadataString`); `apps/web/src/app/actions/images.ts:979-984` (applyAltSuggested copy).
- **Change:** strip `UNICODE_FORMAT_CHARS` (global-replace variant from `lib/validation.ts`) inside `cleanMetadataString` after the NUL strip (source defense for ALL EXIF strings incl. `camera_model`); belt-and-braces: run the applyAltSuggested copied string through the same format-char strip before `tx.update()` (skip rows stripping to empty — logic already exists).
- **Test:** regression fixture feeding a U+202E/U+200B-laden `Model` string → stored caption + copied title contain neither.

### Item 4 — AGG-R5C3-09: `ensureDir` singleton guarded reset (MED-theory/LOW-practice)
- **Source:** BUG-R5C3-06 (debugger).
- **Where:** `apps/web/src/lib/process-topic-image.ts:29-37`.
- **Change:** capture promise into a local, reset `dirPromise = null` in catch ONLY if `dirPromise === p`.
- **Test:** existing process-topic-image suite green (behavioral change is concurrency-only).

### Item 5 — AGG-R5C3-13: stale `'production'` semantic mode renders blank Select (LOW/High)
- **Source:** COR-R5C3-04.
- **Where:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:531-545`.
- **Change:** coerce controlled value: `['disabled','stub'].includes(v) ? v : 'disabled'`; keep the amber legacy warning reading the RAW map (unchanged).

### Item 6 — AGG-R5C3-10: document `'unknown'`-IP shared rate-limit bucket (MED→doc)
- **Source:** BUG-R5C3-05.
- **Where:** `apps/web/src/app/api/search/semantic/route.ts:190-192`; `apps/web/src/lib/rate-limit.ts` SECURITY note.
- **Change:** comments only — note all unknown-IP clients share one bucket under missing TRUST_PROXY, and that the limit must NOT be omitted (contrast with the checkout idempotency-key precedent).

### Item 7 — TRC-R5C3-04: applyAltSuggested skip-guard truthiness (LOW belt-and-braces)
- **Where:** `apps/web/src/app/actions/images.ts:973-974`.
- **Change:** `row.title != null && row.title !== ''` (same for description).

## B. Gates & test hardening

### Item 8 — AGG-R5C3-06: extend touch-target gate to `<Link>`/`<a>` + root-level route files (MED/High)
- **Source:** CRT-R5C3-01 (critic).
- **Where:** `apps/web/src/__tests__/touch-target-audit.test.ts:69-72, 265+`; plan-320 item 6 stale claim (now `plan/done/plan-320-run5-cycle2-medium.md:31`) — corrected in plan-326 Unit C.
- **Change:** (a) FORBIDDEN patterns for `<Link>`/`<a>` carrying sub-44 sizing (`h-8`/`h-9`/`h-10`, sub-44 `min-h-[NNpx]`) without a ≥44 override — the three fixed links (`min-h-11`) must pass; (b) add `app/[locale]` root-level `.tsx` files (`not-found.tsx`, `error.tsx`, `layout.tsx`) to the scan without double-walking subdirs; (c) extend the multi-line normalizer to `<Link`/`<a` tags.
- **Test:** the gate itself; verify it would flag a synthetic `h-8` Link fixture (fixture-style self-test if the file has one, else manual mutation check during dev).

### Item 9 — AGG-R5C3-07: semantic-search-route mock call-order dependence (MED/Med)
- **Source:** TEST-R5C3-07.
- **Where:** `apps/web/src/__tests__/semantic-search-route.test.ts:221-242`.
- **Change:** dispatch on the schema object passed to `.from()` (sentinel column present only on `imageEmbeddings` vs `images`) — mirror checkout-route AGG-R5C2-53 fix.

### Item 10 — AGG-R5C3-21: fast-loop guard for the client→server-only import boundary (LOW/High)
- **Source:** ARCH-R5C3-01 (architect).
- **Change:** new fixture test walking every `'use client'` file's transitive `@/lib`/`@/db` static-import closure asserting none contains `import 'server-only'`; explicitly pin `photo-title.ts` imports `caption-constants` (not `caption-generator`).

### Item 11 — AGG-R5C3-22: test hygiene cluster (LOW)
- **Sources:** TEST-R5C3-09, TEST-R5C3-11, TEST-R5C3-12.
- **Change:** (a) batching test: comment pinning the verified drizzle-orm version + assert ≥1 StringChunk found (fail early if `queryChunks` shape drifts); (b) export `_resetAdminBackfillStateForTesting()` from the runner (non-production guard) and use it in the batching test instead of the `Symbol.for` poke; (c) verify/document Playwright worker serialization for admin specs vs the 5/15-min login budget (config comment; set `workers: 1` for the admin project if not already serialized).

## C. Pull-forwards (owners: plan-315 / plan-316 — implemented this cycle)

### Item 12 — plan-315 item 14: migration-journal monotonicity vitest guard (HIGH-risk escalation TEST-R5C3-02)
- New `apps/web/src/__tests__/migration-journal.test.ts`: `when` strictly increases for idx > 7 (grandfathered-inversion comment for idx ≤ 7), every journal `tag` ↔ `drizzle/NNNN_*.sql` file bijection.

### Item 13 — plan-315 item 19: pin all advisory-lock constants (TEST-R5C3-03)
- Extend/add `advisory-locks.test.ts`: all 5 `LOCK_*` constants + `getImageProcessingLockName(42) === 'gallerykit:image-processing:42'`.

### Item 14 — plan-315 item 17: upload-paths behavioral tests (TEST-R5C3-04)
- New `upload-paths.test.ts` (tmpdir-based, mirroring `strip-gps-from-original.test.ts`): `resolveOriginalUploadPath` primary/legacy/neither branches; `assertNoLegacyPublicOriginalUploads` clean vs legacy-file (warn + throw modes).

### Item 15 — plan-315 item 18: `withAdminAuth` wrong-scope → 401 at wrapper level (TEST-R5C3-05)
- One test in `api-auth-response-headers.test.ts`: verified token `['lr:read']` against `allowTokenScope: 'lr:upload'` → 401.

### Item 16 — plan-315 item 1: TriState shape guard in `bulkUpdateImages` (COR-R5C1-01)
- `apps/web/src/app/actions/images.ts:869-936`: `isTriState(v)` helper validating `topic`/`titlePrefix`/`description`/`licenseTier` shapes right after the `ids` checks → `{ error: t('invalidInput') }`; malformed payload can no longer 500. Unit test with missing-TriState payload.

### Item 17 — designer CSS quick wins (plan-315 items 25/27/31/33 = DES-R5C3-06/-03/-07/-02)
- `nav-client.tsx:78`: `bg-background/50` → `bg-background/90` (keep `supports-[backdrop-filter]:bg-background/20`).
- `lightbox.tsx:627,647`: chevron badges `h-10 w-10` → `h-11 w-11`.
- `home-client.tsx:362,368`: overlays → `from-black/75` (mobile) / `from-black/70` (hover).
- `lightbox.tsx:550,570,594,617,637`: hardcoded blue focus outlines → `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.

### Item 18 — plan-315 item 26: column-derived `containIntrinsicSize` (DES-R5C3-04)
- `home-client.tsx:261`: derive estimated card width from container width / column count (300px stays the SSR fallback).

### Item 19 — plan-315 item 30: sidebar `transition-all` → `transition-[opacity,transform]` (DES-R5C3-05)
- `photo-viewer.tsx:804`: stop width-animating inside `overflow-hidden`; fade/slide instead. Verify the `I` toggle still reflows correctly at lg breakpoint.

---

## Progress

| # | Finding | Commit | Status |
|---|---|---|---|
| 1 | AGG-R5C3-04 | — | TODO |
| 2 | AGG-R5C3-05 (+-17) | — | TODO |
| 3 | AGG-R5C3-12 | — | TODO |
| 4 | AGG-R5C3-09 | — | TODO |
| 5 | AGG-R5C3-13 | — | TODO |
| 6 | AGG-R5C3-10 | — | TODO |
| 7 | TRC-R5C3-04 | — | TODO |
| 8 | AGG-R5C3-06 | — | TODO |
| 9 | AGG-R5C3-07 | — | TODO |
| 10 | AGG-R5C3-21 | — | TODO |
| 11 | AGG-R5C3-22 | — | TODO |
| 12 | plan-315 #14 | — | TODO |
| 13 | plan-315 #19 | — | TODO |
| 14 | plan-315 #17 | — | TODO |
| 15 | plan-315 #18 | — | TODO |
| 16 | plan-315 #1 | — | TODO |
| 17 | plan-315 #25/27/31/33 | — | TODO |
| 18 | plan-315 #26 | — | TODO |
| 19 | plan-315 #30 | — | TODO |
