# Aggregate Review — Run-9 Cycle-6 (HEAD `ba3277da`)

**Date:** 2026-06-21
**Agents fanned out (11/11 returned + persisted):** code-reviewer, security-reviewer, architect, critic, verifier, test-engineer, perf-reviewer, tracer, debugger, document-specialist, designer.

**Gate state (fresh foreground runs by verifier at HEAD `ba3277da`, pre-fix):** ESLint exit 0 (0 errors / 0 warnings); lint:api-auth (2 admin routes OK) / lint:action-origin (43 exports OK+exempt) / lint:public-route-rate-limit (6 routes OK) all exit 0; typecheck (app + scripts) exit 0; Vitest **2056 passed / 4 skipped / 0 failed** (226 files); Next.js prod build exit 0 (10 static pages, 38 routes). SW stamp `d1cde2e4-p7` (last source SHA; docs-only HEAD requires no re-stamp). The 4 skips are exclusively CLIP-weight-gated (`clip-offline-load.test.ts`, `clip-semantic-integration.test.ts`).

## Context

Cycle-6 of run-9. Run-8 converged c2 (`f63af3b9`); run-9 c1 (2 LOW test files), c2 (1 LOW cicp drain), c3 (2 LOW), c4 (1 LOW similar-photos accname), c5 (1 MEDIUM restore-scanner allowlist — FIXED `d1cde2e4`). HEAD `ba3277da` is the c5 docs-provenance commit (empty source delta since `d1cde2e4`).

This cycle deliberately widened the review to a fresh skeptical whole-repo sweep from every angle. Under the orchestrator's HIGH-BAR directive: report only genuine DEFECTS; route marginal polish to deferral. **This cycle found ONE genuine DEFECT — CR-R9C6-01, a correctness defect on the PRIMARY product path (every upload), independently surfaced by THREE agents (code-reviewer + tracer + debugger) with full Tier-1 file:line corroboration, and re-verified at the source by the lead.**

---

## Cross-agent disposition table

