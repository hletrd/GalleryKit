# Architecture & Design Review — Run-9 (post run-8 cycle-3)

**Agent:** architect (architectural/design risks, coupling, layering, module boundaries, abstraction leaks, scalability, separation of concerns)
**Date:** 2026-06-13
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)
**HEAD at review:** `ce0029aa` (working tree clean; only `.context/reviews/*.md` carry edits)
**Method:** Authoritative layering scans (`grep -rn "from '@/app/" lib/`, `@/db` importer enumeration, config-leaf purity), read of the three image-encode write sites, the storage seam, the ICC token ladders, and the data-access cache discipline. Cross-checked every finding against `_aggregate.md` (run-8 c3) and `plan-336` to avoid re-reporting deferred items as new.

---

## Summary

The module layering is, on the whole, **disciplined**: `process-image.ts` and `gallery-config-shared.ts` are clean leaves (no upward imports), there is exactly **one** `lib`→`app` inversion (`api-auth.ts`, already recorded), and the admin tunable flow (`gallery-config-shared` → `gallery-config` → `image-queue`) is respected by every consumer. The substantive architectural risk this cycle is **not** a layering violation — it is **logic triplication of the color-encode write path across three independently-maintained sites** (`image-queue`, `admin-backfill-runner`, `scripts/backfill-color-pipeline`), coupled only by hand-written "mirrors X" comments. That risk has **already materialized once**: the AGG-R8c3-03 orphan-leak fix landed in the in-app runner but is **structurally absent from the sidecar script**, so the two backfill entry points the repo documents as equivalent now have divergent correctness guarantees. The triplicated ICC token ladder (AGG-R8c3-13, deferred) is the lower-stakes sibling of the same root cause.

The `@/lib/storage` abstraction is a **dead seam** (390 LOC consumed only by its own index + a test), but it is honestly self-documented as unwired and is cheap to keep — record-only, not a defect.

---

## Findings by severity

### MEDIUM

#### ARCH-R9-01 — The color-encode + column-write logic is triplicated across 3 sites; the orphan-leak fix is asymmetric (root cause already materialized)
- **Boundary at issue:** the operation "re-run `processImageFormats`, re-run `detectColorSignals`, resolve `colorPipelineDecision`, write the 10-column color set, handle delete-mid-reencode" is implemented THREE times with no shared writer:
  1. **Upload path** — `lib/image-queue.ts:335` (`processImageFormats`) + conditional UPDATE with the `affectedRows === 0 → cleanup` guard (`:367-382`).
  2. **In-app backfill** — `lib/admin-backfill-runner.ts:541` (`detectColorSignals`) + UPDATE at `:557-570` **with** the AGG-R8c3-03 `affectedRows === 0 → cleanupDeletedMidReencodeVariants` guard on BOTH branches (`:573`, `:605`).
  3. **Sidecar script** — `scripts/backfill-color-pipeline.ts:174` (`detectColorSignals`) + batched `flushBatch()` UPDATEs at `:320-342` **without** any `affectedRows` guard.
