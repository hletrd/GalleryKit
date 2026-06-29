# Plan 367 — Cycle 4/100 Fixes

**Created:** 2026-06-29
**Source:** `.context/reviews/_aggregate.md` plus all cycle-4 per-agent reviews.
**Status:** DONE - archived after green cycle gates

This plan schedules every non-deferred cycle-4 aggregate finding. Deferred findings are recorded in `plan/plan-368-cycle4-deferred.md`.

## TASK-1 [MEDIUM] — Harden public mutating-route rate-limit lint against unreachable helper calls

**Finding:** AGG-C4-01 (`critic` CRIT-C4-01, `test-engineer` TE-C4-01)

**Files:**
- `apps/web/scripts/check-public-route-rate-limit.ts`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`

**Action:**
Add fixtures for helper calls inside dead/conditional branches before mutation. Update the scanner so a rate-limit helper hidden inside an `if`/conditional block does not satisfy the pre-mutation requirement unless the scanner can prove the route is charged before mutation. Fail closed for branch-only helper calls.

**Acceptance:**
- New tests fail on current scanner and pass after fix.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passes.

**Progress:** DONE

## TASK-2 [MEDIUM] — Update Playwright theme-toggle locators for stateful accessible names

**Finding:** AGG-C4-02 (`critic` CRIT-C4-02)

**Files:**
- `apps/web/e2e/test-fixes.spec.ts`
- `apps/web/e2e/nav-visual-check.spec.ts`
- `apps/web/messages/en.json` / `ko.json` if an unused key is removed

**Action:**
Replace exact `"Toggle theme"` locators with the stateful theme-label contract or a stable test selector. Add an assertion that the accessible name changes after toggling.

**Acceptance:**
- Playwright specs no longer depend on removed static copy.
- E2E source remains aligned with `nav-client.tsx`.

**Progress:** DONE

## TASK-3 [MEDIUM] — Persist runtime topic cover resources after deploys

**Finding:** AGG-C4-03 (`tracer` TRC-C4-01)

**Files:**
- `apps/web/docker-compose.yml`
- `apps/web/Dockerfile` / `apps/web/scripts/entrypoint.sh` if directory creation or permissions need adjustment
- `apps/web/deploy.sh`
- `apps/web/src/__tests__/nginx-config.test.ts` or a new compose/deploy contract test
- `AGENTS.md`, `CLAUDE.md`, README docs as needed

**Action:**
Persist `public/resources` alongside `public/uploads` so admin-uploaded topic covers survive container replacement. Update docs/tests to distinguish mutable runtime public subdirectories from immutable built public assets.

**Acceptance:**
- Compose bind-mounts `./public/resources`.
- Deploy docs/comments mention `public/uploads` and `public/resources`.
- Tests reject broad `./public` mount while requiring both mutable subdirectory mounts.

**Progress:** DONE

## TASK-4 [MEDIUM] — Move Lightroom restore-maintenance guard before body parsing

**Finding:** AGG-C4-04 (`architect` ARCH-C4-01, `tracer` TRC-C4-02)

**Files:**
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts` or a focused source-contract test

**Action:**
After cheap authentication/token/IP derivation, check restore maintenance before `request.formData()` and before any topic DB query. Preserve the late cleanup recheck for mid-request restore races.

**Acceptance:**
- Source/test contract proves the first restore check occurs before `request.formData()` and topic lookup.
- Existing LR upload tests pass.

**Progress:** DONE

## TASK-5 [MEDIUM] — Preflight Lightroom upload size/quota before multipart parsing

**Finding:** AGG-C4-05 (`architect` ARCH-C4-02)

**Files:**
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- LR upload tests/source-contract tests

**Action:**
Validate `Content-Length` and unsupported transfer encodings before `request.formData()`. Pre-claim a conservative upload budget before body parsing, then settle from conservative budget to actual file size after parsing so existing quota accounting remains accurate.

**Acceptance:**
- Oversized/missing-size unsafe bodies reject before parsing.
- Tracker pre-claim appears before `request.formData()`.
- Existing settlement rollback behavior remains covered.

**Progress:** DONE

## TASK-6 [LOW] — Update PAT `last_used_at` only after scope acceptance

**Finding:** AGG-C4-06 (`tracer` TRC-C4-03)

