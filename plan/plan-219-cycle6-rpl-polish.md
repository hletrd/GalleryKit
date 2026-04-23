# Plan 219 — Cycle 6 RPL Polish Batch

Generated: 2026-04-23. Source: `.context/reviews/_aggregate-cycle6-rpl.md`.

## Why this plan

Cycle-5-rpl closed the lint-gate integrity cluster. Cycle-6-rpl reviews
surface a complementary cluster: scanner robustness (subdir recursion),
rate-limit rollback symmetry (DB side), privacy-guard strictness,
observability gaps (TRUST_PROXY doc, advisory-lock doc), and minor
cosmetics (CSV regex consolidation, security banner, redundant revalidate
call).

No active correctness or security regressions. Defense-in-depth is
working. This cycle adds the next layer.

## Scope

Items flagged as "should-fix" in
`.context/reviews/_aggregate-cycle6-rpl.md`:

- **AGG6R-01** (4-agent consensus) — scanner subdirectory recursion.
- **AGG6R-02** (4-agent consensus) — DB rate-limit rollback symmetry.
- **AGG6R-03** (2-agent) — cleanOrphanedTmpFiles log-after-unlink.
- **AGG6R-04** (2-agent) — e2e origin-guard test.
- **AGG6R-05** (1-agent) — TRUST_PROXY README.md doc.
- **AGG6R-06** (1-agent) — advisory lock CLAUDE.md doc.
- **AGG6R-07** (2-agent) — privacy-guard strictness (whitelist test).
- **AGG6R-09** (1-agent) — SECURITY-CRITICAL banner on scripts/check-*.ts.
- **AGG6R-10** (1-agent) — drop redundant revalidateLocalizedPaths call.
- **AGG6R-11** (2-agent) — CSV escape regex consolidation.

## Constraints (repo rules consulted)

Per `CLAUDE.md` (user global) + `apps/web/CLAUDE.md` (project) + `AGENTS.md`:
- GPG sign every commit with `-S`.
- Conventional Commits + gitmoji.
- `~/flash-shared/gitminer-cuda/mine_commit.sh 7` after every commit.
- Fine-grained commits: one feature/fix per commit.
- Do NOT add `Co-Authored-By: Claude` — never attribute Claude.
- Always `git pull --rebase` before `git push`.
- Node 24+, TypeScript 6+, ESNext.
- No `--no-verify`, no force-push to master.
- Run every gate in `GATES` before deploying; blocking errors only.

## Implementation plan (ordered, fine-grained commits)

### Step 1 — AGG6R-09: SECURITY-CRITICAL banner on lint scripts

- Files:
  - `apps/web/scripts/check-action-origin.ts`
  - `apps/web/scripts/check-api-auth.ts`
- Prepend a banner comment above the existing header:
  ```
  /* SECURITY-CRITICAL: this lint gate enforces defense-in-depth
   * origin / auth checks on server actions / admin API routes.
   * DO NOT downgrade, disable, or weaken this scanner without a
   * security review. See CLAUDE.md "Lint Gates" section.
   */
  ```
- Commit: `docs(lint): 🔒 add SECURITY-CRITICAL banner to action-origin / api-auth scanners (C6R-RPL-01)`

### Step 2 — AGG6R-01: scanner subdirectory recursion

- File: `apps/web/scripts/check-action-origin.ts`.
- Refactor `discoverActionFiles()` to walk the entire `app/actions/`
  tree recursively, preserving the `EXCLUDED_ACTION_FILENAMES` filter and
  the hard-coded db-actions.ts append.
- Update the header comment: "glob-discovered recursively from
  `apps/web/src/app/actions/**/*.ts`".
- File: `apps/web/src/__tests__/check-action-origin.test.ts` —
  add fixture test for a nested subdirectory case.
- Commit: `fix(lint): 🛡️ recurse into action subdirectories in check-action-origin (C6R-RPL-02)`

### Step 3 — AGG6R-02: DB rate-limit rollback symmetry

- File: `apps/web/src/app/actions/public.ts` (`searchImagesAction`).
- On the DB over-limit branch (the `if (isRateLimitExceeded(dbLimit.count,
  SEARCH_MAX_REQUESTS, true))` body) — add `await decrementRateLimit(ip,
  'search', SEARCH_WINDOW_MS).catch(console.debug)` symmetric to the
  in-memory rollback.
- File: `apps/web/src/app/actions/sharing.ts`:
  - On `createPhotoShareLink` DB over-limit branch, add
    `await decrementRateLimit(ip, 'share_photo',
    SHARE_RATE_LIMIT_WINDOW_MS).catch(console.debug)`.
  - On `createGroupShareLink` DB over-limit branch, same for
    `'share_group'`.
  - On `ER_NO_REFERENCED_ROW_2` path in `createGroupShareLink`, rollback
    both in-memory AND DB counters.