| Axis | Agent(s) | Verdict |
|---|---|---|
| Correctness / logic / quality | code-reviewer | **1 DEFECT** — CR-R9C6-01 (upload path bypasses 6 admin processing settings via the `if (!quality && !imageSizes)` gate). 2 LOW non-defects noted (i18n hardcoded retry msg; admin-users RL ordering). `affectedRows` `?.` REFUTED again. |
| Security (OWASP) | security-reviewer | **CLEAN** — auth chain, 8 routes, 4-layer path-traversal+symlink+realpath, Drizzle parameterization + smart-collections allowlist, spawn-no-shell restore, SSRF origin-pin, CSV/OG/Unicode sanitizers, privacy guard, all 3 security lints AST-validated. 3 binary-parser FPs re-refuted. CR-R9C6-01 noted as correctness (not security) — out of lane. ZERO security findings. |
| Architecture (single-writer) | architect | **CLEAN** — 6 advisory locks symmetric (release on all paths incl. restore 3 early-returns + backfill handoff null-then-release + sidecar pre-exit); all 3 delete-mid-reencode cleanup paths full-scan; restore quiesce pause→clear→onIdle; backfill cap=2@pool10. **Schema↔reconcile parity: 18/18 tables, 0 missing columns** (3 regex FPs from backtick-escaped reserved words manually disproven; corroborated by `migrate-reconcile-coverage.test.ts`). ETag 9 keys / HASH_LENGTH=8. Journal monotonic post-condition sound. ZERO findings. |
| Critic / meta-convergence | critic | **ACCEPT** (doc-claim + list-drift surfaces) — 12/12 high-entropy CLAUDE.md claims TRUE; 4 prior disproofs re-confirmed sound; the schema-derived-list drift class (the c5 defect class) is comprehensively guarded. Did NOT probe the image-queue gating logic where CR-R9C6-01 lives. ZERO findings from its own probe. |
| Gate evidence | verifier | **PASS 7/7** — ESLint/3 lints/typecheck green; Vitest 2056/4/0 (226 files); build 10 pages/38 routes; SW stamp consistent. |
| Test health | test-engineer | **HEALTHY** — ~11 highest-value fixture/contract tests cross-checked against impl; the c5 superset tripwire proven non-vacuous; no test masks a bug; no new flake. **Notes (corroborating CR-R9C6-01): NO test exercises `uploadImages → enqueueImageProcessing → handler → processImageFormats`** — exactly why the upload-path settings bypass went uncovered. ZERO masking-defects. |
| Performance (hot paths) | perf-reviewer | **CLEAN** — no N+1, indexes cover query shapes, Sharp fan-out bounded, serve-upload TTL+SWR, no sync I/O on request paths, all Maps bounded. The only production delta since convergence (APP_BACKUP_TABLES 10→18) is a cold admin path, zero perf relevance. ZERO findings. |
| Causal tracing (4 flows) | tracer | **3 CLEAN + 1 DEFECT** — settings-hash→ETag, restore quiesce/lock, c5 restore-scanner all CLEAN; **CR-R9C6-01 CONFIRMED** with Tier-1 evidence (decisive line `image-queue.ts:318`; `!quality` always false because upload passes a non-null `{webp,avif,jpeg}` object; fallbacks coincide with schema defaults → latent until any setting deviates). |
| Latent bugs (parsing/boundary) | debugger | **14 modules BENIGN + 1 DEFECT** — all binary parsers/boundary code BENIGN at HEAD; **independently CONFIRMED CR-R9C6-01** from a data-flow angle (`ImageProcessingJob` type has no fields for the 6 settings; upload always sets `job.quality` → gate never enters; bootstrap correctly omits quality so it loads all 8). |
| Docs vs code | document-specialist | **CLEAN (14/14 checks)** — 20 key-file paths, 12 color/HDR columns, NCLX maps, APP_BACKUP_TABLES=18, nginx caps, upload limits, admin-tunable defaults, deploy auto-prune, version/lock/cache counts all MATCH. No false doc. (NB: the `images.ts:298-300` AGG-M1 comment IS now false as a side-effect of CR-R9C6-01 — see below — but it is a source comment, not a CLAUDE.md claim.) |
| UI/UX a11y | designer | **CLEAN — ZERO new firm DEFECTS** — 15 components + 10 public routes swept; touch-target audit GREEN; c3/c4 fixes confirmed holding; lang/skip-link/dialog-trap/alt-fallback all present. POL-R9C5-01 not re-filed (exit criterion unmet). |

**Cross-agent agreement on CR-R9C6-01:** THREE independent agents (code-reviewer, tracer, debugger) confirmed it with file:line evidence; test-engineer corroborated the coverage gap that hid it; lead re-verified all decisive lines at the source. HIGH overall confidence.

---

## SCHEDULED finding (this cycle)

### CR-R9C6-01 [MEDIUM, conf HIGH, DEFECT — correctness on the primary product path] — fresh uploads silently bypass 6 admin-configurable processing settings (3-agent agreement)

**Where:** `apps/web/src/lib/image-queue.ts:318` (the `if (!quality && !imageSizes)` gate); the 6 settings resolved only inside it at `:327-332`; `apps/web/src/lib/image-queue.ts:113-136` (`ImageProcessingJob` type carries none of the 6); `apps/web/src/app/actions/images.ts:448-453` (upload enqueue always supplies `quality` + `imageSizes`). Correct contrast: `admin-backfill-runner.ts:508-513` passes all 6; `image-queue.ts:654` (bootstrap) omits quality/imageSizes so the gate IS entered.

**Why it's a DEFECT (never deferrable — correctness on the primary product path):**
- The job handler resolves SIX admin-configurable settings — `autoAltTextEnabled`, `forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels` — ONLY inside `if (!quality && !imageSizes)`.
- The UPLOAD path enqueues with `quality: {webp, avif, jpeg}` (a non-null object → `!quality` is ALWAYS `false`) and `imageSizes`. So the gate is **never entered on any real upload** → all 6 settings fall back to process-image.ts defaults (`forceSrgbDerivatives` stays hardcoded `false` at `:309`; the chroma/effort/pixel values stay `undefined` → `?? '4:4:4'`/`?? 6`/`?? '4:2:0'`/`?? 50_000_000` in process-image; `autoAltTextEnabled` stays `false`).
- BOOTSTRAP (re-enqueue of pending images) and BACKFILL both honor the settings → **asymmetry**: a fresh upload vs. the same photo after backfill get DIFFERENT color treatment whenever any of the 6 is non-default.
- The fallbacks coincide with the schema defaults, so the bug is **latent on a factory install** (byte-identical output) but produces silently wrong output the moment an admin changes any of the 6 documented, admin-exposed tunables.

