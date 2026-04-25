# Aggregate Review — Cycle 6

Source reviews: `code-reviewer.md`, `security-reviewer.md`, `critic.md`, `verifier.md`, `test-engineer.md`, `architect.md`, `debugger.md`, `designer.md`.

## Agent coverage
- Ran registered requested review agents: code-reviewer, security-reviewer, critic, verifier, test-engineer, architect, debugger, designer.
- Requested but unavailable in this environment: perf-reviewer, tracer, document-specialist.
- No repo-local custom reviewer agents were found.
- The environment capped concurrent active agents, so the full requested roster ran in waves rather than one physical batch. No registered requested review agent was dropped.

## AGENT FAILURES
- None after retry/second-wave execution. Several read-only review lanes could not write their own file directly, so the orchestrator preserved their returned review content in `.context/reviews/<agent>.md`.

## Merged findings

### AGG-C6-01 — Password change preserves the current session
- **Sources:** security-reviewer `SEC6-01`
- **Severity/confidence:** High / High
- **Citation:** `apps/web/src/app/actions/auth.ts:363-381`
- **Status:** Confirmed security issue.
- **Failure scenario:** A stolen active admin cookie remains valid after password rotation.
- **Fix:** Delete all existing sessions for the user during password change, then create and set a fresh current-session cookie after the transaction commits.

### AGG-C6-02 — Live ignored env secrets are stored inside the repo checkout
- **Sources:** security-reviewer `SEC6-02`
- **Severity/confidence:** High / High
- **Citation:** ignored local files `apps/web/.env.local:4-10`, `.env.deploy:2-5`
- **Status:** Confirmed local hygiene/security issue.
- **Failure scenario:** Workstation backup/support bundle/screen-share/local compromise exposes DB/admin/session/deploy secrets.
- **Fix:** Move local live secret files outside the repo checkout, rotate as appropriate, and ensure local/e2e tooling can load external env files.

### AGG-C6-03 — Historical committed credential material remains in git history
- **Sources:** security-reviewer `SEC6-03`
- **Severity/confidence:** Medium / High
- **Citation:** historical git entries for `apps/web/.env.local.example`
- **Status:** Manual-validation risk.
- **Failure scenario:** Any deployment seeded from historical defaults remains compromised.
- **Fix:** Treat historic values as compromised; rotate reused values; consider history rewrite only through an explicit security process.

### AGG-C6-04 — Audit reports transitive PostCSS XSS advisory with no safe compatible automated fix
- **Sources:** security-reviewer `SEC6-04`
- **Severity/confidence:** Low / Medium
- **Citation:** `package-lock.json` dependency graph (`next` / `next-intl` / nested `postcss`)
- **Status:** Likely supply-chain issue; no reachable app path identified.
- **Failure scenario:** Attacker-controlled CSS reaches vulnerable PostCSS stringify path.
- **Fix:** Upgrade when a Next.js-compatible patched dependency set exists; do not apply the audit-suggested downgrade.

### AGG-C6-05 — First upload on a clean volume can be rejected as insufficient disk space
- **Sources:** code-reviewer `CR6-01`
- **Severity/confidence:** Medium / High
- **Citation:** `apps/web/src/app/actions/images.ts:148-157`
- **Status:** Confirmed.
- **Failure scenario:** `statfs(UPLOAD_DIR_ORIGINAL)` throws `ENOENT` before upload dirs exist.
- **Fix:** Ensure upload directories before the disk-space check or stat an existing parent.

### AGG-C6-06 — Trusted proxy hop misconfiguration fails open to spoofable client IP
- **Sources:** code-reviewer `CR6-02`, debugger `DBG6-03`
- **Severity/confidence:** Medium / High (cross-agent agreement)
- **Citation:** `apps/web/src/lib/rate-limit.ts:69-89`
- **Status:** Confirmed/likely.
- **Failure scenario:** `TRUSTED_PROXY_HOPS` exceeds actual XFF chain length and the left-most spoofable IP is selected.
- **Fix:** Fail closed on too-short chains and fall back only to independently trusted data or `unknown`.

