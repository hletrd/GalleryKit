# Plan 501 — CRIT + HIGH (Run-5 Cycle 1)

**Source:** `.context/reviews/_aggregate.md` (run-5 cycle 1, 2026-06-11)
**Scope:** All CRIT and HIGH merged findings verified real and actionable. 17 work items covering 18 finding IDs (COR-R5C1-04 folded into item 1). DES-R5C1-02 was verified as a non-issue during planning — see `plan-317-run5-cycle1-deferred.md` § verified-non-issues.
**Ordering:** dependency-first — auth/security one-liners → data-loss → CRIT fail-closed → public-leak fixes → migrations → test hardening → a11y. Each item is one fine-grained GPG-signed commit (`git commit -S`), gitmoji + Conventional Commits, deploy per iteration per CLAUDE.md.

**Planner verification note:** every item below was sanity-checked against the working tree on 2026-06-11 (cited lines read; greps run). All confirmed real except DES-R5C1-02 (moved to verified-non-issues with evidence).

---

## Item 1 — TRC-R5C1-18: add `isAdmin()` to `retryFailedImage` (HIGH, security)

- **Finding:** TRC-R5C1-18 (aggregate #3) — verified: `apps/web/src/app/actions/images.ts` `retryFailedImage` calls only `requireSameOriginAdmin()`; no `isAdmin()` anywhere in the body (planner re-read lines 1040-1060).
- **File:** `apps/web/src/app/actions/images.ts:1041-1048`
- **Change:** Immediately after the origin-error early return, add the file-standard auth check:
  ```ts
  if (!(await isAdmin())) return { error: t('unauthorized') };
  ```
  (`retryFailedImage` currently has no `t` — mirror `bulkUpdateImages` at :870: `const t = await getTranslations('serverActions');` first. Keep order origin → isAdmin, matching the documented pattern comment at :871.)
- **Test:** Extend the action auth coverage: new unit test (mock `@/lib/auth` `isAdmin` → false, mock `requireSameOriginAdmin` → null) asserting `retryFailedImage(1)` returns `{ error: … }` and performs zero DB calls. Pattern: existing actions auth tests.
- **Follow-on (same item, separate commit OK):** extend `scripts/check-action-origin` (the action-origin lint) — or add a companion scanner — to require an `isAdmin()`/`getCurrentUser()` call (or an explicit exempt tag) in every mutating action body, so this class can't recur. If the scanner extension is too large for this cycle, file it in the plan-502 notes; the direct fix ships regardless.
- **Gate impact:** `lint:action-origin` unchanged (already passes); new unit test must pass; typecheck.
- **Acceptance:** same-origin request without a valid admin session can no longer clear `processing_error`/re-enqueue; unit test red→green proves it.

## Item 2 — BUG-R5C1-02: unlink leaked original when `detectColorSignals` throws (HIGH, data-loss/disk-leak)

- **Finding:** BUG-R5C1-02 (aggregate #4) — verified: original written at `process-image.ts:782-790`; `detectColorSignals` called at :867 with no try/catch between; caller cleanup at `images.ts:458` guards on `savedOriginalFilename`, assigned only on success (`images.ts:279`).
- **Files:** `apps/web/src/lib/process-image.ts` (`saveOriginalAndGetMetadata`, ~:790-900)
- **Change:** Wrap everything after the successful original write (metadata read, ICC extraction, `detectColorSignals`, decision resolution) in try/catch; on catch, `await fs.unlink(originalPath).catch(() => {})` then re-throw. This keeps the caller contract unchanged (no out-param API change) and covers all throw sites in the window, not just `detectColorSignals`.
- **Test:** Unit test in `apps/web/src/__tests__/` (pattern: existing process-image fixture tests): mock/force `detectColorSignals` to throw on a real tiny fixture upload; assert the original file no longer exists on disk after the rejected promise settles.
- **Gate impact:** unit suite; typecheck.
- **Acceptance:** forced detection throw leaves zero files in the original-upload dir; upload action still returns its normal localized error.

## Item 3 — CRT-R5C1-01: fail-closed `semantic_search_mode='production'` (CRIT) — folds COR-R5C1-04 (LOW)

- **Finding:** CRT-R5C1-01 (aggregate #1) — verified: `gallery-config-shared.ts:168` accepts `'production'`; `settings-client.tsx:540` renders `<SelectItem value="production">`; route's only gate is the mode check.
- **Files:**
  - `apps/web/src/lib/gallery-config-shared.ts:168` — reject `'production'` while the stub is the only encoder: `semantic_search_mode: (v) => v === 'disabled' || v === 'stub'` with a comment citing CRT-R5C1-01 and the capability-probe re-enable criterion (real ONNX encoder module + model files present).
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:540` — remove the `production` SelectItem (or render it `disabled` with the existing amber warning text moved into the disabled item's description). Keep the i18n keys for WI-future; do not delete message strings.
  - `apps/web/src/app/api/search/semantic/route.ts:161-190` — defense in depth: treat `'production'` as 503 on a *capability* check (stub-encoder module present ⇒ 503 regardless of stored config), so a stale DB value from before this fix cannot serve random results.
  - **COR-R5C1-04 fold (route gate order):** while editing the route, reorder so the rate-limit pre-increment happens before the `getGalleryConfig()` read on the disabled path (or document why config-first is acceptable). Keep `lint:public-route-rate-limit` satisfied — the helper call must remain a documented pre-increment name.
- **Test:** (a) config validator test: `'production'` rejected, `'disabled'`/`'stub'` accepted; (b) route test: stored `'production'` value (simulated stale DB) returns 503, never calls `embedTextStub` for ranking output; (c) existing semantic route tests stay green.
- **Gate impact:** unit suite, `lint:public-route-rate-limit`, typecheck. i18n parity check unaffected (keys retained).
- **Acceptance:** no admin-reachable path stores or serves `'production'`; stale stored value fails closed at the route.

## Item 4 — CRT-R5C1-02: `[AUTO] ` stub prefix must never reach public titles (HIGH)

- **Finding:** CRT-R5C1-02 (aggregate #7) — verified: `caption-generator.ts:27` defines `ALT_TEXT_STUB_PREFIX = '[AUTO] '`; `photo-title.ts:104-106` returns `image.alt_text_suggested.trim()` verbatim in the title fallback chain.
- **Files:** `apps/web/src/lib/photo-title.ts:104-106`; `apps/web/src/lib/caption-generator.ts` (export the prefix constant for reuse).
- **Change:** In the `photo-title.ts` fallback branch, strip the stub prefix before use: import the exported `ALT_TEXT_STUB_PREFIX` and `replace(/^\[AUTO\]\s*/, '')` (constant-derived, not a second hardcoded literal). If the stripped remainder is empty/whitespace, fall through to the generic fallback instead. The raw `alt_text_suggested` stays available for `alt=""` attributes (alt-text consumers are unchanged — only the *visible-title* fallback path strips).
- **Test:** Unit test on `getPhotoDisplayTitle`-path helpers: image with `title=null`, `tag_names=null`, `alt_text_suggested='[AUTO] Photo taken with Canon EOS R5'` yields a display title without `[AUTO]`; `'[AUTO] Photo'` → falls to generic fallback (post-strip remainder "Photo" is fine to keep — decide in-test and pin the choice); assert the literal `[AUTO]` can never appear in the returned title for any input (property-style loop over stub outputs).
- **Gate impact:** unit suite; typecheck.
- **Acceptance:** no public visible title, `<title>`, or OG text can contain `[AUTO]`; alt attributes still receive the suggestion.

## Item 5 — CRT-R5C1-03: remove dead `HDR_FEATURE_ENABLED` scaffolding (HIGH, doc-integrity)

- **Finding:** CRT-R5C1-03 (aggregate #8) — verified by grep: sole reference to `HDR_FEATURE_ENABLED`/`NEXT_PUBLIC_HDR_FEATURE_FLAG` is the definition at `apps/web/src/lib/feature-flags.ts:10`; `hdr-filenames.ts` is imported only by its own test (`__tests__/hdr-filenames.test.ts`).
- **Files:** `apps/web/src/lib/feature-flags.ts`; `apps/web/src/lib/hdr-filenames.ts`; `apps/web/src/__tests__/hdr-filenames.test.ts`; CLAUDE.md Key Files row for `hdr-filenames.ts`; coordinate with DOC-R5C1-04 (plan 503) so `NEXT_PUBLIC_HDR_FEATURE_FLAG` is NOT documented as functional.
- **Change (preferred, deletion-first per finding):** delete `HDR_FEATURE_ENABLED` from `feature-flags.ts` (keep the file if other flags exist; delete the file if it becomes empty). For `hdr-filenames.ts` + its test: keep the helper (CLAUDE.md explicitly documents it as "reserved for WI-09" — that reservation is honest), but add a loud header banner `// RESERVED — NOT WIRED. No production importer until WI-09 ships.` Alternatively, if the implementer judges deletion safer, deleting helper+test is acceptable — but then remove the CLAUDE.md Key Files row in the same commit. Either way CLAUDE.md's HDR-ingest section must state the honesty invariant is enforced by the `_PrivacySensitiveKeys` guard, not by any feature flag.
  - **Deletion safety:** file deletions here are dead-code removals verified by grep; per the repo's destructive-action rule, the implementing pass should re-run the consumer grep immediately before deleting.
- **Test:** grep-based source-contract test optional; primary gate is typecheck + full unit suite green after removal.
- **Gate impact:** typecheck, unit suite (hdr-filenames test updated/removed in same commit).
- **Acceptance:** zero references to a non-functional HDR env flag in source or docs; WI-09 implementer cannot mistake scaffolding for a live gate.

## Item 6 — PERF-R5C1-01: batch the in-app backfill candidate fetch (HIGH, OOM risk)

- **Finding:** PERF-R5C1-01 (aggregate #5) — verified: `admin-backfill-runner.ts:158-168` `fetchCandidates()` has `ORDER BY id ASC` and no LIMIT; `runBackfill` enqueues every row up front.
- **File:** `apps/web/src/lib/admin-backfill-runner.ts:158-168, 276-332`
- **Change:** Mirror the sidecar script's keyset pagination (`scripts/backfill-color-pipeline.ts:199`, `BATCH_SIZE = 100`): `WHERE processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < ${IMAGE_PIPELINE_VERSION}) AND id > :cursor ORDER BY id ASC LIMIT 100`; process/drain each batch through the existing PQueue before fetching the next; advance cursor to the batch's max id. Keep `fetchCandidateCount()` for the up-front disclosure UI. Preserve the existing advisory-lock window (`gallerykit_color_pipeline_backfill`) around the whole loop and the existing per-row column-persistence contract (locked by `__tests__/backfill-color-pipeline.test.ts` / `admin-backfill-runner-detection-failure.test.ts` — do not regress those).
- **Test:** Unit test with mocked `db.execute`: seed >2 batches of candidate ids; assert (a) every candidate is processed exactly once, (b) no query returns more than BATCH_SIZE rows, (c) cursor advances strictly. Existing backfill contract tests must stay green.
- **Gate impact:** unit suite; typecheck.
- **Acceptance:** memory residency is O(batch) not O(gallery); 100k-photo simulation (mocked) never materializes >100 candidate rows at once.

## Item 7 — PERF-R5C1-02: analytics breakdown indexes (HIGH) — migration 0021

- **Finding:** PERF-R5C1-02 (aggregate #6) — verified: `schema.ts:231` — `image_views` has only `idx_image_views_image_id_viewed_at (image_id, viewed_at)`; `analytics-data.ts:93-114/169-190` filter `bot, viewed_at` and group by `country_code`/`referrer_host`.
- **Files:** new `apps/web/drizzle/0021_analytics_breakdown_indexes.sql`; `apps/web/drizzle/meta/_journal.json`; `apps/web/scripts/migrate.js` (`reconcileLegacySchema`); `apps/web/src/db/schema.ts`.
- **Change (follow the CLAUDE.md Migration runbook exactly):**
  1. `0021_analytics_breakdown_indexes.sql`: `CREATE INDEX idx_image_views_bot_viewed_country ON image_views (bot, viewed_at, country_code); CREATE INDEX idx_image_views_bot_viewed_referrer ON image_views (bot, viewed_at, referrer_host);` — and the equivalent pair on `topic_views` + `shared_group_views` if `analytics-data.ts` runs the same breakdowns there (check during implementation; the cited queries read `image_views`).
  2. Journal entry idx 21, `when` strictly > 1779494400001 (use `Date.now()` at commit time — current max verified by planner).
  3. Mirror the indexes idempotently in `reconcileLegacySchema`.
  4. Add the index definitions to `schema.ts` table builders.
- **Test:** ARCH-R5C1-04's journal-monotonicity vitest (plan 502 item 14) will pin the journal; for this item, the existing migrate post-condition plus `npm run db:push` dry parity suffices. Optional: extend any schema-shape test.
- **Gate impact:** deploy-time migration assertion (must not trip); unit suite; typecheck.
- **Acceptance:** `EXPLAIN` on `getCountryBreakdown`/`getReferrerBreakdown` (dev DB) shows index range use, no full scan/filesort. This item must land BEFORE plan-502 item ARCH-R5C1-02 (retention deletes use these indexes).

## Item 8 — TEST-R5C1-01: `verifySessionToken` unit tests (CRIT, coverage)

- **Finding:** TEST-R5C1-01 (aggregate #2, merges TEST-R5C1-12) — verified: `session.test.ts` covers only `hashSessionToken` + token format.
- **Files:** `apps/web/src/__tests__/session-verify.test.ts` (new; or extend `session.test.ts` with a mocked-DB describe block)
- **Change:** Unit tests with mocked `@/db` (pattern: `admin-tokens.test.ts`) covering `apps/web/src/lib/session.ts:94-145`: (1) wrong HMAC signature → null; (2) token age > 24 h → null; (3) negative age (future timestamp, clock-skew guard) → null; (4) malformed part count (2 parts, 4 parts, empty) → null; (5) signature length mismatch (timingSafeEqual pre-check) → null without throwing; (6) valid signature but no DB row → null; (7) expired DB row → row deleted + null; (8) valid fresh token → session object returned. Use a stubbed `SESSION_SECRET` env so signatures are computable in-test.
- **Gate impact:** unit suite (+8 tests); typecheck (`tsconfig.typecheck.json` includes `__tests__` — run `npm run typecheck`).
- **Acceptance:** mutation-style spot check: inverting the age comparison or removing the negative-age guard fails at least one test.

## Item 9 — TEST-R5C1-03: `getSessionSecret` production-guard tests (HIGH, coverage)

- **Finding:** TEST-R5C1-03 (aggregate #10) — verified: no test exercises `session.ts:27-33`.
- **Files:** same new test file as Item 8 (one commit per item still fine — separate describe).
- **Change:** `vi.stubEnv` + `vi.resetModules` tests: (1) `NODE_ENV=production` + missing `SESSION_SECRET` → throws; (2) production + short (<32 char) secret → throws; (3) production + valid 64-hex secret → returns it without touching DB (assert mocked DB not called); (4) dev/test without env → falls through to the mocked DB-stored secret path.
- **Gate impact:** unit suite; typecheck.
- **Acceptance:** flipping the `!== 'production'` condition fails test (1).

## Item 10 — TEST-R5C1-02: `BoundedMap` unit tests (HIGH, coverage)

- **Finding:** TEST-R5C1-02 (aggregate #9) — verified: no dedicated test imports `bounded-map` (grep hits are unrelated usages).
- **Files:** `apps/web/src/__tests__/bounded-map.test.ts` (new) for `apps/web/src/lib/bounded-map.ts:1-142`.
- **Change:** Pure unit tests (fake timers): (1) expiry pruning removes only expired entries; (2) prune return-value semantics; (3) hard-cap eviction order — `maxKeys=3`, insert 5, assert the 2 oldest evicted, newest 3 retained; (4) `createResetAtBoundedMap` expiry honors `resetAt`; (5) `createWindowBoundedMap` window expiry; (6) overwrite of existing key does not double-count toward cap.
- **Gate impact:** unit suite; typecheck.
- **Acceptance:** off-by-one mutation in the excess calculation fails test (3).

## Item 11 — TEST-R5C1-04: `isValidTokenShape` boundary tests (HIGH, coverage)

- **Finding:** TEST-R5C1-04 (aggregate #11) — verified: no test references `isValidTokenShape`.
- **Files:** `apps/web/src/__tests__/download-token-shape.test.ts` (new; or extend `stripe-download-tokens.test.ts`) for `apps/web/src/lib/download-tokens.ts:43-52`.
- **Change:** Boundary tests: null/undefined/non-string → false; correct prefix with 42-char and 44-char bodies → false (exact-length pin); wrong prefix → false; non-base64url chars (`+`, `/`, `=`, space) → false; exact valid shape → true; a token from the real generator → true.
- **Gate impact:** unit suite; typecheck.
- **Acceptance:** `{43}` → `{43,}` regex mutation fails the 44-char test.

## Item 12 — TEST-R5C1-05: pin Argon2id work factors (HIGH, coverage)

- **Finding:** TEST-R5C1-05 (aggregate #12, merges TEST-R5C1-16) — `password-hashing.ts:1-18` constants unpinned; `admin-users.test.ts` mocks `argon2.hash` without asserting options.
- **Files:** `apps/web/src/__tests__/password-hashing-policy.test.ts` (new); `apps/web/src/__tests__/admin-users.test.ts:45-47, 119, 131, 147`.
- **Change:** (1) Policy test importing `PASSWORD_HASH_OPTIONS`: `type === argon2id`, `memoryCost >= 65_536`, `timeCost >= 3`, `parallelism >= 1` (assert exact current values AND minimums — exact pin catches accidental weakening, minimum text documents intent). (2) In `admin-users.test.ts`, strengthen the existing mocks: `expect(argon2HashMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ memoryCost: 65_536, timeCost: 3 }))` on each create/update path, so dropping the options argument at the call site fails.
- **Gate impact:** unit suite; typecheck.
- **Acceptance:** removing `PASSWORD_HASH_OPTIONS` from the `argon2.hash` call site fails admin-users tests; weakening a constant fails the policy test.

## Item 13 — TEST-R5C1-06: checkout route branch tests (HIGH, coverage)

- **Finding:** TEST-R5C1-06 (aggregate #13) — only `checkout-db-error-rollback.test.ts` exists (verified by ls).
- **Files:** `apps/web/src/__tests__/checkout-route.test.ts` (new), following the existing rollback test's mocked Stripe + DB pattern, against `apps/web/src/app/api/checkout/[imageId]/route.ts:47-66, 68-218`.
- **Change:** One test per branch: (1) `getTierPriceCents` strict parse — `"500abc"` → rejected (route 4xx, NOT a $5.00 charge); (2) `priceCents <= 0` → 4xx; (3) `!image.processed` → 4xx; (4) happy path → `{ url }` returned, Stripe `sessions.create` called with idempotency key matching `checkout-{id}-{ip}-{minute}` shape; (5) each 4xx branch rolls back its rate-limit pre-increment (assert the rollback helper called); (6) unknown image → 404 branch.
- **Gate impact:** unit suite; typecheck.
- **Acceptance:** replacing the strict `/^\d+$/` parse with `parseInt` fails test (1).

## Item 14 — DES-R5C1-01: accessible name for upload dropzone (HIGH, a11y)

- **Finding:** DES-R5C1-01 (aggregate #14) — verified: `upload-dropzone.tsx:396-403` root div from `getRootProps()` has focus styling but no `aria-label`/role.
- **Files:** `apps/web/src/components/upload-dropzone.tsx:396-403`; `apps/web/messages/en.json` + `ko.json` (new key `upload.dropzoneLabel`).
- **Change:** Add `role="button"`, `aria-label={t('upload.dropzoneLabel')}` and `aria-disabled={uploading || !hasTopics}` to the root props (spread AFTER `{...getRootProps()}` so they aren't clobbered). en: "Upload photos: drop files here or press Enter to browse"; ko equivalent. Maintain i18n parity (en/ko key-count check).
- **Test:** i18n parity test already enforces key parity; optional RTL snapshot not required. Touch-target audit unaffected.
- **Gate impact:** unit suite (i18n parity), lint, typecheck.
- **Acceptance:** dropzone announces a meaningful name + disabled state to AT.

## Item 15 — DES-R5C1-03: keep lightbox position counter announceable (HIGH, a11y) — coordinate DES-R5C1-22 (plan 503)

- **Finding:** DES-R5C1-03 (aggregate #16) — verified: `lightbox.tsx:666-674` counter `role="status" aria-live="polite"` receives `{...controlVisibilityProps}` = `{ tabIndex:-1, 'aria-hidden':true }` when controls hide (`:368-371`).
- **File:** `apps/web/src/components/lightbox.tsx:666-674`
- **Change:** Remove `{...controlVisibilityProps}` from the status div. Visually sync with controls via opacity classes driven by `controlsVisible` (`opacity-0 transition-opacity` when hidden) WITHOUT `aria-hidden`/`visibility:hidden`, so the live region keeps announcing during keyboard navigation. (Plan 503 DES-R5C1-22 adds the translated context label to the same node — implementer may land both in one commit and mark 503's entry done.)
- **Test:** Component test (if testing-library harness exists for lightbox) or source-contract assertion: the status div must not receive `aria-hidden`. Minimum: extend an existing lightbox test to assert the counter element's props.
- **Gate impact:** unit suite, lint, typecheck.
- **Acceptance:** with controls auto-hidden, arrowing photos still produces live announcements.

## Item 16 — DES-R5C1-04: stop focus-trapping the bottom-sheet drag handle (HIGH, a11y)

- **Finding:** DES-R5C1-04 (aggregate #17) — verified: `info-bottom-sheet.tsx:149-153` focuses `dragHandleRef` on EVERY `isOpen && sheetState !== 'expanded'` change.
- **File:** `apps/web/src/components/info-bottom-sheet.tsx:59-65, 144-153`
- **Change:** (1) Move initial focus to the close button (or the sheet container with `tabIndex={-1}`) only on the closed→open transition (reuse the existing `prevIsOpenRef` guard), not on every intermediate `sheetState` change. (2) Make the drag-handle `aria-label` state-aware: `t('viewer.expandSheet')` when peek/collapsed, `t('viewer.collapseSheet')` when expanded — add both i18n keys (en/ko).
- **Test:** i18n parity; component-level assertion if harness exists (focus lands once per open).
- **Gate impact:** unit suite (i18n parity), lint, typecheck.
- **Acceptance:** open → swipe peek↔half → focus does not jump back to the handle; handle announces its action, not a generic label.

## Item 17 — DES-R5C1-05: hide masonry P3 badge from AT (HIGH, a11y)

- **Finding:** DES-R5C1-05 (aggregate #18) — verified: `home-client.tsx:352-361` badge `<span role="img" aria-label={…}>` inside the card link.
- **File:** `apps/web/src/components/home-client.tsx:354-360`
- **Change:** Replace `role="img"` + `aria-label` with `aria-hidden="true"` on the badge span (information remains available in the photo viewer's ColorDetailsSection, which is the canonical audit surface).
- **Test:** None strictly required; optional source assertion in an existing home-client test.
- **Gate impact:** lint, typecheck. (`min-h-11 min-w-11` stays — touch-target audit unaffected.)
- **Acceptance:** wide-gamut card links announce only the photo title; no compound "P3 wide-gamut photo" suffix.

---

## Sequencing summary

| Order | Item | Finding(s) | Why this position |
|---|---|---|---|
| 1 | Item 1 | TRC-R5C1-18 | unauthenticated-mutation hole; one-liner |
| 2 | Item 2 | BUG-R5C1-02 | disk-leak on the upload hot path |
| 3 | Item 3 | CRT-R5C1-01 + COR-R5C1-04 | CRIT fail-open; route edits batched once |
| 4 | Item 4 | CRT-R5C1-02 | public/SEO leak |
| 5 | Item 5 | CRT-R5C1-03 | dead scaffolding before docs (503) touch the same env var |
| 6 | Item 6 | PERF-R5C1-01 | live-process OOM risk |
| 7 | Item 7 | PERF-R5C1-02 | migration; BLOCKS plan-502 ARCH-R5C1-02 |
| 8-13 | Items 8-13 | TEST-R5C1-01/03/02/04/05/06 | security-test hardening; independent, parallelizable |
| 14-17 | Items 14-17 | DES-R5C1-01/03/04/05 | a11y; independent |

**Gates to run before each commit:** `npm test --workspace=apps/web`, `npm run typecheck --workspace=apps/web`, `npm run lint --workspace=apps/web`, plus `lint:api-auth` / `lint:action-origin` / `lint:public-route-rate-limit` when touching their surfaces. Deploy per iteration per CLAUDE.md.
