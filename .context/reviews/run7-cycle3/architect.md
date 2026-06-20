# Architect Review — Run-7 Cycle-3 (HEAD `c6eff919`, master)

**Date:** 2026-06-19
**Agent:** architect (architectural/design risks, coupling, layering, invariant integrity at the documented single-web-instance / single-writer scale)
**HEAD verified:** `c6eff919` (build(sw): refresh SW_VERSION stamp 6bb5a49a-p7).
**Delta from last-reviewed HEAD (`1cdbb883` → `c6eff919`):** the two cycle-2 fixes (`ae5e82cb` NCLX transfer code 5 → gamma28; `eff5d8d6` browser GPS-toggle source-contract test) + cycle-2 review docs + SW_VERSION stamp. **No new application-architecture surface changed in this delta.** (Verified via `git diff --stat 1cdbb883 c6eff919`.)

## Summary

The architecture is **SOUND-WITH-NOTES** at the documented single-writer scale. I built and verified an inventory across all 10 in-scope surfaces; every documented invariant I checked actually holds in code. The config-resolution chain fails CLOSED (catch → documented defaults; `semantic_search_mode='production'` heals to `'disabled'` without the env opt-in). The advisory-lock namespace is fully centralized through `advisory-locks.ts` with zero literal drift across all 6 acquire/release call-site families. The privacy guards are compiler-enforced and the `data-timeline.ts` mirror REUSES the canonical `PrivacySensitiveKeys` type (no hand-copy). The Stripe webhook/entitlement lifecycle is real and consumed (`refunded`/`expiresAt` gated at the download route). The SW offline-fallback never caches an admin-rendered page and errs toward not-caching on a merely-present (unvalidated) cookie.

**One genuinely-new observation (LOW):** `COLOR_IMPACTING_KEYS` (settings-hash.ts) is a hand-maintained subset of `GALLERY_SETTING_KEYS` with NO compile-time guard and NO documented "adding a new color-impacting setting" checklist — a future byte-impacting setting could be added to the encoder path without updating the ETag list. It is **complete and correct today** (I audited all 9 vs the encoder-consumed fields), and the consequence is **self-mitigated** by the mandatory-backfill workflow (which rewrites file mtimes and thus invalidates caches on BOTH serving paths regardless of the hash). Recommended disposition: **DEFER** with a cheap compiler-guard hardening opportunity and an exit criterion.

All of ARCH-R7C2-01 (charge.refunded), OBS-R7C2-02/03/05/06/07, INFO-R7C2-08/09, R7C1-CR-01 were re-verified UNCHANGED with no new evidence — correctly remaining deferred, NOT re-filed.

## Analysis (inventory + invariant verification)

### 1. Config resolution chain — `gallery-config-shared.ts` → `gallery-config.ts` → `image-queue.ts` → `process-image.ts`
- **Layering is clean.** `gallery-config-shared.ts` is pure (no DB import, client-safe): constants, the `GALLERY_SETTING_KEYS` tuple, `VALIDATORS`, `getSettingDefaults`. `gallery-config.ts` is the server-only resolver that imports `@/db` and re-exports the shared surface. The shared module is the single canonical source of the key set and defaults.
- **Fails CLOSED.** `_getGalleryConfig()` wraps the DB read in try/catch; on any failure it returns the full DEFAULTS object (`gallery-config.ts:189-219`). Every per-key resolver re-validates the stored string via `isValidSettingValue` and falls back to the typed default — an invalid/corrupt DB value never reaches the encoder. `IMAGE_PIPELINE_VERSION = 7` is DEFINED at `gallery-config-shared.ts:21` (matches CLAUDE.md).
- **`semantic_search_mode` heal-to-disabled invariant holds** (`gallery-config.ts:144-146`): a stored `'production'` returns `'disabled'` unless `process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] === 'true'`. Operator-only activation path preserved; admin UI exposure is Disabled/Stub only. Fail-closed.
- **Consumption verified** (`image-queue.ts:320-350`): `getGalleryConfig()` resolves once per job, then `imageSizes`, `forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma` (+ quality + max-source-pixels) are passed to `processImageFormats`. Matches the documented chain exactly.

