# Aggregate Review — review-plan-fix cycle 1 (2026-04-24)

## Review agents

Artifacts reviewed:
- `.context/reviews/code-reviewer-cycle1-rpf.md`
- `.context/reviews/security-reviewer-cycle1-rpf.md`
- `.context/reviews/critic-cycle1-rpf.md`
- `.context/reviews/verifier-cycle1-rpf.md`
- `.context/reviews/test-engineer-cycle1-rpf.md`
- `.context/reviews/architect-cycle1-rpf.md`
- `.context/reviews/debugger-cycle1-rpf.md`
- `.context/reviews/document-specialist-cycle1-rpf.md`
- `.context/reviews/designer-cycle1-rpf.md`
- `.context/reviews/perf-reviewer-cycle1-rpf.md`

## AGENT FAILURES

- `architect` reported a read-only session and returned its review content instead of writing it directly. The orchestrator saved the returned artifact at `.context/reviews/architect-cycle1-rpf.md`; no findings were dropped.

## Dedupe summary

New deduped findings: **42**. Cross-agent agreement is noted where present.

| ID | Severity / confidence | Cross-agent signal | Disposition |
|---|---:|---|---|
| AGG1-01 | HIGH / High | security, code, test, debugger | Schedule: validate DB-sourced filenames before queue filesystem access and add regression coverage |
| AGG1-02 | MEDIUM / High | code, critic | Schedule: make verification failure enter retry path |
| AGG1-03 | MEDIUM / High | code, critic | Schedule: fix `privacy-fields.test.ts` type error and add typecheck scripts/gates |
| AGG1-04 | LOW / Medium | code | Schedule: block `DO` in restore SQL scanner |
| AGG1-05 | LOW / Medium | code, test | Schedule: reject empty/dot storage keys and cover storage traversal |
| AGG1-06 | MEDIUM / High | critic, tests | Schedule: roll back DB-backed `user_create` bucket on over-limit |
| AGG1-07 | MEDIUM / High | verifier | Schedule: roll back search counters when `searchImages()` throws |
| AGG1-08 | MEDIUM / High | debugger | Schedule: reject upload tags whose generated slug is invalid/empty |
| AGG1-09 | MEDIUM / High | debugger | Schedule: delete all historical variants on image deletion |
| AGG1-10 | LOW-MEDIUM / Medium | debugger, perf | Schedule: stop blind retry-cache fragmentation and make fallback behavior truthful |
| AGG1-11 | HIGH / Medium | verifier | Schedule: extend auth/API scanners to reject/resolve aliased exports |
| AGG1-12 | HIGH / High | test | Schedule: strengthen nav visual E2E with semantic invariants |
| AGG1-13 | MEDIUM / High | verifier, test | Schedule: make H3 E2E assertion meaningful |
| AGG1-14 | HIGH / High | test | Schedule: make origin guard E2E reject 404/missing-route success |
| AGG1-15 | MEDIUM / High | test | Schedule: clean up admin upload E2E mutations |
| AGG1-16 | HIGH / High | test | Schedule: add root scripts and CI gate workflow |
| AGG1-17 | HIGH / High | test | Schedule focused auth behavioral tests for critical branches |
| AGG1-18 | HIGH / High | test | Schedule focused settings-action tests |
| AGG1-19 | HIGH / High | test | Schedule focused sharing-action tests |
| AGG1-20 | MEDIUM / High | test | Schedule focused admin-user behavior tests |
| AGG1-21 | MEDIUM / High | designer | Schedule: allow info-sheet content scroll and add close button |
| AGG1-22 | MEDIUM / High | designer | Schedule: label admin taxonomy/tag dialog fields |
| AGG1-23 | LOW / Medium | designer | Schedule or defer: add manual load-more fallback |
| AGG1-24 | MEDIUM / High | docs | Schedule: fix `CLAUDE.md` auth coverage wording |
| AGG1-25 | MEDIUM / High | docs, perf | Schedule: fix documented queue concurrency default |
| AGG1-26 | LOW / High | docs | Schedule: fix FIFO-vs-LRU rate-limit wording |
| AGG1-27 | LOW / Medium | docs | Schedule: document TRUST_PROXY same-origin impact |
| AGG1-28 | MEDIUM / High | perf | Schedule: add standalone audit-log `created_at` index |
| AGG1-29 | MEDIUM / High | perf | Defer: global upload-sized server-action body limit needs route architecture |
| AGG1-30 | MEDIUM / Medium | perf, architect | Defer: queue startup replay/fan-out backpressure needs performance design |
| AGG1-31 | MEDIUM / High | perf | Defer: public nav/search bundle split needs bundle-analysis pass |
| AGG1-32 | MEDIUM / Medium | perf | Defer: photo viewer split needs route-level bundle redesign |
| AGG1-33 | LOW / Medium | perf | Defer: image retry query cache fragmentation if retries remain observable |
| AGG1-34 | HIGH / High | security | Operationally close/defer: historical git secret cannot be fixed without destructive history rewrite |
| AGG1-35 | LOW / High | security | Defer: CSP `unsafe-inline` hardening requires nonce/hash strategy |
| AGG1-36 | LOW / Medium | security | Schedule: apply same-origin check to `logout()` or document why exempt |
| AGG1-37 | HIGH / High | architect, critic | Defer: durable multi-process restore maintenance state requires schema/infra design |
| AGG1-38 | MEDIUM / High | architect, critic | Defer: durable shared-group view counts require product decision |
| AGG1-39 | HIGH / High | architect | Defer: split migration/init from container startup requires deploy-lifecycle change |
| AGG1-40 | MEDIUM / High | architect | Defer: storage abstraction boundary is larger refactor |
| AGG1-41 | MEDIUM / Medium | architect | Defer: config ownership split needs product config-domain decision |
| AGG1-42 | MEDIUM / High | architect, perf | Defer: service extraction/list query redesign are broader architecture/performance plans |

