# Aggregate Review — Run 6 / Cycle 3 (review-plan-fix loop)

**HEAD:** b1e9e0da
**Date:** 2026-06-16
**Agents fanned out (11/11 returned):** code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer

This aggregate dedupes overlapping findings across all 11 agents, preserving the **highest** severity/confidence of any duplicate, and notes cross-agent agreement (multi-agent corroboration = higher signal). Per-agent files retained as-is for provenance.

---

## Headline

The codebase is in **genuinely strong shape**. ~58 findings closed across runs 4–6 are confirmed closed at HEAD by independent re-verification:

- **security-reviewer:** Risk LOW. 0 Critical / 0 High new. OG SSRF pin, Stripe card-only guard, bidi stripping all verified present & correct.
- **verifier:** All 10 load-bearing behavioral claims VERIFIED, 0 CONTRADICTED. 105 claim-relevant tests passing.
- **code-reviewer:** 0 Crit / 0 High / 0 Med — 2 Low + 1 nit. Prior-cycle Lows (CR-01 embeddings, CR-02 GPS zero-offset) confirmed closed.
- **perf-reviewer:** No Critical/High. SW LRU O(n log n) and unbounded map LIMIT both verified CLOSED.
- **debugger:** No new Crit/High confirmed. Prior DBG-H1 re-assessed down to Low.
- **tracer:** Auth, SW, Stripe flows traced CLEAN (suspected defects already closed). 3 Low.

The remaining surface is concentrated in (a) **two real UI MEDIUMs introduced by the touch-target retrofit / never-migrated tokens**, (b) **the orchestrator-injected test-isolation defect + siblings**, (c) a few **observability/doc-drift Lows**. No security/correctness/data-loss landmines survived verification.

**Important calibration:** The critic + tracer flagged "settings-hash covers 5 keys" and "cache() wraps 9 functions" as HIGH doc-drift, but **document-specialist independently verified BOTH are already corrected at HEAD** (CLAUDE.md:264 says 9; CLAUDE.md:361 says 10 and lists `getLatestImageForOgCached`). Those two agents worked from a pre-fix snapshot. **They are CLOSED — do NOT re-plan them.** This aggregate trusts document-specialist's direct file:line verification.

---

## MERGED FINDINGS (deduped, severity = max across agents)

### MEDIUM

#### AGG-C3-01 — Switch thumb geometry broken by 44px touch-target retrofit (MEDIUM, High)
- **Agents:** designer (DSGN3-MED-01)
- **File:** `apps/web/src/components/ui/switch.tsx:16,21-25`
- **Problem:** Track was retrofitted to `min-h-11 min-w-11` (44px) for the touch-target audit, but the thumb is still `size-5` (20px) with `data-[state=checked]:translate-x-5` (20px travel). In a 44px-wide track, a 20px thumb travels from x=0 (unchecked) to x=20 (checked) → checked-state thumb center sits at ~30px in a 44px track and **never reaches the right edge**, so every toggle reads as "half-on." Verified by reading the file: track `min-w-11` + thumb `size-5` + `translate-x-5`.
- **Blast radius:** All Switch usages — `search.tsx`, `nav-client.tsx`, `settings/settings-client.tsx` (all color-pipeline tunables), `categories/topic-manager.tsx`.
- **Fix:** Keep the 44px tappable hit area but render a normally-proportioned visible pill (e.g. a smaller visible track inside a 44px hit-zone, OR scale thumb + travel to fill the 44px track). Must keep the audit passing (`min-h-11`/`min-w-11` on the hit target).
- **Confidence:** High (geometry verified directly).

