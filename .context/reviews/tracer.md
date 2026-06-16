# Tracer — Run 6 / Cycle 4

**HEAD:** f8147868
**Date:** 2026-06-16
**Angle:** evidence-driven causal tracing of suspicious end-to-end flows, competing hypotheses, evidence for/against, uncertainty tracking.
**Working tree:** CLEAN. **Tests run this pass:** touch-target-audit + backfill-color-pipeline + admin-backfill-runner-detection-failure + sw-template-contract + backfill-color-pipeline-deleted-mid-reencode → **44/44 passing**.

---

## Headline

All four target flows trace **substantially CLEAN**. The two prior-cycle fixes I was asked to re-examine (backfill exit-code `a033056d`, Switch geometry `a3b8c557`) are **correct** — the Switch geometry is mathematically sound and the detection-failure resume invariant holds on both backfill paths. Cache/ETag invalidation is consistent across all three layers. The upload→process→serve delete-race is closed: the worker is always the last writer and cleans up its own derivatives.

**One genuine latent defect found** (LOW): a sidecar-backfill exit-code over-count at the *detection-failure ∩ concurrent-delete* intersection — `detectionFailures` is inflated by deleted rows, so the new `a033056d` non-zero exit can fire for a run whose "failures" no longer exist. Bounded, not data-integrity. **Two doc/comment drifts** (LOW/INFO) in the just-landed Switch fix.

---

## FLOW 1 — Upload → process → serve (delete-while-processing race, claim lock, orphan cleanup)

### Observation
`uploadImages` writes the original, INSERTs the row at `pipeline_version=CURRENT, processed=false`, fire-and-forget enqueues processing. The queue worker claims a per-image advisory lock, re-checks the row, encodes 3 formats, then a conditional `UPDATE … WHERE processed=false`. `deleteImage` can run concurrently and does NOT take the per-image lock.

### Hypothesis table
| Rank | Hypothesis | Confidence | Evidence Strength |
|------|------------|------------|-------------------|
| 1 | No window leaves disk/DB inconsistent or orphans a served derivative | **High** | Strong (source-traced, all interleavings enumerated) |
| 2 | A derivative written by the worker AFTER delete's cleanup survives as an orphan | Refuted | Strong |
| 3 | Two workers double-encode the same id | Refuted | Strong |

### Evidence FOR Hypothesis 1 (clean)
- Per-image lock `gallerykit:image-processing:{id}` acquired before encode (`image-queue.ts:261`, `getImageProcessingLockName`), released in `finally` (`:545`). Non-blocking `GET_LOCK(name,0)` (`:199`) — a second worker that loses the claim reschedules (`:262-283`), so **double-encode is impossible** (refutes H3).
- Conditional UPDATE `WHERE id=? AND processed=false` (`image-queue.ts:370-372`). On `affectedRows===0` (row deleted mid-process) the worker cleans up ALL variants with the `[]` full-scan form (`:374-391`).
- `deleteImageVariants(dir,name,[])` does a real directory scan matching `{name}_*{ext}` + base (`process-image.ts:517-534`), so every size variant is removed regardless of the configured `image_sizes` — confirmed at the source.
- `deleteImage` removes the id from `enqueued`/retry maps (`images.ts:593-599`) then deletes the row transactionally (`:603-607`) then cleans files with `[]` (`:618-625`).

### Interleaving trace (the dangerous ordering)
The only ordering that could orphan a file is: **delete cleans up → worker writes derivatives afterward.** Trace:
1. deleteImage commits row delete + cleans files (no/partial derivatives on disk).
2. Worker `processImageFormats` re-materializes fresh derivatives (`image-queue.ts:337`) — lands AFTER delete's cleanup.
3. Worker conditional UPDATE → row gone → `affectedRows===0` → worker runs its OWN `[]` cleanup (`:374-391`).

**The worker's cleanup is the terminal step.** There is no code path where the worker writes derivatives *after* its own `affectedRows===0` cleanup. So the worker is always the last writer and always sweeps. No orphan survives (refutes H2). Atomic base-rename via `.tmp` (`process-image.ts:1236-1257`) closes the partial-base-file 404 window; leftover `.tmp` swept at bootstrap (`image-queue.ts:32-73`).