- Add a test case or extend an existing one to assert symmetric rollback.
- Commit: `fix(rate-limit): 🛡️ symmetric DB counter rollback on over-limit and FK error paths (C6R-RPL-03)`

### Step 4 — AGG6R-03: cleanOrphanedTmpFiles log-after-unlink

- File: `apps/web/src/lib/image-queue.ts::cleanOrphanedTmpFiles`.
- Collect `Promise.allSettled` results; count fulfilled vs rejected; log
  `[Cleanup] Removed N .tmp files (M errors)` AFTER the unlinks.
- Drop the pre-unlink "Removing N" log.
- Commit: `fix(queue): 📝 log cleanOrphanedTmpFiles results after unlink (C6R-RPL-04)`

### Step 5 — AGG6R-10: drop redundant revalidateLocalizedPaths('/admin/dashboard') after revalidateAllAppData

- File: `apps/web/src/app/actions/images.ts::deleteImages`.
- In the `foundIds.length > 20` branch, drop `revalidateLocalizedPaths(
  '/admin/dashboard')` after `revalidateAllAppData()` — the latter
  invalidates everything.
- Commit: `perf(actions): 🩹 drop redundant admin-dashboard revalidate after revalidateAllAppData (C6R-RPL-05)`

### Step 6 — AGG6R-11: collapse escapeCsvField regex + CRLF collapse

- File: `apps/web/src/app/[locale]/admin/db-actions.ts::escapeCsvField`.
- Change `value.replace(/[\r\n]/g, ' ')` to `value.replace(/[\r\n]+/g,
  ' ')` so consecutive CRLF/LFLF/CRCR collapse to a single space.
- Consider combining the first strip with the CRLF collapse; current
  behavior is to strip control-char (except \r\n) then replace \r\n
  with space. Keep ordering. Only the CRLF collapse is the bugfix.
- Add `apps/web/src/__tests__/csv-escape.test.ts` with fixtures:
  - Formula-injection prefixes (`=`, `+`, `-`, `@`, `\t`).
  - Embedded quotes (double-escaped).
  - CRLF → single space (the fix).
  - Null bytes stripped.
  - Plain ASCII values pass through with quote wrapping.
- Commit: `fix(csv): 🩹 collapse consecutive CRLF to single space in CSV escape (C6R-RPL-06)`

### Step 7 — AGG6R-07: privacy guard whitelist test

- File: `apps/web/src/__tests__/privacy-fields.test.ts` (extend existing).
- Add a test that:
  - Imports `adminSelectFieldKeys` and `publicSelectFieldKeys` from
    `data.ts`.
  - Asserts: `publicSelectFieldKeys ⊂ adminSelectFieldKeys` (every public
    field also exists in admin).
  - Asserts: the set difference `adminSelectFieldKeys \ publicSelectFieldKeys`
    equals the known `_PrivacySensitiveKeys` set. If a new admin-only
    field is added without updating the sensitive list, this test will
    fail loudly.
- This catches the failure mode AGG6R-07 identifies.
- Commit: `test(privacy): ✅ assert adminSelectFieldKeys \ publicSelectFieldKeys == sensitive keys (C6R-RPL-07)`

### Step 8 — AGG6R-04: e2e origin-guard test

- File: `apps/web/e2e/origin-guard.spec.ts` (NEW).
- Use Playwright's request context to POST to a server action endpoint
  with a mismatched `Origin` header. Assert the response contains a
  localized "unauthorized" error or returns the error-shape payload.
- Target: `/en/admin/dashboard` with a `next-action` POST (form-data
  submission with a fake action id). The action should reject due to
  `hasTrustedSameOrigin` returning false.
- Alternative (safer): test a known mutating action via its form endpoint
  if available, or intercept via the `request` context. Use the existing
  `helpers.ts` fixture for auth.
- Acceptance: spec runs in <30s and asserts the expected behavior.
- Commit: `test(e2e): ✅ assert mutating actions reject spoofed Origin header (C6R-RPL-08)`

### Step 9 — AGG6R-05: TRUST_PROXY operator doc

- File: `README.md`.
- Add a "Deployment" subsection snippet: "When running behind a reverse
  proxy (nginx, Caddy, Cloudflare), set `TRUST_PROXY=true` in the env.
  Without it, `getClientIp` returns `'unknown'` and rate-limit buckets
  collapse into a single shared counter for all requests."