### AGG-C6-07 — Deleting a non-existent topic alias reports success
- **Sources:** code-reviewer `CR6-03`
- **Severity/confidence:** Low / High
- **Citation:** `apps/web/src/app/actions/topics.ts:454-474`
- **Status:** Confirmed.
- **Failure scenario:** Concurrent/stale alias delete hides the fact that nothing changed.
- **Fix:** Check `affectedRows` and return an explicit not-found/no-op response.

### AGG-C6-08 — Admin DB backup/restore actions are effectively untested
- **Sources:** test-engineer finding 1
- **Severity/confidence:** High / High
- **Citation:** `apps/web/src/app/[locale]/admin/db-actions.ts:33-470`
- **Status:** Confirmed test gap.
- **Failure scenario:** Restore lock release, queue resume, temp cleanup, child process failures, or CSV truncation regress with no test signal.
- **Fix:** Add server-action tests with mocked child processes, pool connections, queue hooks, filesystem cleanup, and key rejection/success branches.

### AGG-C6-09 — Share-link actions lack regression tests despite concurrency/rate-limit logic
- **Sources:** test-engineer finding 2
- **Severity/confidence:** High / High
- **Citation:** `apps/web/src/app/actions/sharing.ts:21-389`
- **Status:** Confirmed test gap.
- **Failure scenario:** Duplicate-key/FK/concurrent revoke rollback behavior regresses without tests.
- **Fix:** Add unit/e2e coverage for share creation/revocation branches.

### AGG-C6-10 — Security-critical middleware/instrumentation has no direct tests
- **Sources:** test-engineer finding 3
- **Severity/confidence:** High / High
- **Citation:** `apps/web/src/proxy.ts:13-103`, `apps/web/src/instrumentation.ts:1-37`
- **Status:** Manual-validation test gap.
- **Failure scenario:** Admin redirects, CSP nonce propagation, startup/shutdown hooks regress without automated signal.
- **Fix:** Add middleware/instrumentation tests.

### AGG-C6-11 — Admin E2E can be skipped and settings/SEO persistence is not exercised
- **Sources:** test-engineer finding 4, verifier `VER6-02`
- **Severity/confidence:** High / High (cross-agent agreement)
- **Citation:** `apps/web/e2e/admin.spec.ts:6-7,40-58`, `apps/web/e2e/helpers.ts:28-74`, `apps/web/e2e/origin-guard.spec.ts:50-52`, settings/SEO actions.
- **Status:** Confirmed gate/test gap.
- **Failure scenario:** CI/local gate passes while admin workflows or settings persistence are skipped.
- **Fix:** Make admin E2E required in CI when expected and add save/reload persistence coverage.

### AGG-C6-12 — Visual-check Playwright spec captures screenshots without assertions
- **Sources:** test-engineer finding 5
- **Severity/confidence:** Medium / High
- **Citation:** `apps/web/e2e/nav-visual-check.spec.ts:4-40`
- **Status:** Confirmed test gap.
- **Failure scenario:** Large visual regressions pass as long as screenshots are written.
- **Fix:** Convert to `toHaveScreenshot` baselines or remove manual-only checks.

### AGG-C6-13 — Real Sharp/image-processing pipelines are mocked out
- **Sources:** test-engineer finding 6
- **Severity/confidence:** Medium / High
- **Citation:** `apps/web/src/lib/process-image.ts:224-589`, `apps/web/src/lib/process-topic-image.ts:42-106`, mocked tests.
- **Status:** Confirmed test gap.
- **Failure scenario:** Derivative naming, EXIF/GPS, temp cleanup, topic-image output regress without coverage.
- **Fix:** Add fixture-backed integration tests.

### AGG-C6-14 — Discoverability/metadata surfaces have little automated coverage
- **Sources:** test-engineer finding 7
- **Severity/confidence:** Medium / High
- **Citation:** `apps/web/src/app/api/og/route.tsx`, `sitemap.ts`, `robots.ts`, `manifest.ts`, icon routes, `global-error.tsx`, `vitest.config.ts`
- **Status:** Manual-validation test gap.
- **Failure scenario:** SEO/crawler/OG/branding/fatal-error surfaces regress silently.
- **Fix:** Add route-level payload/render tests and a jsdom/RTL lane if desired.

