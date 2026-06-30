# Cycle 43 Security + Documentation Review

Date: 2026-07-01
Reviewed HEAD: `82a21b82a12e8da26c71a12c1d3a8a567bf0b7fa`
Lane: security-reviewer + document-specialist
Scope: whole repo, with emphasis on auth/authz, public routes, upload/serve paths, SSRF/path traversal, rate limits, data leakage, secrets, operational docs drift, and deploy/docs mismatches.
Deferred filter: I did not re-raise `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, or `AGG-C38-08`; I found no new evidence that changes their severity.

## Findings

### DOC-C43-01 - Cycle 42 closure state is still marked active/incomplete

Severity: Medium
Confidence: High

Evidence:
- `.context/plans/README.md:5-8` still lists Cycle 42 under "Active Current-Cycle Plans" and marks the implementation plan active.
- `.context/plans/cycle-42-2026-07-01-plan.md:45` requires signed commit, pull-rebase, push, and `npm run deploy`.
- `.context/plans/cycle-42-2026-07-01-plan.md:47-53` marks artifact/write/test/gate work done but leaves "Commit, push, deploy" unchecked.
- `AGENTS.md:17` requires `npm run deploy` after every commit pushed to `master`.
- Review command evidence: `git status --short --branch` returned `## master...origin/master`, and `git log -1 --oneline` returned `82a21b82 fix(cycle-42): 🐛 harden review-cycle guardrails`, proving Cycle 42 source closure reached `origin/master`. I found no committed deploy evidence for that same terminal step.

Problem:
The committed plan context disagrees with repository state and does not clearly say whether the required production deploy happened.

Concrete failure scenario:
A later review or implementation lane treats Cycle 42 as still active and repeats already-landed fixes, or assumes production was deployed because source is pushed while the committed cycle artifact still leaves deploy unchecked. This repo has no staging environment, so source-vs-production ambiguity is operational drift.

Suggested fix:
Update `.context/plans/README.md` and `.context/plans/cycle-42-2026-07-01-plan.md` to record the actual terminal state. If deploy was completed, add the deploy evidence; if not, mark deploy pending explicitly while keeping commit/push closed.

## No New Security Findings

I found no new auth/authz, upload/serve, SSRF/path-traversal, public rate-limit, secret, or public-data leakage finding beyond already deferred or historical items.

Key source evidence:
- Admin API routes are forced through `withAdminAuth(...)`, including token scope checks and no-store/nosniff response defaults: `apps/web/src/lib/api-auth.ts:72-104`, `apps/web/src/lib/api-auth.ts:114-140`.
- Same-origin admin action checks fail closed on missing/untrusted provenance: `apps/web/src/lib/request-origin.ts:79-107`, `apps/web/src/lib/action-guards.ts:37-44`.
- Session signing requires production `SESSION_SECRET` and validates HMAC/session hashes before returning admin state: `apps/web/src/lib/session.ts:26-35`, `apps/web/src/lib/session.ts:82-150`.
- Original uploads stay private and reject unsafe filenames/symlink traversal: `apps/web/src/lib/upload-paths.ts:49-56`, `apps/web/src/lib/upload-paths.ts:120-170`.
- Public derivative serving is limited to `jpeg/webp/avif`, rejects traversal/ext mismatches, realpath-checks containment, rejects symlinks, and streams from descriptor-stable handles: `apps/web/src/lib/serve-upload.ts:14`, `apps/web/src/lib/serve-upload.ts:132-190`.
- Public semantic/similar and OG routes charge limiters before expensive work and use canonical/internal origins rather than request-controlled fetch targets: `apps/web/src/app/api/search/semantic/route.ts:107-184`, `apps/web/src/app/api/search/similar/[id]/route.ts:72-104`, `apps/web/src/app/api/og/photo/[id]/route.tsx:45-129`.
- Public select shapes omit admin-only fields with compile-time and test guards: `apps/web/src/lib/data.ts:368-489`, `apps/web/src/lib/search-enrichment-fields.ts:29-47`, `apps/web/src/__tests__/privacy-fields.test.ts:7-131`.
- Tracked-secret hygiene is covered by source scan test: `apps/web/src/__tests__/tracked-secrets.test.ts:7-58`.

## Validation

Passed:
- `npm run lint --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- `npm audit --omit=dev --workspace=apps/web` (`found 0 vulnerabilities`)
- Focused Vitest set: 21 files / 332 tests passed.
- Literal tracked-secret `rg` scan for credential assignments returned no matches.

Not run:
- `npm run build --workspace=apps/web`
- `npm run test:e2e --workspace=apps/web`
- `npm run deploy` (explicitly out of scope for this review)
