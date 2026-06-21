# Architect Review — Run-9 Cycle-3 (HEAD `c2d3857a`)

**Date:** 2026-06-21
**Agent:** architect (Opus, READ-ONLY)
**Lane:** whole-repo architecture & design risk — single-writer topology, advisory-lock coordination, migration/schema-drift machinery, image-processing queue + backfill entry points, connection-pool budgeting, ETag/settings-hash cache invalidation, data-access caching + privacy derivation, config resolution chain, layering/cohesion.

## NEW FINDINGS: 0 (0 CRIT / 0 HIGH / 0 MED / 0 LOW)

A deep, independent, code-first sweep finds **zero** new architectural risks at any schedulable severity. The codebase remains **CONVERGED**. I re-derived every named invariant from source (not from prior review docs), grounded the one production change against the installed dependency's actual contract, and ran the load-bearing gates. I did NOT manufacture a finding to break the streak — a truthful zero is the success condition for this converged tree.

---

## Change surface since run-8 convergence (`f63af3b9` → `c2d3857a`)

Non-doc, non-sw-stamp delta is exactly **3 items**, all already adjudicated as run-9 scheduled fixes:

1. `scripts/backfill-cicp-recheck.ts` — ONE production-source line: `queue.onEmpty()` → `queue.onIdle()` (CR-R9C2-01). Read-only diagnostic script.
2. `__tests__/upload-tracker-state.test.ts` — NEW test file (TE-R9C1-01), pure coverage.
3. `__tests__/upload-processing-contract-lock.test.ts` — NEW test file (TE-R9C1-02), pure coverage.

Plus `public/sw.js` version-stamp-only diff (`1ef54aaa-p7` → build stamp) and `.context/reviews/**` markdown. No schema, no migration, no advisory-lock name, no config resolver, no data-access layer changed. The architectural surface is executable-byte-identical to the converged tree except for the single drain-primitive swap.

---

## The one production change: CR-R9C2-01 — VERIFIED CORRECT (grounded in installed p-queue 9.1.2)

`scripts/backfill-cicp-recheck.ts:136` now drains with `await queue.onIdle()` instead of `onEmpty()`.

I did NOT trust the inline comment — I read the installed package source:

- `node_modules/p-queue/dist/index.js:502-507` — `onEmpty()` resolves on `#queue.size === 0` ONLY (nothing WAITING).
- `node_modules/p-queue/dist/index.js:528-535` — `onIdle()` resolves on `#pending === 0 && #queue.size === 0` (nothing waiting AND nothing in-flight).
- Package docstring at `:524`: *"`.onIdle` guarantees that all work from the queue has finished. `.onEmpty` merely signals that the queue is empty, but it could mean that some promises haven't completed yet."*

The script's per-row counters (`checked` / `flips` / `missing` / `errors`) are mutated INSIDE the queued task body (`backfill-cicp-recheck.ts:88-124`). Under the old `onEmpty()`, the final ≤`concurrency` in-flight tasks could resolve AFTER the summary print (`:138-147`), undercounting the diagnostic's entire output — which IS the script's whole purpose. The swap is exactly right and unifies the script with every sibling drain site. Confirmed via grep: **zero** `onEmpty()` calls remain anywhere in production source; all drains (`image-queue.ts:595/759`, `queue-shutdown.ts:33`, `admin-backfill-runner.ts:764`, `backfill-color-pipeline.ts:500`, this script) use `onIdle()`.

Risk surface of this change: **none**. The script is read-only (docstring `:18-21`: never writes DB or filesystem), so it requires no advisory lock and has no coordination dependency on the two write-path backfill entry points — it can run concurrently with anything. The fix only affects diagnostic-output accuracy, not data integrity.

The two new test files import production code but mutate only their own `Symbol.for` test scope in `beforeEach` (correct hygiene). No production state, no shared-state hazard.

---

## Per-seam verification table (all SOUND — re-derived from source this cycle)

