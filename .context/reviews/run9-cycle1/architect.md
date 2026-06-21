# Architect Review — Run-9 Cycle-1 (HEAD `d3858cfc`)

**Date:** 2026-06-21
**Agent:** architect (Opus, READ-ONLY)
**Lane:** whole-repo architectural & design risk — coupling, layering, separation of concerns, invariant enforcement, shared-state hazards, single-writer topology, schema/migration drift, data-access privacy derivation, color/HDR pipeline layering, ETag/settings-hash contract, advisory-lock scoping, migrate.js reconcile-as-authoritative-schema-executor.

## NEW FINDINGS: 0 (0 CRIT / 0 HIGH / 0 MED / 0 LOW)

A deep, independent, code-first sweep finds **zero** new architectural risks at any schedulable severity. HEAD `d3858cfc` is **byte-identical** to the twice-converged `f63af3b9` (`git diff --stat f63af3b9 HEAD` = docs-only: 12 review files under `.context/reviews/run8-cycle2/`, 0 source/schema/config/test changes). Every named architectural invariant is intact and proven by the blocking typecheck gate. The codebase remains **CONVERGED**.

This is the expected baseline outcome — a 0-finding architecture pass on a byte-identical converged tree is correct, not a failure to look hard. I deliberately re-walked seams the prior architect passes touched only lightly (og-photo-fetch, restore-maintenance, clip-paths, view-retention GC bounds, the per-job lock-name wrapper unification, the semantic-route hand-written select, the data-timeline privacy mirror) specifically to avoid rubber-stamping; all are sound. I did NOT manufacture a finding to break the streak.

---

## Method (independent, code-first — not doc-trusting)

- `git diff --stat f63af3b9 HEAD` → docs-only, confirming byte-identity with the converged tree.
- Built a full file inventory: 90 `lib/*.ts`, 13 server-action files, 8 API routes, 26 scripts.
- Read in full (not grep-skimmed): `settings-hash.ts`, `gallery-config-shared.ts`, `gallery-config.ts`, `og-photo-fetch.ts`, `restore-maintenance.ts`, `clip-paths.ts`, `advisory-locks.ts`, `upload-processing-contract-lock.ts`, `view-retention.ts`, `api/search/semantic/route.ts`, plus the `data.ts:200-470` privacy-derivation + guard block and `image-queue.ts:670-787` (GC arming + restore quiesce/resume).
- Cross-referenced **every `images` schema column** (from `schema.ts`) against `adminSelectFields` / `publicSelectFields` to detect drift — none.
- Verified migration **dual-path** coverage for the newest columns (`avif_10bit`, `was_downscaled`, `color_primaries`, `original_format/size`, `uploaded_by`) in BOTH `drizzle/*.sql` AND `reconcileLegacySchema`.
- Enumerated **every** `GET_LOCK`/`RELEASE_LOCK` call site to confirm acquire/release symmetry, dedicated connections, and that the queue-worker and backfill-runner per-image lock names UNIFY through one generator.
- Ran the load-bearing gate: `npm run typecheck --workspace=apps/web` → **PASS** (proves all compile-time guards resolve to `true`).

---

## Per-seam verification table