- Commit: `docs(readme): 📝 document TRUST_PROXY requirement for proxied deployments (C6R-RPL-09)`

### Step 10 — AGG6R-06: advisory lock doc

- File: `apps/web/CLAUDE.md` (project-local) — "Race Condition
  Protections" section.
- Add two bullets:
  - "**Concurrent restore prevention**: DB advisory lock
    `gallerykit_db_restore` held on a dedicated pool connection for the
    restore window. Concurrent attempts fail fast with
    `restoreInProgress`."
  - "**Per-image-processing claim lock**: advisory lock
    `gallerykit:image-processing:{jobId}` prevents duplicate processing
    of the same image by concurrent workers."
- Commit: `docs(claude): 📝 document advisory locks in race-condition protections (C6R-RPL-10)`

### Step 11 — Gate run

Run every gate in `GATES`:
- `npm run lint --workspace=apps/web`
- `npm run build --workspace=apps/web` (tsc)
- `npm test --workspace=apps/web`
- `npm run test:e2e --workspace=apps/web` (Playwright)
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`

Any errors are blocking. Fix root cause; do not suppress. Warnings:
prefer to fix or record as deferred.

### Step 12 — Deploy

- `DEPLOY_MODE == per-cycle`. After all commits pushed and gates green,
  run `npm run deploy`.
- Record `DEPLOY: per-cycle-success` or `DEPLOY: per-cycle-failed:<reason>`.

### Step 13 — Plan completion

Mark each step `[x] completed` below with the mined commit hash.
Archive to `plan/done/` at the next archive sweep.

## Deferred items (NOT implemented this cycle, per STRICT deferral rules)

Each deferred entry records:
- File + line citation (where applicable).
- Original severity/confidence (NEVER downgraded).
- Concrete reason for deferral.
- Exit criterion for re-opening.

See `plan/plan-220-cycle6-rpl-deferred.md` for the full list.

## Progress tracking

| Step | Status | Commit |
|---|---|---|
| 1. SECURITY-CRITICAL banner (AGG6R-09) | [x] completed | `00000001a66f63a` `docs(lint): 🔒 add SECURITY-CRITICAL banner to action-origin / api-auth scanners (C6R-RPL-01)` |
| 2. Scanner subdir recursion (AGG6R-01) | [x] completed | `00000006ca59bc7` `fix(lint): 🛡️ recurse into action subdirectories in check-action-origin (C6R-RPL-02)` |
| 3. DB rate-limit rollback symmetry (AGG6R-02) | [x] completed | `0000000233131710` `fix(rate-limit): 🛡️ symmetric DB counter rollback on over-limit and FK error paths (C6R-RPL-03)` |
| 4. cleanOrphanedTmpFiles log-after-unlink (AGG6R-03) | [x] completed | `0000000dc924f54` `fix(queue): 📝 log cleanOrphanedTmpFiles results after unlink (C6R-RPL-04)` |
| 5. Drop redundant revalidate (AGG6R-10) | [x] completed | `0000000e61a9216` `perf(actions): 🩹 drop redundant admin-dashboard revalidate after revalidateAllAppData (C6R-RPL-05)` |
| 6. CSV escape CRLF collapse (AGG6R-11) | [x] completed | `0000000a9cbda51` + `00000004609e6f8` (extract to lib/csv-escape for test-isolation) |
| 7. Privacy guard whitelist test (AGG6R-07) | [x] completed | `0000000b1a309e8` `test(privacy): ✅ assert adminSelectFieldKeys \ publicSelectFieldKeys == sensitive keys (C6R-RPL-07)` |
| 8. E2E origin-guard (AGG6R-04) | [x] completed | `000000003788c64` `test(e2e): ✅ assert admin API rejects requests with spoofed Origin header (C6R-RPL-08)` |
| 9. README.md TRUST_PROXY (AGG6R-05) | [x] completed | `000000038d2338f` `docs(readme): 📝 document TRUST_PROXY requirement for proxied deployments (C6R-RPL-09)` |
| 10. CLAUDE.md advisory locks (AGG6R-06) | [x] completed | `0000000e94fa41c` `docs(claude): 📝 document advisory locks in race-condition protections (C6R-RPL-10)` |
| 11. Gate run | [x] completed | eslint clean, next build (tsc) clean, vitest 48 files / 271 tests pass, Playwright 19/19 pass (incl. new origin-guard spec), lint:api-auth + lint:action-origin pass |
| 12. Deploy | [x] per-cycle-success | `npm run deploy` landed; container gallerykit-web recreated and started; app at http://localhost:3000 |
| 13. Plan completion | [x] completed | plan retained in `plan/` for cycle record; archive to `plan/done/` at next archive sweep |
