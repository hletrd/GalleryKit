# Architect Reviewer — Cycle 2/100 (2026-04-28)

## Files Reviewed

All source files under `apps/web/src/`.

## Findings

### LOW Severity

| ID | Finding | File | Confidence |
|---|---|---|---|
| C2-AR-01 | `deleteAdminUser` uses raw SQL via `conn.query()` instead of Drizzle ORM. This is intentional — the advisory lock (`GET_LOCK`) requires a dedicated pool connection and the transaction must run on that same connection. Drizzle's transaction API doesn't support pinning a specific pool connection. This is an architectural consistency note, not a bug. Carried forward from C1-28-F01. | `apps/web/src/app/actions/admin-users.ts:218-240` | Low |
| C2-AR-02 | `restoreDatabase` and `withTopicRouteMutationLock` similarly use raw SQL for advisory locks on dedicated connections. Same architectural justification as C2-AR-01. Consistent pattern. | `apps/web/src/app/[locale]/admin/db-actions.ts:271-328`, `apps/web/src/app/actions/topics.ts:37-57` | Low |

### INFO

- **Single-writer topology**: CLAUDE.md documents that restore maintenance flags, upload quota tracking, and image queue state are process-local. No horizontal scaling risk at current scope.
- **Layering**: Clean separation between data layer (`lib/data.ts`), action layer (`app/actions/`), and API routes (`app/api/`). Privacy enforcement at the data layer via `publicSelectFields` with compile-time guard.
- **Advisory lock scope**: CLAUDE.md documents MySQL advisory lock namespace collision risk for multi-tenant deployments. Not relevant for single-instance personal gallery.
- **Rate limiting architecture**: Dual in-memory + MySQL persistence with pre-increment pattern is consistent across all surfaces.

No new actionable architectural findings beyond the carried-forward C1-28-F01 raw SQL note.

## Convergence Note

Fourth consecutive cycle with no new medium/high architectural findings. The codebase architecture is sound and well-documented.
