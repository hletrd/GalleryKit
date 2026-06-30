# Cycle 25 Code Review

Reviewer: cycle-25 code-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `4cb1258ba0b2cca689846a85423264edc2d96b90`
Date: 2026-06-30

## Scope And Method

I read the current repo `AGENTS.md` and `CLAUDE.md` first, then rebuilt the review context from the current tree instead of carrying forward earlier cycle assumptions. The user instruction for this cycle was to review only, write this report, and not commit or push.

Tracked file inventory from `git ls-files`:

| Area | Count |
| --- | ---: |
| Source outside tests | 239 |
| Unit-test area files | 274 |
| E2E files | 8 |
| Scripts | 27 |
| Drizzle migrations/meta | 31 |
| Locale messages | 2 |
| Public assets | 9 |
| Other app files | 26 |
| Context/review history | 1771 |
| Plans | 180 |
| Docs | 2 |
| Root/config/other | 16 |
| Total tracked files | 2585 |

Focused inspection covered the current application, data, auth, migration, script, and test surfaces that carry the highest logic and maintainability risk:

- Root/project docs and package manifests: `AGENTS.md`, `CLAUDE.md`, `package.json`, `apps/web/package.json`.
- Auth/session/security boundaries: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/proxy.ts`, admin API routes, action-origin lint coverage.
- Data and schema path: `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, `apps/web/scripts/migrate.js`, committed Drizzle SQL/meta.
- Public mutation and rate-limit surfaces: `apps/web/src/app/actions/public.ts`, public API routes, auth actions, sharing actions.
- Admin mutation surfaces: image, collection, topic, tag, settings, SEO, LR-token, embedding, backfill, and DB action files.
- Upload and generated-file paths: `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/upload-paths.ts`, LR upload API, download API.
- Search and semantic search paths: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/components/search.tsx`, `apps/web/src/lib/smart-collections.ts`.
- Sitemap/feed/robots paths and related tests.
- Broad sweeps for unsafe SQL, filesystem deletion, auth bypass patterns, lint suppressions, TODO/FIXME markers, direct env usage, raw response construction, and suspicious script behavior.

## Findings

No confirmed code quality, logic, security, or maintainability findings were found in the reviewed current tree.

Several issues from older review artifacts were explicitly rechecked and not carried forward because the current source no longer supports them as confirmed defects. For example, semantic search now filters against processed images during candidate collection, migration/schema snippets that appeared duplicated in truncated terminal output were valid in the actual files, and sitemap DB unavailability during local build is covered by fallback behavior and tests.

## Likely Risks

No likely risks were strong enough to promote to findings without inventing failure assumptions beyond the inspected code and available validation.

## Manual-Validation Risks

These are not confirmed defects. They are environment-dependent areas that cannot be fully proven from the local review alone.

| Area | Severity | Confidence | Region | Risk | Suggested validation |
| --- | --- | --- | --- | --- | --- |
| Production DB-backed deploy behavior | Medium | Medium | `apps/web/scripts/migrate.js`, `apps/web/deploy.sh`, DB action scripts | Local validation did not connect to the production-style MySQL instance, so restore/import/backfill behavior was reviewed statically and through existing tests rather than exercised against live production-like data. | Run the normal deploy/migration path in the intended environment and confirm migration journal hashes, schema reconciliation, and backup/restore smoke checks. |
| Semantic ranking quality | Low | Medium | `apps/web/src/app/api/search/semantic/route.ts`, CLIP embedding data | The query path is tested and statically reviewed, but relevance thresholds and ranking quality depend on the production embedding corpus. | Validate representative Korean/English photographer queries against production or a recent production clone. |
| Single-writer/runtime assumptions | Medium | Medium | `apps/web/src/lib/*.ts`, background/backfill/admin mutation paths | The docs describe a single-instance runtime posture. The code has local transaction and uniqueness protections in important areas, but a true multi-writer topology would still need environment-level validation. | Confirm production runs one writer instance or add concurrency/load tests before changing deployment topology. |

## Validation Evidence

Commands run from repo root:

- `npm run lint --workspace=apps/web` - passed.
- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `npm run typecheck --workspace=apps/web` - passed.
- `npm test --workspace=apps/web` - passed: 267 passed, 2 skipped test files; 2498 passed, 4 skipped tests.
- `npm run build --workspace=apps/web` - passed. Build emitted the expected local sitemap DB fallback warning because no local MySQL was available on `127.0.0.1:3306`; the fallback path is covered by existing sitemap/robots tests and did not fail the build.

One invalid validation attempt was discarded: `npm test --workspace=apps/web -- --runInBand` failed because Vitest does not support Jest's `--runInBand` flag. The correct Vitest command above was run afterward and passed.

## Final Sweep

Final sweeps included:

- `git status --short` / `git diff --stat` to identify dirty worktree state.
- Broad `rg` scans over source, scripts, migrations, tests, and config for auth, mutation, filesystem, SQL, env, lint-disable, TODO/FIXME, and unsafe-pattern indicators.
- Line-numbered inspection of any suspicious snippets before deciding whether they were real. Tool-output truncation caused a few false positives; each was checked against the actual file before being discarded.

Skipped or low-depth areas:

- Historical `.context/` review and plan files were inventoried but not deeply rereviewed as source of truth, except to avoid carrying stale findings into this cycle.
- Generated/build/dependency outputs such as `node_modules`, `.next`, and cache directories were excluded from review.
- Binary/static public assets were inventoried but not visually audited because this was a code quality, logic, and maintainability review.
- Playwright E2E tests were not run because the inspected changes were review-only and the standard lint/type/unit/build gates already passed. No browser-flow defect was identified that required E2E confirmation.

## Worktree Note

The worktree already contained an unrelated modification to `.context/reviews/verifier.md` before this report was written. I did not inspect it as a finding source, did not modify it, and did not revert it.
