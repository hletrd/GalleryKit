# Aggregate Review — Run-9 Cycle-5 (HEAD `e34c04cf`)

**Date:** 2026-06-21
**Agents fanned out (11/11 returned + persisted):** code-reviewer, security-reviewer, architect, critic, verifier, test-engineer, perf-reviewer, tracer, debugger, document-specialist, designer.

**Gate state (fresh foreground runs at HEAD `e34c04cf`, pre-fix):** ESLint exit 0 (0 errors / 0 warnings); lint:api-auth (2 admin routes OK) / lint:action-origin (41 actions: 35 OK + 6 exempt) / lint:public-route-rate-limit (6 routes OK) all exit 0; typecheck (app + scripts) exit 0; Vitest **2054 passed / 4 skipped / 0 failed** (226 files); Next.js prod build exit 0 (10 static pages). SW stamp `e34c04cf-p7` matches HEAD. The 4 skips are exclusively the CLIP-weight-gated suites.

## Context

This is cycle-5 of run-9. Run-8 converged at cycle-2 (`f63af3b9`); run-9 c1 (`d3858cfc`, 2 LOW test files), c2 (`c2d3857a`, 1 LOW cicp drain), c3 (`094842a4`, 2 LOW: test `beforeAll` + bulk-edit aria), c4 (`80d9ff79`, 1 LOW: similar-photos accname). **The production runtime-logic surface (`apps/web/src/lib` + `apps/web/src/app`) has been essentially unchanged since run-8 convergence** — the deltas were two a11y fixes + one off-path diagnostic + two test files. HEAD `e34c04cf` is a docs-provenance commit (empty source delta since c4's last real fix `80d9ff79`).

This cycle deliberately widened the review to a fresh skeptical whole-repo sweep from every angle. Unlike the previous four cycles (which found only LOW non-product-runtime items), **this cycle found ONE genuine MEDIUM DEFECT on a safety-critical production path — independently surfaced by TWO agents (debugger + tracer) with full data-level + empirical corroboration by the lead.**

Under the orchestrator's HIGH-BAR directive: report only genuine DEFECTS; route marginal polish to deferral. This cycle the fan-out found **ONE genuine DEFECT** (DB restore scanner) and one POLISH advisory (decorative SVG aria-hidden, deferred).

---

## Cross-agent disposition table

| Axis | Agent(s) | Verdict |
|---|---|---|
| Correctness / logic / quality | code-reviewer | **CLEAN** — whole-repo trace; 1 candidate (admin-backfill `affectedRows` optional-chaining) RAISED then REFUTED (mysql2 DML always returns `affectedRows`; belt-and-braces; test-locked). ZERO new findings. |
| Security (OWASP) | security-reviewer | **CLEAN** — auth chain, 8 API routes, 4-layer path-traversal+symlink+realpath, Drizzle parameterization + smart-collections allowlist, spawn-no-shell restore, SSRF origin-pin, CSV/OG/Unicode sanitizers, privacy guard. All 3 security lints AST-validated (77/77 suite). 3 binary-parser subagent false-positives refuted. ZERO new findings. |
| Architecture (single-writer topology) | architect | **CLEAN** — 6 advisory locks symmetric, delete-while-processing `affectedRows===0` full-scan cleanup ×3 paths, restore quiesce pause→clear→onIdle, ETag 9 COLOR_IMPACTING_KEYS + HASH_LENGTH=8, pool budget cap=2@pool10, **schema↔reconcile parity proof: 0 missing columns** (50=50 bijection). ZERO new findings. |
| Critic / meta-convergence | critic | **ACCEPT — convergence GENUINE on the surfaces it probed.** 10/10 high-entropy CLAUDE.md claims verified TRUE; 4 prior disproofs re-confirmed sound; gates green. (Critic did not independently surface the restore-scanner defect — it spot-checked doc claims, not the restore allowlist.) |
| Gate evidence | verifier | **PASS** — 7/7 gates green; Vitest 2054/4/0; build 10 pages; SW stamp matches HEAD. |
| Test health | test-engineer | **HEALTHY** — ~50 files validated correct against impl; no test masks a bug; no new flake source. ZERO new DEFECTS (deferrable coverage-gap polish carried). (Did not flag the restore allowlist — the existing test legitimately covers its 12 tables; the gap is in the impl, not the test.) |
| Performance (hot paths) | perf-reviewer | **CLEAN** — no N+1, indexes cover query shapes, Sharp fan-out bounded, serve-upload TTL+SWR, no sync I/O on request paths, all Maps bounded-by-design. ZERO new findings. |
| Causal tracing (5 flows) | tracer | **4 CLEAN + 1 DEFECT** — upload→ETag, settings→ETag two-tier, restore quiesce, semantic pipeline all CLEAN; **restore-scanner allowlist DEFECT (Flow 3a H4)** independently found with Tier-1 evidence (source + migration provenance). |
| Latent bugs (parsing/boundary) | debugger | **13 modules BENIGN + 1 DEFECT** — all binary parsers/boundary code BENIGN at HEAD; **independently found the restore-scanner allowlist DEFECT** (`APP_BACKUP_TABLES` missing 6 tables since 2026-04-30). |
| Docs vs code | document-specialist | **CLEAN** — 15 primary + ~20 secondary spot-checks all MATCH (pipeline=7, COLOR_IMPACTING_KEYS=9, HASH_LENGTH=8, retention=395, backfill cap=2@10, 6 locks, cache()=10, NCLX maps, nginx caps, 20 key-file paths all exist). No false doc. |
| UI/UX a11y | designer | **CLEAN — ZERO new firm DEFECTS** — 35 components/routes swept; c3+c4 fixes confirmed; one POLISH advisory (POL-R9C5-01 decorative SVG aria-hidden, NOT a WCAG failure → deferred). |

---

## SCHEDULED + IMPLEMENTED finding (this cycle)

### CR-R9C5-01 [MEDIUM, conf HIGH, DEFECT — data-recovery correctness] — DB restore scanner blocks the app's own current-schema backup (2-agent agreement: debugger + tracer)

**Where:** `apps/web/src/lib/sql-restore-scan.ts:2-15` — `APP_BACKUP_TABLES`.

**Why it's a DEFECT (never deferrable — data-recovery / correctness on a safety-critical path):**
- The admin DB restore is the disaster-recovery mechanism. `containsDangerousSql` blocks any `DROP TABLE` (`/\bDROP\s+TABLE\b/i`, line 39) EXCEPT `DROP TABLE IF EXISTS \`<table>\`;` for tables in `APP_BACKUP_TABLES` (masked by `ALLOWED_APP_BACKUP_DROP_TABLE_PATTERN` before the guard).
- The app's own backup (`db-actions.ts:157` `mysqldump … DB_NAME`) uses the **default `--add-drop-table`** (no `--skip-add-drop-table`), so it emits `DROP TABLE IF EXISTS \`<table>\`;` for **every** table.
- The schema (`src/db/schema.ts`) now has **18 tables**; `APP_BACKUP_TABLES` listed only **12** (last updated 2026-04-30, `1111f5e7`). The **6 missing** tables — `admin_tokens` (0006), `smart_collections` (0009), `image_views`/`topic_views`/`shared_group_views` (0010), `image_embeddings` (0012) — were added later.
- **Failure scenario (empirically reproduced by the lead with the inlined scanner):** upload a current-prod `mysqldump` via the admin restore UI → the legitimate `DROP TABLE IF EXISTS \`admin_tokens\`;` (+5) is NOT masked → the `DROP TABLE` guard fires → `containsDangerousSql() === true` → restore aborts with `disallowedSql`. **The app cannot restore its own backups.** Per-table scan: all 6 BLOCKED; full-dump-fragment `containsDangerousSql() === true`.

**Why MEDIUM (not LOW):** it disables disaster recovery for the current schema — operator-impacting correctness failure on a safety-critical path. Two independent agents found it; lead reproduced it at the data level and empirically. Confidence HIGH.

**Fix (IMPLEMENTED — commit `d1cde2e4`):**
1. Add the 6 missing tables to `APP_BACKUP_TABLES`, sorted, with a doc comment stating the **superset invariant** (must be a superset of every `schema.ts` table because mysqldump dumps them all). `sql-restore-scan.ts`.
2. `export` the list so a test can introspect it.
3. Regression coverage in `__tests__/sql-restore-scan.test.ts`: (a) explicit per-table assertion that `DROP TABLE IF EXISTS \`<table>\`;` is allowed for every allowlist entry; (b) a **superset tripwire** introspecting the Drizzle schema via `getTableName`, asserting no schema table is missing (non-vacuity floor: must contain `images` and ≥18 tables). Mirrors `migrate-reconcile-coverage.test.ts`. **Non-vacuity proven:** the old 12-table list fails the tripwire, identifying exactly the 6 missing tables.

**Verification:** targeted suite 16/16 pass; full suite 2056/4/0 (+2 new tests, no regression); typecheck exit 0.

**migrate.js note (REPO CONVENTIONS #6):** NO schema migration / DDL — only widens an in-app SQL-scanner allowlist to match the existing schema. The 6 tables already exist in `reconcileLegacySchema` (architect re-confirmed 0 missing-column parity). No migrate.js change required.

---

## DEFERRED finding(s) (this cycle)

### POL-R9C5-01 [POLISH, conf HIGH, advisory — NOT a WCAG failure] — decorative back-arrow SVG without `aria-hidden`
**Where:** `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:111`. Designer-found.
**Why deferred:** the containing `<Link>` has adjacent visible text (`backToTimeline`), so the accessible name is non-empty and correct — NOT a WCAG failure. Adding `aria-hidden="true"` is cosmetic project-consistency hygiene with zero user-blocking impact → deferrable POLISH under the high-bar policy.
**Exit criterion:** (a) a general decorative-SVG `aria-hidden` hygiene pass; OR (b) a real SR-user report of path-data announcement.

The run-7/8/9 carry-forward register is preserved in `.context/plans/run9-cycle5/deferred.md` (re-verified UNCHANGED at HEAD; no exit criterion met for any).

---

## NON-FINDINGS / re-confirmed-benign this cycle (provenance — do NOT re-file)

- **code-reviewer / critic `affectedRows` optional-chaining REFUTED** — mysql2 DML always returns a `ResultSetHeader` with `affectedRows`; the `?.` is intentional belt-and-braces matching the sidecar's `?? 0`; test-locked. Not a defect.
- **security-reviewer binary-parser false positives (×3)** — icc-extractor:99, gain-map-detection:206, gps-exif-strip — every flagged read has a preceding bounds check the subagent missed. Refuted.
- **debugger 13-module benign re-spot-check** — gps-exif-strip, icc-extractor, icc-chromaticity, gain-map-detection, color-detection, process-image, image-queue, serve-upload, blur-data-url, exif-datetime, validation, rate-limit, bounded-map all BENIGN at HEAD.
- **tracer 4 CLEAN flows** — upload→processing→ETag, settings-hash→ETag two-tier (CRT-D1 documented), restore quiesce pause→clear→onIdle + lock double-release guard + maintenance idempotency, semantic pipeline (isProd similarity gate + null-skip + model-version isolation). All CLEAN.
- **critic 10/10 doc-claim spot-check TRUE + 4 prior disproofs sound** — IMAGE_PIPELINE_VERSION=7, HASH_LENGTH=8, COLOR_IMPACTING_KEYS=9, VIEW_RETENTION_DAYS=395, 6 locks, cache()=10, backfill cap=2@10, NCLX maps, nginx caps, gamma18 ICC-only.
- **document-specialist 15+20 doc spot-checks MATCH** — no false doc.
- **test-engineer coverage-gap polish (×3)** — verifySessionToken concurrent-init, auth-rate-limit combined exhaustion, sidecar flushBatch — deferrable, no test masks a bug. Carried.

---

## Carried-forward deferrals (re-verified UNCHANGED at HEAD `e34c04cf`, full register in `.context/plans/run9-cycle5/deferred.md`)

- **DES-R9C3-02** [LOW advisory] — analytics `<th>` lack `scope="col"` (admin-only, simple tables, UA heuristics OK). Designer did NOT re-file (exit criterion unmet). Carried.
- **DEF-C11-01** [LOW] — search dialog `<Input>` 32 px (`search.tsx:374`). Out of touch-target-audit scope. Carried.
- **R7C1-CR-01..04** [LOW] — restore-maintenance process-local flag; 1000-literal `NOT IN` bootstrap; `'XX'` country sentinel; timeline bounds validation. Carried (architect re-confirmed CR-01 lock-serialized; perf-reviewer re-confirmed CR-02/CR-04 no measured regression).
- **TE-R7C2-03/04/05** [LOW/INFO] — semantic route null-skip untested; logAuditEvent truncation untested; embeddings action no dedicated test. test-engineer + tracer re-confirmed STILL OPEN. Carried.
- **OBS-R7C2-02..06** [LOW] — reconcile position backfill; non-transactional restore; failRestore temp leak; pool not `.end()`'d; unbounded bootstrap retry. Carried (architect re-confirmed documented-design / operator-mitigated).
- **INFO-R7C2-08/09** — orphan migration `0014_drop_reactions.sql`; advisory-lock `:`-vs-`_` separator. Cosmetic. Carried.
- **TE-R9C3-01 residual** — `beforeAll` near-no-op under forks. Carried.

---

## CLOSED-OBSOLETE / refuted-class (do NOT re-open — re-confirmed where examined)

- **ARCH-R7C2-01 / TE-R7C2-02** (Stripe webhook) — CLOSED-OBSOLETE (route deleted run-8). Security-reviewer re-confirmed 0-hit.
- **RES-R7C6-01** (HEIC GPS-strip residual) — CLOSED. Security-reviewer re-confirmed.
- **CR-R9C2-01** (cicp-recheck onIdle) — FIXED run-9 c2; re-verified correct.
- **TE-R9C3-01 / DES-R9C3-01** — FIXED run-9 c3; re-confirmed.
- **DES-R9C4-01** (similar-photos accname) — FIXED run-9 c4; designer + critic re-confirmed (resolves to "Photo"/"사진").
- **MED-R7C2-01** (histogram clip %) REFUTED. **REJ-R7C3-01** (gps-exif indexSize) DISPROVED (critic + debugger re-confirmed sound). **NF-R7C4-01** / **NF-R7C5-01** stay closed.
- **NCLX matrix/transfer map pin class** — COMPLETE/EXHAUSTED. document-specialist + test-engineer re-confirmed maps match CLAUDE.md ↔ code.
- **CSP nonce reuse / session.ts off-by-one** — REFUTED prior cycles; not re-filed.

---

## AGENT FAILURES

None requiring escalation. Three agents (test-engineer `a31b2432cb421f7f6`, tracer `aac15149e1e842cac`, designer `a98bffe9725141912`) returned from their first spawn mid-work without emitting a final report; all three were resumed once via SendMessage and completed, wrote their `.md` files, and returned final conclusions. The critic (`ac444c83c4b743ac5`) is read-only (Write blocked) and returned its full review as text; the lead persisted it to `critic.md` on its behalf. All 11 provenance files exist in `.context/reviews/run9-cycle5/`.

---

## Disposition

- **NEW actionable DEFECT findings:** 1 — CR-R9C5-01 (MEDIUM, conf HIGH, data-recovery correctness; DB restore scanner missing 6 tables). Found independently by debugger + tracer; lead-validated at the data level and empirically reproduced. This is the FIRST product-runtime defect in run-9 (c1-c4 were all non-product LOW items) — and a genuine one, refuting the prior-4-cycle "long-tail polish only" assumption.
- **Scheduled + implemented fixes:** 1 (CR-R9C5-01). Plan: `.context/plans/run9-cycle5/plan-run9c5-fixes.md`.
- **Deferred:** 1 new (POL-R9C5-01 advisory) + full run-7/8/9 carry-forward register, in `.context/plans/run9-cycle5/deferred.md`.
- **Gate state:** all 7 green pre-fix; re-verified green post-fix (Vitest 2056/4/0, typecheck 0, build 0).
- **Deploy:** none (DEPLOY_MODE=none).