| # | Seam | Verdict | Evidence (file:line) |
|---|------|---------|----------------------|
| 1 | Config-resolution chain fail-closed; CLIP double-gate end-to-end | **SOUND** | `gallery-config.ts:103-207` (try→DEFAULTS catch, all keys validated-with-fallback); `:141-143` heals stored `production`→`disabled` w/o `SEMANTIC_SEARCH_ALLOW_PRODUCTION` |
| 2 | settings-hash `COLOR_IMPACTING_KEYS = 9`, dual key-list symmetry | **SOUND** | `settings-hash.ts:42-54` (9 keys), `:63-66` (`_colorKeysAreSettingKeys` guard), `:89-102` (`buildHashFromConfig` enumerates the SAME 9 — cross-checked field-by-field) |
| 3 | data.ts PII derivation + 4 compile-time guards + schema cross-check | **SOUND** | `data.ts:208-276` (admin full), `:323-355` (public by omission, separate ref), `:414-417/427-429/445-447` (privacy/map/large-payload guards); `data-timeline.ts:62-65` (sibling mirror); every schema column accounted for |
| 4 | Migration dual-path: newest columns in `.sql` AND reconcile; journal-`when` monotonic for new entries | **SOUND** | `migrate.js:401` (`avif_10bit`), `:367-396` (others), `0020_avif_10bit.sql`; `_journal.json` idx-23 `when=1782000000000` > prior max `1781687094232` |
| 5 | 6 advisory locks: acquire/release symmetry, dedicated conn, per-job name unified | **SOUND** | `advisory-locks.ts:19-44`; `image-queue.ts:184-185` wraps the canonical `getImageProcessingLockName` so worker + backfill agree; `upload-processing-contract-lock.ts:44-56` idempotent release |
| 6 | Single-writer topology: restore quiesce ordering, GC armed once, shutdown | **SOUND** | `image-queue.ts:712-722` (`if (!state.gcInterval)` arm-once), `:733-774` (`pause→clear→onIdle` deadlock-free quiesce) |
| 7 | CLIP production-gating: double-gate + model_version isolation + offline-path math | **SOUND** | `semantic/route.ts:220-235` (re-reads resolved mode, fails closed; `activeModelVersion` partitions stub vs prod rows); `clip-paths.ts:60-98` (absolute/relative + 40-hex-SHA + 2-segment guards) |
| 8 | Unbounded-growth GC bounds (view-events / audit) | **SOUND** | `view-retention.ts:39-47` (no future cutoff on negative/non-finite), `:37/70-79` (`MAX_BATCHES_PER_TABLE=200` × 5000 cap) |
| 9 | Color/HDR pipeline layering (shared→config→queue→encoder), per-format isolation | **SOUND** | `IMAGE_PIPELINE_VERSION=7` defined once `gallery-config-shared.ts:21`, re-exported `process-image.ts:315`; no source diff vs converged tree |

---

## Seams re-walked that prior architect passes touched lightly (all SOUND — recorded so the next pass knows they were checked)

- **`og-photo-fetch.ts` (R24-M1).** Ascending sized-derivative fetch with per-attempt `AbortSignal.timeout(10s)`, dual byte-cap (Content-Length pre-check + post-buffer), null-on-miss so the caller degrades to the site-default OG. Self-fetches the non-locale `/uploads/jpeg/...` path. No unbounded buffering, no missing timeout. Sound.
- **`restore-maintenance.ts`.** `Symbol.for`-keyed process-global flag (single-writer-correct), idempotent begin/end, `cleanupOriginalIfRestoreMaintenanceBegan` gates the on-disk original cleanup behind the active flag. Sound; matches the documented process-local-state inventory.
- **Per-job advisory-lock name unification.** I specifically chased the `getProcessingLockName` (image-queue.ts:184) vs `getImageProcessingLockName` (advisory-locks.ts:40) split — a real divergence here would let a queue worker and the backfill runner BOTH claim the same image. Confirmed: image-queue's local `getProcessingLockName` is a thin delegating wrapper, so both produce the identical `gallerykit:image-processing:{jobId}`. They serialize correctly.
- **`semantic/route.ts` hand-written enrichment select (`:291-313`).** Does NOT reuse `publicSelectFields` — a parallel narrow select. Verified public-safe: title/description/filename_jpeg/width/height/topic/topic_label/camera_model/lens_model/capture_date, NO lat/long, NO `_PrivacySensitiveKeys` member. Confirmed there is **no per-image or per-topic "hidden/private" concept** in the schema (`map_visible` gates GPS only; `smart_collections.is_public` gates the dynamic-gallery surface only), so returning all `processed=true` rows matches the product model — no leak. The parallel-select smell is pre-existing and accepted for narrow route-local shapes.
- **settings-hash NO-ARG vs CONFIG-ARG divergence (theoretical).** The CONFIG-ARG form normalizes `image_sizes` ordering / clamps invalid values; the NO-ARG DB-raw form does not. `serve-upload.ts:62-69` uses the CONFIG-ARG form as primary and the NO-ARG only as a config-resolution-failure fallback. A hash mismatch between the two forms could at worst cost one extra (harmless) revalidation cycle — **never stale bytes**. This is R8-H1's intended design, not a defect.

---

## Carried deferrals — re-verified UNCHANGED, no new evidence, no exit criterion met (do NOT re-raise)