| # | Seam | Verdict | Evidence (file:line) |
|---|------|---------|----------------------|
| 1 | settings-hash `COLOR_IMPACTING_KEYS = 9`; config-arg vs DB-arg symmetry; compile-time key guard | **SOUND** | `settings-hash.ts:42-54` (exactly 9 keys), `:63-66` (`_colorKeysAreSettingKeys` guard), `:89-102` (`buildHashFromConfig` enumerates the SAME 9 field-by-field) |
| 2 | ETag layering: serve-upload uses pipeline_version+mtime+size+settingsHash; static path rides mtime+size | **SOUND** | `settings-hash.ts` config-arg form is pure (no DB read); CRT-D1 operational gotcha (static path needs re-encode to invalidate) unchanged & documented |
| 3 | Connection-pool budgeting for in-app backfill | **SOUND** | `db/index.ts:23` POOL=10; `admin-backfill-runner.ts:129-142` `resolveBackfillConcurrency` → cap=`max(1,floor((10-5-1)/2))`=2, `RESERVED=max(3,ceil(10/2))`=5; NaN-guard at `:137` |
| 4 | 6 advisory locks: every GET_LOCK has matching RELEASE_LOCK on dedicated conn (finally/early-return); per-job name unified via canonical helper | **SOUND** | `advisory-locks.ts:19-44`; full census across image-queue/admin-backfill-runner/topics/admin-users/db-actions/upload-processing-contract/backfill-color-pipeline — all acquire/release symmetric, crash-safe on conn close |
| 5 | data.ts PII derivation: public derived-by-omission from admin (separate object ref) + compile-time guard | **SOUND** | `data.ts:323-355` destructure-omission; `:414-418` `_privacyGuard` = `Extract<keyof publicSelectFields, PrivacySensitiveKeys> extends never ? true`; `publicMapSelectFields` separately guarded `:364-391` |
| 6 | All admin-only color/HDR columns omitted from public selects | **SOUND** | `data.ts:331-349` omits color_pipeline_decision/is_hdr/has_gain_map/was_downscaled/transfer_function/matrix_coefficients/bit_depth/color_space/icc_profile_name/pipeline_version + uploaded_by/processing_error/failed_at |
| 7 | Migration journal newest-entry monotonicity (the cursor invariant) | **SOUND** | idx 0018-0023 strictly increasing & all `> 1778304060000` (prior-era max @ 0006). Known 0007-0013 non-monotonic 2025 `when`s sit BELOW cursor — the exact drift the hash-based post-condition gate in migrate.js catches |
| 8 | reconcileLegacySchema mirrors EVERY images column in schema.ts; 0023 drop mirrored | **SOUND** | cross-ref schema.ts images columns vs `migrate.js` ensureColumn ADDs — full coverage incl. icc_profile_name/color_pipeline_decision/color_primaries/transfer_function/matrix_coefficients/is_hdr/has_gain_map/pipeline_version/was_downscaled/uploaded_by/avif_10bit; 0023 entitlements DROP + license_tier removal mirrored (reconcile no longer creates them) |
| 9 | No remaining onEmpty() drains; all queue shutdown/backfill paths use onIdle() | **SOUND** | grep across src/+scripts/ — zero onEmpty(), 6 onIdle() drain sites |
| 10 | Backfill entry-point coordination: in-app + sidecar serialize via LOCK_COLOR_PIPELINE_BACKFILL; cicp-recheck is read-only (lock-free, correct) | **SOUND** | `admin-backfill-runner.ts:310/327`, `backfill-color-pipeline.ts:305/516` both use canonical lock name; cicp-recheck takes no lock by design |

---

## Migration / schema-drift machinery (run-7 lesson) — re-checked, CLEAN

- **Journal monotonicity:** the cursor-based legacy migrator depends ONLY on the newest entry being the global max `when`. idx 0023 (`1782000000000`) is the strict maximum; all of 0018-0023 advance monotonically above the prior-era ceiling. The 2025-dated 0007-0013 entries are the documented historical non-monotonicity that the hash-based post-condition (`every journal hash present in __drizzle_migrations` else throw) exists to catch — this is the safety net, not a defect.
- **DDL mirroring:** every column the schema knows about has an idempotent `ensureColumn` in `reconcileLegacySchema`. The 0023 paid-downloads removal (DROP TABLE entitlements + DROP COLUMN license_tier) is correctly reflected by reconcile NO LONGER creating those objects, so a baselined legacy DB converges to the same end-state as a fresh drizzle.migrate() run. `0023_remove_paid_downloads.sql` uses bare DDL safe-by-convention (drizzle runs it exactly once; targets always pre-exist via 0008/0013).

