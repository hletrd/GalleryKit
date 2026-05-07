# Architect — Cycle 14 (current run)

**Reviewer:** architect (architectural and design risk, coupling, layering)
**Scope:** Module boundaries, layering between actions / lib / data, defense-in-depth posture.

## Methodology

Re-checked the module layering:
- `app/actions/**` (server actions) — should only call `lib/**` and `db`, never the React layer.
- `lib/**` — pure helpers (must remain importable from both server actions and tests).
- `db/**` — schema + connection only.
- `app/[locale]/**` — UI + page components; should not bypass `app/actions` to talk to the DB directly.

Inspected the build-time gates (`scripts/check-*`) for whether they still enforce the architectural invariants from cycles 5-6 (recursive discovery, route-file extension breadth, arrow-function support).

## Findings

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| (none) | Layering is intact. Mutating actions remain centralized under `app/actions/**`, and all of them either call `requireSameOriginAdmin()` or are documented opt-outs (`auth.ts`, `public.ts`). | — | — | — |

### Architectural re-checks

- **Storage abstraction not yet wired.** `apps/web/src/lib/storage/index.ts` exists as an experimental backend abstraction but is not consumed by the live upload / processing / serving paths. CLAUDE.md explicitly documents this. No dual-write inconsistency risk.
- **Privacy guard is enforced at compile time.** `_privacyGuard` and `_SensitiveKeysInPublic` types in `apps/web/src/lib/data.ts:197-200` make accidental PII leakage a TypeScript error.
- **Same-origin guard is centralized.** `requireSameOriginAdmin()` lives in `apps/web/src/lib/action-guards.ts`. The lint gate enforces that every mutating action calls it.
- **Restore maintenance state lives in a Symbol-keyed global.** `apps/web/src/lib/restore-maintenance.ts` uses `Symbol.for('gallerykit.restoreMaintenance')` so multiple module instances share one source of truth. Same pattern as `image-queue.ts` and `storage/index.ts`.
- **DB advisory locks scoped to a single pool connection.** Both `restoreDatabase` and `deleteAdminUser` and `withTopicRouteMutationLock` acquire/release on the same `connection.getConnection()` handle.

## Verdict

No architectural drift. Layering remains clean.