- **Evidence of the coupling being comment-only:** `admin-backfill-runner.ts:523` "mirrors backfill-color-pipeline.ts"; `:582-590` "The operator script already has the correct semantics"; `scripts/backfill-color-pipeline.ts:98` "This mirrors `admin-backfill-runner.ts:268-273`", `:195` "Mirrors admin-backfill-runner.ts:268-273". The column LIST (`pipeline_version, icc_profile_name, color_primaries, transfer_function, matrix_coefficients, is_hdr, has_gain_map, color_pipeline_decision, was_downscaled, avif_10bit`) is byte-for-byte duplicated at `admin-backfill-runner.ts:559-568` and `backfill-color-pipeline.ts:322-331`.
- **Why it's a maintainability/correctness risk:** the three copies are kept in sync by developer vigilance and per-file tests (`backfill-color-pipeline.test.ts` pins the script's column set; `admin-backfill-runner-detection-failure.test.ts` pins the runner's no-version-bump semantics), **not** by a shared function the tests could anchor on. CLAUDE.md asserts the two backfill paths "persist the SAME DB column set" and "never strand stale color metadata" — true for the column LIST, but **false for the delete-race guarantee**: the script's `flushBatch` is decoupled from the per-row encode, has no per-image lock (its docstring admits this, `:36-41`) AND no `affectedRows` check, so a `deleteImage` that races a sidecar re-encode of the same id leaks orphaned derivatives exactly as the runner did before AGG-R8c3-03 — the fix was applied to copy #2 and not copy #3.
- **Concrete future-pain scenario:** WI-09 (HDR AVIF encoder) adds an `hdr_avif_filename` / `transfer_function='pq'` write. A developer updates the upload path and the in-app runner, runs the suite green (both per-file tests pass), and ships. The sidecar script — the path CLAUDE.md documents as the **production** backfill method (the prod container lacks `tsx`, so operators run the `--rm` sidecar) — silently writes the OLD column set on the next production backfill, stranding the new HDR metadata on every existing photo with no test failure.
- **Fix (refactor direction):** extract a single `applyColorPipelineResult(db, id, { signals, wasDownscaled, avif10bit }): Promise<{ affectedRows }>` writer in a server lib leaf (e.g. `lib/color-pipeline-writer.ts`) that owns the column list AND the `affectedRows === 0 → cleanup` contract. Have all three callers import it. The script's batched-transaction shape can still call it per-row inside the `db.transaction` (the per-row UPDATE is already in a loop). Anchor ONE cross-site test on the shared writer instead of three per-file fixtures. At minimum (if the batched refactor is deemed too large this cycle): port the `affectedRows === 0 → unlink derivatives` guard into the script's `flushBatch` loop and update CLAUDE.md to stop claiming delete-race parity until then.
- **Confidence:** High (all three sites read; the script's missing `affectedRows` confirmed by grep returning nothing).
- **Relation to prior:** this is the architectural ROOT of AGG-R8c3-03 (which fixed only the symptom in the runner) and a higher-stakes sibling of AGG-R8c3-13 (deferred ICC-ladder duplication). Not previously reported as a single cross-site duplication finding.

### LOW

#### ARCH-R9-02 — `@/lib/storage` is a dead seam (390 LOC, zero production consumers) — record-only
- **Boundary at issue:** `lib/storage/{index,local,types}.ts` exports a full backend abstraction — `getStorage()`, `getStorageSync()`, `switchStorageBackend()`, `getStorageBackendType()`, `getStorageBackendStatus()` (`index.ts:52-141`) — but the only importers are `lib/storage/index.ts` itself and `__tests__/storage-local.test.ts`. Production upload/processing/serving (`process-image.ts`, `serve-upload.ts`, `actions/images.ts`) use direct `fs`/`path`.
- **Why it's a (minor) risk:** a seam that is never exercised by the real pipeline rots — the `StorageBackend` interface can drift away from what the fs code actually needs (path semantics, atomic-rename contract, ETag/mtime expectations) without anyone noticing, so the day someone tries to wire S3 they inherit an interface that was never validated against the real call sites. It also presents a `switchStorageBackend('local')` API that looks like a supported admin lever but is a no-op selector over a single backend.
- **Disposition:** **RECORD-ONLY, not a defect.** CLAUDE.md explicitly states the storage backend "still exists as an internal abstraction… Do not document or expose S3/MinIO switching as a supported admin feature until the upload/processing/serving pipeline is wired end-to-end," and `index.ts:9-12` self-documents the unwired state honestly. This is a deliberate, documented placeholder. Keeping it is cheap; the honesty invariant is intact (no admin UI exposes it).
- **Exit criterion / fix direction:** when storage backends become a real requirement, wire the abstraction at the `process-image` write site and the `serve-upload` read site FIRST (validating the interface against the real atomic-rename + ETag contract) before adding any second backend; until then, leave as-is. If it is decided storage backends will never ship, delete the module rather than let it accrue interface drift.
- **Confidence:** High (import graph + CLAUDE.md cross-checked).

#### ARCH-R9-03 — 14 `@/db`-importing libs are server-only by docstring, enforced only by one boundary test (= AGG-R8c3-A5(b), severity re-assessed)
- **Boundary at issue:** `data.ts, analytics-data.ts, tag-records.ts, admin-tokens.ts, rate-limit.ts, audit.ts, smart-collections.ts, image-queue.ts, gallery-config.ts, data-timeline.ts, session.ts, settings-hash.ts, admin-backfill-runner.ts, upload-processing-contract-lock.ts` all import `@/db`; **only** `caption-generator.ts:19` carries `import 'server-only'`.
- **Why it's a risk:** the `lib/`↔client boundary is real (these modules pull the MySQL pool), but it is held by a single negative test (`__tests__/client-server-only-boundary.test.ts`) rather than per-module compiler guards. If that test is weakened or a new client component imports one of these transitively via a barrel, the server pool code can reach a client bundle — a much louder failure (build-time `server-only` error) is available for near-zero cost.
- **Fix:** add `import 'server-only'` to the head of each of the 14 `@/db`-importing libs. This is a safe, mechanical change; it converts a test-time guard into a compile-time guarantee and makes the server boundary self-evident at each file.
- **Disposition vs prior:** AGG-R8c3-A5 recorded this as LOW/deferred ("re-open during a server-only hardening pass"). I **concur with LOW** and with deferral — the boundary IS currently enforced. Re-stated here only to confirm status; the boundary-test still passes, so no escalation.
- **Confidence:** High.

#### ARCH-R9-04 — `lib/api-auth.ts` → `app/actions/auth` layering inversion (= AGG-R8c3-12, confirmed unchanged)
- **Boundary at issue:** `lib/api-auth.ts:1` `import { isAdmin } from '@/app/actions/auth'` — the only `lib`→`app` edge in the codebase (authoritative scan confirms a single hit). `withAdminAuth` (mandatory on every admin API route) thus reaches UP into the server-action layer for its identity primitive.
- **Why it's a risk:** unchanged from the prior write-up — no hard ESM cycle today, but a near-cycle that gets copied the moment a second `lib` module needs `isAdmin`. The identity read belongs in a leaf.
- **Disposition:** **CONFIRMED STILL PRESENT, status unchanged, correctly deferred in plan-336 Deferred-3.** I concur with LOW/Med and with deferral: the auth check is correct; only the import direction is upside-down, and the extraction touches the auth surface (better landed in a dedicated cycle). No severity change.
- **Fix direction (when picked up):** extract identity reads (`isAdmin`, session lookup) to `lib/auth-session.ts`; have both `app/actions/auth` and `lib/api-auth` import DOWN from it.
- **Confidence:** Med (mechanism clear; impact latent).

#### ARCH-R9-05 — ICC-name→gamut token ladder triplicated (= AGG-R8c3-13, confirmed unchanged)
- **Boundary at issue:** the `displayp3/dcip3/adobe/prophoto/bt2020/rec2020` keyword ladder is hand-rolled at `color-detection.ts:62-66` (`inferColorPrimaries`), `process-image.ts:690-703` (`resolveColorPipelineDecision` string branch), and `process-image.ts:766-778` (`resolveAvifIccProfile`) — plus a primaries-enum derivation at `process-image.ts:652-656`. Three+ copies of the same keyword set.
- **Why it's a risk:** a new gamut keyword (WI-09 / Rec.2100) added to one ladder but not the others makes the admin color audit silently disagree with delivery, uncaught by per-function tests. (The NCLX-first-audit vs ICC-first-delivery PRECEDENCE inversion is intentional/documented — explicitly NOT part of this finding; only the duplicated keyword matching is.)
- **Disposition:** **CONFIRMED STILL PRESENT, status unchanged, correctly deferred in plan-336 Deferred-4** ("land with WI-09"). I concur with LOW and deferral — the three ladders agree today; consolidating with the WI-09 keyword addition lets the shared helper + cross-module test land with the change that would otherwise introduce the drift. No severity change. **Note:** this and ARCH-R9-01 share a root cause (duplicated color logic) and should ideally be consolidated together — the `iccNameToGamut(name)` helper and the `applyColorPipelineResult` writer are the same refactor theme.
- **Confidence:** High.

---

## Status of prior DEFERRED architecture items (plan-336)

All three architecture items the prompt flagged are **RECORDED in plan-336**, present in the code, and **unchanged in substance** since run-8 c3. I re-assessed each; none warrants re-classification:

| Prior ID | plan-336 entry | Code status at `ce0029aa` | My re-assessment |
|---|---|---|---|
| **AGG-R8c3-12** (lib→app inversion, `api-auth.ts:1`) | Deferred-3 (LOW/Med) | **PRESENT** — sole `lib`→`app` edge (authoritative scan: 1 hit) | **Concur LOW/Med + defer.** See ARCH-R9-04. No new replication; exit criteria not yet met. |
| **AGG-R8c3-13** (triplicated ICC ladder) | Deferred-4 (LOW/High) | **PRESENT** — `color-detection.ts:62-66` + `process-image.ts:690-703` + `:766-778` | **Concur LOW + defer to WI-09.** See ARCH-R9-05. Ladders still agree; no live audit-vs-delivery drift. |
| **AGG-R8c3-A5** (COLOR_IMPACTING_KEYS hand-maintained; server-only by docstring) | Deferred-10 (LOW/Med-High) | **PRESENT** — `settings-hash.ts` keys hand-listed; 14 `@/db` libs unguarded, only `caption-generator.ts:19` has `import 'server-only'` | **Concur LOW + defer.** See ARCH-R9-03. Boundary test still enforces; key list correct at 9. |

**One materially-changed status to flag (improvement, not a defect):** AGG-R8c3-05 (home page ran two uncached `GROUP_CONCAT` listing queries) is now **CLOSED** — `getLatestImageForOgCached` exists (`data.ts:1597`) and `generateMetadata` uses it (`(public)/page.tsx:93`), replacing the wasteful full-listing call on the metadata path. The data-access `cache()` discipline is otherwise intact: the 9 documented `Cached` wrappers are present (`data.ts:1595-1649`); the remaining uncached listing functions (`getImagesLite`, `getImagesLitePage`, `getImages`, `getAdminImagesLite`) are intentionally per-request (pagination/cursor inputs make `cache()` keys unstable) — that is correct, not a gap.

**Net architectural posture:** layering is clean except the single recorded `api-auth` inversion; the live risk is duplicated color-encode logic (ARCH-R9-01 substantive; ARCH-R9-05 latent), which the deferred-item set under-weights because it scoped the duplication to the ICC ladder and missed that the SAME duplication spans the full backfill write path and has already produced one asymmetric correctness guarantee.

---

## References

- `apps/web/src/lib/image-queue.ts:335,367-382` — upload-path encode + `affectedRows` cleanup guard (the canonical correct shape).
- `apps/web/src/lib/admin-backfill-runner.ts:541,557-570,573,594-607` — in-app backfill; column UPDATE + AGG-R8c3-03 cleanup on both branches.
- `apps/web/scripts/backfill-color-pipeline.ts:36-41,98,174,320-342` — sidecar script; batched UPDATE with NO `affectedRows` guard (orphan-leak asymmetry) + docstring admitting the per-image-lock gap.
- `apps/web/src/lib/storage/index.ts:9-12,52-141` — dead-seam abstraction, honestly self-documented as unwired.
- `apps/web/src/lib/api-auth.ts:1` — sole `lib`→`app` import inversion.
- `apps/web/src/lib/color-detection.ts:62-66` ; `apps/web/src/lib/process-image.ts:652-656,690-703,766-778` — triplicated ICC-name→gamut ladder.
- `apps/web/src/lib/process-image.ts` (no upward imports) ; `apps/web/src/lib/gallery-config-shared.ts` (no `@/db`, no `@/lib/gallery-config`) — confirmed clean leaves.
- `apps/web/src/lib/caption-generator.ts:19` — the ONLY `import 'server-only'` guard among server libs.
- `apps/web/src/lib/data.ts:1595-1649` — the 9 `cache()` wrappers ; `:1597` `getLatestImageForOgCached` (AGG-R8c3-05 fix) ; `apps/web/src/app/[locale]/(public)/page.tsx:93` (consumes it).
- `plan/plan-336-run8-cycle3-deferred.md:24-36,73-78` — Deferred-3/4/10 (the prior architecture items).
