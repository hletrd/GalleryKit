# Plan 502 — MEDIUM (Run-5 Cycle 1)

**Source:** `.context/reviews/_aggregate.md` (run-5 cycle 1, 2026-06-11)
**Scope:** 33 work items covering 35 finding IDs (TRC-R5C1-01/PERF-R5C1-11 folded into item 15; COR-R5C1-05 folded into item 16). MED findings routed to plan 503 (doc-only fixes) or `plan-317-run5-cycle1-deferred.md` (needs-manual-validation / no-action-today) are cross-referenced at the bottom.
**Effort key:** S = <1 h, M = 1-3 h, L = >3 h.

Commit/gate discipline identical to plan 501 (GPG-signed, gitmoji, per-item commits, full gate run, per-iteration deploy).

---

## A. Security & correctness

### Item 1 — COR-R5C1-01: TriState shape guard in `bulkUpdateImages` (S)
- **Where:** `apps/web/src/app/actions/images.ts:869-936` — planner verified: `topic.mode` etc. read at :900/:910/:919/:927 with no shape validation; destructure at :876.
- **Change:** Add an `isTriState(v)` helper (object, `mode` in `{'keep','set'}`(+file's actual modes), value type per field) and validate all four fields (`topic`, `titlePrefix`, `description`, `licenseTier`) right after the `ids` checks, returning `{ error: t('invalidInput') }`. Also guard `applyAltSuggested` boolean shape.
- **Test:** Unit test posting `{ ids:[1], addTagNames:[], removeTagNames:[] }` (missing TriState fields) → localized error, no throw, no DB call.
- **Acceptance:** malformed payload can no longer produce an unhandled framework 500.

### Item 2 — SEC-R5C1-01: OG route trusted-origin derivation (M)
- **Where:** `apps/web/src/app/api/og/photo/[id]/route.tsx:114` (internal fetch origin), `:262` (302 fallback Location); `apps/web/src/lib/og-photo-fetch.ts:50-52`.
- **Change:** Derive the origin from a trusted server-side base — `siteConfig.url` (or `process.env.BASE_URL`) — falling back to `new URL(req.url).origin` only when neither is configured (dev). Apply to BOTH the Satori-internal photo fetch and the 302 fallback Location.
- **Test:** Unit test: with `siteConfig.url` set, a request with a forged Host header still fetches/redirects on the configured origin.
- **Acceptance:** client-supplied Host can no longer steer the internal fetch or poison the 302 target. (needs-manual-validation note: also confirm the edge nginx forwards only configured server_names; optional `default_server` 444 block is an ops follow-up, not app code.)

### Item 3 — SEC-R5C1-02: PAT failed-verification audit + rate accounting (S)
- **Where:** `apps/web/src/lib/api-auth.ts:63-89`.
- **Change:** In the token branch's failure path, write a `token_auth_failure` audit event (reuse `lib/audit.ts`) and bump a small per-IP `BoundedMap` failure counter (soft signal; reject only at an extreme threshold, e.g. 60/15 min, to avoid breaking Lightroom retries).
- **Test:** Unit test: invalid token → audit insert called; threshold exceeded → 429.
- **Acceptance:** failed PAT presentations leave a forensic trail.

### Item 4 — TRC-R5C1-14: document the GPS-strip guarantee scope (S)
- **Where:** `apps/web/src/app/api/download/[imageId]/route.ts:282`; CLAUDE.md Privacy section; admin settings UI hint for `strip_gps_on_upload`.
- **Change:** Documentation + UI honesty fix (the gap is unreachable in normal operation thanks to the lock-once contract — planner concurs with the aggregate): (1) CLAUDE.md Privacy bullet gains: "the strip applies at upload time only; originals uploaded while the setting was off (or imported out-of-band) retain GPS and are streamed verbatim by the paid-download route"; (2) the settings UI hint text for `strip_gps_on_upload` states the same in en/ko. A retroactive backfill-scrub script is NOT scheduled this cycle — exit criterion recorded in deferred-style note here: re-open as implementation work if any pre-lock-era originals exist in a real deployment (operator-confirmed) or the lock is ever found bypassable.
- **Test:** i18n parity.
- **Acceptance:** no operator can believe the toggle is retroactive.

### Item 5 — TRC-R5C1-15: download-token re-issue path (M)
- **Where:** `apps/web/src/app/api/stripe/webhook/route.ts:346-382, 437-449`; new admin action.
- **Change:** Minimal viable fulfillment safety: an admin server action `reissueDownloadToken(entitlementId)` (origin guard + `isAdmin()`, per the plan-501 item-1 pattern) that mints a fresh single-use token for an existing paid entitlement (old unclaimed token invalidated), surfaced as a button on the admin entitlements/analytics surface. Keep 24 h expiry for minted tokens. The full email pipeline remains future work (documented interim per SEC-R5C1-05 verdict).
- **Test:** Unit test: re-issue invalidates the old hash, inserts a new one bound to the same entitlement; non-admin rejected. `lint:action-origin` covers the new action automatically.
- **Acceptance:** an expired/missed token no longer requires manual DB surgery.

### Item 6 — TRC-R5C1-16: no idempotency key when client IP is unknown (S)
- **Where:** `apps/web/src/app/api/checkout/[imageId]/route.ts:173-178`.
- **Change:** When `getClientIp()` returns `'unknown'`, omit the `idempotencyKey` option entirely (Stripe treats absent key as always-new) — or append a `crypto.randomUUID()` component. Document the TRUST_PROXY dependency in the deployment docs (coordinate with plan 503 doc batch).
- **Test:** Extend plan-501 Item 13's checkout tests: ip `'unknown'` → `sessions.create` called WITHOUT an idempotency key (or with a unique one per call).
- **Acceptance:** two concurrent unknown-IP buyers can never share a checkout session.
- **STATUS: DONE (run-5 cycle-2, commit fc4abdcd via plan-319 item 6)** — unknown-IP requests omit the idempotency key; both branches test-pinned in checkout-route.test.ts.

### Item 7 — TRC-R5C1-17: pin the `affectedRows` claim shape (S)
- **Where:** `apps/web/src/app/api/download/[imageId]/route.ts:394-400`.
- **Change:** Cheapest robust option per the finding: add a unit test pinning the real drizzle/mysql2 UPDATE result shape (`affectedRows` present and numeric) so a driver/ORM upgrade that changes the shape fails the suite instead of silently defaulting open. Keep the documented prefer-customer fallback in code, but route it through a tiny typed helper (`claimedRows(result): number`) with a loud `console.error` when the field is absent.
- **Test:** the pin test + helper unit test.
- **Acceptance:** shape drift is caught at upgrade time, not in production double-downloads.

## B. Pipeline correctness (debugger findings)

### Item 8 — BUG-R5C1-01: fixture-test the 10-bit AVIF reject fallback (M)
- **Where:** `apps/web/src/lib/process-image.ts:1106-1140`.
- **Change:** Per the aggregator's reduced classification (file-backed Sharp pipeline; needs-manual-validation): add a fixture test that mocks `.toFile` to throw a `/bitdepth/` error once, asserting the 8-bit fallback writes a non-empty decodable AVIF and the row records `avif_10bit=false`. If the test exposes any clone-after-failure weirdness, switch the fallback to a fresh `sharp(processingInputPath, …)` construction (strictly safer, negligible cost) in the same commit.
- **Test:** as above (this item IS a test).
- **Acceptance:** the never-exercised-in-CI fallback branch is exercised in CI.

### Item 9 — BUG-R5C1-03: RIFF-walk WebP ICC verification (M)
- **Where:** `apps/web/src/lib/process-image.ts` (`verifyWebpIccInBuffer`).
- **Change:** Replace the 1 KB prefix scan with a sequential RIFF chunk walk (bounded: max 64 KB scanned or first 32 chunks) looking for the `ICCP` FourCC; tolerate odd-sized chunks (RIFF pads to even).
- **Test:** Unit test with a synthetic RIFF buffer placing `ICCP` after a >1 KB dummy chunk → found; buffer without ICCP → not found.
- **Acceptance:** no false "no ICCP" warnings on real high-resolution wide-gamut WebP.

### Item 10 — BUG-R5C1-04: pin TZ stability (S)
- **Where:** `apps/web/src/lib/mysql-datetime.ts:19`; `apps/web/docker-compose.yml`.
- **Change:** (1) Add `TZ` to docker-compose environment with a comment "must never change across deploys — DATETIME rows are serialized in local time" (default `UTC` for new deployments; existing deployment keeps its current zone — implementer must check the prod host's current TZ before choosing the value, and MUST NOT change an existing deployment's zone). (2) Startup assertion: on boot, compare `Intl.DateTimeFormat().resolvedOptions().timeZone` against a first-boot value stored in `admin_settings` (`INSERT IGNORE` pattern); log a prominent ERROR on mismatch (warn-only, not crash — crashing the site over an ops drift is worse than the skew).
- **Test:** Unit test for the assertion helper (mismatch → error log path).
- **Acceptance:** a TZ drift between deploys is loudly visible at startup instead of silently corrupting ordering.

### Item 11 — BUG-R5C1-05: EXIF-rational output for exposures ≥ 1 s (S)
- **Where:** `apps/web/src/lib/process-image.ts` (`decimalToRational`, ~:1319).
- **Change:** Integers ≥ 1 → `"${n}/1"`; non-integers ≥ 1 → nearest simple fraction (e.g. denominator ≤ 10 search, covering 1.3 → 13/10, 1.5 → 3/2, 2.5 → 5/2 — standard long-exposure steps). Keep sub-second behavior unchanged.
- **Test:** Unit cases: 4 → `4/1`, 1.5 → `3/2`, 0.005 → `1/200` (unchanged), 30 → `30/1`.
- **Acceptance:** strict rational parsers accept every emitted ExposureTime.

## C. Architecture & operations

### Item 12 — ARCH-R5C1-02: view-event retention (M) — DEPENDS ON plan-501 Item 7 (indexes)
- **Where:** `apps/web/src/lib/audit.ts:55-73` (pattern); `apps/web/src/app/actions/public.ts:360, 381, 397` (tables).
- **Change:** `purgeOldViewEvents(maxAgeMs)` mirroring `purgeOldAuditLog`: chunked range-deletes (`LIMIT 5000` loops) on `image_views`/`topic_views`/`shared_group_views` using the new `(bot, viewed_at, …)` indexes; wire into the existing hourly purge job; env-gated `VIEW_EVENT_RETENTION_DAYS` (default 365, `0` = keep forever); add to `.env.local.example` (coordinate with plan-503 doc batch).
- **Test:** Unit test with mocked db: rows older than cutoff deleted in chunks; default 365 d; `0` disables.
- **Acceptance:** analytics tables stop growing unboundedly on the 124 G host.

### Item 13 — ARCH-R5C1-03: make geoip-lite deployment-robust (M)
- **Where:** `apps/web/next.config.ts:45`; `apps/web/src/lib/analytics.ts:33-50`.
- **Change:** (1) Add `geoip-lite` to `serverExternalPackages` and its data dir to `outputFileTracingIncludes`. (2) Promote the load-failure `console.debug` to a one-time startup `console.warn` ("country analytics degraded to XX"). (3) Doc note (503 batch): bundled GeoLite2 snapshot is frozen at npm-install time.
- **Test:** Build gate (standalone output must still build); unit test for the warn-once path optional.
- **Acceptance:** a tracing regression surfaces as a visible warning, not silently-empty country analytics.

### Item 14 — ARCH-R5C1-04: journal monotonicity vitest guard (S)
- **Where:** `apps/web/drizzle/meta/_journal.json`; new `apps/web/src/__tests__/migration-journal.test.ts`.
- **Change:** Fixture test asserting (1) `when` strictly increases across journal entries FROM THE CURRENT MAX FORWARD — note the journal already contains a historical idx 6→7 inversion that the reconcile/baseline path has already absorbed, so the assertion must be: all entries with `idx > 7` strictly increase, and every NEW entry (idx > current max at test-write time, i.e. > 20) must exceed the global max `when` of all prior entries; (2) every journal `tag` has a matching `drizzle/NNNN_*.sql` file and vice versa. Add a comment explaining the grandfathered inversion.
- **Test:** this item IS a test.
- **Acceptance:** a hand-written stale `when` (the burned-once failure mode) fails `npm test` at commit time instead of hard-failing the production deploy.

### Item 15 — PERF-R5C1-03: zero-cost embedding hook when disabled (S) — folds TRC-R5C1-01 / PERF-R5C1-11
- **Where:** `apps/web/src/lib/image-queue.ts:405-413` (per-job config read), `:316-334` + `:609-630` (bootstrap re-enqueue without snapshot).
- **Change:** (1) Thread `semanticSearchMode` from the config already resolved in the same job scope (line ~318, as the caption hook does) into the embedding closure — no per-job `getGalleryConfig()`. (2) Bootstrap fold: resolve config ONCE per bootstrap batch and pass the same snapshot (quality, imageSizes, forceSrgbDerivatives, semanticSearchMode) into each re-enqueued job, mirroring the upload path's snapshot pattern.
- **Test:** Unit test on the queue (existing `image-queue.test.ts` harness): processing N jobs with semantic search disabled performs zero `admin_settings` reads from the embedding hook; bootstrap batch resolves config once.
- **Acceptance:** 500-photo bulk upload no longer issues 500 redundant SELECTs; restart-recovery jobs process under one consistent snapshot.

### Item 16 — PERF-R5C1-07: un-block SW cached-image serving (M) — folds COR-R5C1-05
- **Where:** `apps/web/public/sw.template.js:193-237` (`staleWhileRevalidateImage`); reference `apps/web/src/lib/sw-cache.ts`; contract test `__tests__/sw-template-contract.test.ts`; stamped `public/sw.js`.
- **Change:** Restore true SWR: on cache hit, return cached bytes immediately; run the ETag HEAD probe + conditional revalidate in the background (`event.waitUntil`), updating the cache for the NEXT view. Accept the documented one-view staleness on color-setting flips (R10-H3 trade-off reversed with rationale comment). COR-R5C1-05 fold: in the background revalidate, treat a 200 HEAD whose ETag EQUALS the cached one as a 304 (touch LRU meta, skip the full GET); full GET only on differing/absent ETag. Update template + `sw-cache.ts` reference + contract test TOGETHER, then regenerate and commit `public/sw.js` (prebuild stamp) per CLAUDE.md SW rules.
- **Test:** `sw-cache.ts` unit tests for the new decision table (hit→serve-then-revalidate; same-ETag-200→no GET); contract test updated to pin the template against the reference.
- **Acceptance:** warm-cache masonry paint no longer gated on per-image RTT; same-ETag probe costs HEAD only.

## D. Test-surface hardening

### Item 17 — TEST-R5C1-07: `upload-paths.ts` tests (M)
- tmp-dir tests (pattern: `strip-gps-from-original.test.ts`) for `resolveOriginalUploadPath` (primary hit / legacy hit / neither) and `assertNoLegacyPublicOriginalUploads` (clean dir passes; legacy file present → warn vs throw modes). `apps/web/src/lib/upload-paths.ts:58-100`.

### Item 18 — TEST-R5C1-08: `withAdminAuth` wrong-scope branch (S)
- One test: verified token carrying `['lr:read']` against a route requiring `lr:upload` → 401. `apps/web/src/lib/api-auth.ts:67`.

### Item 19 — TEST-R5C1-09: pin advisory-lock names (S)
- Fixture asserting exported constants equal documented strings (`gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`) and `getImageProcessingLockName(42) === 'gallerykit:image-processing:42'`. `apps/web/src/lib/advisory-locks.ts`.

### Item 20 — TEST-R5C1-10: minimum public e2e specs (M)
- Fill `apps/web/e2e/public.spec.ts`: homepage 200 + masonry grid renders; `/p/[id]` loads with title metadata; `/g/[key]` shared group renders; unknown route → 404; (optional) search endpoint rate-limit shape. Use existing `helpers.ts` seeding.

### Item 21 — TEST-R5C1-11: paid-download GET→POST claim e2e (L)
- e2e spec with a seeded entitlement: interstitial GET does NOT claim; first POST claims + streams; second POST → 410. Pin the R4C7 email-scanner-safety contract. If seeding Stripe-free entitlements via direct DB insert in e2e fixtures proves heavy, split into a route-level integration test (mocked auth boundary) this cycle and roll the full e2e to next cycle — record the split in the cycle README.

### Item 22 — TEST-R5C1-13: Stripe webhook behavioral tests (M)
- Mocked Stripe+DB behavioral tests for `checkout.session.completed`: happy path mints entitlement + token (ordering: insert before token log), duplicate delivery idempotent, deleted-image FK path, zero-amount path. Complements (not replaces) the source-scan tests. `apps/web/src/app/api/stripe/webhook/route.ts`.

## E. Designer MED batch (a11y / visual correctness)

All single-file UI changes; run i18n parity + touch-target audit + lint after each.

### Item 23 — DES-R5C1-06 (S): `search.tsx:301-329` — drop the redundant `aria-label` (keep the `sr-only` label as the single name source); render the `z-40` mobile backdrop only `sm:`+ (or remove) since the full-screen `z-50` dialog covers it.
### Item 24 — DES-R5C1-07 (S): `photo-viewer.tsx:592, 659-724` — make the keyboard-shortcut hint visible at all breakpoints (or add `Tooltip` on the info buttons) so `aria-keyshortcuts="I"` has a discoverable visual counterpart.
### Item 25 — DES-R5C1-08 (S): `nav-client.tsx:73-112` — fallback `bg-background/90`; keep `/50` only under `supports-[backdrop-filter]:bg-background/50`.
### Item 26 — DES-R5C1-09 (M): `home-client.tsx:240-261` — derive `containIntrinsicSize` estimate from actual column width (container width / column count) instead of the 300 px constant; optionally rename `colBase` for clarity (cosmetic note from the finding).
### Item 27 — DES-R5C1-10 (S): `lightbox.tsx:613-650` — bump prev/next visible badge to `h-11 w-11` for visual parity with the real (compliant) target.
### Item 28 — DES-R5C1-11 (M): `photo-viewer.tsx:579, 777` — conditionally render the hidden viewer subtree (or gate AnimatePresence on `!showLightbox`) so effects stop while the lightbox is open. Verify no focus-restore regression on lightbox close (the viewer must remount with state intact — keep state in the parent).
### Item 29 — DES-R5C1-12 (M): `info-bottom-sheet.tsx:193-199, 126-132` — add a low-opacity tap-to-dismiss backdrop in peek state (consistent with expanded); ensure it doesn't intercept the photo nav gestures above the sheet beyond dismissal.
### Item 30 — DES-R5C1-13 (S): `photo-viewer.tsx:803-808` — replace `transition-all` with `transition-[opacity,transform]`; avoid width animation against `overflow-hidden` (fade/slide the sidebar instead).
### Item 31 — DES-R5C1-14 (S): `home-client.tsx:363-378` — deepen overlay gradients to `from-black/75` (mobile) / `from-black/70` (hover) or add a text-shadow floor for high-key photos.
### Item 32 — DES-R5C1-15 (S): `globals.css:265-284` — add `@media (prefers-reduced-motion: reduce) { .lightbox-image { animation: none !important; } }` belt-and-suspenders under the existing reduced-motion block (JS gate stays).
### Item 33 — DES-R5C1-16 (S): `lightbox.tsx:550, 570, 594` + siblings — replace hardcoded blue focus outlines with `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.

---

## MED findings NOT in this plan (cross-references)

| Finding | Routed to | Note |
|---|---|---|
| VER-R5C1-01 (settings-hash doc drift) | plan-503 Unit A | doc-only fix; severity MED preserved there |
| ARCH-R5C1-01 (serve-upload ETag inert behind nginx) | plan-503 Unit A | chosen fix is the documented lowest-effort doc correction + source comment |
| DOC-R5C1-02 / DOC-R5C1-03 / DOC-R5C1-04 | plan-503 Unit A | doc/env-example fixes; severity MED preserved |
| PERF-R5C1-05 (revalidate=0) | deferred.md | CLAUDE.md-documented trade-off; quote included there |
| PERF-R5C1-04 (getTopics subquery) | deferred.md | finding itself: "No action required today" |
| PERF-R5C1-06 (prev/next OR predicate) | deferred.md | needs-manual-validation (EXPLAIN on seeded table) |
