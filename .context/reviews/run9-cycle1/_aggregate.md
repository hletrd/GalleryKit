# Aggregate Review — Run-9 Cycle-1 (HEAD `d3858cfc`)

**Date:** 2026-06-21
**Agents fanned out (11/11 returned + persisted):** code-reviewer, security-reviewer, architect, critic, verifier, test-engineer, perf-reviewer, tracer, debugger, document-specialist, designer.

**Gate state (fresh foreground runs at HEAD `d3858cfc`):** ESLint exit 0; lint:api-auth (2 admin routes OK) / lint:action-origin (all mutating actions enforce same-origin) / lint:public-route-rate-limit (5+1 public route files OK) all exit 0; typecheck (app + scripts, 7 JS files) exit 0; Vitest **2036 passed / 4 skipped / 0 failed** (222 files passed + 2 skipped = 224). The 4 skips are exclusively the CLIP-weight-gated suites. Next.js prod build deferred to the gate pass after the cycle's fixes (the only diff since converged `f63af3b9` is review-doc markdown — no build-affecting change pre-fix). `npm audit` not run (offline env; dependency CVE auditing belongs in CI — security-reviewer process note, not a code finding).

## Context

This is cycle-1 of run-9. Run-8 converged at cycle-2 (`f63af3b9`). **HEAD `d3858cfc` is executable-byte-identical to `f63af3b9`** — `git diff --stat f63af3b9..HEAD` shows ONLY `.context/reviews/run8-cycle2/*.md` (12 files, +1310 lines; the convergence-provenance doc commit `d3858cfc`). Zero src/schema/config/test change. The big recent change (Stripe paid-download removal, run-8) was deeply validated across two prior cycles and re-confirmed surgically clean here (0-hit grep for `stripe|checkout|entitlement|license_tier|refund|downloadToken|sales` in production code; typecheck PASS proves zero dangling types).

This cycle's review angle: a fresh deep skeptical whole-repo sweep from every angle, deliberately widened BEYOND the removal blast radius the prior cycles fixated on, to find anything missed across 8 runs.

**Headline result: near-total convergence holds. Nine of eleven agents found ZERO new actionable findings.** The test-engineer surfaced **two genuine, code-confirmed test-coverage gaps** (TE-R9C1-01 MEDIUM, TE-R9C1-02 LOW) on correctness-adjacent guards that are NOT in the carried deferral register. These are pure test additions (no production-code change), cheap and deterministic, and were independently re-verified against the actual code by the lead before scheduling. The debugger surfaced one LOW (settings-hash divergence) that the architect independently examined and both judged **benign-by-design** (documented intended behavior) → NOT counted as a finding (recorded as a non-finding below). One critical-candidate sweep by critic/code-reviewer/tracer produced only REFUTED candidates (provenance below).

---

## Cross-agent agreement matrix (high-signal items)

