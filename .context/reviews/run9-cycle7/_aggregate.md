# Aggregate Review — Run-9 Cycle-7 (HEAD `feb63faa`)

**Date:** 2026-06-21
**Agents fanned out (11/11 returned + persisted):** code-reviewer, security-reviewer, architect, critic, verifier, test-engineer, perf-reviewer, tracer, debugger, document-specialist, designer.

**Gate state (fresh foreground runs by verifier at HEAD `feb63faa`, pre-fix):** ESLint exit 0 (0 errors / 0 warnings); lint:api-auth (2 admin routes OK) / lint:action-origin (37 OK + 5 exempt) / lint:public-route-rate-limit (6 routes OK) all exit 0; typecheck (app + scripts) exit 0; Vitest **2058 passed / 4 skipped / 0 failed** (225 files); Next.js prod build exit 0 (10 static + 29 dynamic routes). SW stamp `feb63faa-p7` matches HEAD. The 4 skips are exclusively the CLIP-weight-gated suites.

## Context

Cycle-7 of run-9. Run-8 converged c2 (`f63af3b9`); run-9 c1 (2 LOW test files), c2 (1 LOW cicp drain), c3 (2 LOW), c4 (1 LOW similar-photos accname), c5 (1 MEDIUM restore-scanner allowlist — FIXED), c6 (1 MEDIUM upload 6-settings bypass CR-R9C6-01 — FIXED `2078e43f`). HEAD `feb63faa` is the c6 docs-provenance commit.

This cycle executed the orchestrator's SPECIAL FOCUS #3 directive: VERIFY the c6 fix is COMPLETE — i.e. that EVERY other enqueue/processing entry point forwards the same 6 settings or correctly falls back. **The fan-out found ONE genuine DEFECT — CR-R9C7-01: the c6 fix wired the BROWSER upload path but MISSED the Lightroom PAT publish path, which has the IDENTICAL bypass. This is precisely the "missed consumer" outcome the SPECIAL FOCUS directive was hunting for.** It was confirmed independently and unanimously by ALL 11 agents with full Tier-1 file:line corroboration, and re-verified at the source by the lead.

---

## Cross-agent disposition table

| Axis | Agent | Verdict |
|---|---|---|
| Correctness / logic | code-reviewer | **1 DEFECT — CR-R9C7-01** (LR route :420 omits the 6). Full 8-row consumer audit table; only LR fails. 1 POLISH noted (settings-wiring test mocks `@/lib/caption` but real import is `@/lib/caption-generator` — inert). |
| Security (OWASP) | security-reviewer | **CLEAN security** — auth chain, 8 routes, path-traversal+symlink+realpath, Drizzle+allowlist, restore scanner, SSRF origin-pin, sanitizers, privacy guards, rate limits all verified. CR-R9C7-01 cross-confirmed as CORRECTNESS (not security; none of the 6 is a security control; `strip_gps_on_upload` IS correctly applied on the LR path). 1 DEFERRED non-exploitable: postcss 8.4.31 bundled inside `node_modules/next/` (build-time only, no runtime CSS path). ZERO security findings. |
| Architecture / drift | architect | **1 DEFECT (CR-R9C7-01) + drift sweep CLEAN** — schema↔reconcile 18/18 tables, 50/50 images columns NO DRIFT; APP_BACKUP_TABLES superset OK; COLOR_IMPACTING_KEYS=9; privacy guards 19 fields aligned; 6 locks symmetric (incl. backfill ownership-transfer null-then-release); delete-mid-processing cleanup ×3; restore quiesce intact; backfill cap=2@pool10. The LR omission IS the snapshot-field-not-forwarded drift class. |
| Critic / meta | critic | **REVISE — 1 DEFECT confirmed; convergence NOT genuine this cycle.** Independent LR verdict = DEFECT HIGH. FALSE_DOC_CLAIMS via CLAUDE.md high-entropy spot-check: 0 (doc exceptionally well-maintained). MED-R7C2-01 + REJ-R7C3-01 re-confirmed sound (not re-opened). After LR fix lands, convergence will be genuine (bug class has no other instance). |
| Gate evidence | verifier | **FAIL (1 blocker = CR-R9C7-01); 7/7 gates GREEN pre-fix.** Vitest 2058/4/0; build OK; SW `feb63faa-p7` matches HEAD. Criterion #6 (LR forwards 6) MISSING. |
| Test health | test-engineer | **1 DEFECT (TE-R9C7-01 = same LR defect) + coverage gap** — NO test catches the LR omission: `lr-upload-hdr-gate.test.ts` asserts only camera_model/capture_date; `image-queue-settings-wiring.test.ts` covers only the browser path by design. All other audited tests valid + non-vacuous (backfill column-set, reconcile tripwire, restore superset, privacy fixture, i18n parity, NCLX pins). |
| Performance | perf-reviewer | **CLEAN — 0 perf findings.** data.ts cache()/tagNamesAgg/no-N+1; indexes cover hot shapes; Sharp fan-out bounded; serve-upload TTL+SWR; SW LRU+300ms HEAD; all 13 in-memory Maps bounded; zero sync I/O on request paths. CR-R9C7-01 cross-confirmed as correctness (wrong bytes), not perf. |
| Causal tracing | tracer | **1 DEFECT (CR-R9C7-01) CONFIRMED** with the full causal chain + decisive line `route.ts:420-444` → handler seeds 6 from job (`?? false`/undefined) → gate `image-queue.ts:336` false (quality present) → config never loaded → processImageFormats gets defaults. settings-hash→ETag flow CLEAN. |
| Latent bugs | debugger | **1 DEFECT (CR-R9C7-01)** from data-flow angle (grep of the 6 names in route.ts = 0 hits). All binary parsers + utility modules CLEAN, no new latent defects. |
| Docs vs code | document-specialist | **1 DEFECT + 1 FALSE doc-claim** — CR-R9C7-01 confirmed; **CLAUDE.md ~line 288 ("All admin tunables flow through gallery-config-shared.ts → gallery-config.ts → image-queue.ts (passes to processImageFormats)") is RENDERED FALSE for the LR publish path.** 20/20 key-file paths exist; all other high-entropy claims (pipeline=7, keys=9, HASH=8, cache()=10, NCLX maps, retention=395, 6 locks, nginx caps, upload limits, admin defaults) MATCH. |
| UI/UX a11y | designer | **CLEAN a11y — 0 WCAG defects** (also cross-confirmed CR-R9C7-01 from the auto-alt-text angle). 44px floor held; dialog traps, live regions, ARIA labels, skip-link, lang attr all present. 3 pre-deferred items' exit criteria unmet. |

