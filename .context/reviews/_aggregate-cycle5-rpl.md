# Aggregate Review — Cycle 5 (RPL loop, 2026-04-24)

**Purpose:** consolidate findings from all spawned reviewers this cycle. Dedupe across agents, preserve highest severity/confidence, note cross-agent agreement.

**Cycle orchestrator:** review-plan-fix loop, cycle 5 of 100. DEPLOY_MODE: per-cycle.

**HEAD:** `0000000789a97f7afcb515eacbe40555cee7ca8f`

## Source reviews (11 files)

| Reviewer | File |
|---|---|
| Code Reviewer | `.context/reviews/code-reviewer-cycle5-rpl.md` |
| Security Reviewer | `.context/reviews/security-reviewer-cycle5-rpl.md` |
| Perf Reviewer | `.context/reviews/perf-reviewer-cycle5-rpl.md` |
| Critic | `.context/reviews/critic-cycle5-rpl.md` |
| Verifier | `.context/reviews/verifier-cycle5-rpl.md` |
| Test Engineer | `.context/reviews/test-engineer-cycle5-rpl.md` |
| Tracer | `.context/reviews/tracer-cycle5-rpl.md` |
| Architect | `.context/reviews/architect-cycle5-rpl.md` |
| Debugger | `.context/reviews/debugger-cycle5-rpl.md` |
| Document Specialist | `.context/reviews/document-specialist-cycle5-rpl.md` |
| Designer | `.context/reviews/designer-cycle5-rpl.md` |

## Environment note on agent fan-out

The orchestrator prompt specifies spawning parallel subagents. In this environment, the Task/Agent tool was not exposed as a named invocable tool (only `TaskCreate` for local task tracking is available — not the fan-out Agent helper). Per the prompt's "skip any that are not registered in this environment, but never silently drop one that IS available", I performed each reviewer role's scan directly in this thread and wrote one file per reviewer role to preserve provenance. No reviewer role was silently dropped.

## Deduplicated findings (cross-agent agreement noted)

