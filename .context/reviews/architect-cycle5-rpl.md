# Architect — Cycle 5 (RPL loop)

Generated: 2026-04-24. HEAD: `0000000789a97f7afcb515eacbe40555cee7ca8f`.

Scope: architectural/design risks, coupling, layering.

## Architecture snapshot

- **Layering:** app/actions (server actions), app/api/admin (API routes with `withAdminAuth`), lib (shared helpers), db (schema + pool), components (React UI), proxy (middleware).
- **Consistency of the mutation surface:** every mutating server action gates on `isAdmin()` → `requireSameOriginAdmin()` → `getRestoreMaintenanceMessage()`, enforced by `scripts/check-action-origin.ts`.
- **API surface:** all `/api/admin/*` routes wrapped in `withAdminAuth`, enforced by `scripts/check-api-auth.ts`.
- **Data layer:** `src/lib/data.ts` is the single public query surface. React `cache()` wraps for request-scoped dedupe.
- **Queue:** PQueue with concurrency=2, advisory-lock-protected per-job claim, retry with exponential backoff.

## Findings

### A5-01 — Lint helpers live in `scripts/` but are part of the architectural defense surface
- **Severity:** LOW.
- **File:** `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-api-auth.ts`.
- **Critique:** these files are security gates — they enforce architectural invariants ("every mutating action has origin check," "every admin API route wraps withAdminAuth"). But they live alongside migration scripts and seeders. Their role as load-bearing gates is not distinguished. A future contributor cleaning up `scripts/` might inadvertently weaken the gate.
- **Recommendation:** rename to `apps/web/scripts/lint-action-origin.ts` / `lint-api-auth.ts` OR move to a dedicated `apps/web/linters/` subtree. OR add a banner comment `// CRITICAL: load-bearing security gate — do not weaken without cross-team review`. Low priority, hygiene.

### A5-02 — `check-action-origin.ts`'s `ACTION_FILES` allow-list is hard-coded
- **Severity:** LOW.
- **File:** `apps/web/scripts/check-action-origin.ts:19-28`.
- **Critique:** the scanner's file list is hard-coded. Adding `apps/web/src/app/actions/foo.ts` requires manually editing the lint script. A missing addition means the new action file is never checked. This is a footgun.
- **Recommendation:** switch from hard-coded `ACTION_FILES` to glob-discovery of `apps/web/src/app/actions/*.ts` (excluding public.ts + auth.ts + index/barrel) plus the known admin db-actions path. Low priority; it's an inconvenience today but could hide a new action file tomorrow.

### A5-03 — No architectural guardrail enforces that mutating actions also check `getRestoreMaintenanceMessage`
- **Severity:** LOW. Cross-ref CR5-07.
- **Critique:** the restore-maintenance check is present in every current mutating action, but by convention only. A new action can skip it, and nothing catches the lapse. Symmetry with the origin gate would be valuable.
- **Recommendation:** add a `lint:action-maintenance` scanner analogous to `lint:action-origin`. Defer (LOW).

### A5-04 — `src/lib/data.ts` remains 894 lines and mixes query, view-count buffering, SEO settings
- **Severity:** LOW. Cross-ref AGG4R2-11.
- **Recommendation:** defer. Existing.

### A5-05 — `app/actions.ts` barrel mixes 9 domain modules into one import path
- **Severity:** LOW. Cross-ref CR5-02.
- **Recommendation:** document canonical import path in barrel header. Low priority.

### A5-06 — Shared-group view-count buffer is in-process module state
- **Severity:** LOW. Cross-ref D6-10 (durable shared-group view counts).
- **Critique:** view counts are buffered in a per-process Map. On multi-instance deployment, view counts fragment. `setInterval` fires per-instance. A durable Redis/DB-level counter would be needed for horizontal scale.
- **Recommendation:** existing deferred backlog, no new work.

### A5-07 — Image processing queue uses `Symbol.for('gallerykit.imageProcessingQueue')` for global singleton
- **Severity:** LOW.
- **File:** `apps/web/src/lib/image-queue.ts:39, 77-94`.
- **Observation:** the `Symbol.for` trick ensures one queue per process across HMR reloads in dev. This is correct for Next.js App Router's dev mode. For prod (single instance per process), it's also correct. For multi-instance prod, the queue fragments — but advisory locks (`GET_LOCK`) prevent double-processing. Good design.
- **No finding.**

### A5-08 — `stripControlChars` + `if (clean !== raw) return error` idiom repeated across 14+ callsites
- **Severity:** LOW. Cross-ref AGG4R2-06.
- **Recommendation:** existing deferred — `requireCleanInput` helper extraction. No new work.

### A5-09 — `check-api-auth.ts` only considers `.ts` / `.js` extensions
- **Severity:** LOW. Cross-ref C5-02.
- **Recommendation:** include `.tsx`/`.mjs`/`.cjs`. Low priority.

### A5-10 — The three lint helpers (`lint`, `lint:api-auth`, `lint:action-origin`) each re-parse source files independently
- **Severity:** LOW.
- **Critique:** each runs its own TypeScript `createSourceFile` on a subset of files. In large repos this would be wasteful. Here the scopes are small enough to not matter. Not a finding; observation only.
- **Disposition:** no action.

## Summary

10 LOW architectural observations. Actionable this cycle:
- A5-01: rename or banner-comment the lint helpers to mark them as security gates.
- A5-02: glob-discover `ACTION_FILES` to prevent allow-list drift.
- A5-09: extend `.tsx` discovery in `check-api-auth.ts`.

Other items match existing deferred backlog.
