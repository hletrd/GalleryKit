# Architect Review — Cycle 18 (HEAD a9702716, baseline 7b5c1943)

Scope: architectural & design-risk review — coupling, layering, cohesion, single-source-of-truth, leaky abstractions, scalability boundaries. Only NEW / still-open / re-assessed structural risks. Cycle-17 surface: images.ts (+28 TOCTOU settle), image-queue.ts (+16 semantic-mode snapshot), 3 a11y one-liners, +5 tests. No drizzle/schema/data/storage changes.

## Boundary inventory (re-verified)
| # | Boundary | State |
|---|----------|-------|
| B1 | topics.slug rename fan-out | 3 FK children + 1 JSON store; no new referrer |
| B2 | Public images select privacy split | 5 sites, 3 compile-guarded, 2 unguarded — count stable |
| B3 | Process-local coordination state | no new state in cycle-17 (semanticSearchMode is per-job snapshot) |
| B4 | gallery-config layering | intact; no raw-DB bypass |
| B5 | @/lib/storage quarantine | holds — zero non-test importers |
| B6 | Migration robustness | unchanged; no new DROP migration |

## Findings

### A1 — STRUCTURAL, HIGH — topics.slug fan-out: root unchanged, cheap tactical net STILL un-built
Fan-out set still exactly 4, no new referrer: images.topic (schema.ts:33 restrict), topic_aliases.topic_slug (:16 cascade), topic_views.topic (:236 cascade) — none with ON UPDATE CASCADE — + smart_collections.query_json. updateTopic re-points all 4 by hand (topics.ts:283,:284,:292,:302-317) before recreate-delete (:321-322). Cycle-17 de-vacuumed GAP-1 but the rename test still hand-mocks exactly {topicAliases,images,topicViews,smartCollections} — a NEW FK child added without re-pointing would still pass every test. **Structural fix (defer, migration):** onUpdate:'cascade' on the 3 FKs + in-place UPDATE. **Tactical net (land now):** schema-derived registry assertion querying INFORMATION_SCHEMA.KEY_COLUMN_USAGE for every FK referencing topics.slug and asserting updateTopic re-points each. Confidence HIGH; recommendation unchanged from cycle-17 because it was never actioned.

### A2 — STRUCTURAL, MED-HIGH — search-route enrichment selects now DUPLICATED across both routes, still outside compile guard
3 of 5 public images-select sites carry the Extract compile guard (publicSelectFields data.ts:395, publicMapSelectFields :431, searchFields :1500-1503). The 2 route-level enrichment selects are unguarded AND now hand-copied verbatim into BOTH routes (semantic :293-309, similar :195-210) — byte-identical to searchFields minus created_at. One public-field contract now exists in THREE near-copies, two unguarded, kept in sync by comment. The sole guard (search-route-privacy.test.ts PII_COLUMNS, 19 entries) currently matches PrivacySensitiveKeys\{processed} but nothing asserts the equality. Drift vector 1 (live): a 21st PII column auto-covers the 3 guarded sites, invisible to the frozen denylist. Drift vector 2 (structural): regex matches only `images.<col>`; JOIN-PII sidesteps it (the prior getImagesForFeed example since CLOSED at data.ts:833 `author_name: NULL`, SEC-13-01 — no live JOIN-PII). **Structural fix (fixable now):** export one guarded `searchEnrichmentSelectFields` const from data.ts, import in both routes; collapses 3 copies to 1, deletes the denylist. Confidence HIGH; security-reviewer confirms 0 live leak → drift-prevention.

### A3 — STRUCTURAL SMELL, LOW-MED — migration DROP mirror in reconcileLegacySchema not in .sql
No new DROP migration in cycle-17; smell identical to prior write-up. Existing nets adequate (migrate-reconcile-coverage.test.ts + runMigrations hash post-condition). No re-action needed.

### A4 — NEW STRUCTURAL SMELL, MEDIUM (instance LOW) — upload-tracker claim is hand-balanced RAII settled at 5+ exit sites; this pattern GENERATED the cycle-17 headline bug
The quota claim (images.ts:228) must be reconciled on every exit path; released by hand at 5+ sites (:244,:249,:273,:277,:533/:555) while the outer finally (:561) releases only the contract lock. Sole guard against a new throw-path leak is the invariant comment (:264-265). This is the GENERATOR of DBG-17-1: CR-16-01 moved the claim earlier + introduced an unsettled await; CR-17-1 patched it. The upload-tracker analog of A1's recurring missed-sibling. **Structural fix (fixable now):** wrap claim lifetime in `try {…} finally { if(!claimSettled) settleUploadTrackerClaim(…,0,0) }`, success/all-failed settle sets claimSettled=true. Makes every exit (incl. future awaits) safe by construction; retires both per-await patches + the comment burden. NOTE: the finally must only fire the 0/0 rollback on throw-BEFORE-the-final-settle (the per-file loop is fully inner-try/catch'd, so no committed-then-throw path exists in practice — verify before landing). Confidence HIGH on diagnosis; MEDIUM do-now-vs-defer given low instance severity.

## Re-confirmations (PASS)
B3 process-local state — no new cross-instance coordination; semanticSearchMode is a per-job snapshot, not process-global → does not widen scaling boundary. B4 gallery-config layering — resolver-gated, no raw-DB bypass. B5 storage quarantine holds. B6 migration journal unchanged. CR-17-1 settle fix architecturally correct as a tactical patch (A4 is the structural observation).

## Priority ledger
| ID | Severity | Disposition |
|----|----------|-------------|
| A1 | HIGH | Restructure = DEFER (migration); schema-derived registry test = land NOW |
| A2 | MED-HIGH | FIXABLE NOW — const extract + 2 imports |
| A4 | MEDIUM (instance LOW) | FIXABLE NOW (try/finally + claimSettled) or defer to discipline |
| A3 | LOW-MED | Optional; nets adequate; no re-action |
| B3/B4/B5/B6 | PASS | — |
