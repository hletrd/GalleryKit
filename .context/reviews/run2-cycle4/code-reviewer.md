# Logic / Edge-Case / Test-Gap Review — Run-2 Cycle 4 (HEAD 2508f132)

Date: 2026-05-30
Method: direct orchestrator review (Task fan-out unavailable in nested context).

## Verdict: ZERO net-new findings (CRIT 0 / HIGH 0 / MED 0 / LOW 0)

## Logic / edge-case surfaces verified clean

| Surface | Evidence |
|---|---|
| `db.execute` row unwrap | Both backfill files defensively unwrap the drizzle mysql2 `[rows, fields]` tuple (`Array.isArray(result) && Array.isArray(result[0])`) so iterating never treats `fields` as a row. `Number(rows[0].cnt)` coerces COUNT bigint/string safely. |
| Backfill candidate selection | `WHERE processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < CURRENT)` — NULL handled explicitly; ORDER BY id ASC deterministic; zero-candidate path returns `{queued, affectedRows:0}` and releases lock. |
| Detection-failure branch | Encode-ok/detect-throw correctly persists derivative cols only, leaving `pipeline_version` behind so the row is retried (resume invariant). Missing-original path skips silently (mirrors script). Encode-failure path returns early without DB write. |
| `wide-gamut-hint.tsx` localStorage | `readLocalDismiss` validates `gamut:string` + `expiresAt:finite number`, auto-expires past-TTL records, try/catch around all storage I/O (private-browsing/quota safe). Dismiss keyed by gamut FAMILY (R13-M2) so functionally-equivalent primaries don't re-nag. |
| `use-display-capability.ts` | Snapshot memoization correct (see perf-reviewer.md); precedence `screen.colorGamut` → `rec2020` MQ → `p3` MQ → srgb default; Firefox correctly defaults srgb (no false-positive canvas probe). |
| Color detection precedence | `detectColorSignals` resolves NCLX colr → ICC chromaticity → ICC name allowlist in documented priority; bounded ISOBMFF walker (depth 5, 1MB scan). (Re-confirmed; no logic change since prior cycles.) |

## Test-suite cross-check
- 156 test files / 1481 tests green.
- Documented CLAUDE.md invariants spot-checked against enforcing tests:
  - privacy contract → `privacy-fields.test.ts` (symmetric guard).
  - tagNamesAgg GROUP_CONCAT shape → `data-tag-names-sql.test.ts`.
  - blur-data-url producer/consumer wiring → `process-image-blur-wiring.test.ts` + `images-action-blur-wiring.test.ts`.
  - touch-target floor → `touch-target-audit.test.ts`.
  - backfill detection-failure column contract → `backfill-detection-failure-contract.test.ts` + `admin-backfill-runner-detection-failure.test.ts`.
  No fixture/production drift detected; no test asserts a stale contract.

## Note on honesty
No off-by-one, null-handling, coercion, precedence, or fixture-drift bug found
on independent inspection. No findings.
