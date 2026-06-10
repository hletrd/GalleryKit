# Plan 275 — Run-4 Cycle 2 implementation fixes

**Status:** in-progress (PROMPT 3)
**Source review:** `.context/reviews/run4-cycle2/_aggregate.md` (+ 4 per-angle files)
**Deferred ledger:** `plan/plan-276-run4-cycle2-deferred.md`

## Repo policy honored
- GPG-sign every commit (`-S`); Conventional Commits + gitmoji; no `Co-Authored-By`.
- Fine-grained commits (one work item each); `git pull --rebase` before every push.
- Per-iteration deploy policy: `npm run deploy` after the cycle's work is green.
- No suppressions; root-cause fixes only.

## Tasks

### Task 1 — Fix `failed_at` MySQL-incompatible datetime write (COR-R4C2-01, HIGH/High + TEST-R4C2-09)
- File: `apps/web/src/lib/image-queue.ts:477` — replace
  `failed_at: new Date().toISOString()` (ISO `Z` suffix → ER 1292 under strict mode,
  reproduced live; the catch masks it so `processing_error` is lost too) with a
  MySQL-DATETIME-literal formatter (`'YYYY-MM-DD HH:MM:SS'`, server-local components —
  consistent with mysql2's own `Date` serialization and `parseExifDateTime`'s Date
  branch).
- New tiny helper `apps/web/src/lib/mysql-datetime.ts` (`toMySqlDateTime(date)`), unit
  test `__tests__/mysql-datetime.test.ts` (zero-padding, no `T`/`Z`, format regex).
- Extend `__tests__/image-queue-permanent-failure.test.ts`: assert the written
  `failed_at` matches `/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/` (the missing value-format
  contract that let this survive ~18 cycles).
- Verify: targeted vitest; live INSERT of the produced literal into the e2e MySQL
  container succeeds.

### Task 2 — Remove bogus exemption + harden action-origin scanner (SEC-R4C2-02, MED/High + TEST-R4C2-10)
- File: `apps/web/src/app/actions/lr-tokens.ts:21` — delete the `@action-origin-exempt`
  comment from `createLrToken` (the body already passes the guard pattern; verified).
- File: `apps/web/scripts/check-action-origin.ts` — in `evaluateBody`, when the export
  carries an exempt comment BUT its body contains a direct mutating call
  (`MUTATING_METHOD_NAMES` property call or `MUTATING_FUNCTION_NAMES` identifier call —
  reuse `statementContainsPreGuardMutation`), emit FAILED
  (`EXEMPT COMMENT ON MUTATING ACTION: …`) instead of SKIP. Verified non-breaking: every
  other exemption in the repo is select-only/state-read (see security-reviewer.md).
- Extend `__tests__/check-action-origin.test.ts` fixtures: exempt+mutating → fail;
  exempt+read-only → skip; createLrToken-shaped (guard, no comment) → ok.
- Verify: `npm run lint:action-origin` passes on the real tree; fixtures green.

