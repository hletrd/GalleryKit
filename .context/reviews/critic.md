# Critic Review — Run-6 Cycle-6

- **HEAD:** `4eb83aab`
- **Agent:** critic
- **Date:** 2026-06-17
- **Angle:** multi-perspective critique of the whole change surface + load-bearing whole-system invariants
- **Mode:** THOROUGH (no escalation to ADVERSARIAL — zero CRITICAL/MAJOR findings surfaced)

---

## VERDICT: ACCEPT

**Zero findings.** All seven challenged whole-system invariants were independently verified from code (not comments/tests) and each HOLDS at HEAD. The only code delta since the cycle-5 baseline (`2f603716`) is a single test file addition — there is no new production code, schema, server action, or API route to critique. An honest 0/0 result is the correct outcome for a system this converged; I did not manufacture marginal findings.

I came within one step of logging a CRITICAL privacy leak based on a failing test, and the Realist Check + a direct runtime probe correctly disqualified it (details under Invariant 1 and the Realist Check section). That near-miss is reported transparently rather than buried.

---

## Change surface since cycle-5 baseline

`git diff --stat 2f603716 4eb83aab` over `apps/web/src/**`, `apps/web/scripts/**`, `public/sw*.js`:

```
apps/web/src/__tests__/client-server-only-boundary.test.ts | 191 ++++++++++++++++++++- (+183/-8)
```

That is the entire production-relevant delta — a pure test addition (cycle-5 fix AGG-C5-01: test coverage for the client→server-only guard). No schema change, no new mutating action, no new route, no lib change. This is fully consistent with the 11→45→14→5→1→(this cycle) convergence.

---

## Invariant verification (each verified from CODE)

### 1. Privacy compile-guards (`_PrivacySensitiveKeys`, `_SensitiveKeysInPublic`) — HOLDS

- `apps/web/src/lib/data.ts:416-420` — `PrivacySensitiveKeys` union has 21 members; `_SensitiveKeysInPublic = Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys>` resolves to `never`, so `_privacyGuard` (line 419) compiles. The map variant guard `_mapPrivacyGuard` (line 431) covers `publicMapSelectFields` minus lat/lng.
- `publicSelectFields` (line 325-357) and `publicMapSelectFields` (line 366-393) are built by **destructuring every sensitive key out** of `adminSelectFields` before spreading the remainder — separate object references, so an add to the admin set does not auto-leak.
- **Schema cross-check** (`apps/web/src/db/schema.ts:19-119`): every admin-only/PII column on `images` (latitude, longitude, filename_original, user_filename, processed, original_format, original_file_size, color_pipeline_decision, is_hdr, has_gain_map, was_downscaled, transfer_function, matrix_coefficients, bit_depth, uploaded_by, processing_error, failed_at, color_space, icc_profile_name, pipeline_version) is present in the `PrivacySensitiveKeys` union. No new sensitive schema column exists that is missing from the guard.
- **Runtime probe (authoritative):** loaded `data.ts` via tsx — `publicSelectFieldKeys.includes('latitude') === false`, `includes('longitude') === false`, 29 public keys, none sensitive.
- `getMapImages` (line 1576-1606) is the only public lat/lng path; gated by `INNER JOIN topics.map_visible=true` + `isNotNull(lat/lng)` + a runtime per-row `topic_map_visible` assertion (line 1597-1603).
- **Test triple-guard:** `privacy-fields.test.ts` SENSITIVE_KEYS (21 entries) matches the union; the symmetric-contract test (line 83-90) asserts `admin − public === SENSITIVE_KEYS` (catches drift in both directions); timeline mirror pinned (line 101-114).

> **Near-miss disclosed:** my first test run (warm vitest cache) showed `privacy-fields.test.ts` FAILING with `expected [...] to not include 'latitude'`. Treated as a candidate CRITICAL privacy leak. Investigation: (a) the runtime key probe shows NO latitude in the public set; (b) `typecheck:app` passes clean, so the compile-time `_privacyGuard` is NOT firing; (c) re-running the SAME test(s) with `--no-cache` passes 8/8 alone and 13/13 paired in BOTH orderings. The failure was a stale-vitest-cache artifact on a warm cache and does not reproduce. Production code is correct. Not a HEAD-verified defect → not logged as a finding (see Open Questions for a non-scored note on the cache sensitivity).

### 2. Action-origin + api-auth gates — HOLDS

