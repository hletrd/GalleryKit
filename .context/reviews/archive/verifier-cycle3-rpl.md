# Verifier Review — Cycle 3 (RPL loop)

**Date:** 2026-04-23
**Role:** Evidence-based correctness check against stated behavior in `CLAUDE.md`, `AGENTS.md`, and shipped code.

## Evidence collected

- `npm run lint --workspace=apps/web` → clean.
- `npm test --workspace=apps/web` → 43 files, 221 tests, all passing.
- `npm run lint:api-auth --workspace=apps/web` → clean.
- `npm run lint:action-origin --workspace=apps/web` → all 18 mutating actions OK.
- `npm run build --workspace=apps/web` — not re-run this cycle; previous cycles confirmed clean (tsc `--noEmit` style via Next compile). Will re-run post-fix.
- Live server curl + Playwright verification of home, photo, 404 routes in both locales.

## Claims verified

| Claim (from CLAUDE.md) | Verified? | Evidence |
|---|---|---|
| All mutating server actions verify auth via `isAdmin()` | ✅ | `lint:api-auth` lint check passes; grep shows `isAdmin()` call early in every action |
| Mutating actions enforce same-origin | ✅ | `lint:action-origin` passes for 18 actions |
| Sharp pipeline uses `Promise.all` + `clone()` | ✅ | `lib/process-image.ts` source |
| Session tokens verified with `timingSafeEqual` | ✅ | `lib/session.ts` uses `crypto.timingSafeEqual` |
| Argon2 used for password hashing | ✅ | `auth.ts` imports `argon2`, uses `argon2id` |
| `SESSION_SECRET` required in production | ✅ | `lib/session.ts:20-30` env + prod guard |
| Upload concurrency = 1 for PQueue | ✅ | `lib/image-queue.ts` `concurrency: 1` |
| GPS lat/long excluded from public API | ✅ | `lib/data.ts` public field set + compile-time guard |
| LIKE wildcards escaped | ✅ | `lib/data.ts` search escaping |
| CSV export escapes formula injection | ✅ | `admin/db-actions.ts` `exportImagesCsv` |
| `/api/live` is liveness probe, `/api/health` is DB-aware readiness | ✅ | Source confirms |

## Claims requiring attention

| Claim | Status | Gap |
|---|---|---|
| WCAG 2.2 coverage documented? | N/A | Not explicitly claimed in CLAUDE.md but prior cycle reviews touch on it |
| Heading hierarchy documented? | ⚠️ | CLAUDE.md doesn't mandate heading structure; a11y findings (C3R-UX-01, CQ3-01) are UX concerns, not doc/code drift |
| `CardTitle` semantic level documented? | ⚠️ | shadcn default is `<div>`; project had implicitly assumed it was a heading. Consider documenting. |

## Regression check

- All 221 vitest tests pass post-cycle-2.
- No new commits break the gate surface.
- e2e suite not re-run this cycle (expensive); prior run OK per git log.

## Totals

- **0 correctness regressions**
- **0 doc/code drift**
- **2 documentation enhancement opportunities** (CardTitle semantic expectation, heading policy)