### 2. Advisory-lock namespace — `advisory-locks.ts`
- **Fully centralized.** Every acquire/release across the repo references the registry constants (`LOCK_DB_RESTORE`, `LOCK_UPLOAD_PROCESSING_CONTRACT`, `LOCK_TOPIC_ROUTE_SEGMENTS`, `LOCK_ADMIN_DELETE`, `LOCK_COLOR_PIPELINE_BACKFILL`, `getImageProcessingLockName`). I grepped all `GET_LOCK`/`RELEASE_LOCK` sites: `image-queue.ts`, `admin-backfill-runner.ts`, `admin-users.ts`, `upload-processing-contract-lock.ts`, `db-actions.ts`, `topics.ts`, `scripts/backfill-color-pipeline.ts`. Zero inline literals; no drift.
- `image-queue.ts:184` `getProcessingLockName(jobId)` is a thin wrapper over `getImageProcessingLockName(jobId)` — no divergence.
- All locks acquired on dedicated pool connections, released in `finally` / `.catch(()=>{})`, auto-released on connection close (crash-safe). Server-scoped-not-DB-scoped caveat documented in the module header.
- INFO-R7C2-09 (the `:` separator on the image-processing lock vs `_` elsewhere) confirmed UNCHANGED; cosmetic, no collision. Already deferred — not re-filed.

### 3. Data-access layer + React `cache()` + privacy guards — `data.ts`
- **`cache()` count = 10** (9 `…Cached` exports + `getSeoSettings = cache(_getSeoSettings)` at `data.ts:1662`). Matches CLAUDE.md.
- **Privacy guard is fail-closed-by-derivation + compiler-enforced.** `publicSelectFields` is destructured-by-omission FROM `adminSelectFields` (data.ts:326-353). The compile-time `_SensitiveKeysInPublic = Extract<keyof publicSelectFields, PrivacySensitiveKeys>` guard (data.ts:418-420) fires a TS error if any sensitive key reaches the public shape. `publicMapSelectFields` auto-extends from `Exclude<PrivacySensitiveKeys,'latitude'|'longitude'>` (data.ts:429-432) — adding a new member to `PrivacySensitiveKeys` automatically guards the map path without a manual edit. `data-timeline.ts:14,65` IMPORTS and REUSES the same `PrivacySensitiveKeys` union for its own `_TimelineSensitive` guard — no hand-copy drift.
- **Documented design tension (NOT a new finding):** a NEW admin column added to `adminSelectFields` that is neither in the omit-destructure NOR in `PrivacySensitiveKeys` would flow into `publicSelectFields` uncaught. This is the documented process-enforced (not compiler-enforced) contract — CLAUDE.md migration runbook step 5 mandates adding admin-only columns to `_PrivacySensitiveKeys` + the test fixture. Known, documented, enforced by checklist + `privacy-fields.test.ts`.

### 4. Settings-hash / ETag invalidation coupling — `settings-hash.ts` (see Finding ARCH-R7C3-01)
- `COLOR_IMPACTING_KEYS` (9 keys, settings-hash.ts:41-53) is a hand-maintained subset of `GALLERY_SETTING_KEYS`. I audited completeness: all 9 encoder-consumed byte-impacting fields are present; the non-byte-impacting settings (`allow_hdr_ingest` gates ingest-reject not derivative bytes, `force_show_color_chips` client-only, `strip_gps_on_upload` original-only, slideshow/license/alt-text/semantic) are correctly excluded. **Complete and correct today.**
- `settings-hash.test.ts` pins each of the 9 keys behaviorally ("differs when X changes") + "ignores keys outside the canonical set" — but does NOT assert the list is in-sync with the encoder-consumed config fields, so a future drift would not fail a test.

### 5. Storage abstraction dead-code — `lib/storage/{index,local,types}.ts`
- **Honest dead code.** The ONLY consumer is its own test (`__tests__/storage-local.test.ts`). No production import path. Matches CLAUDE.md's "Storage Backend (Not Yet Integrated)" note. Not a finding.

