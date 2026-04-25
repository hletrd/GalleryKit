# Plan 239 — Cycle 7 RPF implementation fixes
Status: complete

## Source reviews
- Aggregate: `.context/reviews/_aggregate.md`
- Per-agent provenance: `.context/reviews/*cycle7-rpf.md`
- User-injected TODO: `plan/user-injected/pending-next-cycle.md` (`remove ./.vscode`)

## Repo rules read before planning
- `CLAUDE.md` — Node 24+, Next.js 16 app router, local-only storage support, single web-instance topology, security lint gates, no supported S3/MinIO switching, trusted proxy/header requirements, commit/push with gitmoji from `AGENTS.md`.
- `AGENTS.md` — always commit/push changes and use gitmoji.
- `.context/**` / existing `plan/**` — prior deferrals for distributed coordination, storage abstraction, historical secrets, broad coverage expansion, CSP, CSV streaming, persistent processing state, and visual/test expansion were noted. Fully implemented active plans 221/235/236 were archived under `plan/done/`.
- `.cursorrules` and `CONTRIBUTING.md` are absent.

## Disposition map

| Finding | Severity / confidence | Disposition |
|---|---:|---|
| AGG-C7RPF-01 | HIGH / HIGH | Scheduled P239-01 |
| AGG-C7RPF-02 | MEDIUM / HIGH | Scheduled P239-02 |
| AGG-C7RPF-03 | MEDIUM / HIGH | Scheduled P239-02 |
| AGG-C7RPF-04 | LOW / HIGH | Scheduled P239-04 |
| AGG-C7RPF-05 | LOW / HIGH | Scheduled P239-04 |
| AGG-C7RPF-06 | MEDIUM / HIGH | Scheduled P239-04 |
| AGG-C7RPF-07 | LOW / MEDIUM | Scheduled P239-03 |
| AGG-C7RPF-08 | MEDIUM / MEDIUM | Scheduled P239-05 |
| AGG-C7RPF-09 | MEDIUM / HIGH | Scheduled P239-05 |
| AGG-C7RPF-10 | MEDIUM / HIGH | Upstream-blocked; deferred in `plan/plan-240-cycle7-rpf-deferred.md` |
| AGG-C7RPF-11 | HIGH / HIGH | Deferred in `plan/plan-240-cycle7-rpf-deferred.md` |
| AGG-C7RPF-12 | HIGH / HIGH | Deferred in `plan/plan-240-cycle7-rpf-deferred.md` |
| AGG-C7RPF-13 | HIGH / HIGH | Deferred in `plan/plan-240-cycle7-rpf-deferred.md` |
| AGG-C7RPF-14 | HIGH / HIGH | Deferred in `plan/plan-240-cycle7-rpf-deferred.md` |
| AGG-C7RPF-15 | MEDIUM / MEDIUM | Scheduled P239-07 |
| AGG-C7RPF-16 | MEDIUM / HIGH | Deferred in `plan/plan-240-cycle7-rpf-deferred.md` |
| AGG-C7RPF-17 | HIGH / HIGH | Deferred in `plan/plan-240-cycle7-rpf-deferred.md` |
| AGG-C7RPF-18 | MEDIUM / HIGH | Deferred in `plan/plan-240-cycle7-rpf-deferred.md` |
| AGG-C7RPF-19 | MEDIUM / HIGH | Scheduled P239-08 |
| AGG-C7RPF-20 | LOW / HIGH | Scheduled P239-04 |
| AGG-C7RPF-21 | MEDIUM / HIGH | Deferred / operationally closed in `plan/plan-240-cycle7-rpf-deferred.md` |
| AGG-C7RPF-22 | MEDIUM / HIGH | Scheduled P239-03 |
| USER-C7RPF-01 | user TODO | Scheduled P239-09 |

## Implementation tasks

### P239-01 — Tighten action-origin scanner to require effective guard use
- **Findings:** AGG-C7RPF-01.
- **Files:** `apps/web/scripts/check-action-origin.ts`, `apps/web/src/__tests__/check-action-origin.test.ts`, `CLAUDE.md` if wording needs sync.
- **Plan:** Require a top-level variable initialized from `await requireSameOriginAdmin()` and a subsequent top-level `if (originError) return ...` (or equivalent variable name) before accepting a mutating action. Keep explicit exemption support. Add failing fixtures for ignored result and direct expression-only calls.
- **Acceptance:** scanner rejects ignored guard return fixtures and all existing actions still pass `npm run lint:action-origin --workspace=apps/web`.
- **Status:** done.

