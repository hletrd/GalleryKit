# Tracer Review — Run-8 Cycle-2 (review-plan-fix)

**Date:** 2026-06-13
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)
**Angle:** Evidence-driven causal tracing of suspicious/complex flows — competing hypotheses, evidence for/against, uncertainty tracking.
**Working tree:** CLEAN. HEAD = `77867144` (synced with origin/master; the prompt's HEAD list predates the run-7-fix commits — those landed at `0d17a362`..`77867144`).
**Gates measured live this cycle:** `lint:action-origin` / `lint:api-auth` / `lint:public-route-rate-limit` → all exit 0. `npm run typecheck` (app + scripts) → exit 0. Migration tests (49) + backfill honesty tests (25) → all green.

---

## Prior findings (run-7 AGG-R7-01..13) — VERIFIED CLOSED at HEAD

Each verified against the actual code at HEAD, not just the commit message:

| Prior ID | Closure commit | Evidence at HEAD |
|---|---|---|
| AGG-R7-01 (stale pool formula ×3 sites) | `0d17a362` | `admin-backfill-runner.ts:28-37` header + `db/index.ts:16-24` comment + body all state `cap = max(1, floor((LIMIT-RESERVED-1)/2))`, `RESERVED = max(3, ceil(LIMIT/2))` → cap=2 at LIMIT 10. Self-consistent. **CLOSED** |
| AGG-R7-02 (backfill setTimeout leak) | `f11746cd` | `settings-client.tsx:83` timer-id ref + `:122-131` dedicated empty-deps unmount effect (`clearTimeout` all) + `:87,96` `backfillMountedRef` gate on the post-fire setState. **CLOSED** |
| AGG-R7-03 (error-shell no visible heading) | `0d2312cd` | `admin/(protected)/error.tsx:30` visible `<h1 ... text-3xl font-semibold>` (not the faint `/30` glyph). **CLOSED** |
| AGG-R7-04 (remaining aria-describedby) | `61cfd235` | wired across the remaining settings hints. **CLOSED** |
| AGG-R7-05 (AGG-9/AGG-10 regression tests) | `d035de10` | `error-shell` visible-heading + home `title:{absolute}` pinned. **CLOSED** |
| AGG-R7-07 (dropzone aria-disabled honesty) | `35d07f0b` | `upload-dropzone.tsx:412` `aria-disabled` + `:413` explicit `tabIndex:-1` fallback + useDropzone drops root handlers when disabled + `:419` `<input disabled>`. **CLOSED** |
| AGG-R7-08 (doc-drift COLOR_IMPACTING_KEYS count) | `10d77324` | `settings-hash.ts:9-12` docstring + CLAUDE.md:260 both state **9** keys (5 color + 3 quality + `image_sizes`); `COLOR_IMPACTING_KEYS` array at `settings-hash.ts:37+` matches. **CLOSED** |
| AGG-R7-09 (home-OG no on-disk fallback) | `4852bcf5` | `(public)/page.tsx:111` OG now uses base `/uploads/jpeg/${filename_jpeg}` (always exists per atomic-rename contract), not a `_${size}.jpg` sized derivative. Comment `:99-109` documents it. **CLOSED** |
| AGG-10 (home title double-suffix) | `8fc403a2` | `(public)/page.tsx:49` `metadataTitle = { absolute: title }`, applied in both metadata branches (`:66`,`:119`). **CLOSED** |
| AGG-R7-13 (Stripe `async_payment_succeeded`) | — | Still ALREADY-OWNED by plan-316 CRT-R5C1-04 per CLAUDE.md. NOT re-reported (per prompt). |

AGG-R7-06/10/11/12 were doc/test-depth items; the actionable ones above are closed. AGG-R7-11's "monotonicity checks adjacent pairs only" concern is **refuted** — see TRC-1 evidence: `migration-journal.test.ts:79-98` already asserts the global-max-of-all-prior invariant from idx 18 forward (the real `MAX(created_at)` cursor), not just adjacent pairs.

---

## Flows traced this cycle (5 candidate flows from the prompt)

### TRC #1 — Migration journal → migrate.js cursor → applied-set post-condition (NEW finding)

**Observation.** The journal has non-monotonic `when` timestamps (idx 6 = `1778304060000` / 2026-05-09, then idx 7-17 all in the 2025 `1746-1747M` band, then idx 18+ climb back above idx 6). `migrate.js` defends against the burned-once silent-skip with a per-entry hash baseline + a post-condition that throws if any journal hash is absent from `__drizzle_migrations` after `migrate()`.

**Tracing target.** Can a REAL future migration silently skip (its SQL never executed on an existing production DB) while the deploy still reports success?

**Hypotheses.**
- **H1:** Following the documented rule (new `when` strictly > global max) is fully safe — drizzle applies, post-condition passes.
- **H2:** The reconcile+baseline path baselines a new migration's hash BEFORE drizzle runs, so drizzle short-circuits it, and `reconcileLegacySchema` becomes the SOLE applier — meaning a forgotten reconcile entry silently drops the SQL while the post-condition still passes (hash present).
- **H3:** The `migrate-reconcile-coverage` test fully closes H2.

**Evidence — control-flow order (decisive).**
- `migrate.js:759-760`: `prepareLegacyDatabaseIfNeeded(...)` runs BEFORE `runMigrations(...)`.
- `migrate.js:682-695`: on an existing DB, `journalCovered = migrations.every(hash recorded)`. A NEW migration's hash is not yet recorded → `journalCovered = false` → it calls `reconcileLegacySchema` + `baselineAllJournalMigrations`.
- `migrate.js:642-657`: `baselineAllJournalMigrations` INSERTs a `__drizzle_migrations` row for every journal hash not already present — **including the brand-new migration's hash** — without executing its `.sql`.
- `migrate.js:698-719`: `runMigrations` → drizzle `migrate()` then post-condition `missing = expectedMigrations.filter(hash not in recordedHashes)`. Because the new hash was just baselined, drizzle's MySQL migrator (which gates on hash presence) short-circuits the apply, and the post-condition sees the hash present → **passes silently**.

→ **Confirmed: on every existing-DB upgrade that adds a new migration, `reconcileLegacySchema` is the sole apply mechanism; drizzle's `migrate()` is effectively a no-op for new entries, and the post-condition cannot detect a forgotten reconcile entry because the baseline guarantees hash-presence.**

**Evidence — what the safety net DOES catch (H3, partial).**
- `migrate-reconcile-coverage.test.ts:67-82`: source tripwire asserting `migrate.js` contains `CREATE TABLE IF NOT EXISTS <table>` for every schema table AND mentions every column NAME. So a new-COLUMN or new-TABLE migration with a forgotten reconcile entry FAILS this test at commit time (provided CLAUDE.md step 4 — add the column to `schema.ts` — is followed). **This is real and closes the most common case.**
- Live proof the contract is currently honored: migration 0021 (index-only) IS mirrored in `reconcileLegacySchema` via `ensureIndex` (`migrate.js:527-530`).

**Evidence AGAINST full closure (the residual gap).**
- The coverage test checks only column-NAME presence and `CREATE TABLE`. It does NOT verify: indexes, type/default changes (`ALTER ... MODIFY`), `DROP`s, or pure data migrations.
- Therefore a future **index-only / type-change / data migration** whose author forgets to update `reconcileLegacySchema` will: (a) pass `migration-journal.test.ts` (the `when` is monotonic), (b) pass `migrate-reconcile-coverage.test.ts` (no new column name), (c) be baselined-without-applied on every existing DB, (d) pass the migrate.js post-condition. The schema change is **silently dropped** on existing deployments. (A fresh DB is unaffected only if reconcile mirrors it — same dependency.)

**Conclusion.** DEFECT (latent, narrow). The silent-skip failure class that `migrate.js`'s post-condition was built to eliminate still survives for the migration subtypes the column-name coverage test cannot see. The protection is entirely dependent on CLAUDE.md step 3 (update `reconcileLegacySchema`) being followed for non-column migrations, with no test enforcing it.
**Confidence:** High (control flow + tests machine-verified; the gap is in test coverage scope, not in a misread).
**Severity:** LOW (requires a specific migration subtype + a process miss; no current instance — 0021 is correctly mirrored).
**Next-probe / fix options (pick one):**
1. Extend `migrate-reconcile-coverage.test.ts` to also assert every `CREATE INDEX <name>` from each `drizzle/*.sql` appears as an `ensureIndex('<name>'...)` in `migrate.js` (parse the SQL files, not just schema.ts). This catches the index subtype, which is the most likely future non-column migration.
2. OR add an e2e/CI step that diffs a fresh-`init` DB's `information_schema` (indexes + column types) against a sequentially-`migrate()`-applied DB, failing on any divergence — the authoritative end-to-end check the coverage test's own docblock (`:18-19`) admits it cannot perform.

---

### TRC #2 — Backfill run → state mirroring → getBackfillStatus → settings UI (VERIFIED HONEST)

**Observation.** The admin "Re-encode existing photos" runner re-encodes `processed=TRUE` rows behind the `gallerykit_color_pipeline_backfill` advisory lock and surfaces per-run counters to the settings UI.

**Tracing target.** Is the reported `processed`/`errors` count honest in EVERY branch (success, encode-fail, detection-fail, fatal-catch, missing-original, locked)?

**Evidence — per-row tally is 1:1 with the outcome.**
- `admin-backfill-runner.ts:398-400`: `ReprocessResult` is a discriminated union; each `ok:false` carries a distinct `reason`.
- `:622-659`: the queue task increments EXACTLY ONE counter per outcome — `processed++` on `ok:true`; the switch maps `missing-original→skippedMissingOriginal`, `locked→skippedLocked`, `encode-failed→encodeFailures (+ lastError)`, `detection-failed→detectionFailures`; an UNEXPECTED throw → `errors++ (+ lastError)`.
- `:498-513` vs `:530-536`: `ok:true` (detection succeeded → version-bumped UPDATE) is mutually exclusive with `detection-failed` (no version bump; only `was_downscaled`/`avif_10bit` persisted) — a detection failure can NEVER be counted as `processed`. Confirmed by `admin-backfill-runner-detection-failure.test.ts`.
- `:662-698`: all six counters are mirrored to shared `state` continuously (per-task) AND in a final flush. No reconstruction-by-subtraction (the AGG-1 hazard) anywhere.
- `:702-703`: `lastRunHadFailures = encodeFailures>0 || detectionFailures>0 || errors>0` — skips (missing/locked) correctly do NOT count as failures.

**Evidence — status surface mirrors directly.**
- `admin-backfill.ts:103-117`: `getBackfillStatus` returns every counter straight from `readAdminBackfillState()` — no derivation.
- `settings-client.tsx:314-325`: the with-failures banner renders `processed`/`errors`/`encodeFailures`/`detectionFailures` from the mirrored fields; the clean banner renders `processed`. `lastError` shown only when `lastRunHadFailures && lastError` (`:337`).

**Evidence — the fatal-catch path is honest (the AGG-1 fix).**
- `:647-658`: a fatal per-row throw (e.g. the version-bump UPDATE throws) increments `errors` AND sets `state.lastError`, so a fatal-only run no longer reads "N re-encoded, 0 failures" with no message.

**Conclusion.** NO DEFECT. Every branch is honest; the counters cannot conflate a failure/skip with a success. 25 backfill tests pass (`admin-backfill-runner-{fatal-counters,detection-failure,batching,leak,concurrency-cap}.test.ts` + `admin-backfill-status-shape.test.ts` + `backfill-{color-pipeline,detection-failure-contract}.test.ts`).
**Confidence:** High.

---

### TRC #3 — Auth: cookie → proxy.ts guard → server action `requireSameOriginAdmin`/`isAdmin` → DB sink (VERIFIED CLEAN)

**Tracing target.** Any path that reaches a mutating DB sink WITHOUT both an `isAdmin()` AND a `requireSameOriginAdmin()` check?

**Evidence — layered defense intact.**
- `proxy.ts:81-116`: middleware is a presence/format gate only (token len ≥ 100, three non-empty colon segments) → redirect to login; full crypto validation deferred to server actions (defense in depth). `proxy.ts:137-140`: matcher EXCLUDES `/api/*`, so every `/api/admin/*` route must self-gate (enforced by `lint:api-auth`).
- `lib/action-guards.ts:37-44`: `requireSameOriginAdmin` reads headers once, runs strict `hasTrustedSameOrigin`, returns a localized message on failure (caller returns early).

**Evidence — lint gates pass live (the real enforcement).**
- `lint:action-origin` exit 0: every mutating export in `actions/` (+ `db-actions.ts`) stores the `requireSameOriginAdmin()` result and returns early; read-only exports carry `@action-origin-exempt`.
- `lint:api-auth` exit 0: every method export under `api/admin/**` wraps `withAdminAuth`.
- `lint:public-route-rate-limit` exit 0.

**Evidence — exempt actions are genuinely read-only or self-gated.**
- The 10 `@action-origin-exempt` sites are all read-only getters (`tags.ts:18`, `sales.ts:30`, `admin-users.ts:60`, `seo.ts:26`, `settings.ts:18`, `lr-tokens.ts:118`, `admin-backfill.ts:94` — all `isAdmin`-gated reads) OR explicitly-public analytics writes (`public.ts:353/370/391`, intentionally anonymous + rate-limited per architecture).
- `admin-backfill.ts:32-40`: `triggerBackfill` (the one mutating backfill entry) gates on BOTH `isAdmin()` (`:34`) AND `requireSameOriginAdmin()` (`:37`) before `triggerAdminBackfill()`.

**Conclusion.** NO DEFECT. No mutating sink reachable without both checks. The lint-gate heuristic + the exempt-comment discipline hold at HEAD.
**Confidence:** High (3 gates machine-verified + exempt sites hand-audited).

---

### TRC #4 — Stripe webhook → entitlement → download-token validation/claim (VERIFIED CLEAN; ACH gap already-owned)

**Tracing target.** Can an unpaid/forged event mint an entitlement, or can a single-use download token be consumed twice (TOCTOU)?

**Evidence — webhook cannot mint a false entitlement.**
- `stripe/webhook/route.ts:74-86`: mandatory signature verification (400 in constant time on failure, before any DB work).
- `:105-118`: gates on `payment_status === 'paid'` — async/unpaid sessions rejected. `:231-235` tier allowlist; `:299-305` zero-amount reject; `:273-281` + `:390-398` deleted-image (FK) → 200 + manual-refund log, not a retry-storm 500.
- `:320-331` SELECT-by-sessionId idempotency + `:357-382` `onDuplicateKeyUpdate` with `insertId>0` disambiguation (the dup-key loser does NOT mint a token / log line) → no dead-token hazard on Stripe retries.

**Evidence — download token claim is atomic (TOCTOU-safe).**
- `download/[imageId]/route.ts:198-258`: GET is the no-claim interstitial — only SELECTs (`:210`,`:296`-style reads) + builds HTML; genuinely write-free (so auto-HEAD / mail scanners never burn the token, R4C7).
- `:373-385`: the claim is `UPDATE entitlements SET downloadedAt=NOW(), downloadTokenHash=NULL WHERE id=? AND downloadedAt IS NULL` — an atomic compare-and-swap. Two concurrent POSTs both pass `validateDownloadRequest`, but only one gets `affectedRows===1`; the loser gets `affected===0` → 410 "Token already used" (`:396-401`).
- `:338-351`: the file handle is `open()`ed BEFORE the claim, so a vanished file returns 404 with the token INTACT (`:356-360`), not a burned-token 200-with-aborted-body. Handle closed on every post-open failure path (`:387`,`:399`).
- `:170-187`: constant-time `verifyTokenAgainstHash` + expiry + refunded + single-use checks, in order.

**Conclusion.** NO DEFECT. The only entitlement gap is `async_payment_succeeded` (ACH/bank transfer never gets an entitlement row), which is **ALREADY-OWNED by plan-316 CRT-R5C1-04** and documented in CLAUDE.md — not re-reported per prompt.
**Confidence:** High.

---

### TRC #5 — Image upload → Sharp → DB → public serving → ETag invalidation; color/HDR admin-only enforcement (VERIFIED CLEAN)

**Tracing target.** Does any wide-gamut/HDR audit field leak into a public API response, and does flipping a color/quality/size setting actually invalidate cached derivatives?

**Evidence — color/HDR fields are admin-only by triple-layer construction.**
- `data.ts:416`: `PrivacySensitiveKeys` union includes all admin-only color/HDR fields (`color_pipeline_decision`, `is_hdr`, `has_gain_map`, `transfer_function`, `matrix_coefficients`, `bit_depth`, `color_space`, `icc_profile_name`, `pipeline_version`, `was_downscaled`) + GPS/filename PII.
- `data.ts:417-420`: compile-time `_privacyGuard` = `Extract<keyof publicSelectFields, PrivacySensitiveKeys>` must be `never` — a TS error fires if any sensitive key appears in `publicSelectFields`. `:429-432` `_mapPrivacyGuard` extends this to the map-select shape (only latitude/longitude allowed beyond public).
- `data.ts:241`: `color_primaries` is correctly PUBLIC (not omitted) — matches CLAUDE.md (color_primaries = public; the rest admin-only).
- `privacy-fields.test.ts:83-93`: SYMMETRIC runtime contract — the admin-only key set must equal `SENSITIVE_KEYS` exactly; a new admin field that's neither omitted publicly nor added to `SENSITIVE_KEYS` fails the test. Closes the "forgot to omit" drift.

**Evidence — ETag invalidation is honest across both serving paths.**
- `settings-hash.ts:37+`: `COLOR_IMPACTING_KEYS` = 9 keys (5 color + 3 quality + `image_sizes`); the 8-char hash is embedded in the serve-upload ETag, so flipping ANY of them changes the variant ETag (CLAUDE.md:260, AGG-R7-08-corrected).
- Static path (the production path for existing `public/uploads/` files per R4C6 ARCH-R4C6-06): invalidation rides the mtime+size ETag — a backfill re-encode rewrites the file in place (`Cache-Control: ...must-revalidate`, deliberately NOT `immutable`), changing both. The backfill runner persists the same DB column set as a fresh upload (`admin-backfill-runner.ts:498-535`).

**Conclusion.** NO DEFECT. No color/HDR or GPS field leaks publicly (compile-time guard + symmetric test). Settings→ETag invalidation is sound on both the serve-upload and static paths.
**Confidence:** High.

---

## Summary table — OPEN / NEW this cycle

| ID | Finding | Flow | Severity | Confidence | Disposition |
|---|---|---|---|---|---|
| **TRC-1** | Migration silent-skip survives for **non-column** migration subtypes (index-only, type/default change, `DROP`, data migration). On every existing-DB upgrade `reconcileLegacySchema` is the SOLE applier (baseline runs before drizzle `migrate()`, so drizzle short-circuits the new hash); the migrate.js post-condition only checks hash-presence (which baseline guarantees), and `migrate-reconcile-coverage.test.ts` only enforces column-NAME + `CREATE TABLE` presence. A forgotten reconcile entry for a non-column migration is dropped silently with a green deploy. (Refines AGG-R7-11; refutes its "adjacent-pairs-only" claim — the global-max cursor IS pinned.) | TRC #5 (migration) | LOW (latent; 0021 is correctly mirrored, no current instance) | High | NEW — actionable: extend coverage test to assert `CREATE INDEX` ↔ `ensureIndex`, OR add a fresh-vs-sequential `information_schema` diff in CI |

All other traced flows (backfill honesty, auth, Stripe/download, color-field privacy, ETag invalidation) are **VERIFIED CLEAN** with High confidence. All run-7 actionable findings (AGG-R7-01..09 + AGG-10) verified CLOSED at HEAD.

## VERIFIED-CLEAN (stress-tested this cycle, no action)
- Backfill counter honesty: 1:1 outcome→counter mapping, no reconstruction, fatal-catch populates `lastError`, detection-fail never bumps version. (25 tests)
- Auth: 3 security lint gates exit 0; no mutating sink without both `isAdmin` + `requireSameOriginAdmin`; 10 exempt sites are read-only getters or explicit public analytics.
- Stripe webhook: signature-gated, paid-only, idempotent (SELECT + dup-key insertId disambiguation), deleted-image → 200 not retry-storm.
- Download token: GET write-free interstitial; POST claim is atomic CAS (`UPDATE ... WHERE downloadedAt IS NULL`), file opened before claim, handle closed on all post-open paths.
- Color/HDR privacy: compile-time `_privacyGuard`/`_mapPrivacyGuard` (Extract→never) + symmetric `privacy-fields.test.ts` contract; `color_primaries` public, all HDR/decision/bit_depth/icc admin-only.
- ETag invalidation: 9 COLOR_IMPACTING_KEYS in serve-upload ETag hash; mtime+size ETag on static path; backfill re-encode rewrites in place.
- Migration journal monotonicity: `migration-journal.test.ts:79-98` pins the global-max-of-all-prior cursor invariant from idx 18 (not adjacent pairs).

## Uncertainty / next-probe (open)
- TRC-1 has no current production instance (0021 indexes are mirrored). The probe that would collapse remaining uncertainty about real-world exposure: grep the next-added `drizzle/*.sql` for `CREATE INDEX`/`ALTER`/`DROP`/`UPDATE`/`INSERT` statements at PR time and confirm a matching `reconcileLegacySchema` mutation exists — exactly what option 1 of the fix automates.