**Files:**
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/__tests__/api-auth*.test.ts` or token tests

**Action:**
Split token verification from usage marking. Mark `last_used_at` after the required scope passes, and avoid double-touching successful Lightroom uploads by using the wrapper-provided authenticated token/user where possible.

**Acceptance:**
- Wrong-scope token attempts do not update `last_used_at`.
- Successful token-auth requests still update `last_used_at`.

**Progress:** DONE

## TASK-7 [LOW] — Correct deploy/disk-hygiene persistence docs

**Finding:** AGG-C4-07 (`verifier` V-C4-01, `document-specialist` DOC-C4-01)

**Files:**
- `AGENTS.md`
- `CLAUDE.md`
- `apps/web/deploy.sh`
- README files if needed after TASK-3

**Action:**
Replace stale `./public` persistence wording with exact mutable mount wording: `./data`, `./public/uploads`, `./public/resources`, and `./src/site-config.json`; immutable public assets are served from the image.

**Acceptance:**
- No authoritative docs/comments claim broad `./public` is persisted.

**Progress:** DONE

## TASK-8 [LOW] — Convert CLIP superpowers docs to post-implementation records

**Finding:** AGG-C4-08 (`document-specialist` DOC-C4-02)

**Files:**
- `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`
- `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`

**Action:**
Add explicit post-implementation/historical boundaries, remove "production rejected/stub-only" current-tense claims, align threshold/status with current code, and prevent the old checklist from reading as executable current work.

**Acceptance:**
- Docs do not contradict current `semantic_search_mode=production` gate and threshold `0.22`.

**Progress:** DONE

## TASK-9 [LOW] — Remove duplicate skip link from locale 404 shell

**Finding:** AGG-C4-09 (`designer` DES-C4-01)

**Files:**
- `apps/web/src/app/[locale]/not-found.tsx`
- Existing shell/a11y tests or a focused source test

**Action:**
Remove the local skip link while keeping the root layout skip link and `main#main-content`.

**Acceptance:**
- 404 shell has one `main#main-content` and no duplicate local skip link.

**Progress:** DONE

## TASK-10 [LOW] — Localize Lightroom token date formatting

**Finding:** AGG-C4-10 (`designer` DES-C4-02)

**Files:**
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`
- Tests/source-contract if present

**Action:**
Use the selected app locale when formatting token created/last-used/expiry dates.

**Acceptance:**
- No bare `toLocaleDateString()` remains in the token client for app-visible dates.

**Progress:** DONE

## TASK-11 [LOW] — Add accessible status semantics to token-list loading state

**Finding:** AGG-C4-11 (`designer` DES-C4-03)

**Files:**
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`

**Action:**
Add `role="status"`, `aria-live="polite"`, `aria-hidden` spinner treatment, and localized loading text.

**Acceptance:**
- Screen readers receive a loading state for the token list.

**Progress:** DONE

## TASK-12 [MEDIUM] — Remove HEIF from RAW rejection guidance

**Finding:** AGG-C4-12 (`product-marketer-reviewer` PM-C4-01)

**Files:**
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- Copy/source-contract tests if present

**Action:**
Remove HEIF from RAW recovery copy unless HEIF support is made runtime-gated end-to-end.

**Acceptance:**
- RAW rejection guidance recommends only currently reliable formats.

**Progress:** DONE

## TASK-13 [MEDIUM] — Add deploy script contract tests

**Finding:** AGG-C4-13 (`test-engineer` TE-C4-02)

**Files:**
- New or existing test under `apps/web/src/__tests__/`
- `apps/web/deploy.sh`
- `scripts/deploy-remote.sh`

**Action:**
Add a source-contract test that enforces prune-after-up, required prune commands, no `volume prune -a`, and config-driven deploy helper behavior.

**Acceptance:**
- Test fails for dangerous deploy-order/prune/host-hardcode changes.

**Progress:** DONE

## TASK-14 [MEDIUM] — Add production site-config validator failure-path tests

**Finding:** AGG-C4-14 (`test-engineer` TE-C4-03)

**Files:**
- `apps/web/scripts/ensure-site-config.mjs`
- New test under `apps/web/src/__tests__/`

**Action:**
Add subprocess tests for missing config, missing production URL, placeholder host, invalid/relative URL, and valid `BASE_URL` override.

**Acceptance:**
- Failure paths are tested directly, not only through the CI happy path.

**Progress:** DONE

## TASK-15 [LOW] — Split smart-collection load-more query to avoid discarded total count

**Finding:** AGG-C4-15 (`perf-reviewer` PERF-C4-05)

**Files:**
- `apps/web/src/lib/data.ts`
- `apps/web/src/app/actions/public.ts` if call signature changes
- Focused data/source test

**Action:**
Keep total-count query for initial smart-collection pages, but use a cursor-only select for load-more with `limit + 1` rows to derive `hasMore`.

**Acceptance:**
- Cursor load-more path does not include `COUNT(*) OVER()`.
- Existing smart-collection behavior remains unchanged.

**Progress:** DONE

## Coverage assertion

All active findings from `.context/reviews/_aggregate.md` are scheduled here. Deferred findings are recorded in `plan/plan-368-cycle4-deferred.md`. No active security, correctness, or data-loss finding is deferred.

