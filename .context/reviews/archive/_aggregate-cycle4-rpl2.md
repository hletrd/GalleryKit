# Aggregate Review — Cycle 4 (RPL loop 2, 2026-04-23)

**Purpose:** consolidate findings from all spawned reviewers this cycle. Dedupe across agents, preserve highest severity/confidence, note cross-agent agreement.

**Cycle orchestrator:** review-plan-fix loop, cycle 4 of 100. DEPLOY_MODE: per-cycle.

## Source reviews (11 files)

| Reviewer | File |
|---|---|
| Code Reviewer | `code-reviewer-cycle4-rpl2.md` |
| Security Reviewer | `security-reviewer-cycle4-rpl2.md` |
| Perf Reviewer | `perf-reviewer-cycle4-rpl2.md` |
| Critic | `critic-cycle4-rpl2.md` |
| Verifier | `verifier-cycle4-rpl2.md` |
| Test Engineer | `test-engineer-cycle4-rpl2.md` |
| Tracer | `tracer-cycle4-rpl2.md` |
| Architect | `architect-cycle4-rpl2.md` |
| Debugger | `debugger-cycle4-rpl2.md` |
| Document Specialist | `document-specialist-cycle4-rpl2.md` |
| Designer | `designer-cycle4-rpl2.md` |

## Deduplicated findings (cross-agent agreement noted)

| Unified ID | Source IDs | Description | Severity | Confidence | Cross-Agent |
|---|---|---|---|---|---|
| **AGG4R2-01** | CQ-01, SEC-02, VER-03, TE-01, ARCH-01 signal, DBG-01, DOC-03, TRACE-A | `poolConnection.on('connection')` callback in `db/index.ts:28-30` sets `group_concat_max_len` without a `.catch` handler. A transient failure becomes an unhandled promise rejection AND silently reverts to the 1024-byte MySQL default, truncating `GROUP_CONCAT` outputs in `exportImagesCsv` and SEO settings | LOW | HIGH | 7 agents |
| **AGG4R2-02** | CQ-02, CRIT-04, ARCH-01 | `app/actions.ts` barrel re-exports every action module **except** `settings` (`getGallerySettingsAdmin`, `updateGallerySettings`). Dual-import posture is confusing | LOW | MEDIUM | 3 agents |
| **AGG4R2-03** | CQ-03, SEC-01, TE-02, DOC-01 | `safeJsonLd` only escapes `<`. Does not escape U+2028/U+2029 or `&`. Defence-in-depth fix is trivial | LOW | MEDIUM | 4 agents |
| **AGG4R2-04** | CQ-04 | `updateTopic` uses string-sentinel errors (`throw new Error('TOPIC_NOT_FOUND')`). Ad-hoc; named-class refactor would make the relationship type-checkable | LOW | MEDIUM | 1 agent |
| **AGG4R2-05** | DSG-08 | JSON-LD breadcrumb on photo page uses `image.topic` (slug) as `name` instead of `image.topic_label` (human label) | LOW | HIGH | 1 agent |
| **AGG4R2-06** | CRIT-02 | `stripControlChars` + reject-if-changed idiom is copy-pasted across 14+ callsites; a `requireCleanInput` helper would reduce drift | LOW | MEDIUM | 1 agent |
| **AGG4R2-07** | SEC-07 | SQL restore scanner blocks `DROP DATABASE` but not `CREATE DATABASE`. `--one-database` limits blast radius; defense-in-depth only | LOW | LOW | 1 agent |
| **AGG4R2-08** | PERF-01 | `flushGroupViewCounts` issues N UPDATE statements per flush (N = groups in buffer). Could be coalesced into a single `ON DUPLICATE KEY UPDATE` batch | LOW | MEDIUM | 1 agent |
| **AGG4R2-09** | CRIT-03 | JSON-LD surface is hand-constructed at three call sites. A shared `<JsonLdScript data={...} />` component would consolidate the escape contract | LOW | LOW | 1 agent |
| **AGG4R2-10** | CQ-06 | `deleteImageVariants` comment says "no readdir" but the unknown-sizes branch still uses `fs.opendir`. Comment could be tightened | LOW | LOW | 1 agent |
| **AGG4R2-11** | ARCH-02 | `data.ts` is 894 lines mixing query/cache/view-count/SEO concerns. Split would reduce cognitive load | LOW | LOW | 1 agent |
| **AGG4R2-12** | TE-04 | Playwright tests do not assert JSON-LD `<script>` emission / shape | LOW | LOW | 1 agent |

