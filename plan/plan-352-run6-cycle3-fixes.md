# Plan 352 — Run 6 / Cycle 3 — Fixes

**Source:** `.context/reviews/_aggregate.md` (cycle 3, HEAD b1e9e0da) + per-agent reviews.
**Status:** IN PROGRESS
**Repo policy:** GPG-signed commits (`-S`), conventional + gitmoji, no `--no-verify`, `git pull --rebase` before push, fine-grained commits, run `npm run typecheck --workspace=apps/web` before committing test changes. Per-cycle deploy via `npm run deploy`.

This plan schedules the 8 fix-this-cycle findings. Every other review finding is recorded in `plan-353-run6-cycle3-deferred.md`. No finding silently dropped.

---

## TASK 1 — ORCH-C3-TMPDIR: test-isolation defect (INJECTED, MANDATORY) [AGG-C3-03]

**Severity:** test-isolation hygiene (orchestrator-injected mandatory).
**Confidence:** High.
**Files:**
- `apps/web/src/lib/process-topic-image.ts:11-20` (root cause: `RESOURCES_DIR` has no env override)
- `apps/web/src/__tests__/process-topic-image.test.ts:70,154,169-173` (writes scratch into repo-tracked `public/resources/`)
- stray artifact: `public/resources/tmp-test-1781600723284` (+ any `<uuid>.webp` orphans)

**Root cause:** `process-topic-image.ts` computes `RESOURCES_DIR` from `process.cwd()` at module-eval time with no env override. Under Vitest (cwd = `apps/web`) the test writes `tmp-test-*`, `keep-*.webp`, and real `<uuid>.webp` Sharp outputs into the repo-tracked `public/resources/` directory. `afterAll` only unlinks files created in the current run; prior orphans (and any crash-interrupted runs) leak into the working tree. `public/resources/` is NOT gitignored, so the stray shows up as untracked `public/`.

**Implementation:**
1. Add a `TOPIC_RESOURCES_ROOT` env override to `process-topic-image.ts` `RESOURCES_ROOT`/`RESOURCES_DIR` (mirror the `UPLOAD_ROOT`/`UPLOAD_ORIGINAL_ROOT` pattern in `lib/upload-paths.ts:13,28`). When set, use it verbatim; otherwise keep the existing cwd-derived behavior so production is unchanged.
2. In `process-topic-image.test.ts`: set `process.env.TOPIC_RESOURCES_ROOT` to a fresh `fs.mkdtempSync(path.join(os.tmpdir(), 'gk-topic-res-'))` **before** importing the module (module-eval reads the env), and in `afterAll` `fs.rm(tempDir, { recursive: true, force: true })`. Remove the brittle per-file `writtenFiles`/`createdFiles` arrays in favor of whole-dir cleanup.
3. Delete the existing stray `public/resources/tmp-test-1781600723284` and any `<uuid>.webp` / `keep-*.webp` orphans under `public/resources/` in the same commit.
4. Verify: `npm run test --workspace=apps/web` then `git status --porcelain` — must show NO new `public/resources/` or `public/uploads/` entries.

**Acceptance:** test passes against the tmpdir; full test run leaves the working tree clean; no env override in production = no behavior change.

**Status:** PENDING

---

## TASK 2 — Switch thumb geometry broken by 44px retrofit [AGG-C3-01]

**Severity:** MEDIUM. **Confidence:** High.
**File:** `apps/web/src/components/ui/switch.tsx:16,21-25`

**Problem:** Track is `min-h-11 min-w-11` (44px) for the touch-target audit, but thumb is `size-5` (20px) with `translate-x-5` (20px travel). In a 44px track the thumb never reaches either edge → every toggle reads "half-on." Affects search, nav, settings (color tunables), categories.

**Implementation:** Preserve the 44px tappable hit-zone (audit requires `min-h-11`/`min-w-11` and the touch-target test must keep passing) but make the *visible* track a normally-proportioned pill with a thumb that fully travels. Approach: render an inner visible track (e.g. `h-6 w-11` rounded-full with the bg-state classes) centered inside the 44px `SwitchPrimitive.Root` hit area, and a thumb sized/translated to fill that inner track edge-to-edge (e.g. `size-5` thumb with `translate-x-[1.375rem]`-equivalent travel for a 44px-wide visible track, OR an inner `w-11 h-6` track with `size-5` thumb + `translate-x-5`). Verify the checked thumb sits flush against the right edge and unchecked flush left.

**Acceptance:** Visual: checked state thumb at right edge, unchecked at left edge, on all 7 Switch usages. `npm test` touch-target audit still green (hit-zone ≥ 44px).

**Status:** PENDING

---

## TASK 3 — Histogram clip labels sub-AA in light mode [AGG-C3-02]

**Severity:** MEDIUM (WCAG 1.4.3 AA fail). **Confidence:** High.
**File:** `apps/web/src/components/histogram.tsx` (two `<span className="text-red-500">` clip-warning lines, ~671/674)