**Concrete failure scenarios (admin-visible):**
1. `force_srgb_derivatives=true` → a freshly uploaded Display-P3 photo gets **P3-tagged WebP/JPEG anyway** (the gate the admin set for sRGB-only delivery is ignored), directly violating the documented photographer-intent contract, until a manual backfill re-encodes it.
2. `wide_gamut_max_source_pixels` lowered (e.g. 20 M) → the upload-warning at `images.ts:302` uses the config value and warns at >20 MP, but the ENCODER uses the 50 M default and does NOT downscale → the host can OOM on the rgb16 pipeline — the exact failure the setting exists to prevent. (This also makes the `images.ts:298-300` AGG-M1 comment — "matches the encoder's actual downscale threshold" — currently FALSE.)
3. `avif_effort` / `sdr_jpeg_chroma` / `wide_gamut_jpeg_chroma` tuned → fresh uploads use process-image defaults, diverging from backfilled photos (file-size / chroma differences).
4. `auto_alt_text_enabled=true` → fresh uploads call `generateCaption(..., false)` and never get the configured caption stub.

**Why MEDIUM (not LOW):** it disables 6 admin-documented tunables on the PRIMARY product path (every upload) and silently violates the core photographer-intent contract (CLAUDE.md "Color & HDR Pipeline" premise) whenever any is used. Three independent agents found it; lead re-verified at the source. Not deferrable — correctness on a product-runtime path, and the high-bar policy lists "real product-runtime bug" as never-deferrable.

**Why it survived 9 runs:** under defaults the output is byte-identical, so no functional test caught it; the only tests touching these settings call the pure resolver or the backfill runner directly — NO test exercises the full upload→enqueue→handler→processImageFormats wiring (test-engineer corroborated).