### AGG-C6-15 — Anonymous load-more action lacks server-side rate limiting and docs overstate protection
- **Sources:** critic `CRIT6-01`
- **Severity/confidence:** Medium / High
- **Citation:** `apps/web/src/app/actions/public.ts:23-40`, `CLAUDE.md:127-130`
- **Status:** Confirmed.
- **Failure scenario:** Anonymous clients hammer pagination offsets/tags and force repeated DB reads.
- **Fix:** Add search-style in-memory + DB-backed per-IP throttling or redesign as cacheable GET; fix docs.

### AGG-C6-16 — `seo_locale` is a visible but inert SEO setting
- **Sources:** critic `CRIT6-02`
- **Severity/confidence:** Medium / High
- **Citation:** `apps/web/src/app/actions/seo.ts`, SEO client, `apps/web/src/lib/data.ts:860-889`, metadata generation under `apps/web/src/app/[locale]/**`
- **Status:** Confirmed.
- **Failure scenario:** Admins save an OG Locale value that metadata never uses.
- **Fix:** Wire the setting into metadata generation or remove it.

### AGG-C6-17 — Caching docs are stale relative to public `revalidate = 0`
- **Sources:** critic `CRIT6-03`
- **Severity/confidence:** Low-Medium / High
- **Citation:** `CLAUDE.md:198-202`, public routes under `apps/web/src/app/[locale]/(public)/**`
- **Status:** Confirmed docs/code mismatch.
- **Failure scenario:** Operators/reviewers assume ISR behavior that no longer exists.
- **Fix:** Update docs or intentionally restore ISR.

### AGG-C6-18 — Production CSP allows unused `cdn.jsdelivr.net` style origin
- **Sources:** critic `CRIT6-04`
- **Severity/confidence:** Low / High
- **Citation:** `apps/web/src/lib/content-security-policy.ts:58-69`
- **Status:** Confirmed.
- **Failure scenario:** Security policy remains broader than actual dependencies.
- **Fix:** Remove the unused origin and test the minimal policy.

### AGG-C6-19 — Action-origin lint gate accepts dead/nested guards and broad getter exemptions
- **Sources:** verifier `VER6-01`
- **Severity/confidence:** High / High
- **Citation:** `apps/web/scripts/check-action-origin.ts:99-103,112-128,158-181`, `apps/web/src/__tests__/check-action-origin.test.ts`, `CLAUDE.md:241-245`
- **Status:** Confirmed scanner bypass.
- **Failure scenario:** A mutating server action passes CI with no effective same-origin guard.
- **Fix:** Require effective top-level guard calls or explicit exemptions; narrow getter exemption; add bypass regression tests.

### AGG-C6-20 — Schema authority is split between migrations and runtime reconciler
- **Sources:** architect `ARCH6-01`
- **Severity/confidence:** High / High
- **Citation:** `apps/web/drizzle/**`, `apps/web/scripts/migrate.js:244-494`, `apps/web/scripts/init-db.ts:24-31`
- **Status:** Confirmed architecture risk.
- **Failure scenario:** Clean and legacy environments diverge while both appear working.
- **Fix:** Make migrations canonical; move reconciliation to explicit upgrade path; add drift checks.

### AGG-C6-21 — Multiple admins are multiple roots with no capability boundary
- **Sources:** architect `ARCH6-02`
- **Severity/confidence:** High / High
- **Citation:** `README.md:37`, `CLAUDE.md:5,158-159`, `apps/web/src/db/schema.ts:106-111`, admin nav/actions.
- **Status:** Confirmed intentional product/design constraint.
- **Failure scenario:** Any admin can perform every destructive/global operation.
- **Fix:** Introduce capabilities/roles if the trust model changes or admin features expand.