- `npm run lint:action-origin` → "All mutating server actions enforce same-origin provenance." Every mutating action returns early on `requireSameOriginAdmin()` (verified by the scanner over `app/actions/**` + `db-actions.ts`).
- `npm run lint:api-auth` → OK for both `api/admin/**` routes (`db/download/route.ts`, `lr/upload/route.ts`).
- **Glob-completeness skeptic check:** enumerated ALL of `src/app/api/**` — only those two routes live under `api/admin/`. The rest (`checkout`, `download`, `stripe/webhook`, `og/*`, `search/*`, `health`, `live`) are intentional public/payment surfaces, correctly scanned by `lint:public-route-rate-limit` instead (all OK). No admin route escapes the auth glob.
- `withAdminAuth` (`src/lib/api-auth.ts:49-121`) now enforces same-origin centrally (line 92-99) in addition to `isAdmin()` (line 100), closing the historical gap where a route with only the wrapper lacked CSRF defense. Token path (line 63-89) is the documented PAT bypass for non-browser clients (Lightroom), scope-gated.

### 3. Migration journal-hash post-condition (`apps/web/scripts/migrate.js`) — HOLDS

- `runMigrations` (line 698-719) calls drizzle `migrate()` then **re-reads `__drizzle_migrations`** and throws `Drizzle silently skipped N migration(s)` if any journal hash is missing. This is the loud-fail that catches the non-monotonic-`when` silent-skip class.
- `getAllJournalMigrations` (line 144-160) hashes each SQL file's content (SHA-256), one record per journal entry — the post-condition compares against these, not a max-row baseline.
- `prepareLegacyDatabaseIfNeeded` (line 659-696) routes fresh DBs and incomplete-log DBs through `reconcileLegacySchema` + `baselineAllJournalMigrations` (per-entry rows), so the cursor lands correctly and drizzle's own hash check short-circuits cleanly.
- `reconcileLegacySchema` (line 247-613) mirrors all color/HDR + gain-map columns (line 364-380), satisfying the runbook contract.

### 4. Advisory-lock no-deadlock (6 named locks) — HOLDS

- `src/lib/advisory-locks.ts` defines all 6: `LOCK_DB_RESTORE`, `LOCK_UPLOAD_PROCESSING_CONTRACT`, `LOCK_TOPIC_ROUTE_SEGMENTS`, `LOCK_ADMIN_DELETE`, `getImageProcessingLockName(jobId)`, `LOCK_COLOR_PIPELINE_BACKFILL`.
- Each acquire site (`image-queue.ts:199`, `admin-backfill-runner.ts:310/347`, `upload-processing-contract-lock.ts:28`, `admin-users.ts:219`, `topics.ts:67`, `db-actions.ts:290`) takes the lock on a **dedicated connection** and releases in a `finally`/on connection close.
- **Lock-ordering skeptic check:** no call site holds two named advisory locks simultaneously — each operation acquires at most one. The backfill runner (admin-backfill-runner.ts) acquires the backfill lock and, per-image, the image-processing lock, but releases the per-image lock before the next image and these are nested by design with no inverse-order acquirer elsewhere. No deadlock cycle exists. Server-scoped-name caveat is documented (single GalleryKit per MySQL server).

### 5. ETag / cache consistency (settings-hash → ETag, both serve paths) — HOLDS

- `settings-hash.ts:41-53` — `COLOR_IMPACTING_KEYS` = 9 keys (5 color + 3 quality + 1 size). `buildHashFromConfig` (line 76-89) computes from resolved GalleryConfig (validated values, not raw DB strings — R8-H1).
- `serve-upload.ts:215` folds the 8-char hash into `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"`; 304 path (line 223-235) and 200 path (line 252) both emit `public, max-age=3600, must-revalidate`. Serving-hash resolution is debounced behind a module-scoped 5s TTL + SWR (line 46-83) so derivative floods don't issue one SELECT per file.
- Static-path invalidation rides mtime+size (backfill re-encode rewrites the file). Both layers share the `max-age=3600, must-revalidate` policy per CLAUDE.md. Coherent.

### 6. HDR honesty (is_hdr/transfer_function admin-only until WI-09) — HOLDS (doubly)

