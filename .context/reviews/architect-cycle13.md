# Architect - Cycle 13 (current run, 2026-04-23)

Note: Earlier cycle-13 file `architect-cycle13-historical-2026-04-19.md` preserved for provenance; ARCH-13-01 / ARCH-13-02 were implemented in plan-122. ARCH-13-03 (publicSelectFields enforcement) was addressed by the `_SensitiveKeysInPublic` compile-time guard in data.ts.

## Layering check

- **Route → Server action → DB**: clean. Routes in `app/[locale]/...` import from `app/actions/*`. Server actions import from `lib/*` and `db/*`.
- **`lib/` is fan-out**: no inter-lib cycles observed. `rate-limit.ts`, `auth-rate-limit.ts`, `session.ts`, `sanitize.ts`, `validation.ts`, `sql-restore-scan.ts` are leaf modules.
- **Guards**: `action-guards.ts` depends on `request-origin.ts` only (leaf → leaf). `api-auth.ts` wraps route handlers.
- **Build-time guards**: `check-action-origin` and `check-api-auth` scripts live in `scripts/` and do not couple to runtime code beyond source inspection.
- **Config layering**: `gallery-config.ts` (server-only, DB-dependent) correctly delegates validators to `gallery-config-shared.ts` (pure, client-safe). The `validatedNumber` + `parseImageSizes` pattern now enforces defensive reads from DB.

## Identified tensions (pre-existing, not new)

1. Storage module abstraction (`@/lib/storage`) is not yet wired — deliberately documented in CLAUDE.md.
2. Dual rate-limit layers (in-memory Map + DB-backed bucket) are documented and covered by tests.

## Findings

No new CRITICAL, HIGH, MEDIUM, or LOW findings.

## Confidence: High

Architecture is clean; no refactor pressure.