## Merged findings with citations and fix notes

### AGG1-01 — Restored DB filenames can drive unsafe queue filesystem paths
- **Original severity/confidence:** HIGH / High.
- **Citations:** `apps/web/src/lib/image-queue.ts:212-258`, `apps/web/src/lib/upload-paths.ts:48-64`, `apps/web/src/app/actions/images.ts:374-382,473-482`.
- **Failure scenario:** a malicious restored row can set `filename_original`/derivative filenames to traversal strings; the background queue then resolves/join paths before the admin delete-path validation can intervene.
- **Fix:** validate all DB-sourced filenames at queue entry before resolving originals or joining derivative paths; add tests.

### AGG1-02 — Queue verification failure bypasses retry handling
- **Original severity/confidence:** MEDIUM / High.
- **Citations:** `apps/web/src/lib/image-queue.ts:246-259,282-294`.
- **Failure scenario:** a missing/zero-byte derivative returns early, leaves row unprocessed, and does not trigger the existing retry loop.
- **Fix:** throw on verification failure so existing retry logic runs.

### AGG1-03 — TypeScript typecheck is red and not first-class
- **Original severity/confidence:** MEDIUM / High.
- **Citations:** `apps/web/src/__tests__/privacy-fields.test.ts:54-56`, `package.json`, `apps/web/package.json`.
- **Failure scenario:** `tsc -p apps/web/tsconfig.json --noEmit` fails while lint/test/build pass.
- **Fix:** widen the comparison set and add `typecheck` scripts.

### AGG1-04 — SQL restore scanner permits `DO ...`
- **Original severity/confidence:** LOW / Medium.
- **Citations:** `apps/web/src/lib/sql-restore-scan.ts:1-48`, `apps/web/src/__tests__/sql-restore-scan.test.ts:22-69`.
- **Failure scenario:** crafted restore dump can run `DO SLEEP(...)` and hang restore/maintenance.
- **Fix:** block `DO` statements and test string-literal false positives.

### AGG1-05 — Local storage backend accepts empty/dot keys
- **Original severity/confidence:** LOW / Medium.
- **Citations:** `apps/web/src/lib/storage/local.ts:25-31`.
- **Failure scenario:** malformed keys resolve to the upload root and fail later with inconsistent directory errors.
- **Fix:** reject empty, dot, slash-only, and traversal keys before path resolution; add tests.

### AGG1-06 — `createAdminUser` over-limit path leaks DB rate-limit budget
- **Original severity/confidence:** MEDIUM / High.
- **Citations:** `apps/web/src/app/actions/admin-users.ts:114-129`.
- **Failure scenario:** over-limit attempts inflate the DB bucket even though in-memory state is rolled back.
- **Fix:** decrement/reset the DB bucket symmetrically on the over-limit branch; add behavior coverage.

