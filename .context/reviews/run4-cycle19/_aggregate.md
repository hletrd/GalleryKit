# Aggregate review — Run-4 Cycle 19

Per-angle provenance files in this directory:
- `code-reviewer-debugger-tracer.md`
- `security-reviewer-critic-verifier.md`
- `perf-reviewer-architect.md`
- `test-engineer.md`
- `document-specialist.md`
- `designer.md`

NOTE: This cycle runs as a single orchestrator-spawned subagent;
nested Agent/Task spawning is unavailable in this context (same
documented constraint as run2/run3/run4-c1..c18). Each angle was
executed as a distinct full-inventory in-context pass; no angle
sampled. Inventory: line-level regression review of the three
cycle-18 fix commits (`b4a5795c`, `ff0fb549`, `096bfceb`); rotation
by mention-count map over run4-c1..c18 corpora to the
**zero-coverage operational scripts cluster** (all 24 files under
`apps/web/scripts/`), the **e2e suite** (all 6 spec/helper files),
the **raw `db.execute` consumer sweep** the scripts review triggered
(all 11 consumer files), and the **UI-primitive tail**
(`components/ui/*`, password-client, bulk-edit-types,
upload-tracker-state).

## Context

C18 closed the feed-locale and stripe-deleted-image divergences. C19's
rotation into the scripts cluster surfaced the run's most consequential
finding yet: a six-week-old, empirically-proven, production-breaking
regression in topic management that every gate missed because the unit
mocks encode the same wrong driver-shape assumption as the code.

## Cross-angle agreement

- **COR-R4C19-01** — code/debugger/tracer (primary; drizzle source
  trace + stub + live-DB proof), verifier (independent evidence chain,
  counter-hypotheses ruled out), architect (root cause: no canonical
  raw-row seam; perf change crossed a layering boundary), test
  (mock-shape divergence TEST-R4C19-02), designer (UX harm
  adjudication DES-R4C19-08). **5/6 angles — highest agreement of the
  run.**
- **COR-R4C19-04** — code (primary), perf (keyset also fixes O(N²)
  OFFSET scans). **2/6.**
- **SEC-R4C19-06** — code + security (destructive-ops posture).
  **2/6.**
- **DOC-R4C19-05** — document-specialist (primary), security
  (sibling-script contrast). **2/6.**

## Merged finding list

| ID | Sev/Conf | Title | Source angles | Disposition |
|----|----------|-------|---------------|-------------|
| COR-R4C19-01 | **HIGH/High (CONFIRMED, live-DB proof)** | `topicRouteSegmentExists` (topics.ts:41-48) treats drizzle raw `db.execute`'s mysql2 `[rows, fields]` tuple as a rows array → `rows.length > 0` is ALWAYS true → createTopic (:126), updateTopic slug rename (:232), createTopicAlias (:426) have been deterministically broken since 515bc639 (2026-04-28). Live-DB proof: nonexistent slug → `rows.length = 2`, matching rows 0. Fix: house tuple unwrap (pattern at backfill-color-pipeline.ts:269) + tuple-accurate test mocks + failing-pre-fix success-path locks. | 5/6 | SCHEDULE |
| TEST-R4C19-02 | HIGH/High | topics-actions.test.ts mocks `db.execute` as a bare rows array — the suite green-lights the broken shape. Tuple-accurate mocks + create/rename/alias success+conflict locks, proven failing pre-fix. | test, code | SCHEDULE (with COR-R4C19-01) |
| COR-R4C19-03 | MED/High (CONFIRMED) | backfill-cicp-recheck.ts:56-62 casts the same tuple to `DbRow[]` → iterates [rows,fields] as 2 pseudo-rows → unhandled PQueue rejection / nonsense diagnostics. Same unwrap fix. | code, verifier | SCHEDULE |
| COR-R4C19-04 | MED/High (CONFIRMED) | backfill-alt-text.ts:44-91 + backfill-clip-embeddings.ts:66-126 advance `OFFSET` while their UPDATEs shrink the WHERE set → ~half the backlog silently skipped, success summary printed. Fix: keyset pagination (`WHERE id > cursor ORDER BY id`), which also survives permanently-unprocessable rows and removes O(N²) OFFSET scans. | code, perf | SCHEDULE |
| DOC-R4C19-05 | LOW-MED/High (CONFIRMED) | backfill-alt-text.ts:20-24 documents an `auto_alt_text_enabled` / `--force` gate the code never implements (setting unread; FORCE_FLAG only prints a tip). Implement the documented gate exactly as the sibling backfill-clip-embeddings.ts:42-61 does. | doc, security | SCHEDULE (same file as COR-R4C19-04) |
| SEC-R4C19-06 | MED-LOW/High | migrate-titles.ts:17-21 runs `UPDATE images SET title = NULL` (no WHERE/flag/prompt) — long-completed one-shot that would silently destroy every current photo title if invoked today. Fix: additive refusal guard requiring `--i-understand-this-clears-all-titles`; deletion stays an owner decision (DEF-R4C16-A precedent). | code, security | SCHEDULE |
| TEST-R4C19-07 | MED/High | No admin topic-management e2e (admin.spec covers nav/GPS/upload only) — why no gate caught a fully broken create flow. Add create→visible→delete spec in the adminE2EEnabled lane, self-cleaning. | test | SCHEDULE |
| OBS-R4C19-C | LOW/Medium | check-public-route-rate-limit.ts:116-119 is fail-open on `export * from` route files (its sibling admin gate is fail-closed on the same shape). Fail the file on star re-exports — zero current cost, closes the asymmetry. | security | SCHEDULE (small hardening) |
| OBS-R4C19-A | LOW/Medium | seed-admin.ts lacks migrate-admin-auth.ts:42-44's `$$argon2` compose-escape normalization → a `$$`-escaped hash would be silently re-hashed as plaintext and lock the admin out. | code, security | DEFER (exit: first bootstrap-login support report with compose-escaped hash, or next functional seed-admin edit) |
| DEF-R4C19-B | LOW/Medium | 7 hand-copied tuple-unwrap idioms + 2 missed sites = no canonical raw-row seam. | architect | DEFER (exit: next NEW raw `db.execute` consumer introduces `extractRows<T>()` and migrates opportunistically) |
| OBS-R4C19-B | INFO | check-api-auth.ts:162 bare `require.main` (sibling guards `typeof require`). Dormant under tsx. | code | RECORD |
| OBS-R4C19-D | INFO | migrate-capture-date.js leaves trailing `Z` on second-precision ISO strings; dormant (column long since DATETIME, :40 early-return). | code | RECORD |
| OBS-R4C19-E | INFO | backfill-clip-embeddings.ts:64 dead `const skipped = 0` counter in summary. | code | RECORD (fold into COR-R4C19-04 edit) |
| DES-R4C19-08 | adjudication | False-conflict error blames the admin's input for a system fault — severity context for COR-R4C19-01; no separate fix. | designer | RECORD |