- **Data layer:** `/p/[id]` public page uses `getImageCached` → `getImage` → `publicSelectFields`, which omits `transfer_function`, `is_hdr`, `color_pipeline_decision`, `matrix_coefficients`, `bit_depth`, `pipeline_version`, `icc_profile_name`. A non-admin visitor's `image` carries these as `undefined`.
- **Component layer:** `color-details-section.tsx:169,179,236` derives `isHdr` from `transfer_function` (undefined→false publicly) AND gates HDR label/badge on `isAdmin && isHdr`. `lightbox-color-pip.tsx:139,149` gates the `hdr-badge` on `isAdmin && isHdr`. The `isAdmin` prop flows from the server `isAdmin()` check (`p/[id]/page.tsx:157,292`), never hard-coded.
- `copyColorMetadata` (color-details-section.tsx:254-264) reads admin-only fields, but the button only renders inside the accordion and the values are `undefined` for public visitors. Defense-in-depth holds.

### 7. Blur-data-url contract (producer + write + read) — HOLDS (symmetric)

- **Producer:** `process-image.ts:895` — `blurDataUrl = assertBlurDataUrl(candidate)`.
- **Write:** `app/actions/images.ts:352` — `blur_data_url: assertBlurDataUrl(data.blurDataUrl)`.
- **Read:** `components/photo-viewer.tsx:196` — `if (!isSafeBlurDataUrl(value)) return undefined`.
- `blur-data-url.ts` enforces 3 allowed `data:image/{jpeg,png,webp};base64,` prefixes + 4096-char cap (`MAX_BLUR_DATA_URL_LENGTH`). All three legs route through the same contract — symmetric, with the producer-side wrap closing the source-of-truth gap.

---

## Multi-perspective notes

- **Executor:** The only delta is a test file; an implementer has nothing new to build. No ambiguity.
- **Stakeholder:** Convergence is real — the system is at steady state on these invariants. Continuing to spend review cycles hunting for invariant violations has diminishing returns; the next valuable review would be a *fresh-angle* pass (e.g., a feature-behavior audit, not an invariant re-litigation), not another invariant sweep.
- **Skeptic:** I actively tried to break the privacy guard via the failing test and could not — the failure was a tooling artifact, not a code defect. The strongest argument for a finding (a red privacy test) dissolved under runtime + typecheck + clean-cache evidence.

---

## Hard-guard compliance

- Did NOT propose `import 'server-only'` on `@/db` (cycle-5 proved it breaks tsx backfill).
- Did NOT propose activating CLIP/semantic-search.
- Did NOT re-report any cycle 1-5 item; verified everything against HEAD `4eb83aab`.

---

## Realist Check (applied to the one anomaly)

The transient privacy-test failure was pressure-tested:
1. **Realistic worst case:** a developer on a warm vitest cache sees a red privacy test, is confused; on re-cache it goes green. No production exposure — runtime keys are provably correct.
2. **Mitigating factors:** `--no-cache` (CI fresh-checkout default) passes 13/13; the compile-time `_privacyGuard`/`_SensitiveKeysInPublic` Extract independently catches a real leak and is NOT firing; a real leak would ALSO red the typecheck.
3. **Detection:** immediate and redundant (test + typecheck).
4. **Hunting-mode bias acknowledged:** I nearly inflated a tooling artifact into a CRITICAL. The direct runtime probe was the disqualifying evidence.

Outcome: not a HEAD-reproducible defect (does not reproduce with `--no-cache` in any order) → no finding, per the cycle's no-fabrication directive.

---

## Evidence of green at HEAD

- `npm run lint:action-origin` — PASS
- `npm run lint:api-auth` — PASS
- `npm run lint:public-route-rate-limit` — PASS
- `npm run typecheck:app` — PASS (route types generated; privacy compile-guard not firing)
- `vitest run privacy-fields.test.ts client-server-only-boundary.test.ts --no-cache` — 13/13 PASS (both orderings)
- Runtime probe — `publicSelectFieldKeys` contains no lat/lng (29 safe keys)

---

## Open Questions (unscored)

- **Vitest warm-cache sensitivity (NOT a code finding):** `privacy-fields.test.ts` produced a false FAILURE on a warm vitest cache in this session but passes deterministically with `--no-cache` in every ordering. The key arrays are `Object.freeze`d at module load and cannot mutate, so this is a vitest module-cache transform-cache artifact, not application state. It is below the bar for a finding (not reproducible clean, no production impact, CI uses fresh checkouts). Flagged only because a privacy test that can flake red/green is a test-reliability smell worth a glance by the test-engineer lane if cache flakes recur — but there is no code change to make here and no invariant is at risk.