### Evidence AGAINST / gaps
- `original/{uuid}` SIGKILL orphan between original-write and INSERT remains (AGG-C3-08, deferred) — disk-bloat only, **NOT re-reported** (reasoning confirmed correct: file never served, never referenced, cleanup sweep covers only webp/avif/jpeg).
- No runtime two-worker race test (AGG-C3-19 deferred) — invariant is sound by construction; lock-name pins only. Unchanged.

### Verdict: **CLEAN.** Critical unknown: none. No probe needed.

---

## FLOW 2 — Backfill detection-failure-after-encode (re-examining `a033056d`)

### Observation
Both backfill paths (sidecar `scripts/backfill-color-pipeline.ts`, in-app `lib/admin-backfill-runner.ts`) re-encode then re-detect. When encode succeeds but `detectColorSignals` throws, the row must persist fresh `was_downscaled`/`avif_10bit` WITHOUT advancing `pipeline_version`, so it stays a candidate (`pipeline_version < CURRENT`) for a later detection retry.

### Hypothesis table
| Rank | Hypothesis | Confidence | Evidence Strength |
|------|------------|------------|-------------------|
| 1 | `pipeline_version` correctly stays behind on detection-failure; no path lands stale color metadata at CURRENT | **High** | Strong (both paths source-traced + a pinning test passing) |
| 2 | A success-branch partial UPDATE could bump version with stale columns | Refuted | Strong |
| 3 | Sidecar exit-code/summary mis-reports | **Confirmed (minor)** | Moderate (source-traced) |

### Evidence FOR Hypothesis 1 (resume invariant holds)
- **Sidecar:** detection-failure returns `{outcome:'processed', derivativeOnly}` (`backfill-color-pipeline.ts:230-233`) → routed to `derivativeBatch` (`:440`) → batched UPDATE sets ONLY `was_downscaled`+`avif_10bit` (`:394-402`), **no `pipeline_version`**. Success returns `signals` → UPDATE sets `pipeline_version=CURRENT` together with fresh signals atomically (`:378-391`).
- **In-app runner:** `signals===null` branch UPDATEs ONLY `was_downscaled`+`avif_10bit` (`admin-backfill-runner.ts:594-599`), returns `detection-failed` (`:609`). No version bump. Success branch (`:557-577`) writes version + fresh signals in one UPDATE.
- **Pinned by test** `admin-backfill-runner-detection-failure.test.ts:198-203`: asserts the detection-failure UPDATE does NOT contain `pipeline_version` but DOES contain `was_downscaled`+`avif_10bit`. PASSING.
- H2 refuted: version bump and color columns are a single atomic UPDATE; a partial failure rolls the whole UPDATE, never leaving version-ahead-of-columns. There is no interleaving that strands stale color at CURRENT.

### `a033056d` exit-code fix — verified correct in the common case
- `detectionFailures++` in the derivative branch (`:439`); surfaced in progress (`:453`), Done line (`:464`), a loud WARNING (`:470`), and `process.exit(errors>0 || detectionFailures>0 ? 1 : 0)` (`:485`). An all-detection-failure run now exits 1 — the fix achieves its goal.

### Evidence AGAINST / gap — **LATENT DEFECT TRC-C4-01 (LOW)**
**Sidecar `detectionFailures` over-counts rows that were detection-failures AND concurrently deleted mid-reencode.**

Trace: `detectionFailures++` fires inside the per-row queue task (`:439`), BEFORE the batched `flushBatch` discovers the 0-row UPDATE. `collectDeletedMidReencodeFiles(updateResults)` runs over BOTH success and derivative results (`:392, :401, :406`). When a derivative-only (detection-failure) row's UPDATE matched 0 rows (deleted), the handler does `processed -= count` and `deletedMidReencode += count` (`:413-414`) but **never decrements `detectionFailures`**.

