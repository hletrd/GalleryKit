# Plan 237 — Cycle 6 RPF fixes

Status: implemented — archived 2026-04-25
Created: 2026-04-25
Source aggregate: `.context/reviews/_aggregate.md`

## Repo rules read before planning
- `CLAUDE.md`: Next.js 16/React/TypeScript app; local filesystem storage only; single web-instance/single-writer topology; admin accounts are multiple root admins; historical env values must be treated as compromised; Node.js 24+ and TypeScript 6+ required.
- `AGENTS.md`: always commit and push all changes; use gitmoji; no new dependencies without explicit request; keep diffs small, reviewable, and reversible; run lint/typecheck/build/tests/static analysis after changes.
- `.context/**` and `plan/**`: prior cycles defer broad architecture/test/performance redesigns with preserved severity and exit criteria while scheduling narrow current-head correctness/security/UX fixes.
- `.cursorrules`: missing.
- `CONTRIBUTING.md`: missing.
- `docs/` style/policy files: none present.

## Implementation tasks

### C6RPF-01 — Rotate session on password change
- **Findings:** AGG-C6-01 (`apps/web/src/app/actions/auth.ts:363-381`) High/High.
- **Plan:** Delete all existing sessions for the user inside the password-change transaction, then mint a new session token/cookie after commit so the current browser remains signed in while stolen prior cookies are invalidated.
- **Acceptance:** Unit/source tests prove password change deletes all sessions and creates/sets a fresh current session; auth tests pass.
- **Status:** Done 2026-04-25 — password changes now delete all sessions, insert a fresh session, and set a new cookie inside the existing success path.

### C6RPF-02 — Move local secrets out of the repo and support external e2e env loading
- **Findings:** AGG-C6-02 (`apps/web/.env.local:4-10`, `.env.deploy:2-5`) High/High.
- **Plan:** Move ignored live env files to `$HOME/.gallerykit-secrets/`; update Playwright/local scripts to default to the external e2e env path when repo-local `.env.local` is absent while preserving explicit `E2E_ENV_FILE` override.
- **Acceptance:** `npm run test:e2e` still works using the external env file; repo checkout no longer contains the live ignored env files.
- **Status:** Done 2026-04-25 — live ignored env files were moved to `$HOME/.gallerykit-secrets/`; Playwright now sources that external file when repo-local `.env.local` is absent.

### C6RPF-03 — Ensure upload dirs before disk-space stat
- **Findings:** AGG-C6-05 (`apps/web/src/app/actions/images.ts:148-157`) Medium/High.
- **Plan:** Ensure the upload directory tree exists before `statfs(UPLOAD_DIR_ORIGINAL)` or stat a guaranteed existing upload root.
- **Acceptance:** Regression test covers a missing upload directory and the action no longer returns `insufficientDiskSpace` solely for `ENOENT`.
- **Status:** Done 2026-04-25 — upload directories are created before `statfs`, with regression coverage for mkdir ordering and statfs failure.

### C6RPF-04 — Fail closed for too-short trusted proxy chains
- **Findings:** AGG-C6-06 (`apps/web/src/lib/rate-limit.ts:69-89`) Medium/High.
- **Plan:** When `TRUST_PROXY=true` and `X-Forwarded-For` has fewer valid IPs than `TRUSTED_PROXY_HOPS`, do not trust the left-most value; fall back to `x-real-ip` only if usable or return `unknown`.
- **Acceptance:** Rate-limit tests cover too-short chains and spoofed left-most values.
- **Status:** Done 2026-04-25 — too-short trusted proxy chains no longer trust spoofable left-most XFF values; tests cover `unknown` and `x-real-ip` fallback.

### C6RPF-05 — Report stale topic-alias deletes accurately
- **Findings:** AGG-C6-07 (`apps/web/src/app/actions/topics.ts:454-474`) Low/High.
- **Plan:** Check `affectedRows` from alias delete and return a localized not-found/no-op error when nothing was deleted.
- **Acceptance:** Topics tests cover stale alias deletion.
- **Status:** Done 2026-04-25 — stale alias deletes return a localized not-found error and are covered by topics tests.

### C6RPF-06 — Rate-limit anonymous load-more and align docs
- **Findings:** AGG-C6-15 (`apps/web/src/app/actions/public.ts:23-40`, `CLAUDE.md:127-130`) Medium/High.
- **Plan:** Add a search-style per-IP in-memory + DB-backed throttle for `loadMoreImages()` and update `CLAUDE.md` to accurately describe public action throttling/caching behavior.
- **Acceptance:** Public action tests cover over-limit rollback/empty response; docs match behavior.
- **Status:** Done 2026-04-25 — anonymous load-more now uses a per-IP throttle and docs describe current public throttling/cache behavior.

### C6RPF-07 — Make `seo_locale` effective
- **Findings:** AGG-C6-16 (SEO actions/client/data and metadata generation) Medium/High.
- **Plan:** Validate/normalize configured OG locale and use it in all metadata generation paths as an override; keep route-locale derived fallback when unset.
- **Acceptance:** Unit tests prove configured `seo_locale` changes Open Graph locale and default fallback still uses route locale.
- **Status:** Done 2026-04-25 — configured `seo_locale` is validated, normalized, and consumed by all public Open Graph metadata paths.