### AGG1-07 — `searchImagesAction()` leaks rate-limit budget on search failure
- **Original severity/confidence:** MEDIUM / High.
- **Citations:** `apps/web/src/app/actions/public.ts:64-98`.
- **Failure scenario:** transient DB error in `searchImages()` rejects after counters increment.
- **Fix:** wrap the final search call and roll back both counters on errors.

### AGG1-08 — Upload tag ingestion can persist empty slugs
- **Original severity/confidence:** MEDIUM / High.
- **Citations:** `apps/web/src/app/actions/images.ts:109-116,261-290`, `apps/web/src/lib/tag-records.ts:5-12`, `apps/web/src/lib/validation.ts:32-39`.
- **Failure scenario:** punctuation-only tags such as `!!!` produce `slug = ''` and orphan/collide.
- **Fix:** validate generated slugs before insert and fail invalid upload tags.

### AGG1-09 — Delete cleanup misses historical image-size variants
- **Original severity/confidence:** MEDIUM / High.
- **Citations:** `apps/web/src/app/actions/images.ts:406-419,518-533`, `apps/web/src/lib/process-image.ts:170-205`.
- **Failure scenario:** changing image sizes leaves old derivatives after delete.
- **Fix:** force prefix-scan cleanup (`sizes=[]`) for delete paths so all variants are removed.

### AGG1-10 — Optimistic image retry/fallback behavior is misleading and costly
- **Original severity/confidence:** LOW-MEDIUM / Medium.
- **Citations:** `apps/web/src/components/optimistic-image.tsx:9-42`, `apps/web/next.config.ts:107-116`.
- **Failure scenario:** permanent 404s retry for ~15s and fragment image optimizer cache via `?retry=N`; `fallbackSrc` is unused.
- **Fix:** use a fallback source when available and cap blind retries lower or stop retrying local URLs.

### AGG1-11 — Auth/API gate scanners skip aliased exports
- **Original severity/confidence:** HIGH / Medium.
- **Citations:** `apps/web/scripts/check-action-origin.ts:148-223`, `apps/web/scripts/check-api-auth.ts:86-135`.
- **Failure scenario:** `const POST = withAdminAuth(...); export { POST }` can evade scanner coverage.
- **Fix:** reject aliased exports or resolve them in scanners; add tests.

### AGG1-12..AGG1-16 — E2E/CI gates are weak or absent
- **Original severity/confidence:** HIGH/MEDIUM mixed.
- **Citations:** `apps/web/e2e/nav-visual-check.spec.ts:4-33`, `apps/web/e2e/public.spec.ts:85-99`, `apps/web/e2e/origin-guard.spec.ts:27-60`, `apps/web/e2e/admin.spec.ts:61-76`, `package.json`, `.github/`.
- **Fix:** add semantic assertions, exact origin statuses, upload cleanup, root scripts, and CI workflow.

### AGG1-17..AGG1-20 — Behavioral test coverage gaps
- **Original severity/confidence:** HIGH/MEDIUM / High.
- **Citations:** `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/admin-users.ts`.
- **Fix:** add targeted tests for the most critical rollback/auth/error branches as part of the code fixes; broader coverage can remain a carry-forward plan.

### AGG1-21..AGG1-23 — UI/UX issues
- **Original severity/confidence:** MEDIUM/LOW mixed.
- **Citations:** `apps/web/src/components/info-bottom-sheet.tsx:54-64,141-157,190-217`, admin category/tag/image dialog files, `apps/web/src/components/load-more.tsx:20-94`.
- **Fix:** allow sheet content scrolling + close button; add persistent labels; add load-more fallback in a UI polish pass.

### AGG1-24..AGG1-27 — Documentation mismatches
- **Original severity/confidence:** MEDIUM/LOW mixed.
- **Citations:** `CLAUDE.md`, `README.md`, `apps/web/README.md`, `apps/web/src/lib/request-origin.ts`.
- **Fix:** update wording for public actions, queue concurrency default, FIFO eviction, and TRUST_PROXY origin effects.

### AGG1-28..AGG1-42 — Performance/architecture/operations follow-ups
- **Original severity/confidence:** HIGH/MEDIUM/LOW mixed.
- **Citations:** `apps/web/src/lib/audit.ts:46-57`, `apps/web/src/db/schema.ts:113-125`, `apps/web/next.config.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/Dockerfile`, `apps/web/scripts/migrate.js`, `apps/web/src/lib/storage/*`, public layout/viewer files.
- **Fix:** implement narrow audit index now if schema-safe; carry forward broad lifecycle/bundle/durability refactors with preserved severity and exit criteria.