**Fix (SCHEDULED — option A, preserves the design's snapshot intent):**
1. Add the 6 fields to `ImageProcessingJob` (`forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, `autoAltTextEnabled`).
2. Populate them from the already-fetched `uploadConfig` (the upload-start snapshot at `images.ts:176`) in the upload enqueue.
3. In the handler, prefer `job.*` for each with a config-load fallback (so the bootstrap path — which intentionally omits quality/imageSizes — still loads them from config, and the DB-unavailable catch still degrades to process-image defaults). This keeps the upload-time snapshot semantics the comment at `:304-305` documents.
4. Fix the now-false `images.ts:298-300` comment (it becomes TRUE again once the encoder receives the value).
5. Add a wiring test: upload enqueue forwards the 6 settings; the handler passes `job.*` (not defaults) to `processImageFormats` when present.

**migrate.js note (REPO CONVENTIONS #6):** NO schema migration / DDL — only widens an in-memory job type + wires existing config fields. No `reconcileLegacySchema` change.

---

## DEFERRED finding(s) (this cycle)

None NEW. The 2 code-reviewer LOW non-defects (i18n hardcoded retry msg; admin-users RL ordering) are non-exploitable polish — recorded in the deferred register. POL-R9C5-01 carried unchanged. Full run-7/8/9 carry-forward register preserved in `.context/plans/run9-cycle6/deferred.md`.

---

## NON-FINDINGS / re-confirmed-benign (provenance — do NOT re-file)

- **`affectedRows` optional-chaining** — REFUTED again (mysql2 DML always returns affectedRows; belt-and-braces; test-locked).
- **3 binary-parser FPs** (color-detection NCLX colr, gps-exif ILOC, gain-map/icc-extractor) — re-refuted; each flagged read has a preceding bounds check.
- **debugger 14 modules BENIGN** — all binary parsers + boundary logic at HEAD.
- **critic 12/12 doc-claims TRUE + 4 disproofs sound** (MED-R7C2-01, REJ-R7C3-01, NF-R7C4-01, NF-R7C5-01).
- **document-specialist 14/14 doc checks MATCH** — no false CLAUDE.md doc.
- **schema↔reconcile 18/18, 0 missing columns**; publicSelectFields / SENSITIVE_KEYS / COLOR_IMPACTING_KEYS / i18n parity / touch-target all guarded GREEN.

---

## Carried-forward deferrals (re-verified UNCHANGED at HEAD `ba3277da`, full register in `.context/plans/run9-cycle6/deferred.md`)

- **POL-R9C5-01** [POLISH] — decorative back-arrow SVG without aria-hidden (year/[year]/page.tsx:111). NOT a WCAG failure (adjacent visible text). Carried.
- **DES-R9C3-02** [LOW advisory] — analytics `<th>` lack scope="col". Carried.
- **DEF-C11-01** [LOW] — search dialog `<Input>` 32px (search.tsx:374), out of touch-target-audit scope. Carried.
- **R7C1-CR-01..04** [LOW] — restore-maintenance process-local flag; 1000-literal NOT IN bootstrap; 'XX' country sentinel; timeline bounds. Carried.
- **TE-R7C2-03/04/05** [LOW/INFO] — semantic route null-skip / logAuditEvent truncation / embeddings action untested. Carried.
- **OBS-R7C2-02..06** [LOW] — reconcile position backfill; non-transactional restore; failRestore temp leak; pool not .end()'d; unbounded bootstrap retry. Carried.
- **INFO-R7C2-08/09** — orphan migration 0014; advisory-lock `:`-vs-`_` separator. Carried.
- **TE-R9C3-01 residual** — upload-tracker beforeAll near-no-op under forks. Carried.
- **NEW LOW (this cycle, deferred):** code-reviewer's 2 non-defects (i18n retry msg `images.ts:1109`; admin-users RL ordering `admin-users.ts:120-122`).

---

## CLOSED-OBSOLETE / refuted-class (do NOT re-open)

- ARCH-R7C2-01 / TE-R7C2-02 (Stripe webhook) — CLOSED-OBSOLETE (route deleted run-8).
- RES-R7C6-01 (HEIC GPS-strip residual) — CLOSED.
- CR-R9C2-01 (cicp onIdle) — FIXED c2. TE-R9C3-01/DES-R9C3-01 — FIXED c3. DES-R9C4-01 — FIXED c4 (designer re-confirmed). CR-R9C5-01 (restore allowlist) — FIXED c5 (now 18/18 tables; tripwire GREEN).
- MED-R7C2-01 REFUTED; REJ-R7C3-01 DISPROVED; NF-R7C4-01/NF-R7C5-01 closed. NCLX matrix/transfer map pins COMPLETE. CSP nonce / session off-by-one REFUTED.

---

## AGENT FAILURES

None requiring escalation. code-reviewer (`ad72d33c71d930c60`), security-reviewer (`a7a562f5c9b000803`), and critic (`a2d6f23c9f76c67ae`) are read-only (Write blocked) and returned full reviews as text; the lead persisted them to their `.md` files. All 11 provenance files exist in `.context/reviews/run9-cycle6/`.

---

## Disposition

- **NEW actionable DEFECT findings:** 1 — CR-R9C6-01 (MEDIUM, conf HIGH, correctness on the primary upload path; 6 admin processing settings bypassed). Found independently by code-reviewer + tracer + debugger; corroborated by test-engineer; lead-verified at the source. This refutes the "long-tail polish only" assumption for a SECOND consecutive cycle — like c5's restore defect, it is a real product-runtime correctness bug that 9 runs missed.
- **Scheduled fixes:** 1 (CR-R9C6-01). Plan: `.context/plans/run9-cycle6/plan-run9c6-fixes.md`.
- **Deferred:** 0 new firm; 2 new LOW non-defects + full run-7/8/9 carry-forward register, in `.context/plans/run9-cycle6/deferred.md`.
- **Gate state:** all 7 green pre-fix; to re-verify green post-fix.
- **Deploy:** none (DEPLOY_MODE=none).