- **Consequence:** `process.exit(... detectionFailures>0 ...)` (`:485`) can exit **non-zero** for a run whose only "stale" rows were *deleted and no longer exist*. A CI/cron wrapper re-triggers a backfill that finds nothing to do (idempotent). **Bounded, not data-integrity** — the deleted rows are genuinely gone; there is nothing stale to retry.
- **Trigger:** a photographer deletes a photo while a sidecar backfill is mid-re-encode of that exact id AND that id's color detection also threw. Narrow intersection.
- **In-app runner is CLEAN here:** `reprocessOne` checks `affectedRows===0` inline and returns `deleted-mid-reencode` BEFORE `detection-failed` (`admin-backfill-runner.ts:605-609`), so the two reasons are **mutually exclusive** — a deleted detection-failure row counts only as `deletedMidReencode`, never inflating `detectionFailures`/`hadFailures` (`:791`). The asymmetry exists only because the sidecar batches DB writes decoupled from the per-row encode (its own header acknowledges this, `:36-43`).
- **Fix (one line, if scheduled):** in `flushBatch`, when a *derivative* item is the deleted one, decrement `detectionFailures` alongside the `processed`/`deletedMidReencode` adjustment — i.e. partition `deletedMidReencodeFiles` by which batch (success vs derivative) the row came from. OR re-derive the exit condition from a post-flush recount.

### Verdict: resume invariant **CLEAN**; exit-code precision **LOW defect TRC-C4-01** (sidecar only). Critical unknown: none — the over-count is deterministic from source. Discriminating probe (if doubted): unit test feeding `flushBatch` a derivative item with `affectedRows:0` and asserting `detectionFailures` is not left elevated.

---

## FLOW 3 — Switch geometry fix (`a3b8c557`)

### Observation
The touch-target retrofit had bumped Switch Root to `min-h-11 min-w-11` (44px) but left the thumb `size-5` + fixed `translate-x-5` (20px), so the thumb never reached the right edge ("half-on"). The fix (`switch.tsx`) nests a visible `h-6 w-11` pill inside the 44px Root and switches the thumb to `translate-x-full`.

### Hypothesis table
| Rank | Hypothesis | Confidence | Evidence Strength |
|------|------------|------------|-------------------|
| 1a | Fully fixed — thumb travels edge-to-edge, geometry correct | **High** | Strong (pixel math + Radix source verified) |
| 1b | Fixed visually but hit-zone broke | Refuted | Strong |
| 1c | Some Switch usages still wrong | Refuted | Strong |