**Cross-agent agreement on CR-R9C7-01:** ALL 11 agents confirmed it (correctness lanes found it as the DEFECT; security/perf cross-confirmed as out-of-lane correctness; designer cross-confirmed via auto-alt-text; document-specialist additionally found the false doc-claim). UNANIMOUS, full file:line corroboration, lead-re-verified at the source. HIGHEST confidence.

---

## SCHEDULED finding (this cycle)

### CR-R9C7-01 [MEDIUM, conf HIGH, DEFECT — correctness on the Lightroom publish product path] — LR PAT upload bypasses the same 6 admin processing settings that CR-R9C6-01 fixed for browser uploads (11-agent unanimous agreement)

**Where:** `apps/web/src/app/api/admin/lr/upload/route.ts:420-444` (the `enqueueImageProcessing` call). The full config is already in scope at `route.ts:170` (`const config = await getGalleryConfig()`). Contrast: the FIXED browser path `apps/web/src/app/actions/images.ts:461-466` forwards all 6. Handler gate `apps/web/src/lib/image-queue.ts:336` (`if (!quality && !imageSizes)`); the 6 seeded from `job.*` at `:326-335`.

**Why it's a DEFECT (never deferrable — correctness on a documented product-runtime path):**
- The LR enqueue supplies `quality` (`:428-432`, built from `config.imageQuality{Webp,Avif,Jpeg}`) + `imageSizes` (`:433`) but does NOT forward `forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, `autoAltTextEnabled`.
- Because `quality` is truthy, the handler's config-load gate `if (!quality && !imageSizes)` is NEVER entered → the 6 fall to the handler's `?? false` / `undefined` seeds → process-image's own `??` defaults (`false` / `'4:4:4'` / `6` / `'4:2:0'` / `50_000_000` / `false`).
- This is the EXACT pre-CR-R9C6-01 browser bug, surviving on the documented primary non-browser ingest path (Lightroom Classic publish plugin, US-P53).
- The fallbacks coincide with the schema/process-image defaults, so the bug is LATENT on a factory install (byte-identical) but produces silently wrong output the moment an admin changes any of the 6 documented tunables.

**Concrete failure scenarios (admin-visible, LR-published photos):**
1. `force_srgb_derivatives=true` → a Lightroom-published Display-P3 photo gets P3-tagged WebP/JPEG anyway (violates the documented sRGB-only-delivery contract) until a manual backfill.
2. `wide_gamut_max_source_pixels` lowered → the ENCODER uses the 50 M default and does NOT downscale → potential OOM on the rgb16 pipeline — the exact failure the setting exists to prevent.
3. `avif_effort` / `sdr_jpeg_chroma` / `wide_gamut_jpeg_chroma` tuned → LR uploads use process-image defaults, diverging in file-size/chroma from backfilled photos.
4. `auto_alt_text_enabled=true` → LR uploads never get the configured caption stub.

**Why MEDIUM (not LOW or CRITICAL):** disables 6 admin-documented tunables on a documented production ingest path AND silently violates the core photographer-intent contract whenever any is used; but the original is preserved and a `--force-reencode` backfill repairs it, and it only affects installs that BOTH tuned a non-default AND ingest via the LR plugin. Not deferrable — correctness on a product-runtime path; the high-bar policy lists "real product-runtime bug" as never-deferrable.

**Why c6 missed it:** the c6 fix targeted the browser upload enqueue (`images.ts:440`) and added the wiring test for that path only; the LR enqueue (`lr/upload/route.ts:420`) is a structurally parallel but separate call site that was not updated, and `lr-upload-hdr-gate.test.ts` asserts only camera_model/capture_date in the enqueue block — no settings-forwarding assertion existed for the LR path.

**Fix (SCHEDULED):**
1. Add the 6 fields to the `enqueueImageProcessing({...})` call at `lr/upload/route.ts:420`, sourced from the already-loaded `config`, mirroring `images.ts:461-466`. (Six lines, no new DB query, no schema change.)
2. Extend `lr-upload-hdr-gate.test.ts` with a source-contract assertion that the LR enqueue block forwards each of the 6 settings (so regression is locked, mirroring the existing camera_model/capture_date assertion + the browser path's `image-queue-settings-wiring.test.ts`).
3. SW re-stamp via prebuild after source change.

**Associated FALSE doc-claim (document-specialist, never deferrable — but RESOLVED by the same fix):** CLAUDE.md "Admin tunables (color/HDR)" section claim that all admin tunables flow to processImageFormats becomes TRUE again once the LR enqueue forwards them. No separate doc edit required beyond the code fix (the claim is about the pipeline contract, which the fix restores). If desired, a one-line note can be added; not required for correctness.

**migrate.js note (REPO CONVENTIONS #6/#7):** NO schema migration / DDL — only forwards existing config fields on an existing job type at one additional enqueue site. No `reconcileLegacySchema` / APP_BACKUP_TABLES / COLOR_IMPACTING_KEYS / privacy-guard change. The drift swept by architect (18/18 tables, 50/50 columns, 9 keys, 19 privacy fields) is CLEAN.

---

## DEFERRED finding(s) (this cycle)

### DEF-R9C7-01 [LOW, conf Medium, POLISH] — `image-queue-settings-wiring.test.ts` mocks `@/lib/caption` but the real import is `@/lib/caption-generator`
**Where:** `apps/web/src/__tests__/image-queue-settings-wiring.test.ts` mock factory. The mock is inert (the module under test imports from `@/lib/caption-generator`), so the test passes on real behavior, not the mock — harmless but misleading.
**Reason for deferral:** the test still validates the real wiring correctly (it asserts processImageFormats args, not caption behavior); the stray mock has zero functional effect. Cosmetic test hygiene. Not correctness/security/data-loss.
**Exit criterion:** (a) the wiring test is reworked to actually exercise caption behavior; OR (b) a caption-generator regression slips through because the inert mock masked it.

### SEC-R9C7-DEFER-01 [LOW/non-exploitable, conf HIGH, POLISH] — postcss 8.4.31 bundled inside `node_modules/next/` (GHSA-qx2v-qp2m-jg93)
**Where:** transitive, `node_modules/next/` bundled copy only; the app's direct postcss + all build transitives are already ≥ 8.5.10.
**Reason for deferral:** build-time only (zero runtime usage in `src/`), no untrusted-CSS path; `audit fix --force` would catastrophically downgrade Next. Not an exploitable runtime vuln.
**Exit criterion:** (a) a runtime CSS-transform path on untrusted input appears; OR (b) the next routine Next bump (clears it automatically); OR (c) severity reclassification.

Full run-7/8/9 carry-forward register preserved in `.context/plans/run9-cycle7/deferred.md`.

---

## NON-FINDINGS / re-confirmed-benign (provenance — do NOT re-file)

- **`affectedRows` optional-chaining** — not re-raised; REFUTED repeatedly (mysql2 DML always returns affectedRows; test-locked).
- **3 binary-parser FPs** (color-detection colr, gps-exif ILOC, gain-map/icc-extractor) — re-refuted by debugger + critic; each flagged read has a preceding bounds check.
- **critic high-entropy doc spot-check** — 0 false claims (pipeline=7, keys=9, HASH=8, retention=395, 6 locks, cache()=10, backfill cap=2@10, NCLX maps incl. matrix-8=YCgCo + transfer-5=gamma28, nginx caps, admin defaults).
- **document-specialist 20/20 key-file paths + all general fact checks MATCH.**
- **schema↔reconcile 18/18 tables, 50/50 images columns**; APP_BACKUP_TABLES superset; COLOR_IMPACTING_KEYS=9; privacy 19 fields; i18n parity; touch-target; NCLX pins — all GREEN.
- **MED-R7C2-01 (histogram clip %)** + **REJ-R7C3-01 (gps-exif indexSize)** re-confirmed sound by critic; NOT re-opened.

---

## Carried-forward deferrals (re-verified UNCHANGED at HEAD `feb63faa`, full register in `.context/plans/run9-cycle7/deferred.md`)

- **DEF-R9C6-01** [LOW POLISH] — `retryFailedImage` hardcoded English string (`images.ts:1109`). Carried.
- **DEF-R9C6-02** [LOW POLISH] — `incrementAdminUserCreate` over-limit ordering (`admin-users.ts:120-122`). Carried.
- **POL-R9C5-01** [POLISH] — decorative back-arrow SVG without aria-hidden (`year/[year]/page.tsx:111`). NOT a WCAG failure (adjacent visible text). Designer did NOT re-file. Carried.
- **DES-R9C3-02** [LOW advisory] — analytics `<th>` lack scope="col". Carried.
- **DEF-C11-01** [LOW] — search dialog `<Input>` 32px (`search.tsx:374`), out of touch-target-audit scope. Carried.
- **R7C1-CR-01..04**, **TE-R7C2-03/04/05**, **OBS-R7C2-02..06**, **INFO-R7C2-08/09**, **TE-R9C3-01 residual**, **coverage-gap polish ×3** — all carried, no exit criterion met.

---

## CLOSED-OBSOLETE / refuted-class (do NOT re-open)

- ARCH-R7C2-01 / TE-R7C2-02 (Stripe webhook) — CLOSED-OBSOLETE (route deleted run-8).
- RES-R7C6-01 (HEIC GPS-strip residual) — CLOSED.
- CR-R9C2-01 (cicp onIdle) — FIXED c2. TE-R9C3-01/DES-R9C3-01 — FIXED c3. DES-R9C4-01 — FIXED c4. CR-R9C5-01 (restore allowlist) — FIXED c5 (18/18 tables; tripwire GREEN). CR-R9C6-01 (browser upload 6 settings) — FIXED c6.
- MED-R7C2-01 REFUTED; REJ-R7C3-01 DISPROVED; NF-R7C4-01/NF-R7C5-01 closed. NCLX matrix/transfer map pins COMPLETE. CSP nonce / session off-by-one REFUTED.

---

## AGENT FAILURES

None. All 11 agents returned full reviews and persisted their `.md` files. (Some OMC reviewer agents are read-only — Write blocked — and returned reviews as text; the lead/agents persisted them. All 11 provenance files exist in `.context/reviews/run9-cycle7/`.)

---

## Disposition

- **NEW actionable DEFECT findings:** 1 — CR-R9C7-01 (MEDIUM, conf HIGH, correctness on the Lightroom publish path; 6 admin processing settings bypassed — the exact c6 defect class on the consumer the c6 fix missed). UNANIMOUS 11-agent agreement; lead-verified at the source. This is the SPECIAL FOCUS #3 directive's target outcome: a missed enqueue consumer.
- **Scheduled fixes:** 1 (CR-R9C7-01) → `.context/plans/run9-cycle7/plan-run9c7-fixes.md`.
- **Deferred:** 2 new POLISH (DEF-R9C7-01 inert test mock; SEC-R9C7-DEFER-01 bundled postcss) + full run-7/8/9 carry-forward register, in `.context/plans/run9-cycle7/deferred.md`.
- **Gate state:** all 7 green pre-fix; to re-verify green post-fix.
- **Deploy:** none (DEPLOY_MODE=none).