## Priority remediation order (this cycle)

### Must-fix (none — no HIGH/MEDIUM severity)
None.

### Should-fix (LOW, batched into one polish patch)
1. **AGG4R2-01** — add `.catch` to `db/index.ts:29` pool-connection handler. **Cross-agent consensus: 7.** One-line fix with data-integrity implications.
2. **AGG4R2-03** — harden `safeJsonLd` to escape U+2028/U+2029. **Cross-agent consensus: 4.** Two-line fix, defence-in-depth.
3. **AGG4R2-05** — fix JSON-LD breadcrumb `name` to use `image.topic_label || image.topic`. One-line fix, SEO/UX clarity.
4. **AGG4R2-02** — make `app/actions.ts` barrel complete OR document intentional exclusion. Consistency.
5. **AGG4R2-07** — add `CREATE DATABASE` to `DANGEROUS_SQL_PATTERNS`. Defence-in-depth.

### Defer (LOW, scoped)
- AGG4R2-04 — named error classes (refactor, separate PR)
- AGG4R2-06 — `requireCleanInput` helper extraction (refactor, separate PR)
- AGG4R2-08 — batched view-count UPDATE (perf, benchmark-gated)
- AGG4R2-09 — `<JsonLdScript>` component (refactor, separate PR)
- AGG4R2-10 — comment tightening (cosmetic)
- AGG4R2-11 — `data.ts` split (refactor, separate PR)
- AGG4R2-12 — JSON-LD E2E assertion (test-surface expansion, separate plan)

## Carry-forward (unchanged status)

From prior cycles:
- D1-01 / D2-08 / D6-09 — CSP `'unsafe-inline'` hardening
- D2-01 / D1-03 — Admin mobile nav scroll affordance
- D2-02 — `uploadImages` dead `replaced: []` return field
- D2-03 / D6-05 — CSV export streaming
- D2-04 — Duplicate in-memory rate-limit maps (see ARCH-05)
- D2-05 — `searchImages` sequential round-trips (confirmed still present in PERF-02)
- D2-06 — `bootstrapImageProcessingQueue` unpaginated SELECT (confirmed in PERF-03)
- D2-07 — Session clock-drift lower bound
- D2-09 — updatePassword concurrent regression test
- D2-10 — settings-client hint coupling
- D2-11 — data.ts mutable view buffering (confirmed still relevant in ARCH-02/DBG-03)
- D6-01 — cursor/keyset infinite scroll
- D6-02 — scoped topic/tag photo navigation
- D6-03 — visual regression workflow
- D6-04 — public photo ISR/auth-boundary redesign
- D6-06 — sitemap partitioning
- D6-10 — durable shared-group view counts (see Hypothesis B in tracer)
- D6-11 — tag-filtered metadata canonical names
- D6-12 — split mutable view buffering
- D6-13 — single-process runtime assumption
- D6-14 — broader test-surface expansions
- OC1-01 / D6-08 — historical example secrets in git history
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- PERF-UX-01 — blur placeholder no-op
- PERF-UX-02 — full variable font
- AGG3R-06 — Footer "Admin" link contrast (AAA fail)
- AGG3R-08, AGG3R-09, AGG3R-10, AGG3R-11, AGG3R-12 — various LOW UX items

## Agent failures

None — every spawned reviewer returned a file.

## Totals

- **0 CRITICAL / HIGH** findings
- **0 MEDIUM** findings
- **12 LOW** findings (5 should-fix this cycle, 7 deferred)
- **25+ carry-forwards** unchanged

## Cross-agent agreement highlight

**AGG4R2-01** (the `db/index.ts` pool-connection handler) is flagged by 7 of 11 reviewers with HIGH confidence. This is the strongest signal of the cycle and should be fixed first.
