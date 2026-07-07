# Cycle 11/100 Implementation Plan

Date: 2026-07-07
Source review: `.context/reviews/_aggregate.md`
Status: implemented; full gates pending

## Repo Rules Read Before Planning

- `CLAUDE.md`
- `AGENTS.md`
- `.context/plans/README.md`
- `.context/**` plan/review inventory relevant to current cycle
- `docs/**` policy/style scan: no additional style/policy override found
- `.cursorrules` and `CONTRIBUTING.md`: not present

## Coverage Accounting

All 47 aggregate findings are covered:

- Scheduled here: 17 findings
- Already fixed before this plan and scheduled for verification here: 4 findings
- Deferred in `plan/plan-381-cycle11-deferred.md`: 26 findings

## Work Packages

### WP1 - Advisory-lock and restore-fence correctness

Findings: `AGG-C11-01`, `AGG-C11-31`

Tasks:

- Fix `apps/web/src/app/actions/topics.ts` so `withTopicRouteMutationLock()` does not silently return a connection to the pool after `RELEASE_LOCK` failure. Log loudly and destroy the connection on failed unlock; release only on clean unlock or when no lock was acquired.
- Add/extend `apps/web/src/__tests__/topics-actions.test.ts` to assert a rejected `RELEASE_LOCK` destroys rather than cleanly releases the connection.
- Fix `apps/web/src/app/actions/auth.ts` so `logout()` participates in the restore maintenance fence before session verification/delete: same-origin first, then maintenance check / mutation slot, then session work. If blocked by restore, delete only the cookie and redirect without DB mutation.
- Add/extend `apps/web/src/__tests__/auth-mutation-barrier-source.test.ts` or a behavior test proving `logout` acquires the mutation slot before `verifySessionToken()` and skips DB delete when blocked.

Acceptance:

- Targeted topic/auth tests pass.
- `npm run lint:action-origin --workspace=apps/web` remains green.

### WP2 - Sanitize public image-base URL exposure

Finding: `AGG-C11-13`

Tasks:

- Create a shared image-base URL validation/sanitization helper, reusing the CSP rules: absolute http(s), HTTPS in production, no credentials, no query, no hash.
- Wire `apps/web/src/app/[locale]/layout.tsx` and `apps/web/src/lib/image-url.ts` to use only sanitized values.
- Keep CSP behavior aligned with the same helper.
- Update `apps/web/src/__tests__/image-url.test.ts` and CSP tests so credential/query/hash values are not stamped into `data-image-base` and not concatenated into image URLs.

Acceptance:

- Targeted image URL/CSP tests pass.
- Production build does not expose credential-bearing `IMAGE_BASE_URL` in rendered HTML.

### WP3 - DB TLS tooling parity

Finding: `AGG-C11-03`

Tasks:

- Mirror runtime/script `DB_SSL_CA` handling in `apps/web/drizzle.config.ts`, or import a shared JS-safe helper if practical.
- Fail closed for non-local DBs without `DB_SSL_CA` unless `DB_SSL=false`.
- Add a focused script/config test if the existing JS-script checker can cover it cheaply.

Acceptance:

- `npm run typecheck:scripts --workspace=apps/web` passes.
- Drizzle Kit config no longer has weaker TLS semantics than runtime/scripts.

### WP4 - Verify already-landed cycle-11 fixes

Findings: `AGG-C11-22`, `AGG-C11-23`, `AGG-C11-24`, `AGG-C11-26`

Observed current evidence before implementation:

- `drainBackgroundDbWritesForRestore(timeoutMs = 15_000)` already exists in `apps/web/src/lib/background-db-writes.ts`.
- `CONFIG_HASH_VALUE_MAPPERS` is typed as `Record<(typeof COLOR_IMPACTING_KEYS)[number], ...>` in `apps/web/src/lib/settings-hash.ts`.
- Current `CLAUDE.md` documents feed/sitemap `updated_at` indexes after commit `a1e158d1`.
- Current `apps/web/src/__tests__/lr-upload-route-behavior.test.ts` includes additional LR failure branches after commit `4b1d4862`.

Tasks:

- Run targeted tests for background DB drain, settings hash, docs/source contracts, and LR upload route behavior.
- If any regression appears, fix it in-place; otherwise mark these as verified in this plan progress.

Acceptance:

- Targeted tests pass and plan progress records the verification.

### WP5 - Search and photo-viewer accessibility/product polish

Findings: `AGG-C11-43`, `AGG-C11-45`

Tasks:

- Make search result option labels unique for duplicate/near-duplicate photo results by including a stable differentiator in visible/accessibility text, preferably id or localized ordinal.
- Add/adjust tests for duplicate search result accessible names.
- Add `aria-keyshortcuts="ArrowLeft"` and `aria-keyshortcuts="ArrowRight"` to normal photo navigation controls.
- Add a source or component test for the shortcut metadata.

Acceptance:

- Targeted search/photo navigation tests pass.
- Existing touch/focus/i18n tests remain green.

### WP6 - Smart-collection delete guidance honesty

Finding: `AGG-C11-42`

Tasks:

- Change server/user-facing copy in English and Korean so category-delete blocks caused by smart collections explicitly say the Collections editor is not available in admin UI yet and the operator must update/remove matching `smart_collections.query_json` rows.
- If feasible, include collection ids/names in the returned error; otherwise at least make the current remediation path honest and operator-level.
- Update tests that assert the server-action message key or copy.

Acceptance:

- i18n key parity remains green.
- Topic deletion tests remain green.

### WP7 - Small docs/source truth corrections

Findings: `AGG-C11-34`, `AGG-C11-35`, `AGG-C11-36`

Tasks:

- Update or explicitly mark ignored `.omc/wiki` migration and CLIP pages as non-authoritative so they no longer contradict tracked migration/CLIP docs.
- Close/reword `.context/plans/deferred-carry-forward.md` for the now-documented `site-config.json` build-time contract; keep any runtime-editability question as a product decision, not a documentation ambiguity.

Acceptance:

- Documentation diff contains no new product claims beyond current source truth.
- `git diff --check` passes for edited docs.

## Progress

- [x] Prompt 1 aggregate written.
- [x] Prompt 2 plan written.
- [x] WP1 implemented and tested. `topics-actions.test.ts` and `auth-mutation-barrier-source.test.ts` passed in the focused cycle-11 suite.
- [x] WP2 implemented and tested. `image-url.test.ts` passed in the focused cycle-11 suite.
- [x] WP3 implemented and tested. `drizzle-tls-source.test.ts cycle-11-ui-copy-source-contracts.test.ts` now pins Drizzle TLS CA parity.
- [x] WP4 verified. `failed-image-retry.test.ts`, `image-queue-permanent-failure.test.ts`, `lr-upload-route-behavior.test.ts`, `settings-hash.test.ts`, and `background-db-writes.test.ts` passed in the focused cycle-11 suite.
- [x] WP5 implemented and tested. `search-disclaimer.test.ts` and `drizzle-tls-source.test.ts cycle-11-ui-copy-source-contracts.test.ts` passed in the focused cycle-11 suite.
- [x] WP6 implemented and tested. Smart-collection delete guidance is covered by `drizzle-tls-source.test.ts cycle-11-ui-copy-source-contracts.test.ts`.
- [x] WP7 implemented and checked. Tracked docs now mark ignored `.omc/wiki` cache notes as non-authoritative and reword the carry-forward `site-config.json` row as a product/runtime-editability decision.
- [x] Full configured gates run. Final gate evidence:
  - `git diff --check`: passed.
  - `npm run lint --workspace=apps/web`: passed.
  - `npm run lint:api-auth --workspace=apps/web`: passed.
  - `npm run lint:action-origin --workspace=apps/web`: passed.
  - `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
  - `npm run typecheck --workspace=apps/web`: passed.
  - `BASE_URL=https://gallery.atik.kr npm run build --workspace=apps/web`: passed. Build logged the existing sitemap fallback because no local MySQL was listening on `127.0.0.1:3306`; static generation completed successfully.
  - `npm test --workspace=apps/web`: passed 345 files / 3185 tests, with 2 skipped files / 4 skipped tests.
  - `npm run test:e2e --workspace=apps/web`: not required for this cycle because no browser-flow behavior was changed beyond source/unit-covered labels and shortcut metadata; skipped to avoid starting more local DB/browser infrastructure under the cycle-11 MySQL container constraint.
- [ ] Commit/push complete.
- [ ] Per-cycle deploy complete.

Focused verification: `npm test --workspace=apps/web -- topics-actions.test.ts auth-mutation-barrier-source.test.ts image-url.test.ts search-disclaimer.test.ts drizzle-tls-source.test.ts cycle-11-ui-copy-source-contracts.test.ts failed-image-retry.test.ts image-queue-permanent-failure.test.ts lr-upload-route-behavior.test.ts settings-hash.test.ts background-db-writes.test.ts` passed 10 files / 99 tests.