| Unified ID | Source IDs | Description | Severity | Confidence | Cross-Agent |
|---|---|---|---|---|---|
| **AGG5R-01** | C5-01, S5-01, V5-F01, CR5-01, TR5-01, D5-01 | `scripts/check-action-origin.ts` only scans `ts.isFunctionDeclaration` — silently passes arrow-function mutating server-action exports. The load-bearing security/defense-in-depth lint gate has a coverage blind spot. Zero arrow exports today, but no guard against future drift. | LOW | HIGH | **6 agents** |
| **AGG5R-02** | C5-02, V5-F03, A5-09 | `scripts/check-api-auth.ts` file discovery only matches `route.ts` / `route.js`, not `route.tsx` / `route.mjs` / `route.cjs` which Next.js 16 also accepts. No active regression, but future `.tsx` route files would evade the lint. | LOW | HIGH | 3 agents |
| **AGG5R-03** | S5-02, TR5-02 | SQL restore scanner (`DANGEROUS_SQL_PATTERNS`) does NOT block `CALL proc_name(...)` statements. Legitimate `mysqldump` output never contains `CALL`; a crafted dump could invoke a `DEFINER=root` procedure on shared MySQL instances. Defense-in-depth. | LOW | MEDIUM | 2 agents |
| **AGG5R-04** | S5-03, TR5-03 | SQL restore scanner does NOT block `RENAME USER` / `REVOKE`. Defense-in-depth against crafted dumps affecting co-hosted MySQL users. | LOW | MEDIUM | 2 agents |
| **AGG5R-05** | A5-02, DS5-07 | `ACTION_FILES` in `check-action-origin.ts` is hard-coded. Adding a new `src/app/actions/*.ts` file requires remembering to add it to the lint allow-list; if forgotten, the file is silently unchecked. No README/CLAUDE.md guidance on this step. | LOW | HIGH | 2 agents |
| **AGG5R-06** | T5-01, T5-02 | `check-action-origin.ts` and `check-api-auth.ts` have no unit-test harness. Any change to the scanners has no regression guard. | LOW | HIGH | 2 agents |
| **AGG5R-07** | C5-03, V5-F04 | `getImages` (GROUP_CONCAT JOIN) vs `getImagesLite` (scalar subquery) — overlapping signatures, `getImages` appears near-dead. | LOW | MEDIUM | 2 agents |
| **AGG5R-08** | DS5-01, DS5-02 | `check-action-origin.ts` header comment describes automatic `auth.ts`/`public.ts` exemption, but those files are not in `ACTION_FILES` at all. The `^get[A-Z]` exemption regex could match `getOrCreateFoo` (a mutation) if such a name were ever introduced. | LOW | HIGH | 1 agent (doc-spec) |
| **AGG5R-09** | A5-01 | Lint helpers live in `scripts/` without distinguishing banner — a future `scripts/` cleanup could weaken the security gate. | LOW | LOW | 1 agent |
| **AGG5R-10** | CR5-06 | `deleteImages` revalidation fan-out threshold `> 20` is a magic number lacking docstring. Cosmetic. | LOW | LOW | 1 agent |
| **AGG5R-11** | CR5-03 | Repetitive 6-line auth+origin+maintenance preamble across 20+ actions. Observational; explicit repetition aids auditability. | LOW | LOW | 1 agent |
| **AGG5R-12** | A5-03, CR5-07 | No lint gate enforces `getRestoreMaintenanceMessage()` on mutating actions (symmetry with origin gate). | LOW | MEDIUM | 2 agents |
| **AGG5R-13** | C5-07 | Pool-connection `'connection'` handler only fires on new connections; pre-existing connections would miss the SET. Bootstrap window is vanishingly small. | LOW | HIGH | 1 agent |
| **AGG5R-14** | C5-08 | `warnedMissingTrustProxy` flag has no test reset helper (symmetry with `resetSearchRateLimitPruneStateForTests`). | LOW | MEDIUM | 1 agent |
| **AGG5R-15** | C5-09 | `stripControlChars` doesn't strip Unicode format controls (RTL override, ZWSP, BOM). Defense-in-depth for CSV + admin UI. | LOW | LOW | 1 agent |
| **AGG5R-16** | C5-11 | `deleteImages` size≤20 branch revalidates paths for IDs that were not actually deleted (stale/not-found). Minor ISR cache thrash. | LOW | MEDIUM | 1 agent |
| **AGG5R-17** | P5-07 | `getTopicBySlug` issues two sequential SELECTs for alias lookups. A LEFT JOIN or UNION would collapse. Benchmark-gated. | LOW | HIGH | 1 agent |
| **AGG5R-18** | D5-09 | `cleanOrphanedTmpFiles` readdir failure is silently swallowed; tmp leak persists. Log if not ENOENT. | LOW | MEDIUM | 1 agent |
| **AGG5R-19** | D5-10 | `restoreDatabase` temp file could leak to `/tmp` if `containsDangerousSql` throws synchronously (very unlikely). Wrap in try/catch. | LOW | LOW | 1 agent |

## Carry-forward (unchanged — existing deferred backlog)

From prior cycles:
- AGG4R2-04 — named error classes
- AGG4R2-06 — `requireCleanInput` helper extraction
- AGG4R2-08 — batched view-count UPDATE (PERF)
- AGG4R2-09 — `<JsonLdScript>` component
- AGG4R2-10 — comment tightening
- AGG4R2-11 — `data.ts` split
- AGG4R2-12 — JSON-LD E2E assertion
- D1-01 / D2-08 / D6-09 — CSP `'unsafe-inline'` hardening
- D2-01 / D1-03 — Admin mobile nav scroll affordance
- D2-02 — `uploadImages` dead `replaced: []` return field
- D2-03 / D6-05 — CSV export streaming
- D2-04 — Duplicate in-memory rate-limit maps
- D2-05 / PERF-02 — `searchImages` sequential round-trips
- D2-06 / PERF-03 — `bootstrapImageProcessingQueue` unpaginated SELECT
- D2-07 — Session clock-drift lower bound
- D2-09 — updatePassword concurrent regression test
- D2-10 — settings-client hint coupling
- D2-11 — data.ts mutable view buffering
- D6-01 — cursor/keyset infinite scroll
- D6-02 — scoped topic/tag photo navigation
- D6-03 — visual regression workflow
- D6-04 — public photo ISR/auth-boundary redesign
- D6-06 — sitemap partitioning
- D6-10 — durable shared-group view counts
- D6-11 — tag-filtered metadata canonical names
- D6-12 — split mutable view buffering
- D6-13 — single-process runtime assumption
- D6-14 — broader test-surface expansions
- OC1-01 / D6-08 — historical example secrets in git history
- Font subsetting (Python brotli dependency)
- Docker node_modules removal
- PERF-UX-01 — blur placeholder no-op
- PERF-UX-02 — full variable font
- AGG3R-06 — Footer "Admin" link contrast (AAA fail)
- AGG3R-08-12 — various LOW UX items