### AGG-C6-22 — Process-local coordination state encodes a single-writer topology
- **Sources:** architect `ARCH6-03`
- **Severity/confidence:** Medium / High
- **Citation:** `README.md:146`, `CLAUDE.md:158`, restore/upload/view-count/queue state files.
- **Status:** Documented architecture risk.
- **Failure scenario:** Horizontal scaling splits maintenance/upload/queue/view-count state.
- **Fix:** Enforce single-writer or externalize coordination.

### AGG-C6-23 — Configuration ownership is fragmented across file/env/DB
- **Sources:** architect `ARCH6-04`
- **Severity/confidence:** Medium / High
- **Citation:** `README.md:41-58`, `apps/web/src/lib/data.ts:870-891`, `layout.tsx`, footer, constants, `admin_settings`.
- **Status:** Confirmed architecture risk.
- **Failure scenario:** Changing one config plane updates only some surfaces.
- **Fix:** Define config domains and centralize composition.

### AGG-C6-24 — Storage abstraction is not wired into live storage architecture
- **Sources:** architect `ARCH6-05`
- **Severity/confidence:** Medium / High
- **Citation:** `apps/web/src/lib/storage/index.ts:4-12`; direct filesystem call sites; `CLAUDE.md:99`; stale storage messages.
- **Status:** Confirmed architecture risk.
- **Failure scenario:** Future backend switching misses real file pipeline call sites.
- **Fix:** Delete unused abstraction or fully integrate it.

### AGG-C6-25 — Mobile photo info sheet lets keyboard focus escape
- **Sources:** designer `UX6-01`
- **Severity/confidence:** High / High
- **Citation:** `apps/web/src/components/info-bottom-sheet.tsx:155-170`, `apps/web/src/components/photo-viewer.tsx:259-267`
- **Status:** Confirmed in browser.
- **Failure scenario:** Keyboard users tab into underlying page while sheet appears modal.
- **Fix:** Trap focus/mark modal for entire open dialog lifetime or remove dialog semantics for peek state.

### AGG-C6-26 — Admin action-column headers are blank
- **Sources:** designer `UX6-02`
- **Severity/confidence:** Medium / High
- **Citation:** `apps/web/messages/en.json:150-151`, `apps/web/messages/ko.json:150-151`, image/category/tag table headers.
- **Status:** Confirmed.
- **Failure scenario:** Table action column lacks a label for screen readers and appears unfinished.
- **Fix:** Add localized Actions text or an sr-only header.

### AGG-C6-27 — Korean admin password page has hard-coded English metadata title
- **Sources:** designer `UX6-03`
- **Severity/confidence:** Low / High
- **Citation:** `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx:3-5`
- **Status:** Confirmed.
- **Failure scenario:** Korean admin browser title remains English.
- **Fix:** Localize or remove hard-coded metadata.

### AGG-C6-28 — RTL support is not wired beyond current LTR locales
- **Sources:** designer `UX6-04`
- **Severity/confidence:** Low / Medium
- **Citation:** `apps/web/src/app/[locale]/layout.tsx:83-88`, `apps/web/src/lib/constants.ts:1-4`
- **Status:** Future-risk gap; not a current shipped-locale bug.
- **Failure scenario:** Future RTL locale remains LTR.
- **Fix:** Add locale-direction mapping before adding RTL locales.

### AGG-C6-29 — Partial-success uploads do not refresh the dashboard
- **Sources:** debugger `DBG6-01`
- **Severity/confidence:** Medium / High
- **Citation:** `apps/web/src/components/upload-dropzone.tsx:270-294`
- **Status:** Confirmed.
- **Failure scenario:** Successful files in a mixed batch are hidden until manual refresh.
- **Fix:** Call `router.refresh()` in the partial-success branch.

### AGG-C6-30 — Infinite-scroll observer can remain attached to an old sentinel after query reset
- **Sources:** debugger `DBG6-02`
- **Severity/confidence:** Medium / Medium
- **Citation:** `apps/web/src/components/load-more.tsx:60-83`
- **Status:** Likely/manual-validation risk.
- **Failure scenario:** Infinite scroll stops after query/hasMore changes while component stays mounted.
- **Fix:** Reconnect observer through a callback ref or effect dependencies that include sentinel/query state.
