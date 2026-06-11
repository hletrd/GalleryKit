# Aggregate review — Run-4 Cycle 13

Per-angle provenance files in this directory:
- `code-reviewer-debugger-tracer.md`
- `security-reviewer-critic-verifier.md`
- `perf-reviewer-architect.md`
- `test-engineer.md`
- `document-specialist.md`
- `designer.md`

NOTE: This cycle runs as a single orchestrator-spawned subagent; nested
Agent/Task spawning is unavailable in this context (same documented
constraint as run2/run3/run4-c1..c12). Each angle was executed as a distinct
full-inventory in-context pass; no angle sampled. Inventory: independent
line-level regression review of the cycle-12 fix commit (`ef1ea136` quiesce
reorder + behavioral test); rotation to the least-run-4-covered surfaces by
a fresh mention-count coverage map over run4-c1..c12 review texts —
`app/actions/topics.ts` (full 524 lines), `lib/process-topic-image.ts`,
`lib/tag-records.ts` / `lib/tag-slugs.ts`, `lib/csv-escape.ts`,
`lib/blur-data-url.ts`, `lib/icc-extractor.ts` (full bounds audit),
`lib/image-url.ts` / `download-filename.ts` / `backup-filename.ts` /
`mysql-cli-ssl.ts` / `error-shell.ts` / `action-result.ts` /
`feature-flags.ts`, `db/schema.ts` topics region, `topic-manager.tsx`
rename/map UI, `getMapImages` guard in `lib/data.ts`; plus pattern sweeps
(transactional insert+delete recreate idioms across all of `src/` — topics
rename is the only instance; unradixed parseInt on rotation surfaces — none;
unbounded parser loops — none).

## Context
C12 closed the restore-quiesce deadlock. C13's coverage-map rotation landed
on the topics action stack and found a column-addition blind spot in the
codebase's only recreate-row idiom: US-P21 added `topics.map_visible`
(2026-05-03) without threading it through the slug-rename recreate
(2026-04-22), so renaming a topic silently resets its public-map opt-in.

## Cross-angle agreement
- **COR-R4C13-01** — flagged by code/debugger/tracer (recreate insert omits
  `map_visible`; causal trace `2f2e8436` → `52cb48f1`), security/critic/
  verifier (CONFIRMED via schema DEFAULT + getMapImages JOIN; fail-safe
  direction — availability loss, not GPS leak; audit log silent on the
  transition), perf/architect (only recreate idiom in `src/`; in-transaction
  carry chosen over FK ON UPDATE CASCADE restructuring), test-engineer
  (rename test pins call order, discards `.values()` payloads — exactly why
  the regression shipped silently), document-specialist (CLAUDE.md rename
  claim true-but-column-silent; no doc edit required), designer (Map switch
  silently flips OFF in the same admin table row that hosts the rename
  entry point; backend fix is the remedy). 6/6 angles.

## Merged finding list

| ID | Sev/Conf | Title | Source angles |
|----|----------|-------|---------------|
| COR-R4C13-01 | **MED/High (CONFIRMED)** | Topic slug rename silently resets `map_visible` to false: `updateTopic`'s rename path (`app/actions/topics.ts:248-253`) re-creates the topic row with only `{label, slug, order, image_filename}` while `topics.map_visible` is `NOT NULL DEFAULT false` (`db/schema.ts:11`, US-P21). Renaming an opted-in topic drops its photos from the public `/map` (`getMapImages` INNER JOINs `map_visible = true`, `lib/data.ts:1533-1550`) with no error, no audit event, and the admin Switch silently showing OFF. Fail-safe direction (more private, never less). Fix: widen the in-transaction SELECT to fetch the authoritative row's `image_filename` + `map_visible` and thread both into the replacement insert; assert the inserted VALUES in the rename test so the next `topics` column addition fails the suite instead of shipping another silent reset. | code, security, perf, test, document, designer |
| COR-R4C13-02 | LOW/High | Rename carries `image_filename` from a pre-lock SELECT (`topics.ts:213,217,237`) — concurrent image update between SELECT and transaction gets clobbered by the stale value (orphaned file, two-admin sub-second window). Closed for free by the COR-R4C13-01 in-transaction carry. | code, perf |
| TEST-R4C13-01 | gap/High | `topics-actions.test.ts:246-291` rename test asserts step order only; fake `txInsert` discards `.values()` payloads — folds into COR-R4C13-01 (add VALUES assertion + `map_visible` to the `@/db` mock's `topics` shape) | test |
| DOC-R4C13-01 | INFO/High | CLAUDE.md "Topic slug rename: Transaction wraps reference updates before PK rename" remains TRUE; it never asserted column preservation. Fix-commit body to state the carry contract; no doc edit scheduled | document |
| DOC-R4C13-02 | INFO/High | CLAUDE.md never mentions the US-P21 per-topic map opt-in (name-level schema list, so no contradiction) — observation recorded in the deferred ledger with exit criterion | document |
| DES-R4C13-A | MED/High (resolved-by-backend-fix) | Rename flips the same-row Map switch OFF with zero feedback — mutation's visible effects exceed its stated scope; no client change wanted once the backend carries the value | designer |

## Regression review of cycle-12 commit — SOUND
`ef1ea136` verified at line level: `pause(); clear(); await onIdle();` with
state clears after the await; the injected fake's reject-unless-cleared
semantics and exact order assertion close both the hang and silent-drift
modes; comment claims match code; no drift against
`drainProcessingQueueForShutdown`. No follow-on work.

## Clean-pass surfaces this cycle
`process-topic-image.ts` (upload hygiene sound), `tag-records.ts` /
`tag-slugs.ts`, `csv-escape.ts` (bypass lineage holds), `blur-data-url.ts`,
`icc-extractor.ts` (full bounds audit clean), `image-url.ts`,
`download-filename.ts`, `backup-filename.ts`, `mysql-cli-ssl.ts`,
`error-shell.ts`, `action-result.ts`, `feature-flags.ts`.

## Standing deferrals re-audit (exit criteria un-triggered this cycle)
Diff since the c12 review commit (`d2696975..HEAD`) touches only
`data.ts` / `image-queue.ts` / tests / SW version / docs — none of the
deferral surfaces:
- DEF-R4C11-A (aria-live constant string, plan-294) — untouched. Deferred.
- DEF-R4C10-A/B (gps-strip extension trust; OnThisDay server day, plan-292)
  — untouched. Deferred.
- DEF-R4C1-01 / DEF-R4C2-01 / DEF-R4C3-01 (LR PAT breadth/scopes/English)
  — no LR change. Deferred.
- OPS-R4C6-01 (host nginx `/uploads/`, MED/High preserved, plan-284) — no
  host nginx maintenance. Deferred.
- DEF-R4C8-A/B/C/D (paid GET bodies, interstitial 410, ImageZoom passive
  preventDefault, Tailwind safelist, plan-288) — untouched. Deferred.
- Histogram mode-cycle aria-label (since plan-286) — deferred.
- OBS-R4C12-B/C/D/E (plan-296) — quota-lock invariant intact (no lock
  narrowing this cycle), claim-retry guards intact, data.ts:83 symmetry
  untouched, ETag format unchanged. All remain recorded.

## Gate baseline (clean tree)
vitest 183 files / 1747 tests green pre-change (run this cycle); all 8
gates run during PROMPT 3 after the fix lands.

## HARD-SCOPE check
No finding proposes edit / culling / scoring / preset features. The one
scheduled fix preserves an existing admin setting across an existing
operation.

## AGENT FAILURES
None. All angles completed in-context (single-subagent constraint documented
above); no spawn retries required.