### P239-02 — Return explicit public-action transient states and keep UI retryable
- **Findings:** AGG-C7RPF-02, AGG-C7RPF-03.
- **Files:** `apps/web/src/app/actions/public.ts`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/__tests__/public-actions.test.ts`, messages.
- **Plan:** Change load-more/search actions to return discriminated results for `ok`, `rateLimited`, `maintenance`, and validation states. Only terminal successful pagination may set `hasMore=false`; transient states keep retry affordances alive and show localized messages. Search should render no-results only for successful empty results.
- **Acceptance:** unit tests prove restore/rate-limit paths are explicit and do not look like terminal/no-result states.
- **Status:** done.

### P239-03 — Pin rate-limit bucket rollbacks and reduce load-more DB hot-path cost
- **Findings:** AGG-C7RPF-07, AGG-C7RPF-22.
- **Files:** `apps/web/src/lib/rate-limit.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/__tests__/rate-limit.test.ts`, `apps/web/src/__tests__/public-actions.test.ts`.
- **Plan:** Add bucket-start-aware persistent rate-limit helpers so increment/check/rollback share the same window. Collapse load-more persistent check into a single increment-and-count operation instead of increment plus a second select, while preserving in-memory fallback and rollback on downstream errors.
- **Acceptance:** tests cover fixed bucket-start rollback and load-more over-limit behavior without a separate `checkRateLimit` call.
- **Status:** done.

### P239-04 — Align stale UI/docs/i18n contracts with current behavior
- **Findings:** AGG-C7RPF-04, AGG-C7RPF-05, AGG-C7RPF-06, AGG-C7RPF-20.
- **Files:** `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/app/actions/images.ts` if return type cleanup is needed, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/src/app/actions/seo.ts`, `CLAUDE.md`, tests.
- **Plan:** Remove the dead duplicate-replacement UI/copy or rename it to non-replacement behavior; restrict SEO locale validation to supported OG locales to match copy; update CLAUDE scanner docs; remove dead settings message keys for controls that are no longer rendered/supported.
- **Acceptance:** tests and typecheck pass; message catalogs no longer advertise unsupported settings/storage controls.
- **Status:** done.

### P239-05 — Align trusted-proxy and remote E2E DB transport security
- **Findings:** AGG-C7RPF-08, AGG-C7RPF-09.
- **Files:** `apps/web/e2e/helpers.ts`, `apps/web/nginx/default.conf`, `README.md`, tests if available.
- **Plan:** Reuse existing MySQL TLS option helper (or identical policy) for remote admin E2E helper connections. Set `X-Forwarded-Host` in all nginx proxy locations and document that trusted proxies must overwrite it.
- **Acceptance:** lint/typecheck pass; targeted tests cover import/shape if practical.
- **Status:** done.

### P239-06 — Investigate nested PostCSS audit finding and record upstream blocker
- **Findings:** AGG-C7RPF-10.
- **Files:** `package.json`, `package-lock.json`, `plan/plan-240-cycle7-rpf-deferred.md`.
- **Plan:** Check npm metadata/audit for a compatible Next/PostCSS resolution. If no compatible release exists, do not force a breaking downgrade; preserve severity in deferred record with exit criterion.
- **Acceptance:** `npm audit --omit=dev`, `npm view next@latest dependencies.postcss`, and `npm view next@canary dependencies.postcss` evidence is recorded.
- **Status:** done — latest `next@16.2.4` and `next@16.3.0-canary.2` still depend on `postcss@8.4.31`; `npm audit fix --force` suggests downgrading Next to `9.3.3`, which violates the repo's Next 16 app-router baseline. Deferred as D-C7RPF-09.

### P239-07 — Make Playwright server reuse explicit opt-in
- **Findings:** AGG-C7RPF-15.
- **Files:** `apps/web/playwright.config.ts`, docs if needed.
- **Plan:** Change `reuseExistingServer` to read `E2E_REUSE_SERVER === 'true'` so default e2e runs initialize/seed/build the current checkout.
- **Acceptance:** e2e config typecheck passes and local reuse remains available by env opt-in.
- **Status:** done.

### P239-08 — Make shared-group view counts explicitly approximate
- **Findings:** AGG-C7RPF-19.
- **Files:** `CLAUDE.md`, relevant admin/shared copy if the count is displayed.
- **Plan:** Document that shared-group view counts are best-effort approximate analytics unless/until moved to durable storage. If a UI label displays the count, clarify it there too.
- **Acceptance:** docs/UI no longer imply durable authoritative counts.
- **Status:** done.

### P239-09 — Remove committed VS Code workspace files
- **Findings:** USER-C7RPF-01 from `plan/user-injected/pending-next-cycle.md`.
- **Files:** `.vscode/**`, `plan/user-injected/pending-next-cycle.md`.
- **Plan:** Delete the tracked `.vscode` directory and mark the queued TODO completed.
- **Acceptance:** `git ls-files .vscode` is empty and pending-next-cycle no longer contains the active TODO.
- **Status:** done.

## Gates
Run the full cycle gates after implementation:
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test`
- `npm run test:e2e`

Also run security lint/audit checks relevant to touched findings:
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm audit --omit=dev`

## Progress / verification
- Prompt 2: plan created.
- Prompt 3: implementation completed; full gate results recorded in cycle report / git history.