#### AGG-C3-02 — Histogram clip labels use sub-AA `text-red-500` in light mode (MEDIUM, High)
- **Agents:** designer (DSGN3-MED-02)
- **File:** `apps/web/src/components/histogram.tsx` (the two `<span className="text-red-500">` clip-warning lines ~671/674)
- **Problem:** Shadow/highlight clip warnings (load-bearing for photographers) use raw `text-red-500` (#ef4444) = **3.76:1 on the white card** → fails WCAG 1.4.3 AA (4.5:1 for normal `text-xs`). The app already defines a theme-aware `--destructive-text` token (`globals.css:43` light = `0 73.7% 41.8%` ≈ red-700, AA on white; `:69/:97` dark) and the `text-destructive-text` utility is already used in 5+ components. These two histogram lines were never migrated.
- **Fix:** Swap `text-red-500` → `text-destructive-text` on both clip-warning spans. Proven one-liner.
- **Confidence:** High (token verified to exist + be in use; contrast math confirmed).

### LOW (fix this cycle)

#### AGG-C3-03 — Test-isolation: scratch files written into repo-tracked dirs (ORCH-C3-TMPDIR family) (LOW→MED isolation hygiene, High)
- **Agents:** test-engineer (TE-C3-01, TE-C3-02), orchestrator-injected (ORCH-C3-TMPDIR — MANDATORY)
- **Files:**
  - `apps/web/src/__tests__/process-topic-image.test.ts:70,154,169-173` — writes `tmp-test-*`, `keep-*.webp`, `<uuid>.webp` into repo-tracked `public/resources/` (root computed from `process.cwd()` at module-eval, no env override). **Stray `tmp-test-1781600723284` (5 bytes) currently sits in `public/resources/`**; `afterAll` only unlinks files created *this run*, never sweeping prior orphans. test-engineer reports `<uuid>.webp` orphans also survived an isolated run.
  - `apps/web/src/lib/process-topic-image.ts:11-20` — `RESOURCES_DIR` root cause: no env override, so the test cannot redirect to an OS tmpdir.
  - **Sibling family (TE-C3-01):** ~7 tests write AVIF/WebP/JPEG into the live `public/uploads/` serving dir relying only on per-id `afterAll` unlink — e.g. `process-image-color-roundtrip.test.ts` (56 ops), `process-image-exif-strip.test.ts`, `process-image-orientation.test.ts`, `backfill-color-pipeline.test.ts` (24 ops). `UPLOAD_ROOT`/`UPLOAD_ORIGINAL_ROOT` are env-redirectable (`lib/upload-paths.ts:13,28`) but no test uses them.
- **Fix (scoped to ORCH-C3-TMPDIR + the topic-image test this cycle; uploads-family deferred):**
  1. Add an env override to `process-topic-image.ts` `RESOURCES_DIR` (e.g. `TOPIC_RESOURCES_ROOT`) mirroring the `upload-paths.ts` pattern.
  2. Point `process-topic-image.test.ts` at `os.tmpdir()` + `fs.mkdtempSync` via that env, with whole-dir cleanup in `afterAll` (rm -rf the temp dir, not per-file unlink).
  3. Remove the existing stray `public/resources/tmp-test-1781600723284` (+ any `<uuid>.webp` orphans) as part of the committed fix.
  4. Verify `npm run test --workspace=apps/web` leaves the working tree clean (no new `public/resources/` or `public/uploads/` artifacts).
- **Confidence:** High (stray artifact directly observed; root cause read in source).

#### AGG-C3-04 — Sidecar backfill exits 0 on an all-detection-failure run (LOW, Medium)
- **Agents:** code-reviewer (CR3-01), tracer (D3 no-progress-loop variant)
- **File:** `apps/web/scripts/backfill-color-pipeline.ts:413-462` (esp. 416-417, 462)
- **Problem:** `reprocessRow` returns `{outcome:'processed'}` for BOTH success and detection-failure-after-encode; `main` does `processed++` for both, detection failures aren't counted in `errors`, so `process.exit(errors>0?1:0)` returns success even when every row's color detection threw and no `pipeline_version` advanced. Data integrity is fine (resume contract intact — the in-app runner handles this correctly via `lastRunHadFailures`), but a CI/cron wrapper keying on exit code sees green while color metadata silently went stale gallery-wide.
- **Fix:** Track + surface `detectionFailures` separately; include it in the last-run summary and make `process.exit` non-zero when detectionFailures > 0 (or at minimum emit a distinct WARN summary line).
- **Confidence:** Medium.

#### AGG-C3-05 — Stale `max-age=86400` docstring in settings-hash.ts (LOW, High)
- **Agents:** critic (MINOR-1), document-specialist (F1), tracer (within D2)
- **File:** `apps/web/src/lib/settings-hash.ts:20` (docstring)
- **Problem:** Docstring says `Cache-Control max-age=86400`, actual served value is `max-age=3600, must-revalidate` in all three layers (`serve-upload.ts:230/252`, `next.config.ts:71`, `nginx/default.conf:157`) since R8-R7. Makes the staleness window look 24× worse than reality. (Legitimate 86400 occurrences are `s-maxage`/`stale-while-revalidate` on OG routes — different surface.)
- **Fix:** Update docstring to `max-age=3600, must-revalidate`.
- **Confidence:** High.

#### AGG-C3-06 — serve-upload.ts ETag comment re-enumerates keys it warns against re-enumerating (LOW, Low impact)
- **Agents:** code-reviewer (CR3-02)
- **File:** `apps/web/src/lib/serve-upload.ts:197-208`
- **Problem:** Comment says "do NOT re-enumerate them here; it drifts" then lists all 9 `COLOR_IMPACTING_KEYS` inline. Currently consistent with `settings-hash.ts:37-49`, but this is the exact stale-count trap AGG-R7-08 just fixed.
- **Fix:** Replace inline list with a pointer to `COLOR_IMPACTING_KEYS`.
- **Confidence:** High (fact) / Low (impact).

#### AGG-C3-07 — Stripe `async_payment_succeeded` cross-ref label drift in CLAUDE.md (LOW, Medium)
- **Agents:** document-specialist (F2); gap corroborated by tracer (Stripe flow), verifier (claim 10), security-reviewer
- **File:** CLAUDE.md entitlements note vs `apps/web/src/app/api/stripe/webhook/route.tsx:91-104`
- **Problem:** CLAUDE.md cites "plan-316 CRT-R5C1-04"; code now tracks under "Cycle 3/4 RPF / P262-01 / P264-03". Behavioral claim is **accurate** (async-paid genuinely NOT handled) and **operationally closed** (`checkout/[imageId]/route.ts:207` pins `payment_method_types:['card']`). Only the cross-ref label drifted.
- **Fix:** Update CLAUDE.md cross-ref label to match the code comment's tracking ID.
- **Confidence:** Medium.

#### AGG-C3-18 — Layering trap: client-safe predicate imported via server-only re-export (LOW, High)
- **Agents:** architect (A6)
- **File:** `apps/web/src/app/actions/images.ts:29` imports via `color-detection.ts:48` re-export (which pulls `fs`/Sharp)
- **Problem:** `actions/images.ts` imports a client-safe predicate through the server-only `color-detection` re-export. Repoint to the client-safe leaf (`color-primaries` / `color-pipeline-decisions`), drop the re-export.
- **Fix:** Repoint the import; remove the re-export. Small, safe.
- **Confidence:** High.

### LOW / structural / perf / test / a11y — DEFER candidates (full detail in per-agent files)

- **AGG-C3-08 (LOW, tracer D1):** Orphaned `original/{uuid}` on SIGKILL between original-write (`images.ts:280`) and DB INSERT (`:382`); `cleanOrphanedTmpFiles` sweeps only webp/avif/jpeg dirs, not `original/`. Disk-bloat only.
- **AGG-C3-09 (LOW, debugger DBG-L1):** Upload-tracker quota claim settled inside outer `try`; outer `finally` (`images.ts:538-540`) releases only contract lock. Framework-only trigger; quota over-count until window expires. Fix: move settlements into `finally` behind a `let settled` guard.
- **AGG-C3-10 (LOW/MED perf, PERF-C3-01):** `process-image.ts:1019-1022` full `metadata()` decode discarded for sRGB sources (gate it behind `isWideGamutSource`).
- **AGG-C3-11 (LOW perf, PERF-C3-03):** Admin dashboard grid OFFSET pagination (`data.ts:915-937`); admin-only, bounded.
- **AGG-C3-12 (LOW perf, PERF-C3-02):** SW per-tile HEAD ETag probe on warm-cache display path (`sw.js:233-257`); deliberate color-freshness tradeoff, bounded by 300ms timeout.
- **AGG-C3-13 (LOW perf):** feed filesort (`data.ts:771-794`), `getFailedImages` unindexed (`:940-954`), `getTopics` correlated subquery (`:452-473`), touch-swipe re-render (`photo-navigation.tsx:93`), wheel rect thrash (`image-zoom.tsx:103,110`).
- **AGG-C3-14 (HIGH structural, architect A1) → DEFER per CLAUDE.md:** `@/lib/storage` (390 LOC, zero importers) is intentionally-retained future abstraction. CLAUDE.md explicitly forbids exposing it until wired end-to-end. Exit criterion: delete OR wire when storage backends become a roadmap item.
- **AGG-C3-15 (HIGH structural, architect A2; critic REFUTED corruption framing) → DEFER per CLAUDE.md topology rule:** Restore-maintenance flag process-local while restore lock server-scoped. critic confirmed the server-scoped `LOCK_UPLOAD_PROCESSING_CONTRACT` (held across the whole restore window, `db-actions.ts:302`) **blocks** 2nd-instance writes rather than corrupting. CLAUDE.md documents single-instance topology. Exit criterion: add a startup single-instance advisory lock IF horizontal scaling is attempted.
- **AGG-C3-16 (MED structural, architect A3 + critic MINOR-2):** `reconcileLegacySchema` hand-maintained schema mirror; post-condition checks journal hashes, not that the mirror produced columns; existing tripwire is name-only (can't catch ALTER/MODIFY). Fix: a schema-parity test diffing reconcile output vs `schema.ts`. Plan as MED hardening OR defer.
- **AGG-C3-17 (MED structural, architect A4/A5) → DEFER:** `actions/images.ts` god-action (1157 LOC) + LR route duplicates upload pipeline. Extract shared `lib/upload-orchestration.ts`. Exit criterion: extract when the upload pipeline next needs a change touching both sites.
- **AGG-C3-19 (MED test, TE-C3-03):** Per-image processing-claim RACE has no runtime test — only lock-name string pins. Plan a TDD opportunity OR defer.
- **AGG-C3-20 (MED test, TE-C3-04):** Untested admin-mutation actions — `updateGallerySettings` (zero tests, single mutation point for ALL color tunables), `login`/`updatePassword`, smart-collection CRUD action, `backfillClipEmbeddings`. Plan OR defer.
- **AGG-C3-21 (LOW test, TE-C3-05):** `lib/analytics-data.ts` (5 query builders) zero tests; GROUP BY exposure.
- **AGG-C3-22 (LOW test, TE-C3-06):** `data-tag-names-sql.test.ts:244` rebuilds query inline rather than compiling real `getImagesLite`.
- **AGG-C3-23 (LOW test, TE-C3-07):** e2e gaps — paid-download single-use, license gating, view-count semantics, webhook→entitlement.
- **AGG-C3-24..29 (LOW designer):** timeline/year cards no touch title; lightbox spinner silent `role=status`; histogram compute overlay no live region; 4 hardcoded `outline-blue-500` vs `ring-ring`; InfoBottomSheet empty peek pill on sRGB; TopicManager dialogs lack `DialogDescription`.
- **AGG-C3-30 (INFO designer):** `ui/sheet.tsx` unused, sub-44px close button (dead code).
- **AGG-C3-31 (MED security operational, security-reviewer):** Real `SESSION_SECRET`+bootstrap passwords recoverable in git history (initial commit `d7c32790` `.env.local.example`, removed `d068a7fb`). HEAD clean. CLAUDE.md already documents rotate-immediately. **Operational, not a code change.** Record as deferred/operational.
- **AGG-C3-32 (LOW security, security-reviewer):** SQL-restore scanner inter-token comment bypass (`sql-restore-scan.ts:104`) `DROP/**/TABLE`→`DROPTABLE`. Defense-in-depth only (gated by admin-auth + same-origin + `--one-database`; app-table drops intentionally allowed). Optional quick-fix: replace comments with a space.
- **AGG-C3-33 (LOW security, security-reviewer):** `admin-tokens.verifyToken` bumps `last_used_at` before scope check (cosmetic).

---

## DISPOSITION SUMMARY (for PROMPT 2 planning)

**FIX THIS CYCLE (concrete, verified, high-value):**
- AGG-C3-01 — Switch geometry (MED)
- AGG-C3-02 — Histogram contrast (MED)
- AGG-C3-03 — ORCH-C3-TMPDIR test isolation (INJECTED, mandatory)
- AGG-C3-04 — Sidecar backfill exit code (LOW)
- AGG-C3-05 — settings-hash.ts:20 max-age docstring (LOW)
- AGG-C3-06 — serve-upload.ts ETag comment de-enumeration (LOW)
- AGG-C3-07 — Stripe cross-ref label drift in CLAUDE.md (LOW)
- AGG-C3-18 — color-detection re-export layering trap (LOW)

**DEFER (record with citation + severity + exit criterion):** AGG-C3-08..17, AGG-C3-19..33 per the per-finding notes above.

**CLOSED — do NOT re-plan (verified at HEAD):** "settings-hash 5 keys" (now 9), "cache() 9 functions" (now 10), all ~58 prior-cycle findings.

**HARD GUARD honored:** CLIP semantic search remains disabled-by-design; no agent proposed activation. Disable/heal logic verified correct (verifier claim 2).

---

## AGENT FAILURES

First fan-out (single message, 11 concurrent agents): the server transiently rate-limited 9 of 11 (`API Error: Server is temporarily limiting requests` — NOT a usage limit). 2 succeeded on first attempt (perf-reviewer, architect). The 9 were **retried in staggered batches of 3** and all 9 completed on retry:
- Retry batch 1: security-reviewer, code-reviewer, verifier — succeeded.
- Retry batch 2: critic, test-engineer, tracer — succeeded.
- Retry batch 3: debugger, document-specialist, designer — succeeded.

**Final: 11/11 agents returned and wrote their per-agent files. No permanent failure.**