### 6. Color pipeline layering — `color-detection.ts` / `color-primaries.ts` / `color-pipeline-decisions.ts` / `process-image.ts`
- Client-safe vs server split is honored (decisions/primaries are client-safe; detection/encoder are server). Cycle-1/cycle-2 spec fixes (YCgCo code 8, gamma28 code 5) verified present in the delta. No layering violation.

### 7. Rate-limit Maps process-locality — `rate-limit.ts` / `auth-rate-limit.ts` / `bounded-map.ts`
- Process-local fast-path buckets via `createResetAtBoundedMap`/`createWindowBoundedMap` (bounded, insertion-order oldest-first eviction, hard-capped — `bounded-map.ts:115-125`). Login bucket has a DB backup (`rateLimitBuckets` table). Matches the documented topology (AGG-D5/ARCH-07: OG/checkout/share/search/semantic buckets per-process; login backed by DB). Documented scale-out caveat intact. Not a finding.

### 8. Migration / schema-drift runbook — `scripts/migrate.js`
- Fail-loud drift guard intact: `getAllJournalMigrations` (one record per entry, hash = SHA256 of SQL), `prepareLegacyDatabaseIfNeeded` checks `migrations.every(m => haveHashes.has(m.hash))` (not MAX(created_at)), `runMigrations` post-condition throws `Drizzle silently skipped N migration(s)` if any journal hash is missing post-migrate (migrate.js:702-718). Matches the documented permanent fix.
- OBS-R7C2-02 (reconcile `position` backfill not re-runnable after partial crash) and INFO-R7C2-08 (orphan `0014_drop_reactions.sql`) re-verified unchanged; already deferred — not re-filed.

### 9. SW / PWA offline-fallback design — `public/sw.template.js`
- **Never caches admin content.** `networkFirstHtml` caches a 200 GET HTML ONLY when `x-gk-admin-render !== '1'` (sw.template.js:279), and the cache is served EXCLUSIVELY in the `catch` (network-unreachable) branch (sw.template.js:294-309). Admin routes always bypass (`isAdminRoute`). The 24h TTL + 50-entry cap are honored.
- **`x-gk-admin-render` errs safe:** proxy.ts:128-129 sets the header whenever the `admin_session` cookie is merely PRESENT (full crypto validation deferred to server actions). A forged/invalid cookie therefore causes the SW to SKIP caching — never to cache an admin page as public. The page renders public (token verify fails) but is conservatively not cached. No privilege leak; not a finding.
- Image SWR HEAD-revalidation bounded by `AbortSignal.timeout(300ms)` (sw.template.js:38,239). Matches doc.

### 10. Entitlement / webhook lifecycle — `api/stripe/webhook/route.ts` + `api/download/[imageId]/route.ts`
- Webhook handles ONLY `checkout.session.completed`; everything else falls through to `received: true` (route.ts:453). Idempotency (SELECT-by-sessionId + ON DUPLICATE KEY + insertId>0 disambiguation), deleted-image FK (200 + manual-refund log), zero-amount reject, tier allowlist, email shape/length/lowercase — all verified present and consistent.
- **Lifecycle is consumed:** the download route gates on `expiresAt > NOW() && refunded = false` (route.ts:80,130,175) and clears `downloadTokenHash` on claim. The `refunded` field is real, not vestigial.
- `charge.refunded` / `async_payment_succeeded` gaps = ARCH-R7C2-01 + plan-316, already deferred (Dashboard-only refund self-closes within 24h token expiry; card-only checkout pin closes async operationally). Re-verified UNCHANGED — NOT re-filed.

## Root Cause (of the one new observation)

The settings-hash maintains a SECOND enumeration of byte-impacting settings that must stay manually in sync with the encoder's config consumption. Unlike the privacy surface — where `data-timeline.ts` and `publicMapSelectFields` both DERIVE from the single canonical `PrivacySensitiveKeys` type via `Extract`/`Exclude` (so a new sensitive key auto-propagates) — the ETag-invalidation surface has no such linkage. This is the same "fix one sibling, miss the next" class the repo has repeatedly hit, but on a low-blast-radius surface and self-mitigated by the mandatory backfill.