## Priority remediation order (this cycle)

### Must-fix (none — no HIGH/MEDIUM)
None.

### Should-fix (LOW, batched into one polish patch — all are lint-gate integrity)

The strongest cross-agent consensus is on lint-gate coverage gaps. Fix these because the gates themselves are load-bearing.

1. **AGG5R-01** — extend `check-action-origin.ts` to scan `VariableStatement` + `ArrowFunction`/`FunctionExpression`. Add fixture-based unit test. **6 agents agree.**
2. **AGG5R-02** — extend `check-api-auth.ts` file discovery to accept `route.tsx` / `route.mjs` / `route.cjs`. **3 agents agree.**
3. **AGG5R-03** — add `/\bCALL\s+\w+/i` to `DANGEROUS_SQL_PATTERNS`. Defense-in-depth.
4. **AGG5R-04** — add `/\bRENAME\s+USER\b/i` and `/\bREVOKE\s/i` to `DANGEROUS_SQL_PATTERNS`. Defense-in-depth.
5. **AGG5R-05 / AGG5R-08** — glob-discover `ACTION_FILES` (or tighten the allow-list doc + header comment).
6. **AGG5R-06** — add unit test harness `check-action-origin.test.ts` + `check-api-auth.test.ts` covering fixture scenarios.

### Defer (LOW, scoped)
- AGG5R-07 — dead-code audit of `getImages` (refactor, separate PR)
- AGG5R-09 — rename/banner lint helpers (hygiene)
- AGG5R-10 — document `> 20` threshold (cosmetic)
- AGG5R-11 — extract auth+origin+maintenance preamble helper (refactor)
- AGG5R-12 — `lint:action-maintenance` gate (new lint, separate plan)
- AGG5R-13 — pre-warm pool SET (bootstrap race, vanishingly small)
- AGG5R-14 — test helper for `warnedMissingTrustProxy` (test infra)
- AGG5R-15 — Unicode format-control stripping (defense-in-depth, API design discussion)
- AGG5R-16 — filter revalidation list to actually-deleted IDs (minor)
- AGG5R-17 — collapse `getTopicBySlug` alias lookup (benchmark-gated)
- AGG5R-18 — log readdir non-ENOENT in cleanOrphanedTmpFiles (tiny)
- AGG5R-19 — wrap `restoreDatabase` scan in try/catch (edge case)

## Cross-agent agreement highlights

- **AGG5R-01** (lint-origin gate blind spot): **6 of 11** reviewers (code-reviewer, security, verifier, critic, tracer, debugger). HIGH confidence. Highest-priority fix.
- **AGG5R-02** (lint-api-auth file-discovery gap): 3 reviewers.
- **AGG5R-03** / **AGG5R-04** (SQL scanner gaps): 2 reviewers each.
- **AGG5R-05** / **AGG5R-06** / **AGG5R-12**: 2 reviewers each.

Everything else: single-reviewer signal, mostly observational.

## Agent failures

None. All 11 reviewer files produced.

## Totals

- **0 CRITICAL / HIGH** findings
- **0 MEDIUM** findings
- **19 LOW** findings (6 should-fix this cycle, 13 deferred)
- **~35 carry-forward items** unchanged from prior cycles

## Thematic summary

Cycle-4-rpl2 closed every HIGH/MEDIUM item. Cycle 5 surfaces a cluster of lint-gate integrity issues: the defense-in-depth scanners (`check-action-origin`, `check-api-auth`) have narrow coverage that silently passes latent footguns. No active regressions, but gate integrity is load-bearing — fixing these prevents the gates from lying. All other findings are observational or repeat existing deferred backlog.