### Task 3 — Failed-images panel: deterministic icon tile instead of doomed `<img>` (UX-R4C2-03, MED/Medium; clears the eslint warning at root)
- File: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:78-84`
  — replace the `<img src={sizedImageUrl(...)}>` (requests a `_64.jpg` derivative that
  failed images typically never produced; no onError fallback; the repo's only
  `no-img-element` warning) with a lucide `ImageOff` icon tile (same 44 px square,
  `aria-hidden`, photo identified by the adjacent title/user_filename text).
- Verify: eslint 0 warnings; vitest touch-target audit still green.

### Task 4 — Token label: code-point validation, no silent truncation (COR-R4C2-04, LOW-MED/High)
- File: `apps/web/src/app/actions/lr-tokens.ts` — after `sanitizeAdminString`, reject
  labels > 128 code points (`countCodePoints`) with the existing 'Invalid token label'
  error (UI `maxLength={128}` already prevents this in normal flows).
- File: `apps/web/src/lib/admin-tokens.ts:204` — make the residual defense truncation
  code-point-safe: `Array.from(opts.label.trim()).slice(0, 128).join('')`.
- Extend `__tests__/lr-tokens-action.test.ts`: 129-code-point emoji label → error;
  128 → accepted, passed through unsliced.

### Task 5 — Webhook manual-distribution log uses `resolvedEmail` (SEC/COR-R4C2-05, LOW/High)
- File: `apps/web/src/app/api/stripe/webhook/route.ts:377` — `email=${customerEmail}` →
  `email=${resolvedEmail}` so the missing-email case prints the
  `unknown+<sessionId>@stripe.local` reconciliation sentinel instead of an empty field.
- Extend `__tests__/stripe-webhook-source.test.ts` with a source-contract assertion.

### Task 6 — Single source of truth for the 200 MiB per-file cap (ARCH-R4C2-06, LOW/High)
- File: `apps/web/src/lib/process-image.ts:332` — drop local `MAX_FILE_SIZE`; import
  `MAX_UPLOAD_FILE_BYTES` from `@/lib/upload-limits` (env-only module, no layering
  concern). No behavior change today; UI hint and enforcement can no longer drift.
- Verify: vitest (process-image suites), typecheck.

### Task 7 — `recordTopicView` slug-format pre-check (COR-R4C2-07, LOW/Medium)
- File: `apps/web/src/app/actions/public.ts:353-355` — add `isValidSlug(topicSlug)` to
  the entry guard (parity with `loadMoreImages:81`); junk topics fail fast instead of
  costing a doomed FK-rejected INSERT.

### Task 8 — Code-point-safe Stripe title truncation (COR-R4C2-08, LOW/Medium)
- File: `apps/web/src/app/api/checkout/[imageId]/route.ts:140-142` — truncate via
  `Array.from(image.title)` so the 199-cap cannot bisect a surrogate pair; preserve the
  C2-RPF-14 ellipsis semantics.

### Task 9 — Gates + deploy
- Run ALL gates on the whole repo: eslint (expect 0 errors AND 0 warnings after Task 3),
  typecheck, vitest, lint:api-auth, lint:action-origin, lint:public-route-rate-limit,
  production build, playwright e2e. Fix anything that surfaces; no suppressions.
- Then `npm run deploy` (DEPLOY_MODE=per-cycle).

## Progress
- [x] Task 1 — toMySqlDateTime helper + failed_at fix + format contract tests
      (commit 53e6722a; helper-produced literal verified INSERTable on live
      MySQL 8 strict mode)
- [x] Task 2 — exempt comment removed + scanner hardened (exempt-on-mutating-body
      now FAILS; arrow-form exemption detection fixed) + 5 fixtures
      (commit 605e07db)
- [x] Task 3 — ImageOff icon tile; doomed thumbnail fetch removed; eslint
      no-img-element warning gone at root (commit 6dea1f92)
- [x] Task 4 — label code-point validation + safe residual truncation
      (commit 9d582f08)
- [x] Task 5 — resolvedEmail in manual-distribution log + source-contract test
      (commit 6fc59264)
- [x] Task 6 — single 200 MiB constant across upload-limits / process-image /
      process-topic-image (3rd copy found and consolidated too)
      (commit 7a8cfdf5)
- [x] Task 7 — isValidSlug pre-check on recordTopicView (commit 20f4c8cc)
- [x] Task 8 — code-point-safe Stripe title truncation (commit 927d15db)
- [x] Task 9 — ALL GATES GREEN on final tree: eslint 0 errors / 0 warnings
      (the no-img-element warning is gone via Task 3), typecheck (app +
      scripts), vitest 1576/1576 (161 files — includes the new
      mysql-datetime + scanner + label + webhook contracts; one stale
      assertion in failed-image-retry.test.ts pinned the BROKEN ISO-Z form
      and was re-pointed at the fixed write site, commit 7aac57b0),
      lint:api-auth, lint:action-origin, lint:public-route-rate-limit,
      production build (exit 0), playwright e2e 20 passed / 2 skipped
      (admin-spec + CI-only origin-guard skips by design). Deploy follows.

**Status update:** all 9 tasks complete — gates green; deploying per-cycle.