### C6RPF-08 — Tighten production CSP style sources
- **Findings:** AGG-C6-18 (`apps/web/src/lib/content-security-policy.ts:58-69`) Low/High.
- **Plan:** Remove unused `https://cdn.jsdelivr.net` from production `style-src` and extend CSP tests.
- **Acceptance:** CSP tests assert production style sources do not include jsdelivr.
- **Status:** Done 2026-04-25 — production CSP no longer allows jsdelivr styles and CSP tests pin the narrower source list.

### C6RPF-09 — Harden action-origin scanner against dead/nested guard bypasses
- **Findings:** AGG-C6-19 (`apps/web/scripts/check-action-origin.ts:99-103,112-128,158-181`) High/High.
- **Plan:** Accept only effective top-level `requireSameOriginAdmin()` guard statements in exported action bodies; require explicit exemptions for getters or nontrivial read-only exports; add regression tests for nested-helper, dead-branch, and mutating `get*` bypasses.
- **Acceptance:** New scanner tests fail on bypass shapes and existing action-origin gate passes.
- **Status:** Done 2026-04-25 — origin scanner now requires effective top-level guards or explicit exemptions, with bypass regression tests and gate verification.

### C6RPF-10 — Make admin e2e skips visible in CI
- **Findings:** AGG-C6-11 / VER6-02 (`apps/web/e2e/admin.spec.ts:6-7`, `apps/web/e2e/helpers.ts:28-74`) High/High.
- **Plan:** Keep local admin e2e optional when credentials are absent, but fail/loudly assert in CI when admin e2e credentials are missing so the gate cannot silently pass without admin coverage.
- **Acceptance:** Helper/spec test or Playwright test makes CI skip impossible without explicit non-CI local behavior.
- **Status:** Done 2026-04-25 — CI now fails if admin e2e credentials are absent while local opt-in behavior remains available.

### C6RPF-11 — Make mobile photo info sheet modal while open
- **Findings:** AGG-C6-25 (`apps/web/src/components/info-bottom-sheet.tsx:155-170`) High/High.
- **Plan:** Activate focus trapping and modal semantics for the entire open sheet lifetime, not just expanded state.
- **Acceptance:** Existing/focused component tests prove focus stays trapped while sheet is open.
- **Status:** Done 2026-04-25 — the photo info sheet activates focus trapping and modal semantics for the full open lifetime.

### C6RPF-12 — Label admin action columns
- **Findings:** AGG-C6-26 (`apps/web/messages/en.json:150-151`, `apps/web/messages/ko.json:150-151`) Medium/High.
- **Plan:** Provide localized non-empty action-column labels.
- **Acceptance:** Message parity and UI tests remain green; tables expose a non-empty action header.
- **Status:** Done 2026-04-25 — admin action-column labels are non-empty in English and Korean messages.

### C6RPF-13 — Remove hard-coded English password metadata
- **Findings:** AGG-C6-27 (`apps/web/src/app/[locale]/admin/(protected)/password/page.tsx:3-5`) Low/High.
- **Plan:** Generate localized metadata from route locale/translations or remove the hard-coded title.
- **Acceptance:** Metadata is localized for Korean route.
- **Status:** Done 2026-04-25 — password page metadata is generated from localized nav translations.

### C6RPF-14 — Refresh after partial-success uploads
- **Findings:** AGG-C6-29 (`apps/web/src/components/upload-dropzone.tsx:270-294`) Medium/High.
- **Plan:** Call `router.refresh()` when an upload batch has at least one success, including partial success.
- **Acceptance:** Upload-dropzone test covers partial-success refresh.
- **Status:** Done 2026-04-25 — partial-success uploads refresh the dashboard when any upload succeeded.

### C6RPF-15 — Reconnect infinite-scroll observer after query/sentinel changes
- **Findings:** AGG-C6-30 (`apps/web/src/components/load-more.tsx:60-83`) Medium/Medium.
- **Plan:** Replace the one-time ref/effect with callback-ref observer management or equivalent dependencies so observer disconnects/reconnects when sentinel/query state changes.
- **Acceptance:** Test covers reset/reattach behavior.
- **Status:** Done 2026-04-25 — load-more observer management now reconnects through a callback ref when the sentinel changes.

### C6RPF-16 — Update stale caching docs
- **Findings:** AGG-C6-17 (`CLAUDE.md:198-202`) Low-Medium/High.
- **Plan:** Document the current `revalidate = 0` contract for public pages and why freshness is preferred over ISR staleness.
- **Acceptance:** Docs match current route behavior.
- **Status:** Done 2026-04-25 — stale ISR-style caching notes were replaced with the current `revalidate = 0` freshness contract.

## Required gates
Run after implementation against the whole repo:
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test`
- `npm run test:e2e`

Deployment: `DEPLOY_MODE=none`, so no deploy this cycle.


## Implementation verification

Completed 2026-04-25. Evidence:
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test`
- `npm run test:e2e`
- `npm run lint:action-origin`
- `npm run lint:api-auth`

Deployment: `DEPLOY_MODE=none`, so no deploy was run this cycle.