## Findings

### ARCH-R7C3-01 [LOW, conf MEDIUM] — `COLOR_IMPACTING_KEYS` is an un-guarded hand-maintained subset; future byte-impacting settings can drift out of ETag invalidation
- **Where:** `apps/web/src/lib/settings-hash.ts:41-53` (`COLOR_IMPACTING_KEYS`) vs `apps/web/src/lib/gallery-config-shared.ts:25-71` (`GALLERY_SETTING_KEYS`) and the encoder-consumed fields at `apps/web/src/lib/image-queue.ts:326-331`. Test `apps/web/src/__tests__/settings-hash.test.ts` pins the 9 keys behaviorally but not the in-sync invariant.
- **Architectural risk:** maintainability / silent-drift coupling. There is no compile-time guard that `COLOR_IMPACTING_KEYS ⊆ GALLERY_SETTING_KEYS`, and no guard/checklist that a setting which alters derivative BYTES is added to `COLOR_IMPACTING_KEYS`. The list is complete and correct TODAY (audited all 9 against the encoder), but it is a parallel enumeration that a future change can desync.
- **Concrete scenario where it bites:** a contributor adds `image_quality_heic` (or any new encoder-quality/chroma/size knob) to `GALLERY_SETTING_KEYS`, the resolver, and `processImageFormats`, but forgets `COLOR_IMPACTING_KEYS`. The `settings-hash.test.ts` stays green (it only tests the existing 9). On the `serve-upload.ts` path, flipping the new setting no longer forces the 304→200 revalidation between the setting-change and the next backfill — already-cached clients keep stale-byte derivatives during that window.
- **Why LOW / self-mitigated (the honest bound):** (a) the STATIC serving path (the documented majority of traffic, CRT-D1) never relied on the settings-hash — it invalidates via the mtime+size ETag; (b) CLAUDE.md mandates a backfill re-encode after ANY color/quality/size setting change for the bytes to actually change, and the re-encode uses atomic rename over the base file (`process-image.ts:1227-1252`), changing mtime+size and thus invalidating caches on BOTH paths regardless of the settings-hash. So a missed key only loses the *convenience* serve-upload invalidation in the transient pre-backfill window — the real invalidation (backfill) still fires. No correctness/data-loss/privacy impact.
- **Recommended disposition:** **DEFER** with a cheap hardening opportunity. The robust fix mirrors the privacy pattern: add a compile-time guard `type _ColorKeysAreSettingKeys = COLOR_IMPACTING_KEYS[number] extends GallerySettingKey ? true : ...` (catches a typo'd/removed key) AND a one-line "Adding a new color-impacting setting" checklist note in CLAUDE.md (parity with the migration-column checklist) instructing contributors to update `COLOR_IMPACTING_KEYS`. Neither changes runtime behavior.
- **Exit criterion:** (a) a new encoder-byte-impacting admin setting is added to `GALLERY_SETTING_KEYS`/`processImageFormats` (then it MUST be added to `COLOR_IMPACTING_KEYS` in the same change, and the subset guard + checklist should land with it); OR (b) a stale-derivative-on-serve-upload-path incident is reported in the pre-backfill window; OR (c) a general config-coupling hardening pass is scheduled.
- **Confidence:** MEDIUM (the drift mechanism is real and uncaught; the bound to LOW depends on the mandatory-backfill workflow being followed, which the CRT-D1 gotcha already documents as required).

## Trade-offs (ARCH-R7C3-01 disposition)

| Option | Pros | Cons |
|--------|------|------|
| A — Defer (recommended) | Zero runtime risk; current membership verified correct; self-mitigated by mandatory backfill | The convenience-invalidation gap remains latent until a contributor adds a new key |
| B — Add compile-time subset guard + CLAUDE.md checklist now | Mirrors the proven `PrivacySensitiveKeys` pattern; catches typo/removal at `tsc`; cheap (~5 lines + a doc note) | Cannot fully auto-detect "this NEW setting is byte-impacting" (semantic, not type-derivable) — still needs the human checklist; minor add to an already-converged cycle |
| C — Derive `COLOR_IMPACTING_KEYS` from a per-setting `byteImpacting: boolean` flag on a richer config registry | Single source of truth; no parallel enumeration | Large refactor of the config registry shape; disproportionate to a LOW self-mitigated gap at single-writer scale |

Option B is the defensible hardening if the cycle wants a cheap belt; otherwise A is correct.

## Re-verified deferred items (UNCHANGED, no new evidence — NOT re-filed)

- ARCH-R7C2-01 (charge.refunded webhook gap) — webhook still only handles `checkout.session.completed`; falls through to `received:true`. Bundle with plan-316. Deferred.
- OBS-R7C2-02 (reconcile position backfill), OBS-R7C2-03 (non-transactional restore), OBS-R7C2-05 (pool not .end()'d), OBS-R7C2-06 (unbounded bootstrap retry), OBS-R7C2-07 (updateTopic rename no FOR UPDATE) — all re-confirmed as documented-design/operator-runbook-mitigated. Deferred.
- INFO-R7C2-08 (orphan `0014_drop_reactions.sql`), INFO-R7C2-09 (`:` lock-name separator) — unchanged housekeeping. Deferred.
- R7C1-CR-01 (restore-maintenance process-local) — unchanged single-writer constraint. Deferred.
- MED-R7C2-01 (histogram clip denominator) — REFUTED; not re-litigated.

## References
- `apps/web/src/lib/gallery-config.ts:106-223` — config resolver, fail-closed catch, semantic heal-to-disabled.
- `apps/web/src/lib/gallery-config-shared.ts:21,25-71,156-206` — canonical key set, validators, IMAGE_PIPELINE_VERSION.
- `apps/web/src/lib/settings-hash.ts:41-53` — `COLOR_IMPACTING_KEYS` (the un-guarded subset).
- `apps/web/src/__tests__/settings-hash.test.ts:48-100` — behavioral key pins (no in-sync assertion).
- `apps/web/src/lib/advisory-locks.ts:1-45` — centralized lock registry.
- `apps/web/src/lib/image-queue.ts:184-222,320-350,695-718` — lock wrapper, config consumption, hourly GC wiring.
- `apps/web/src/lib/admin-backfill-runner.ts:105-142` — backfill connection-budget cap (verified cap=2 at pool=10, NaN-guarded).
- `apps/web/src/lib/data.ts:326-432,1662` — privacy-guard derivation + compile-time guards + 10th cache().
- `apps/web/src/lib/data-timeline.ts:14,65` — reuse of canonical `PrivacySensitiveKeys`.
- `apps/web/src/app/api/stripe/webhook/route.ts:88,453` — single-event handler + fall-through.
- `apps/web/src/app/api/download/[imageId]/route.ts:80,130,175` — entitlement refunded/expiresAt consumption.
- `apps/web/public/sw.template.js:279,294-309` — offline-only HTML cache + admin-render exclusion.
- `apps/web/src/proxy.ts:128-129,140` — `x-gk-admin-render` header set (present-cookie, errs safe).
- `apps/web/scripts/migrate.js:687,702-718` — hash-based drift detection + fail-loud post-condition.

## Verdict

**SOUND-WITH-NOTES.** All 10 in-scope architectural surfaces hold their documented invariants at the single-web-instance / single-writer scale. The config chain fails closed, the lock namespace is centralized with no drift, privacy is compiler-enforced + derived, the webhook/entitlement lifecycle is consumed, the SW never leaks admin content. ONE new LOW observation (ARCH-R7C3-01, un-guarded `COLOR_IMPACTING_KEYS` subset) — real coupling/drift mechanism but complete-and-correct today and self-mitigated by the mandatory-backfill workflow; recommended DEFER with an optional cheap compiler-guard hardening. No CONCERNS-level (correctness/data-loss/privacy/security/layering-violation) finding.