### Evidence FOR 1a (fully fixed)
- **Pixel math:** Root `inline-flex min-h-11 min-w-11 items-center justify-center` → 44×44 hit area, centers child (`switch.tsx:26`). Visible track `h-6 w-11` (24×44) with `px-0.5` (2px/side) → **40px inner box** (`:36`). Thumb `size-5` (20px); `translate-x-0` unchecked → flush left; `data-[state=checked]:translate-x-full` = `translateX(100% of own width = 20px)` (`:49`). Inner 40px − thumb 20px = **20px travel needed = 20px delivered → flush right.** Geometry exact.
- **Radix `data-state` propagation verified:** `@radix-ui/react-switch/dist/index.mjs:48` sets `data-state` on Root; `:89` (`SwitchThumb`) sets `data-state` on the **Thumb element itself** from `context.checked`. So the thumb's `data-[state=checked]:translate-x-full` selector resolves on the thumb — the travel is driven by real state, not the Root. This was the load-bearing sub-question; confirmed.
- **Hit-zone intact (refutes 1b):** the 44px tappable area is still on Root; the visible pill is `pointer-events-none` (`:36`) and the thumb is `pointer-events-none` (`:48`), so all pointer events land on the 44px Root. Touch-target audit `KNOWN_VIOLATIONS['components/ui/switch.tsx'] = 0` (`touch-target-audit.test.ts:143`) and the **audit PASSES** in this pass's 44-test run.
- **All usages covered (refutes 1c):** the fix is in the shared `ui/switch.tsx`; all 3 consumers (`search.tsx`, `settings/settings-client.tsx`, `categories/topic-manager.tsx`) import that single component — verified by grep. (`nav-client.tsx`, listed as a consumer in the cycle-3 aggregate AGG-C3-01 blast radius, no longer imports Switch at HEAD; harmless drift in the old finding's text, not this fix.)

### Evidence AGAINST / gaps — **DOC DRIFT TRC-C4-02 (LOW) + INFO**
- **Stale header comment:** `switch.tsx:14` says the thumb "travels the full visible track width via `translate-x-[calc(100%-2px)]` (width-relative, unlike the old fixed 20px travel)". The code at `:49` uses **`translate-x-full`**, NOT `translate-x-[calc(100%-2px)]`. The inline comment at `:41-44` describes the ACTUAL `translate-x-full` math correctly. So the file contains two mutually-inconsistent descriptions of the travel; the header one describes an approach that was not shipped. The commit message also says `translate-x-full`. **Doc-only — the code is correct.** Fix: align `:14` to `translate-x-full`.
- **No geometry test:** the Switch references in `cycle4-rpf-source-contracts.test.ts` / `cycle5-…` are `switch` STATEMENTS (`mapErrorCode`), not the UI Switch. There is **no test pinning the thumb travel / track geometry** (INFO). A future Tailwind class edit could silently re-break it. Optional: a source-contract assert that thumb travel == inner-track − thumb-width.

### Verdict: geometry **CLEAN / fully fixed (1a)**. Latent risk is doc drift (TRC-C4-02, LOW) + missing geometry test (INFO). Critical unknown: none.

---

## FLOW 4 — Cache / ETag invalidation across 3 layers (static-serve, serve-upload, SW)

### Observation
Three serving layers carry `public, max-age=3600, must-revalidate`: Next static (`next.config.ts:69-72`), `serve-upload.ts:230/252`, nginx (`default.conf:157`). A settings change or backfill re-encode must invalidate cached derivatives without leaving a stale byte.

### Hypothesis table
| Rank | Hypothesis | Confidence | Evidence Strength |
|------|------------|------------|-------------------|
| 1 | Invalidation is correct on every layer for the SUPPORTED operation (backfill re-encode) | **High** | Strong |
| 2 | A settings-flip WITHOUT a backfill leaves a stale byte on the static path | Confirmed-but-by-design | Strong |

### Evidence FOR Hypothesis 1
- **serve-upload path** (locale-prefixed `/{locale}/uploads/...` + files missing from `public/`): ETag = `W/"v${PIPELINE}-${mtimeMs}-${size}-${settingsHash}"` (`serve-upload.ts:215`). `settingsHash` covers all `COLOR_IMPACTING_KEYS` (`getServingColorSettingsHash`, `:50-83`). So on this path a settings flip invalidates **immediately** (ETag changes even with unchanged mtime). De-enumeration comment de-drifted (AGG-C3-06 fix present, `:197-208`).
- **Static path** (production, existing files in `public/uploads/`): Next's default static server delivers these (documented precedence: `headers()` → filesystem → route handlers, `next.config.ts:56-67`). Its ETag is mtime+size only (no settings-hash). **Backfill re-encode rewrites bytes in place** → mtime AND size change → ETag changes → 304→200 revalidation fires on every cached client. Pipeline-version bumps invalidate via the same re-encode mtime change. CORRECT for the supported flow.
- **SW layer**: `staleWhileRevalidateImage` does a bounded (300ms) HEAD probe with `If-None-Match: cachedEtag` (`sw.js:233-257`); a differing server ETag → dispatch revalidate + serve fresh (`:247-252`); 304 → serve cached + touch LRU (`:241-246`). The SW honors whatever ETag the underlying layer returns, so after a backfill re-encode the static-path mtime ETag differs and the SW re-fetches. On probe timeout/failure it serves stale and self-heals in background — a deliberate one-paint window (`:254-262`).
- **SW version**: `SW_VERSION='dd26e742-p7'` (`sw.js:26`) lags HEAD `f8147868`, but the `prebuild` hook (`package.json:10`) runs `build-sw.ts` which stamps the **current** short-SHA + `-p${IMAGE_PIPELINE_VERSION}` (`build-sw.ts:32,46`) on every build. A deploy (`npm run build`) re-stamps it. The committed lag is expected and harmless — **NOT a defect**. `sw-template-contract.test.ts` passes (template ↔ reference parity intact).

### Evidence for Hypothesis 2 (by-design, not a defect)
- A settings flip with **no backfill** does NOT change the on-disk bytes or mtime, so the static-path mtime-only ETag does NOT invalidate → a client keeps the cached derivative. **But the on-disk bytes ARE the old encoding** (no re-encode happened), so serving them is *correct* — the static cache matches the file. The documented contract (CLAUDE.md, repeated) is that flipping a color setting REQUIRES a backfill to re-encode existing photos; the backfill is what changes the bytes and triggers invalidation on all layers. The serve-upload path's settings-hash ETag is an additional belt-and-braces for the paths it serves. **No stale-byte-vs-intended-byte divergence on the supported flow.**

### Evidence AGAINST / gaps
- The static path's mtime+size ETag means a settings-flip's *intent* reaches a static-served client only after the operator runs the (documented-mandatory) backfill. This is an accepted, documented design constraint — not a latent defect. SW per-tile HEAD probe (AGG-C3-12, deferred) unchanged.

### Verdict: **CLEAN** for the supported operation. No layer lets a stale byte survive a backfill re-encode. Critical unknown: none. (Hypothesis 2 is the documented single-instance/backfill-required contract, not a bug.)

---

## Convergence / separation notes
- TRC-C4-01 (sidecar exit-code over-count) and the prior-cycle AGG-C3-04 are **distinct**: AGG-C3-04 was "exit 0 hides stale metadata" (fixed by `a033056d`); TRC-C4-01 is the inverse residual — "exit 1 for rows that no longer exist." Same code region, opposite direction, introduced by the fix's interaction with the pre-existing deleted-mid-reencode partition.
- Flows 1 and 2's delete-mid-reencode handling **converge** on the same root mechanism (deleteImage takes no per-image lock; the encoder/backfill is the last writer and self-cleans on `affectedRows===0`). The sidecar's counting asymmetry is the only place this mechanism leaks into an observable (exit code), and only because its DB writes are batch-decoupled from the per-row encode.

---

## Findings summary

| ID | Severity | Confidence | File:line | Status |
|----|----------|------------|-----------|--------|
| **TRC-C4-01** | LOW | High | `scripts/backfill-color-pipeline.ts:413-414, 439, 485` | NEW — sidecar `detectionFailures` over-counts deleted-mid-reencode detection-failure rows → spurious non-zero exit. Bounded, not data-integrity. In-app runner clean. |
| **TRC-C4-02** | LOW | High | `apps/web/src/components/ui/switch.tsx:14` | NEW — stale header comment claims `translate-x-[calc(100%-2px)]`; code (and the correct inline comment at :41-44) uses `translate-x-full`. Doc-only; geometry correct. |
| TRC-C4-03 | INFO | High | `apps/web/src/components/ui/switch.tsx` | No test pins thumb-travel/track geometry; a future Tailwind edit could silently re-break it. Optional source-contract assert. |

**Re-confirmed CLEAN (evidence chains above):** delete-while-processing race (Flow 1), backfill detection-failure resume invariant (Flow 2, both paths), Switch geometry fix (Flow 3, pixel math + Radix data-state verified), 3-layer cache/ETag invalidation on the supported backfill flow (Flow 4).

**Deferred items re-validated, NOT re-reported:** AGG-C3-08 (original/ SIGKILL orphan — reasoning correct), AGG-C3-09 (upload-tracker quota in outer finally — framework-only), AGG-C3-12 (SW HEAD probe), AGG-C3-19 (no two-worker race test). SW_VERSION committed-lag is expected (prebuild re-stamps).

**HARD GUARD honored:** no proposal to activate CLIP semantic search.