---

## Process-local-state inventory vs documented single-writer model — all consistent

| State | Bound / coordination | Matches doc? |
|---|---|---|
| login / account / password-change rate-limit | bounded Maps (MAX 5000), login has DB backup | ✓ documented |
| OG/share/search/semantic rate-limit | bounded Maps (MAX 2000), per-process | ✓ documented scale-out weakness (carried) |
| shared-group view-count buffer | MAX_VIEW_COUNT_BUFFER_SIZE cap, SIGTERM flush, best-effort | ✓ documented |
| restore maintenance flag | `Symbol.for` process-global, lock-serialized | ✓ documented (R7C1-CR-01 deferred) |
| backfill runner status | per-process surface; correctness-fenced by LOCK_COLOR_PIPELINE_BACKFILL | ✓ documented |
| upload-tracker state (newly test-covered) | `Symbol.for('gallerykit.uploadTracker')` process-local; window/active-claim bounded | ✓ — the new test pins this contract, no behavior change |

No missing coordination state. Every per-process hazard is bounded, lock-fenced, or an explicitly-documented best-effort/scale-out limitation in the carried-deferral register.

---

## Carried deferrals — re-verified UNCHANGED, no exit criterion met (do NOT re-raise)

- **R7C1-CR-01** restore-maintenance process-local flag — lock-serialized, single-writer-correct. Unchanged.
- **OBS-R7C2-02..07** reconcile position backfill / non-transactional restore / failRestore temp leak / pool not .end()'d / unbounded bootstrap retry / updateTopic no FOR UPDATE — documented-design / operator-mitigated / lock-serialized. Unchanged.
- **INFO-R7C2-08/09** orphan 0014_drop_reactions.sql / advisory-lock `:` vs `_` separator — cosmetic. Unchanged.
- **ARCH-R7C2-01** Stripe webhook — CLOSED-OBSOLETE (paid downloads removed in 0023). Unchanged.
- **settings-hash no-arg vs config-arg divergence (R8-H1)** — BENIGN-BY-DESIGN; serve-upload uses config-arg primary; worst case one extra harmless revalidation, never stale bytes. Not a finding.

---

## Gate evidence (fresh foreground at HEAD `c2d3857a`)

- `npm run typecheck:scripts` → **PASS** (covers the changed `backfill-cicp-recheck.ts`; 7 JS scripts checked + scripts tsconfig clean).
- `npx tsc -p tsconfig.typecheck.json --noEmit` (direct, against generated `.next/types`) → **0 type errors** across the whole app, confirming every `_*Guard` / `_colorKeysAreSettingKeys` / `_privacyGuard` compile-time assertion resolves. NOTE: the wrapper `npm run typecheck:app` reported a spurious `validator.ts: Cannot find module './routes.js'` — this is a Next 16 typegen/`tsc` ordering artifact in the generated `.next/types/validator.ts` (typegen emits `routes.d.ts`; the validator's `.js` import resolves under Next's build but not always under the wrapper's regenerate-then-check chain). It is NOT a source defect, is unrelated to all 3 run-9 changes (none touch routes/pages/layouts), and direct tsc against the source yields 0 errors.
- New test files: `vitest run upload-tracker-state.test.ts upload-processing-contract-lock.test.ts` → **18 passed / 0 failed**.

---

## Conclusion

**0 new findings — convergence confirmed.** The only production-source change since the twice-converged `f63af3b9` is a single correct drain-primitive swap (`onEmpty()` → `onIdle()`) in a read-only diagnostic script, verified against the installed p-queue 9.1.2 source and the documented sibling-drain convention. Every enumerated architectural seam — single-writer topology, 6-name advisory-lock coordination, migration journal monotonicity + reconcileLegacySchema mirroring, image-processing queue + dual backfill entry points, connection-pool budgeting, ETag/settings-hash invalidation, data-access privacy derivation with compile-time guard, config resolution chain — verified SOUND directly from code. No invariant violated, no shared-state hazard, no coordination gap, no migration drift, no layering violation introduced.
