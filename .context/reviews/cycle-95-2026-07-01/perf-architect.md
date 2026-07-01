# Cycle 95 Performance / Architecture Review

Review target: `750729ada2403c0c01267670b9552a05e0ead217`.

## Scope

Reviewed Cycle 94 performance/architecture findings against current HEAD and inspected whether the Cycle 94 token-admin changes introduced new hot paths or shared-state concerns.

## Confirmed Findings

No new performance or architecture defect was confirmed.

## Carry-Forward Items Still Deferred

- `C94-09 / C77-ARCH-01`: restore maintenance still does not fence already-in-flight non-upload admin mutations. Original severity/confidence: High / High. Citations remain `.context/plans/cycle-94-2026-07-01-deferred.md` plus `apps/web/src/app/[locale]/admin/db-actions.ts:452`, `apps/web/src/app/actions/settings.ts:43`, `apps/web/src/app/actions/settings.ts:164`, `apps/web/src/app/actions/tags.ts:44`, `apps/web/src/app/actions/topics.ts:87`, `apps/web/src/app/actions/sharing.ts:93`.
- `C94-10 / C88-03`: `image_embeddings` cannot stage or retain multiple model versions per image. Original severity/confidence: Medium / High. Citations remain `.context/plans/cycle-94-2026-07-01-deferred.md` plus `apps/web/src/db/schema.ts:284`, `apps/web/drizzle/0012_image_embeddings.sql:10`, `apps/web/src/lib/image-queue.ts:379`, `apps/web/src/app/api/search/semantic/route.ts:274`, `apps/web/src/app/api/search/similar/[id]/route.ts:139`.
- `C94-11`: first-page public listing forces an exact `COUNT(*) OVER()` through grouped tag-join queries. Original severity/confidence: Medium / High. Citations remain `.context/plans/cycle-94-2026-07-01-deferred.md` plus `apps/web/src/lib/data.ts:911`, `apps/web/src/lib/data.ts:926`, `apps/web/src/lib/data.ts:1495`, `apps/web/src/lib/data.ts:1507`, `apps/web/src/components/home-client.tsx:268`.

## Non-Findings

- Cycle 94 token list retry state does not add polling, background timers, or additional server requests except explicit retry/create/revoke refreshes.
- The new `loadError` and `labelError` state is local UI state and does not change shared architecture.

## Validation

Static architecture review. Full build/test gates are scheduled after artifact updates.