**Problem:** `text-red-500` (#ef4444) = 3.76:1 on the white card; fails AA for `text-xs`. The theme-aware `--destructive-text` token (`globals.css:43` light ≈ red-700 AA-compliant; `:69/:97` dark) already exists and is used in 5+ components.

**Implementation:** Replace `text-red-500` → `text-destructive-text` on both clip-warning spans.

**Acceptance:** Both spans use `text-destructive-text`; contrast ≥ 4.5:1 in light mode; dark mode unaffected (token already AA there).

**Status:** PENDING

---

## TASK 4 — Sidecar backfill exits 0 on all-detection-failure run [AGG-C3-04]

**Severity:** LOW (observability). **Confidence:** Medium.
**File:** `apps/web/scripts/backfill-color-pipeline.ts:413-462` (esp. 416-417, 462)

**Problem:** `reprocessRow` returns `{outcome:'processed'}` for both success and detection-failure-after-encode; `main` counts both as `processed` and neither as `errors`, so `process.exit(errors>0?1:0)` is green even when every row's color detection threw (no `pipeline_version` advanced). A CI/cron wrapper keying on exit code sees success while metadata silently went stale.

**Implementation:** Add a `detectionFailures` counter distinct from `errors` and `processed`. When `reprocessRow` hits detection-failure-after-encode, increment it. In `main`'s summary, log `detectionFailures` explicitly, and set the exit code non-zero when `detectionFailures > 0` (so a wrapper can distinguish "all stale" from "all good"). Keep the resume contract unchanged (still no version bump on detection failure — that is correct). Mirror the in-app runner's `lastRunHadFailures` semantics for parity.

**Acceptance:** A run where detection always fails exits non-zero and logs the detectionFailures count; a clean run still exits 0. Update `__tests__/backfill-color-pipeline.test.ts` if it asserts on the summary/exit shape.

**Status:** PENDING

---

## TASK 5 — Stale `max-age=86400` docstring in settings-hash.ts [AGG-C3-05]

**Severity:** LOW (doc drift). **Confidence:** High.
**File:** `apps/web/src/lib/settings-hash.ts:20`

**Problem:** Docstring says `Cache-Control max-age=86400`; actual served value is `max-age=3600, must-revalidate` everywhere since R8-R7. 24× overstated staleness window.

**Implementation:** Update the docstring to `max-age=3600, must-revalidate`.

**Acceptance:** Docstring matches the three serving layers.

**Status:** PENDING

---

## TASK 6 — serve-upload.ts ETag comment re-enumerates keys [AGG-C3-06]

**Severity:** LOW. **Confidence:** High (fact) / Low (impact).
**File:** `apps/web/src/lib/serve-upload.ts:197-208`

**Problem:** Comment warns "do NOT re-enumerate them here; it drifts" then inlines all 9 `COLOR_IMPACTING_KEYS`. Stale-count trap (the same "5"→"9" drift AGG-R7-08 fixed).

**Implementation:** Replace the inline key list with a pointer to `COLOR_IMPACTING_KEYS` in `settings-hash.ts` (single source of truth). Keep the explanatory prose, drop the enumeration.

**Acceptance:** No inline key enumeration in the comment; points to the canonical constant.

**Status:** PENDING

---

## TASK 7 — Stripe `async_payment_succeeded` cross-ref label drift in CLAUDE.md [AGG-C3-07]

**Severity:** LOW (doc cross-ref). **Confidence:** Medium.
**File:** `CLAUDE.md` (entitlements `Warning:` note) vs `apps/web/src/app/api/stripe/webhook/route.tsx:91-104`

**Problem:** CLAUDE.md cites "plan-316 CRT-R5C1-04"; the code comment tracks the gap under "Cycle 3/4 RPF / P262-01 / P264-03". Behavioral claim is accurate and operationally closed (card-only pin). Only the label drifted.

**Implementation:** Update the CLAUDE.md cross-ref to match the code comment's tracking ID (or reconcile both to one canonical ID). Keep the accurate behavioral description.

**Acceptance:** CLAUDE.md and the webhook route comment agree on the tracking ID.

**Status:** PENDING

---

## TASK 8 — color-detection re-export layering trap [AGG-C3-18]

**Severity:** LOW (layering). **Confidence:** High.
**File:** `apps/web/src/app/actions/images.ts:29` (import) + `apps/web/src/lib/color-detection.ts:48` (re-export)

**Problem:** `actions/images.ts` imports a client-safe predicate through the server-only `color-detection` re-export (which pulls `fs`/Sharp). Latent client-bundle-bloat / layering trap.

**Implementation:** Repoint the `actions/images.ts:29` import to the client-safe leaf module that actually owns the predicate (`@/lib/color-primaries` for `isWideGamutPrimary`, or `@/lib/color-pipeline-decisions` for `isP3Pipeline` — confirm which symbol is imported). Then remove the now-unnecessary re-export line in `color-detection.ts:48` IF no other importer depends on it (grep first). If other importers exist, repoint those too or leave the re-export and just fix the actions import (minimum: actions import points at the leaf).

**Acceptance:** `actions/images.ts` no longer imports the predicate via `color-detection`; `npm run typecheck` + `npm run build`-equivalent type gate pass; no broken importers.

**Status:** PENDING

---

## Gate requirements (all tasks)

Before commit+push and deploy, the full repo must pass:
- `npm run lint --workspace=apps/web` (ESLint)
- `npm run typecheck --workspace=apps/web`
- `npm test --workspace=apps/web` (Vitest)
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`

Errors are blocking. No suppressions unless repo rules authorize (quote in commit body). Warnings best-effort; defer with note if not cleanly fixable.

## Progress log
- (to be updated during PROMPT 3)