## Regression review of cycle-18 commits — SOUND

All three fix commits verified line-level against the live tree (guard
ordering, 404/200 taxonomies, comment-only registry change). No
follow-on findings.

## Clean-pass surfaces this cycle

Full lists in the per-angle files. Highlights: seed-e2e (NODE_ENV
refusal, FK-cascade-aware cleanup), mysql-connection-options +
e2e/helpers TLS posture, run-e2e-server host/port allowlist,
entrypoint.sh gosu drop, build-sw execFileSync, ensure-site-config
placeholder refusal, check-api-auth fail-closed verification (star
re-exports, aliased exports, as/satisfies unwrap), e2e suite a11y
locks (heading hierarchy, focus trap, origin-guard 403 with DB-minted
session), ui-primitive tail (no size drift), password-client,
bulk-edit-types, upload-tracker-state.

## Standing deferrals re-audit (exit criteria)

Diff since the c18 review commit (`92a8f291..HEAD` — fix surfaces +
plan/SW stamps only) touches no deferral surface; no exit criterion
fires:
- DEF-R4C18-A (feed route duplication), DEF-R4C18-B (entitlements
  cascade) — un-triggered; carried.
- DEF-R4C17-A/B; DEF-R4C16-A/B; DEF-R4C15-A/B; RISK-R4C14-03 +
  TEST-R4C14-02; DEF-R4C11-A; DEF-R4C10-A/B; DEF-R4C1-01/02-01/03-01
  (LR PAT); OPS-R4C6-01 (host nginx); DEF-R4C8-A/B/C/D; histogram
  mode-cycle aria-label (incl. NOTE-R4C18-D1); OBS-R4C12-B/C/D/E;
  DOC-R4C13-01/02 — all un-triggered; carried.

## Gate baseline (clean tree)

Cycle-18 close: all 8 gates green; deploy verified live (SW
`00df9a68-p7` → final stamp `6ac76d0b`). All 8 gates re-run during
PROMPT 3 after this cycle's fixes land.

## HARD-SCOPE check

No finding proposes edit / culling / scoring / preset features. All
scheduled fixes restore or harden existing surfaces: driver-shape
correctness (topics, cicp-recheck), backfill completeness (keyset),
documented-gate fidelity (alt-text), destructive-ops ceremony
(migrate-titles), gate fail-closed parity (public-route scanner), and
test/e2e locks.

## AGENT FAILURES

None — all six angle passes completed (single-subagent in-context
execution; no nested agent spawns attempted because the Agent tool is
unavailable in this environment, per the documented run-wide
constraint).