| Finding / verdict | Agents agreeing | Net disposition |
|---|---|---|
| **Convergence genuine on correctness/security/perf/arch/doc/a11y axes** | code-reviewer, security-reviewer, architect, critic, verifier, perf-reviewer, tracer, debugger, document-specialist, designer (10) | **CONFIRMED — 0 new on these axes** |
| HEAD byte-identical to converged `f63af3b9` (diff = review docs only); typecheck PASS = machine proof of no dangling types | code-reviewer, architect, critic, verifier, perf-reviewer | **CONFIRMED** (5 agents) |
| Paid-download removal surgically clean — 0-hit production-code grep for every deleted symbol class | code-reviewer, security-reviewer, architect, critic, tracer, document-specialist, verifier | **CONFIRMED CLEAN** (7 agents) |
| `upload-tracker-state.ts` behavioral logic untested (prune grace-period, MAX_KEYS evict, window-reset, `hasActiveUploadClaims` settings-race guard) | test-engineer (TE-R9C1-01) — lead-confirmed against code + existing `upload-tracker.test.ts` (which only tests the DIFFERENT `settleUploadTrackerClaim`) | **SCHEDULED — NEW (MEDIUM)** |
| `acquireUploadProcessingContractLock` `BigInt(1)` branch untested (only source-grep `restore-upload-lock.test.ts` exists) | test-engineer (TE-R9C1-02) — lead-confirmed against code | **SCHEDULED — NEW (LOW)** |
| `settings-hash.ts` no-arg vs config-arg divergence on INVALID stored settings → ETag instability only, never stale bytes, no security impact, documented intended (R8-H1) design | debugger (LOW-01), architect (independently examined, "benign") | **NON-FINDING (benign-by-design, 2 agents agree)** |
| Privacy derivation holds — `publicSelectFields` omit-derived; 4 compile guards hold; no PII/license remnants | architect, security-reviewer, tracer, verifier, debugger | **CONFIRMED CLEAN** (5 agents) |
| Migration 0023 + reconcileLegacySchema correct; journal `when` monotonic for 0023; drops mirrored `migrate.js:627-628`; post-condition won't false-fail | architect, critic, tracer (FLOW-C), verifier, document-specialist | **CONFIRMED CLEAN** (5 agents) |
| Originals never streamed to HTTP (nginx 404 + instrumentation startup assert + migrate evacuation + ALLOWED_UPLOAD_DIRS) | security-reviewer, tracer (FLOW-B), debugger | **CONFIRMED CLOSED** (3 agents) |
| ETag/settings-hash `COLOR_IMPACTING_KEYS=9` holds; `_ColorKeysAreSettingKeys` guard holds; CRT-D1 caveat accurate | architect, tracer (FLOW-D), verifier, document-specialist | **CONFIRMED CLEAN** (4 agents) |
| No perf/concurrency regression on any hot path | perf-reviewer (source-validated), code-reviewer, debugger | **CONFIRMED** (3 agents) |
| Touch-target gate PASS; scanner covers all tag classes + blind spots; ARIA/focus/i18n correct (ko plural asymmetry by-design) | designer | **CONFIRMED CLEAN** |
| On-disk docs (CLAUDE.md/AGENTS.md/README) accurate against code on every spot-check (IMAGE_PIPELINE_VERSION=7, COLOR_IMPACTING_KEYS=9, HASH_LENGTH=8, NCLX maps incl. gamma28=code5 + matrix8=YCgCo + gamma26=code17, advisory locks, backfill columns, VIEW_RETENTION_DAYS=395, upload+nginx caps) | document-specialist, verifier, architect | **CONFIRMED CLEAN** (3 agents) |

---

## SCHEDULED findings (this cycle)

### TE-R9C1-01 [MEDIUM, conf HIGH] — `upload-tracker-state.ts` behavioral logic untested
**Where:** `apps/web/src/lib/upload-tracker-state.ts` — `pruneUploadTracker` (2× grace-period expiry at `:39`; `UPLOAD_TRACKER_MAX_KEYS=2000` cap eviction at `:49-59`), `resetUploadTrackerWindowIfExpired` (`:62-68`), `hasActiveUploadClaims` (`:70-79`).
**Why it matters:** `hasActiveUploadClaims` is the SOLE guard (used at `settings.ts:70`) that blocks an `image_sizes` / `strip_gps_on_upload` admin change from firing mid-upload (the upload-processing-contract invariant: those settings lock once photos exist / uploads are in flight). A false-negative (returning `false` while uploads are active) silently drops that safety lock — a setting intended to be immutable-with-content could change against an in-flight batch. The existing `upload-tracker.test.ts` tests only `settleUploadTrackerClaim` from the DIFFERENT `upload-tracker.ts` module; these three functions in `upload-tracker-state.ts` are mocked away in every consumer test. All three take an injectable `now` → fully deterministic to test.
**Lead verification:** CONFIRMED against code + `upload-tracker.test.ts` (the dedicated file does not import `upload-tracker-state`).
**Fix:** add `__tests__/upload-tracker-state.test.ts` with behavioral tests for: prune expiry at exactly 2× window (boundary), prune MAX_KEYS eviction (oldest-first), no eviction at/below cap, window reset at exactly 1× window (boundary), `hasActiveUploadClaims` true on count>0, true on bytes>0, false when all entries expired/zeroed.

### TE-R9C1-02 [LOW, conf HIGH] — `acquireUploadProcessingContractLock` `BigInt(1)` branch untested
**Where:** `apps/web/src/lib/upload-processing-contract-lock.ts:32` — `lockAcquired = acquired === 1 || acquired === BigInt(1)`.
**Why it matters:** mysql2 can return integer columns as `number` OR `BigInt` depending on driver config (`supportBigNumbers`/`bigNumberStrings`) and column type. The `BigInt(1)` arm is the defensive branch for drivers that return `GET_LOCK` as BigInt. If a driver/config change ever made `GET_LOCK` return `BigInt(1)` and only the numeric-`1` arm were exercised, the lock would return `null` on every call → every upload-contract settings change would spuriously fail with the `uploadSettingsLocked` toast. Only the source-grep `restore-upload-lock.test.ts` exists; no behavioral test exercises either acquisition arm.
**Lead verification:** CONFIRMED against code.
**Fix:** add behavioral tests (new `__tests__/upload-processing-contract-lock.test.ts`) with a mock connection covering: `acquired === 1` → returns a lock object with a working `release()`; `acquired === BigInt(1)` → ALSO returns a lock (the defensive parity); `acquired === 0` → returns null + releases conn; `acquired === null` → returns null + releases conn; connection-acquire throw → returns null; query throw after acquire → returns null + releases; double-release is a no-op.

