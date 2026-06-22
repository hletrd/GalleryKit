# Aggregate Review — Run-9 Cycle-8 (HEAD `4e132b03`)

**Date:** 2026-06-22
**Agents fanned out (11/11 returned + persisted):** code-reviewer, security-reviewer, architect, critic, verifier, test-engineer, perf-reviewer, tracer, debugger, document-specialist, designer.

**Gate state (independently re-run by the lead at HEAD `4e132b03`, plus verifier's fresh foreground run):** ESLint exit 0 (0 errors / 0 warnings); lint:api-auth (2 admin routes OK) / lint:action-origin ("All mutating server actions enforce same-origin provenance") / lint:public-route-rate-limit (6 routes OK) all exit 0; typecheck (app + scripts) exit 0; Vitest **2059 passed / 4 skipped / 0 failed** (225 files); Next.js prod build exit 0 (38 routes). The 4 skips are the CLIP-weight-gated suites. SW stamp committed `83780ec9-p7` (one-commit-behind HEAD `4e132b03`, the established build(sw) norm).

## Context

Cycle-8 of run-9. Run-9 found 3 consecutive "derived-snapshot/list drifted from source" MEDIUM defects: c5 (restore-scanner APP_BACKUP_TABLES), c6 (browser-upload 6-settings bypass), c7 (Lightroom-upload 6-settings bypass — the sibling c6 missed). The c7 critic declared the settings-forwarding bug class EXHAUSTED.

**This cycle executed the orchestrator's SPECIAL FOCUS #3 directive: confirm there is no THIRD enqueue/processing consumer still bypassing settings, and that no other schema-derived list has drifted.** The lead enumerated all 6 `enqueueImageProcessing` call sites BEFORE the fan-out and confirmed: the 2 external producers (browser `images.ts:440`, LR `lr/upload/route.ts:420`) forward all 6; retry (`images.ts:1139`) + bootstrap (`image-queue.ts:674`) omit quality+imageSizes → correctly fall into the config-reload gate (`image-queue.ts:336`); the 2 internal re-enqueues (`:290`, `:510`) pass the same `job` by reference. **No third bypassing consumer exists.** The architect's independent drift sweep across 7 charged surfaces + 4 adjacent surfaces confirmed CLEAN.

**OUTCOME: 0 DEFECTS across all 11 agents. This is genuine convergence — the target outcome the orchestrator described for this cycle.**

---

## Cross-agent disposition table

| Axis | Agent | Verdict |
|---|---|---|
| Correctness / logic | code-reviewer | **0 DEFECTS, 1 POLISH.** APPROVE. Settings-forwarding class confirmed EXHAUSTED (all 6 enqueue paths verified). 4 substantive agent-surfaced candidates each DECISIVELY REFUTED (rate-limit rollback = intended TOCTOU; WI-15 downscale off-by-one = arithmetically sound; advisory-lock leak in acquireImageProcessingClaim = mysql2 destroys-on-release auto-frees; topic slug-rename TOCTOU = serialized by lock). POLISH: POL-R9C8-01 (`images.ts:1122` hardcoded English `'Image not found or not in a failed state'`). |
| Security (OWASP) | security-reviewer | **0 DEFECTS, 0 POLISH.** Built security inventory, read every relevant file end-to-end, ran 69 security unit tests (pass), spot-checked all 4 lint-gate invariants against real bodies. Auth chain, session/token crypto, injection (Drizzle + spawn arg-arrays + safeJsonLd), path traversal + realpath, SSRF origin-pin, privacy field guards, rate limiting, CSP nonce, secrets — all CLEAN. postcss bundled transitive re-confirmed non-exploitable (build-time only). |
| Architecture / drift | architect | **0 DEFECTS, 1 PHANTOM POLISH (disproved).** Drift sweep CLEAN across all 7 charged + 4 adjacent surfaces: schema↔reconcile 18/18 tables + 50/50 images columns; COLOR_IMPACTING_KEYS=9 (8 non-listed keys confirmed non-byte-impacting); privacy 4-way aligned at 20; APP_BACKUP_TABLES 18 superset; 6 locks symmetric/dedicated-conn; 6 settings on all enqueue paths; NCLX/i18n(779=779)/backfill-column-set/og-sanitize/view-retention all aligned. Its lone "POLISH" (CLAUDE.md "19 privacy fields") was DISPROVED by critic + document-specialist (phantom). |
| Critic / meta | critic | **APPROVE-CONVERGENCE. 0 DEFECTS, 1 POLISH.** All high-entropy CLAUDE.md claims verify correct. Settings-drift class independently confirmed exhausted (all 6 sites enumerated). MED-R7C2-01 + REJ-R7C3-01 re-confirmed sound (not re-opened). **The architect's "19 privacy fields" is a PHANTOM — CLAUDE.md makes no such claim; filing it would be a manufactured DEFECT (rejected).** POLISH: POL-R9C8-01 (browser-upload producer lacks the source-contract regression lock the LR producer has). |
| Gate evidence | verifier | **PASS 7/7 gates.** Vitest 2059/4/0; build 38 routes; all 4 lint + typecheck exit 0. CR-R9C7-01 LR fix confirmed present (route.ts:444-449) + locked by named regression test (lr-upload-hdr-gate.test.ts:318). |
| Test health | test-engineer | **0 DEFECTS, 2 POLISH.** Suite HEALTHY (2059/4/0). DEF-R9C7-01 (inert `@/lib/caption` mock) re-confirmed inert — real caption-generator runs unmocked, is pure, contaminates no assertion; **no regression masked → NOT escalated, stays POLISH**. NEW POLISH GAP-R9C8-01: browser-upload `uploadImages()` enqueue lacks the 6-settings source-contract lock that the LR path has (coverage gap, code is correct today). Drift-locking tests (privacy-fields, sql-restore-scan introspection, backfill column-set, reconcile post-condition) all non-vacuous. |
| Performance | perf-reviewer | **0 DEFECTS, 0 POLISH.** Only diff since clean c7 baseline is the +36-line additive LR settings fix (zero perf footprint). 13 in-memory Maps re-verified actively-bounded; tagNamesAgg intact at all 6 accessors (+ group_concat_max_len=65535); composite indexes match query shapes; no new unindexed query; zero sync I/O on request paths. |
| Causal tracing | tracer | **0 DEFECTS, 0 POLISH.** All 5 traced chains intact (6-settings incl. processImageFormats USES all passed values; settings-hash→ETag; privacy-field; pipeline_version→backfill→ETag; HDR-honesty/blur/GPS). The one observable non-propagation (`autoAltTextEnabled` not reaching processImageFormats) is CORRECT-by-architecture (consumed at the caption hook, not the encoder). |
| Latent bugs | debugger | **0 DEFECTS, 0 POLISH.** All 5 focus areas clean: no unguarded reads in the 4 binary parsers (prior FPs confirmed); Sharp rgb16/Bradford/10-bit-fallback/clone() all sound (base.clone() valid — base is unconsumed source); WI-15 tmp cleaned in finally; stripGpsFromOriginal tmpPath cleanup correct on all error paths; numeric paths all Number.isFinite-guarded; fire-and-forget caption + CLIP both have catch handlers. |
| Docs vs code | document-specialist | **0 false-doc-claim DEFECTS, 1 POLISH.** All high-entropy claims MATCH (pipeline=7, keys=9, HASH=8, cache()=10, retention=395, 6 locks, NCLX maps, nginx caps, admin defaults, upload limits, 18 tables/50 cols, pool 10/20, 20/20 key-file paths). **"19 privacy fields" = PHANTOM** (zero CLAUDE.md matches; doc states no count; actual=20). **"process-image.ts:1019-1097" citation = IMPRECISE-BUT-NOT-FALSE POLISH** (the cited 80-line span genuinely contains the fresh-instance-per-format comment at ~:1050; substance is true). |
| UI/UX a11y | designer | **0 WCAG DEFECTS, 0 POLISH.** 44px floor held (button.tsx size="sm" = min-h-11); no new touch-target violation class the audit misses; dialog traps, live regions, ARIA labels, skip-link, lang attr present. password-form.tsx dead-ID (`confirmPassword-error-summary` unused) is NOT a WCAG failure (input correctly links to inline `<p id="confirmPassword-error">`). Only re-noted already-deferred items (POL-R9C5-01, DES-R9C3-02, DEF-C11-01) — none re-filed. |

**Cross-agent agreement:** UNANIMOUS 0 DEFECTS. The settings-drift bug class is confirmed exhausted by 4 independent agents (code-reviewer, architect, critic, tracer) each enumerating all 6 enqueue sites. The two doc items the architect/document-specialist surfaced were both adjudicated NON-defects: "19 privacy fields" is a phantom (verified by lead grep: only "React 19" exists), and "1019-1097" is an imprecise-but-true line citation. NO real DEFECT exists at HEAD `4e132b03`.

---

## SCHEDULED findings (this cycle)

**NONE.** 0 actionable DEFECTS. This is genuine convergence per REPO CONVENTIONS #7. No commit is warranted; manufacturing one would violate the high-bar directive.

---

## DEFERRED findings (this cycle) — all POLISH, recorded in `.context/plans/run9-cycle8/deferred.md`

### NEW this cycle (3 POLISH)
- **POL-R9C8-01** [LOW, conf High, POLISH] — `images.ts:1122` `retryFailedImage` returns hardcoded English `'Image not found or not in a failed state'`. (Same i18n-polish class as DEF-R9C6-01 / the line:1109 string; both are admin-only return messages.) **Exit:** a general admin-surface i18n hardening pass OR a non-English admin reports the string.
- **GAP-R9C8-01** [MEDIUM-severity coverage gap, conf High, POLISH] — browser-upload `uploadImages()` enqueue (`images.ts:440`) has NO source-contract test asserting the 6 admin settings are forwarded, while the LR path IS locked (`lr-upload-hdr-gate.test.ts:318-328`). The CODE is correct today (c6 fix verified by tracer + architect); this is a missing regression lock, not a live bug → POLISH. **Exit:** a future edit silently drops the 6 from `images.ts:440` (which no test would catch) OR a test-hardening pass adds the browser-path source-contract assertion.
- **DOC-R9C8-01** [LOW, conf High, POLISH] — CLAUDE.md:219 cites `process-image.ts:1019-1097` for the fresh-instance-per-format behavior; the span is wider than ideal (the anchor comment is at ~:1050). Imprecise-but-not-false (the cited range DOES contain the documented behavior) → POLISH, NOT a false-doc-claim DEFECT. **Exit:** the cited range no longer contains the fresh-instance logic (→ would become a false claim DEFECT) OR a doc line-citation tightening pass.

### Carried forward (re-verified UNCHANGED at HEAD `4e132b03`)
- **DEF-R9C7-01** [LOW POLISH] — settings-wiring test mocks `@/lib/caption` (real import `@/lib/caption-generator`); inert, masks no regression. NOT escalated (test-engineer re-confirmed exit criterion unmet).
- **SEC-R9C7-DEFER-01** [LOW/non-exploitable POLISH] — postcss 8.4.31 bundled inside node_modules/next/ (build-time only).
- **DEF-R9C6-01** [LOW POLISH] — `retryFailedImage` hardcoded English string (`images.ts:1109`).
- **DEF-R9C6-02** [LOW POLISH] — `incrementAdminUserCreate` over-limit ordering (`admin-users.ts:120-122`).
- **POL-R9C5-01** [POLISH advisory] — decorative back-arrow SVG without aria-hidden (`year/[year]/page.tsx:111`) — NOT a WCAG failure.
- **DES-R9C3-02** [LOW advisory] — analytics `<th>` lack scope="col".
- **DEF-C11-01** [LOW] — search dialog `<Input>` 32px (`search.tsx:374`), out of touch-target-audit scope.
- **R7C1-CR-01..04**, **TE-R7C2-03/04/05**, **OBS-R7C2-02..06**, **INFO-R7C2-08/09**, **TE-R9C3-01 residual**, **coverage-gap polish ×3** — all carried, no exit criterion met.

---

## NON-FINDINGS / re-confirmed-benign (provenance — do NOT re-file)

- **"19 privacy fields" doc claim** — PHANTOM. CLAUDE.md makes no such claim (lead grep: only "React 19" + "1019-1097" line citation). Code count is 20, correctly guarded. Architect fabricated; critic + document-specialist + lead disproved. NOT a finding.
- **4 code-reviewer-surfaced candidates** — all REFUTED: rate-limit rollback (intended TOCTOU), WI-15 downscale off-by-one (sound), advisory-lock leak in acquireImageProcessingClaim (mysql2 auto-release), topic slug-rename TOCTOU (lock-serialized).
- **`affectedRows` optional-chaining** — REFUTED repeatedly (mysql2 DML always returns affectedRows).
- **4 binary-parser FPs** (color-detection colr/NCLX, gps-exif ILOC, gain-map, icc-extractor) — re-refuted by debugger; each flagged read has a preceding bounds check.
- **Sharp base.clone() in 10-bit AVIF fallback** — re-confirmed valid (base is the unconsumed source instance).
- **schema↔reconcile 18/18 tables, 50/50 columns**; APP_BACKUP_TABLES 18 superset; COLOR_IMPACTING_KEYS=9; privacy 20 fields (4-way); i18n 779=779; backfill column-set; NCLX maps; touch-target — all GREEN.
- **MED-R7C2-01 (histogram clip %)** + **REJ-R7C3-01 (gps-exif indexSize)** re-confirmed sound by critic; NOT re-opened.

---

## CLOSED-OBSOLETE / refuted-class (do NOT re-open)

- ARCH-R7C2-01 / TE-R7C2-02 (Stripe webhook) — CLOSED-OBSOLETE (route deleted run-8).
- RES-R7C6-01 (HEIC GPS-strip residual) — CLOSED.
- CR-R9C2-01 (cicp onIdle) — FIXED c2. TE-R9C3-01/DES-R9C3-01 — FIXED c3. DES-R9C4-01 — FIXED c4. CR-R9C5-01 (restore allowlist) — FIXED c5. CR-R9C6-01 (browser upload 6 settings) — FIXED c6. **CR-R9C7-01 (LR publish 6 settings) — FIXED c7.**
- MED-R7C2-01 REFUTED; REJ-R7C3-01 DISPROVED; NF-R7C4-01/NF-R7C5-01 closed. NCLX matrix/transfer map pins COMPLETE. CSP nonce / session off-by-one REFUTED.

---

## AGENT FAILURES

None. All 11 agents returned full reviews. The read-only OMC agents (architect, critic, perf-reviewer, tracer, debugger, document-specialist) have Write blocked and returned reviews as text; the lead persisted their `.md` files. All 11 provenance files exist in `.context/reviews/run9-cycle8/`.

---

## Disposition

- **NEW actionable DEFECT findings:** 0 — genuine convergence. The settings-drift bug class (c5/c6/c7) is confirmed EXHAUSTED by 4 independent agents enumerating all 6 enqueue sites; the architect's full drift sweep across 11 surfaces is CLEAN; the two doc items surfaced are non-defects (phantom + imprecise-but-true). This is the SUCCESS condition the orchestrator described (#7): a truthful zero on a perfected system.
- **Scheduled fixes:** 0.
- **Deferred:** 3 new POLISH (POL-R9C8-01 i18n string; GAP-R9C8-01 browser-upload source-contract coverage gap; DOC-R9C8-01 line-citation imprecision) + full carry-forward register, in `.context/plans/run9-cycle8/deferred.md`.
- **Gate state:** all 7 green (independently re-run by lead + verifier).
- **Deploy:** none (0 commits → convergence).
