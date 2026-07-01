# Cycle 97 Data / Migration / Privacy Review

Scope: deployed `master` at `061c1c81af234469641f75a53e5bbc61fa63114a`.

## Findings

### C97-05 - Restore SQL scanner can miss split CREATE routine/view statements past the raw tail window

- Severity/confidence: Medium / High.
- Evidence: `apps/web/src/lib/sql-restore-scan.ts:107`-`120` blocks `CREATE TRIGGER`, `FUNCTION`, `PROCEDURE`, `EVENT`, and `VIEW`; `appendSqlScanChunk()` at `apps/web/src/lib/sql-restore-scan.ts:267`-`277` retained only the last raw `SQL_SCAN_TAIL_BYTES`; the restore path scans chunks in `apps/web/src/app/[locale]/admin/db-actions.ts:620`-`637`. A crafted file with `CREATE` followed by more than the tail budget of whitespace before `FUNCTION`, `PROCEDURE`, or `VIEW` loses the `CREATE` token before the next chunk is scanned.
- Failure scenario: a restore upload can smuggle disallowed routine/view DDL past the pre-import scanner and into `mysql --one-database`.
- Suggested fix: compact sanitized scan-tail forms across chunks so huge whitespace/comment gaps cannot separate dangerous statement heads from their second token; add split-window tests for function, procedure, view, and trigger.

## Residual Risks

Migration journal, reconcile, privacy select guards, and analytics retention had existing source/test contracts. No additional confirmed data/privacy issue in this cycle.