---

## NON-FINDINGS resolved this cycle (provenance — do NOT re-file as findings)

### debugger LOW-01 — `settings-hash.ts` no-arg vs config-arg divergence — **BENIGN-BY-DESIGN**
The no-arg `getColorSettingsHash()` (`:104-118`) hashes raw DB strings; the config-arg form (`:89-102`, R8-H1) hashes validated `GalleryConfig` values (defaults applied for out-of-range). They diverge ONLY when an admin setting is stored out-of-range (e.g. `image_quality_avif=150`). **Production serving (`serve-upload.ts`) uses the config-arg form**, so served ETags always match actual encoded bytes. The no-arg worst case is ETag instability (always 200, never a stale 304) — never stale-bytes delivery, no security impact. This is the EXACT scenario R8-H1 was written to handle (docstring `:86-88` documents it). Debugger rated it LOW + "no security impact"; architect independently examined the same divergence and concluded "benign (at worst one extra revalidation, never stale bytes; serve-upload uses the config-arg form as primary)." Two agents agree it is intended/benign → NOT a finding. Recorded here so it is not re-manufactured next cycle.

### Cosmetic INFO residual carried from run-8 c2 (resolved by critic this cycle, still NOT a finding)
The run8-c2 critic↔test-engineer disagreement over `process-image.ts:1570/1646` "download-original path" comments was settled this cycle by the critic with evidence: `serve-upload.ts` whitelists only jpeg/webp/avif and NO HTTP route streams the on-disk original (every reader is internal), so the comments ARE technically stale, but this is pure comment text with zero behavioral impact and the cosmetic tail of already-landed FIND-R8C1-02. Re-filing would be manufactured padding. Recorded as INFO/provenance only; planner may optionally fold a one-word touch-up into any future cleanup. NOT counted.

### SW stamp lag-by-one (examined by critic, dismissed)
`sw.js` stamp `ea372e41-p7` lags HEAD `d3858cfc` by one commit. This is the intentional, stable prebuild cadence across all 8 prior runs (prebuild stamps the then-current HEAD, which becomes the parent of the stamp commit). NOT a defect; the prior aggregate's "== HEAD" phrasing was a writeup imprecision. No re-stamp is warranted this cycle because the diff since the last stamp is review-doc markdown only (no template/source change) — though a re-stamp will naturally ride this cycle's fix commits per the prebuild hook on the next build.

---

## Critical-candidate sweep — all REFUTED (provenance — do NOT re-litigate)

- **code-reviewer:** `auth-rate-limit.ts:133` `PASSWORD_CHANGE_MAX_ATTEMPTS` "orphaned" — REFUTED (enforced at `auth.ts:340/357/358`, test-pinned). `load-more.tsx:51` `mountedRef` "undefined pre-mount" — REFUTED (`useRef(true)` at `:36`). `session.ts:145` expiry "off-by-one" — REFUTED (`<` is correct fail-safe + 24h max-age guard). `content-security-policy.ts:97` "invalid/reused nonce" — REFUTED (`proxy.ts:41` per-request 32-hex nonce).
- **tracer (FLOW-A):** `color_pipeline_decision` on public download object — REFUTED again (null-safe `isP3Pipeline`/`isWideGamutPrimary`, admin field merely `undefined` for public; no crash, no leak).
- **tracer (FLOW-E):** `buildDownloadFilename` user-title → `download` attribute path-traversal — REFUTED (`slugifyTitle` strips bidi/zero-width/C0-C1, NFKD, `[^a-z0-9]+`→`-`; `../../../etc/passwd` → `etc-passwd-{id}.jpg`).
- **debugger:** `parseCicpFromHeif`/`hasGainMap` "depth×1MB scan DoS" candidate from the brief — REFUTED (buffer pre-capped at 1 MB before the recursive walk; depth×1MB concern does not apply). `gps-exif-strip.ts` value-size integer overflow, XMP cross-chunk reconstruction, `icc-extractor` mluc offset arithmetic, restore flag/lock/temp lifecycle, global-regex `lastIndex`, smart-collections SQL injection, blur-data-url, view-count atomic Map swap — all BENIGN with file:line evidence.

---

