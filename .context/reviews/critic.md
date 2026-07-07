# Cycle 13 Critic Review

Date: 2026-07-07 KST
Reviewer: critic
Repository: `/Users/hletrd/flash-shared/gallery`
Mode: whole-repository, source-free critical review. I did not modify source code or plans; this review artifact is the only intended write.

## Inventory And Method

Primary contracts read first:

- `AGENTS.md` from the active workspace prompt.
- `CLAUDE.md` project knowledge base.
- Current aggregate baseline: `.context/reviews/_aggregate.md`.
- Recent archive baselines: `.context/reviews/archive/_aggregate-c12.md`, `_aggregate-c13.md`, `_aggregate-cycle12.md`, `_aggregate-cycle13.md`, and `_aggregate-cycle47-rpf-end-only.md`.

Review-relevant inventory:

- 681 source/config/script/test files across `apps/web/src/app`, `apps/web/src/lib`, `apps/web/src/components`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, and `apps/web/src/__tests__`.
- Project and operations files: root `package.json`, `apps/web/package.json`, `.nvmrc`, `.github/workflows/*.yml`, `README.md`, `apps/web/README.md`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`, `scripts/check-proxy-topology.mjs`, and service-worker source/generated output.
- Excluded as non-review source: build/runtime output, dependency directories, binary/static fixture payloads, and generated artifacts whose source was separately checked.

I examined the repository through direct reads of high-risk files plus repo-wide sweeps for common issue classes: admin/auth/origin/rate-limit coverage, raw SQL, unsafe HTML/JSON-LD sinks, service-worker caching, migration journal drift, restore/upload failure paths, public route cost, background queue concurrency, destructive filesystem operations, TODO/FIXME markers, source-string tests, and workflow/deploy mismatches.

## Fresh Validation Evidence

- `git status --short --branch`: clean `master...origin/master` before this artifact write.
- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- `npm audit --workspace=apps/web --omit=dev --audit-level=moderate`: passed, `found 0 vulnerabilities`.
- Service worker generation check: `apps/web/public/sw.js` matches `apps/web/public/sw.template.js` after normalizing only the generated `SW_VERSION`.
- Migration inventory check: 30 journal entries and 30 SQL files; newest committed entries remain monotonic above the historical cursor. The historical non-monotonic journal segment remains the known schema-drift class guarded by `apps/web/scripts/migrate.js`.

Full `lint`, `typecheck`, `build`, `vitest`, and Playwright suites were not rerun in this critic pass; this review relied on the targeted gates above plus static/manual inspection.

## Findings

No new actionable findings were confirmed beyond the current Cycle 12 aggregate backlog.

I intentionally did not duplicate obvious archived findings that are still visible but not newly differentiated. The latest aggregate already records those with concrete citations and failure scenarios in `.context/reviews/_aggregate.md:36-393`. Reissuing them here would add noise rather than new review value.

## Prior-Cycle Items Not Reissued

Still actionable but already current in the aggregate baseline:

- Dependency/tooling, proxy topology, date-query, map, listing aggregation, semantic scan, batch delete, smart collection, background pool, temp cleanup, byte-generation, single-writer, reconcile, browser coverage, source-string test, admin UI, restore, Lightroom upload, coverage, shared-group side effect, storage quarantine, navigation/discoverability, and admin UX risks are already enumerated in `.context/reviews/_aggregate.md:36-364`.
- The strongest cross-agent carry-forward set is summarized in `.context/reviews/_aggregate.md:366-380`.
- The final aggregate risk summary remains accurate at `.context/reviews/_aggregate.md:393-395`.

Examples of visible but non-duplicated current evidence:

- Non-sargable date helpers are still present in `apps/web/src/lib/data-timeline.ts:111-155`, already tracked as `AGG-C12-05`.
- The public map still caps and hydrates up to 10,000 markers via `apps/web/src/lib/data.ts:1741-1791`, already tracked as `AGG-C12-06`.
- Public listing tag aggregation still happens before page limiting in `apps/web/src/lib/data.ts:786-828` and `apps/web/src/lib/data.ts:893-940`, already tracked as `AGG-C12-07`.
- Startup orphan-temp cleanup still uses broad `Promise.all` fan-out in `apps/web/src/lib/image-queue.ts:40-96`, already tracked as `AGG-C12-12`.
- Single-writer contention remains warn-only in `apps/web/src/lib/single-writer-guard.ts:6-16` and `apps/web/src/lib/single-writer-guard.ts:218-235`, already tracked as `AGG-C12-15`.
- Legacy reconcile remains hand-written DDL beginning at `apps/web/scripts/migrate.js:348`, already tracked as `AGG-C12-16`.
- Bottom-sheet dropdown protection still includes source-string tests in `apps/web/src/__tests__/bottom-sheet-dropdown-portal.test.ts:14-26`, already tracked as `AGG-C12-19`.

Prior issues that appear fixed or materially improved in this checkout:

- The production dependency audit is now clean despite the earlier aggregate finding at `.context/reviews/_aggregate.md:36-44`; root overrides are present in `package.json:7-15`, Next remains at `apps/web/package.json:59`, and the targeted audit passed.
- The Docker mutable-tag issue at `.context/reviews/_aggregate.md:66-74` is fixed by digest-pinned Node base images in `apps/web/Dockerfile:1` and `apps/web/Dockerfile:16`.
- The CLIP production preflight gap at `.context/reviews/_aggregate.md:196-204` is materially improved by `.github/workflows/clip-preflight.yml:1-46`, which seeds cached CLIP weights and runs `npm run test:clip:preflight` on schedule/manual dispatch.
- Required CI now includes a production dependency audit at `.github/workflows/quality.yml:66-67`.

## Final Missed-Issue Sweep

Final sweeps did not reveal a new admin auth bypass, same-origin mutating action bypass, public mutating route without a rate-limit gate, sensitive public field projection drift, generated service-worker drift, migration journal omission, focused `.only` test, obvious JSON-LD escaping regression, or a newly introduced dependency audit failure.

Residual risk remains concentrated in the already archived classes: live production cardinality, live host nginx/proxy state, real CLIP model/runtime behavior, mobile/non-Chromium browser behavior, source-string test oracles, and operator-only deployment invariants.