- **OBS-R7C2-02** [LOW] — reconcile `position` backfill non-rerunnable after a partial-crash. Bootstrap-only window; self-degrades to `imageId` order via the `data.ts` secondary sort. Unchanged at `migrate.js`.
- **OBS-R7C2-05** [LOW] — db pool never `.end()`'d. Process-lifetime singleton; intended.
- **OBS-R7C2-06** [LOW] — unbounded bootstrap retry. Bounded by `unref()`'d backoff; benign.
- **OBS-R7C2-07** [LOW] — `updateTopic` no `FOR UPDATE`. Serialized by `LOCK_TOPIC_ROUTE_SEGMENTS`.
- **R7C1-CR-01..04** [LOW] — restore-maintenance process-local flag; `1000`-literal `NOT IN`; `'XX'` country sentinel; timeline bounds. Unchanged.
- **INFO-R7C2-08** — orphan `0014_drop_reactions.sql` (no journal entry). Destructive-deletion-gated tidy; no runtime risk on either migration path. Unchanged.
- **INFO-R7C2-09** — advisory-lock `:`-vs-`_` separator on the per-job name (cosmetic; re-confirmed `advisory-locks.ts:41`). No collision.

## Closed / moot (do NOT re-file — per run brief)

- **ARCH-R7C2-01** (Stripe Dashboard-refund convergence) + **TE-R7C2-02** (stripe-webhook test) — webhook route DELETED in run-8. **CLOSED-OBSOLETE.** Confirmed: whole-tree grep for `stripe|checkout|entitlement|license_tier|refund|charge.refunded` = 0 production-code hits (matches run-8 c2 verification).
- **RES-R7C6-01** (HEIC GPS-strip residual leak vector) — the only consumer that streamed `data/uploads/original/` (the deleted paid-download route) is gone; `serve-upload.ts ALLOWED_UPLOAD_DIRS` + `nginx location ^~ /uploads/original/ → 404` keep the original unreachable. **CLOSED.** Re-open criterion preserved: any future route streaming from `data/uploads/original/` re-opens at HIGH/CRITICAL.
- **NCLX matrix/transfer pin class** — COMPLETE (per run brief).

---

## Final commonly-missed architectural sweep

| Pattern | Result |
|---------|--------|
| Hidden coupling | None new. The public/admin select coupling is the *intended* destructure-derivation; 4 compile-time guards make it safe; typecheck PASS proves no leak. |
| Leaky abstraction | None. `@/lib/storage` is honest dead code (only `__tests__/storage-local.test.ts` imports it). CLIP `production` cannot leak through the admin UI (double-gate; UI offers only Disabled/Stub). |
| Fail-open default | None. Config → DEFAULTS on any DB read failure; CLIP heals to `disabled`; HDR ingest OFF; `force_srgb_derivatives` OFF (still gamut-preserved AVIF); semantic route fails closed to 503. |
| Unbounded growth without GC | None. Rate-limit maps capped (`bounded-map`); `*_views` chunk-GC'd hourly with batch+iteration caps + no-future-cutoff guard; shared-group view buffer best-effort-by-design (documented). |
| Single point of failure | Documented + accepted single-writer Docker topology. No NEW SPOF; correctness-critical coordination is fenced by 6 advisory locks (or DB-backed login rate limit). |
| Ordering dependency | The migrate.js journal-`when` ordering foot-gun remains fenced by the hash post-condition (`migrate.js` throws on any silently-skipped entry). New entry 0023 is strictly monotonic. |
| Idempotency gap | OBS-R7C2-02 (bootstrap-only position backfill, self-degrading) is the only one, unchanged. Backfill idempotent (`pipeline_version < CURRENT` selection; no version bump on detection failure). Upload-contract lock release idempotent via `released` flag. |
| Schema/select drift | Zero. Every `images` column maps to admin (full) / public (omitted) / map (lat-long-only) consistently; `avif_10bit` + all newer columns mirrored in BOTH migration paths. |

---

## Summary for orchestrator

- **Verdict:** CONVERGED. **0 new architect-lane findings** (0/0/0/0).
- HEAD `d3858cfc` is byte-identical to the twice-converged `f63af3b9` (docs-only diff). Nothing source/schema/config changed since convergence, so no new surface exists to regress.
- I independently re-verified 9 architectural seams from code (not docs) plus 5 lightly-touched seams; the load-bearing typecheck gate PASSES, proving all 4 data-layer privacy guards + the color-key guard + the clip-paths static guards hold.
- All carried LOW/INFO deferrals re-verified unchanged with no exit criterion met — do NOT re-raise. The Stripe-class items (ARCH-R7C2-01 / TE-R7C2-02 / RES-R7C6-01) remain CLOSED-OBSOLETE per the run brief and confirmed by a 0-hit production-code grep.
- **Headline:** No coupling, layering, invariant-enforcement, shared-state, single-writer, migration-drift, data-access, color-pipeline, ETag/settings-hash, or advisory-lock-scoping risk rises to schedulable severity. The architecture is sound and converged; a 0-finding result is the honest, correct outcome.