## Carried-forward deferrals (re-verified UNCHANGED at HEAD `d3858cfc`, no new evidence, no exit criterion met — full register in `.context/plans/run9-cycle1/deferred.md`)

- **DEF-C11-01** [LOW] — search dialog `<Input>` 32 px (`search.tsx:374`). Designer re-verified out-of-scope. Carried.
- **R7C1-CR-01..04** [LOW] — restore-maintenance process-local flag; 1000-literal `NOT IN` bootstrap; `'XX'` country sentinel; timeline bounds validation. Carried (perf-reviewer re-confirmed CR-02 no measured regression).
- **TE-R7C2-03** [LOW] — semantic route malformed-embedding row-skip untested. Carried (test-engineer re-confirmed STILL OPEN; distinct module from this cycle's TE-R9C1-01/02).
- **TE-R7C2-04** [LOW] — `logAuditEvent` metadata-truncation untested. Carried (STILL OPEN).
- **TE-R7C2-05** [INFO] — `embeddings.ts` action no dedicated test. Carried (STILL OPEN).
- **OBS-R7C2-02..07** [LOW] — reconcile position backfill; non-transactional restore; failRestore temp leak; pool not `.end()`'d; unbounded bootstrap retry; updateTopic no FOR UPDATE. Carried (architect + debugger re-confirmed unchanged, documented-design / operator-mitigated).
- **INFO-R7C2-08/09** — orphan migration `0014_drop_reactions.sql` (destructive-action-gated); advisory-lock `:`-vs-`_` separator. Cosmetic. Carried.

---

## CLOSED-OBSOLETE / refuted-class (do NOT re-open — re-confirmed this cycle)

- **ARCH-R7C2-01 / TE-R7C2-02** (Stripe webhook) — CLOSED-OBSOLETE (route deleted run-8). Confirmed by 0-hit grep. Do NOT re-open.
- **RES-R7C6-01** (HEIC GPS-strip residual) — CLOSED (no surviving route streams `data/uploads/original/`; nginx 404 + startup assert + evacuation). Re-confirmed by security-reviewer + tracer (FLOW-B) + debugger.
- **MED-R7C2-01** (histogram clip %) — REFUTED. Stays refuted.
- **REJ-R7C3-01** (`gps-exif-strip.ts:466` indexSize) — DISPROVED; file byte-identical. Stays disproved.
- **NF-R7C4-01** (`color-detection.ts:185` code-4 comment) — VERIFIED CORRECT vs H.273. Stays verified non-finding.
- **NF-R7C5-01** (`migrate.js` baselineAllJournalMigrations duplicate rows) — REFUTED (filters on missing-hash Set). Stays refuted.
- **NCLX matrix/transfer map pin class** — COMPLETE/EXHAUSTED. document-specialist re-confirmed all maps match between CLAUDE.md and code. Class closed.
- **`process-image.ts:1108` "Only paid on the wide-gamut path"** — NOT stale ("paid" = idiom for "computationally expensive"). Do NOT "fix" it.
- **CLAUDE.md/README/AGENTS.md "stale paid-download docs" run-premise** — REFUTED again (on-disk docs already clean; stale copy only in injected system-reminder, not on disk).

---

## AGENT FAILURES

The first debugger spawn returned an analysis summary but its final message was truncated mid-work ("Let me check the `parseCicpFromHeif`…") and it did NOT persist its review file on the first pass. Per the run instructions it was re-spawned once with its in-progress conclusions; the retry completed, explicitly wrote `debugger.md`, and returned a clean summary (1 LOW non-finding + a table of BENIGN verdicts incl. the `parseCicpFromHeif` candidate it was mid-verifying). All 11 provenance files now exist in `.context/reviews/run9-cycle1/`.

---

## Disposition

- **NEW actionable findings:** 2 (TE-R9C1-01 MEDIUM, TE-R9C1-02 LOW) — both pure test-coverage additions on correctness-adjacent guards, lead-confirmed against code.
- **Non-findings resolved (provenance):** 1 (debugger LOW-01 settings-hash divergence — benign-by-design, 2-agent agreement) + 2 cosmetic INFO (process-image comments, SW stamp lag).
- **Scheduled fixes:** 2 (both findings). Plan: `.context/plans/run9-cycle1/`.
- **Deferred-register bookkeeping:** all run-8 open deferrals carried forward unchanged in `.context/plans/run9-cycle1/deferred.md`.
- **Gate state:** all green pre-fix; re-run after fixes (test additions only → no lint/typecheck/build risk beyond the new test files themselves).
- **Deploy:** none (DEPLOY_MODE=none).
