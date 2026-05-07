# Architect Review — Cycle 3 (RPL loop)

**Date:** 2026-04-23
**Focus:** Architectural/design risks, coupling, layering, long-term maintainability.

## Summary

The architecture is mature. No new architectural risks this cycle. Key strengths preserved:

- **Thin server actions → data layer** split (actions in `app/actions/*.ts` call `lib/data.ts` which calls Drizzle). Clear layering.
- **Isolated test harness** under `__tests__/` + separate e2e under `e2e/`.
- **Env-driven config** (TRUST_PROXY, SESSION_SECRET, IMAGE_MAX_INPUT_PIXELS, etc.) with documented defaults.
- **Single source of truth** for gallery settings (`lib/gallery-config.ts` + shared `lib/gallery-config-shared.ts`).
- **Internationalization** centralized in `messages/{locale}.json` and `next-intl`.

## Observations

### ARCH3-01 — The `@/lib/storage` abstraction remains unwired [INFO] (carry-forward)

Per `CLAUDE.md`: "the `@/lib/storage` module still exists as an internal abstraction, but the product currently supports local filesystem storage only. Do not document or expose S3/MinIO switching as a supported admin feature until the upload/processing/serving pipeline is wired end-to-end."

Status: unchanged. No new action this cycle. Risk: dead code drift. Mitigation: internal-only, not exposed in UI — acceptable.

### ARCH3-02 — The `CardTitle` primitive is `<div>` project-wide [MEDIUM]

Architectural implication of CQ3-01: shadcn/ui v3 `CardTitle` renders `<div>`. Admin pages and other consumers also use `CardTitle` for what should be semantic headings. A project-wide decision is needed:

1. **Local wrap approach** (minimal churn): wrap CardTitle in `<h2>` where needed, as done for the photo page fix.
2. **Primitive override approach**: patch `ui/card.tsx` to render `CardTitle` as `<h3>` by default (or accept an `as` prop).
3. **Status quo**: leave as `<div>`; document the expectation that consumers provide semantic heading elements around or inside.

**Recommendation:** Option 1 for this cycle (narrow fix on the photo page). Option 2 in a future refactor cycle if multiple pages prove to need it.

### ARCH3-03 — Single-process runtime assumptions [carry-forward D6-13] [LOW]

The in-memory rate-limit Maps, upload tracker, and image-processing queue assume a single Node process. A multi-replica deployment would see divergent state. Current deployment model is single Docker container — OK for now, but should be documented or redesigned if scaled.

## Totals

- **0 new architectural findings**
- **1 MEDIUM policy question** (ARCH3-02) — overlaps with CQ3-01 fix
- **2 carry-forwards unchanged**
