# Quality Review — Cycle 1

## Scope / inventory
Reviewed the current repo surface relevant to logic defects and cross-file regression risk, with emphasis on:
- `apps/web/src/app/**` server actions, public pages, and route handlers
- `apps/web/src/components/**` client-side interaction/state flows
- `apps/web/src/lib/**` shared data, upload, auth, and config helpers
- `apps/web/scripts/**` operational and E2E seed/migration scripts
- repo-level docs/rules already present in `AGENTS.md`, `CLAUDE.md`, and `.context/reviews/*`

Most earlier review-cycle issues already appear fixed in the current head. The findings below are the remaining high-signal problems I confirmed in the current code.

## Findings

| Severity | Confidence | File / region | Problem | Concrete failure scenario | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| Medium | High | `apps/web/scripts/seed-e2e.ts:1-24` and `apps/web/src/lib/upload-paths.ts:11-37` | The E2E seed script evaluates `SEED_IMAGE_SIZES`, `UPLOAD_ROOT`, and `UPLOAD_ORIGINAL_ROOT` **before** loading `.env.local`, but those values are derived from environment variables at import time. | If `.env.local` overrides `IMAGE_SIZES`, `UPLOAD_ROOT`, or `UPLOAD_ORIGINAL_ROOT`, the script still seeds files using the pre-env defaults. That can place variants in the wrong directories or create derivative sets that do not match the configured app/runtime paths, causing flaky or completely broken E2E runs. | Load dotenv before any env-dependent imports/derivations, or move the env-dependent constants behind an explicit post-config initialization function so the script always uses the same path and size contract as the app. |
| Medium | High | `apps/web/src/components/photo-viewer.tsx:79-105` | The component captures `document.title` once on mount, then restores that snapshot in cleanup. That makes route transitions vulnerable to stale-title restoration. | On client-side navigation away from a photo page, the cleanup can briefly overwrite the tab title with the previous page's title before the next route's metadata/title effect runs. Users can see title flicker or get stuck with an outdated title if the next page fails to update immediately. | Remove the mount-time title restoration, or replace it with an explicit previous-title stack that is updated per navigation instead of restored on unmount. The safer default is to let the route/page metadata own the title and avoid cleanup writes entirely. |
| Low | Medium | `apps/web/src/components/photo-viewer.tsx:61,106,145-171,312-320` | `timerShowInfo` is read in `showInfo`, but the current file only ever clears it; nothing sets it to `true`. The state path is effectively dead. | The code suggests a timed info-panel reveal/sync path, but in practice `showInfo` collapses to `isPinned` only. Future maintainers may wire other behavior against a state branch that can never activate, creating misleading behavior and avoidable maintenance overhead. | Either delete the dead state and simplify `showInfo` to `isPinned`, or restore the missing code path that actually turns the timer-driven state on. |

## Notes
- I did not re-report earlier cycle issues that are already fixed in the current head (for example, the stricter origin guard, post-transaction password-rate-limit clearing, and corrected public search rate-limit handling).
- No additional high-confidence correctness defects stood out in the remaining reviewed surface beyond the items above.
