# Aggregate Review — Cycle 8 RPF (2026-04-25)

**Scope:** Full repository review for review-plan-fix cycle 8. Per-agent review artifacts are preserved in `.context/reviews/*.md` for provenance.

## Agent roster and execution notes

### Completed review artifacts

- `code-reviewer` → `.context/reviews/code-reviewer.md`
- `security-reviewer` → `.context/reviews/security-reviewer.md`
- `test-engineer` → `.context/reviews/test-engineer.md`
- `debugger` → `.context/reviews/debugger.md`
- `designer` → `.context/reviews/designer.md`
- `critic` → `.context/reviews/critic.md`
- `verifier` → `.context/reviews/verifier.md`
- `dependency-expert` → `.context/reviews/dependency-expert.md`
- `document-specialist` → `.context/reviews/document-specialist.md` (covered through the registered `writer` role)
- `perf-reviewer` → `.context/reviews/perf-reviewer.md` (covered through the closest available reviewer role because no native `perf-reviewer` role was registered)
- `tracer` → `.context/reviews/tracer.md` (covered through the closest available debugging/tracing role because no native `tracer` role was registered)
- `architect` → `.context/reviews/architect.md`

### Registered reviewer-style agents considered but skipped

- `product-marketer-reviewer.md` — global/non-repo marketing reviewer; no marketing-copy review surface was relevant to this GalleryKit codebase cycle.
- `ui-ux-designer-reviewer.md` — global/non-native reviewer; the registered `designer` lane covered UI/UX with browser evidence for this web frontend.

### AGENT FAILURES

- `architect`: the first architect subagent timed out and was closed. A retry produced a full architectural review but could not write the file directly; the returned markdown was written to `.context/reviews/architect.md`. An additional accidental retry also timed out and was closed. The aggregate below includes the available architect findings and records the timeouts for provenance.

## Consolidated findings

Deduplication preserved the highest severity/confidence across overlapping findings. “Signal” records cross-agent agreement or related corroboration.

### C8RPF-01 — Rate-limit rollbacks can decrement the wrong time bucket
- **Severity / confidence:** Medium / High
- **Signal:** code-reviewer; related to test-engineer sharing/auth test gaps.
- **Primary citations:** `apps/web/src/lib/rate-limit.ts:254-281`; `apps/web/src/lib/auth-rate-limit.ts:40-48,76-84`; `apps/web/src/app/actions/auth.ts:138-141,238-240`; `apps/web/src/app/actions/admin-users.ts:62-66`; `apps/web/src/app/actions/sharing.ts:85-89`; contrast `apps/web/src/app/actions/public.ts:23-32,126-160`.
- **Problem:** rollback paths call `decrementRateLimit()` without the original `bucketStart`. Requests crossing a window boundary can increment bucket A and roll back bucket B, leaving stale counters behind.
- **Failure scenario:** a login/share/user-create request begins at the end of one window and fails after the next window begins; repeated failures can create phantom throttling or undercount the new bucket.
- **Suggested fix:** capture a single bucket start at pre-increment time and pass it to increment/check/reset/decrement for the whole flow.

### C8RPF-02 — Multi-hop `X-Forwarded-For` parsing can select a proxy instead of the client
- **Severity / confidence:** Medium / High
- **Signal:** tracer; related security reviewer proxy-trust risk.
- **Primary citations:** `apps/web/src/lib/rate-limit.ts` (`getClientIp`); docs around `TRUST_PROXY` in `README.md` and `apps/web/.env.local.example`.
- **Problem:** trusted-proxy hop math can return the first trusted proxy in a multi-hop chain rather than the untrusted client just before that trusted chain.
- **Failure scenario:** IP-based login/upload/search controls bucket traffic by CDN or proxy address, causing collateral throttling for many users or weakened per-client controls.
- **Suggested fix:** choose the address immediately before the configured trusted-hop suffix; if the chain length is not greater than the trusted hop count, fall back safely.

### C8RPF-03 — Uploads persist `user_filename` without normalization or length guarding
- **Severity / confidence:** Low / Medium
- **Signal:** code-reviewer.
- **Primary citations:** `apps/web/src/app/actions/images.ts:200-241`; `apps/web/src/db/schema.ts:28`.
- **Problem:** `path.basename(file.name).trim()` is persisted into a `varchar(255)` field without stripping control characters or checking length before expensive file/EXIF work.
- **Failure scenario:** an oversized or control-character filename can cause late DB failure after disk/EXIF work, or leak odd control characters into admin UI, logs, or exports.
- **Suggested fix:** sanitize and bound `user_filename` before persistence and reject invalid filenames before file I/O.

### C8RPF-04 — Restore maintenance is sampled once, so in-flight uploads can write during restore
- **Severity / confidence:** High / High
- **Signal:** debugger, tracer, architect/code-reviewer process-local coordination risks.
- **Primary citations:** `apps/web/src/lib/restore-maintenance.ts:21-55`; `apps/web/src/app/actions/images.ts:82-245`; `apps/web/src/app/[locale]/admin/db-actions.ts` restore flow.
- **Problem:** long-running upload work checks maintenance before file I/O but can reach the DB insert after restore maintenance begins.
- **Failure scenario:** a restore starts while an upload is extracting EXIF; the upload later inserts a row and queues processing into a DB/filesystem state that no longer matches the restored snapshot.
- **Suggested fix:** make restore maintenance a real write lock, or at least re-check immediately before the first DB mutation and clean up saved files when maintenance begins.

### C8RPF-05 — Restore maintenance is checked too late in many mutating actions
- **Severity / confidence:** High / High
- **Signal:** tracer; related debugger restore findings.
- **Primary citations:** mutating server actions under `apps/web/src/app/actions/*.ts` and `apps/web/src/app/[locale]/admin/db-actions.ts`.
- **Problem:** several mutations authenticate, read, or prepare work before checking `getRestoreMaintenanceMessage()`.
- **Failure scenario:** during restore maintenance, actions can still perform non-trivial work and may reach partial side effects if a future refactor moves a write earlier.
- **Suggested fix:** hoist restore-maintenance checks to the start of mutating actions, immediately after translation setup and before auth/DB reads where practical.

### C8RPF-06 — Upload-processing settings can race first upload and violate locked-once-images-exist invariant
- **Severity / confidence:** High / High
- **Signal:** debugger; related architect single-writer invariant.
- **Primary citations:** `apps/web/src/app/actions/settings.ts:74-147`; `apps/web/src/lib/upload-tracker-state.ts:15-61`.
- **Problem:** settings code checks for existing images and active upload claims outside the same critical section as the settings write; a concurrent first upload can insert after the check and before the update.
- **Failure scenario:** `image_sizes` or `strip_gps_on_upload` changes after the first image is committed, making derivative URLs or stored GPS privacy inconsistent across images.
- **Suggested fix:** serialize uploads and upload-contract settings changes with a shared lock/critical section and perform the existing-image check inside that boundary.

### C8RPF-07 — Deleted images can remain publicly accessible if filesystem cleanup fails
- **Severity / confidence:** Medium / High
- **Signal:** debugger.
- **Primary citations:** `apps/web/src/app/actions/images.ts:423-442,535-577`; `apps/web/src/lib/image-queue.ts:433-439`.
- **Problem:** DB deletion succeeds before best-effort filesystem cleanup, and there is no retry/tombstone/orphan reconciliation path for non-temporary derivatives.
- **Failure scenario:** transient unlink failure leaves derivative files under public uploads even though DB rows are gone, keeping assets reachable by direct URL.
- **Suggested fix:** surface partial cleanup failures and schedule retry/tombstone cleanup, or add a boot/maintenance reconciler for deleted-image artifacts.

### C8RPF-08 — Public/shared route freshness docs claim explicit `revalidate = 0` on shared pages, but shared routes omit it
- **Severity / confidence:** Medium / High
- **Signal:** verifier, document-specialist.
- **Primary citations:** `CLAUDE.md:199-205`; `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`; `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`.
- **Problem:** docs say public shared routes explicitly opt out of ISR, while the shared group/photo pages lack `export const revalidate = 0`.
- **Failure scenario:** maintainers rely on the documented cache policy while debugging stale shared content or changing route behavior.
- **Suggested fix:** add `revalidate = 0` to shared routes if freshness is intended, or update docs to describe the split.

### C8RPF-09 — Nginx upload allowlist serves PNG where the app allowlist does not
- **Severity / confidence:** Medium / High
- **Signal:** verifier.
- **Primary citations:** `apps/web/nginx/default.conf`; `apps/web/src/lib/serve-upload.ts`.
- **Problem:** the edge regex allows `.png` under processed upload directories, while Node-side serving and docs limit public derivatives to JPEG/WebP/AVIF.
- **Failure scenario:** a stray or attacker-placed PNG under a public derivative directory is served in Docker/nginx deployment but rejected by app-level tests.
- **Suggested fix:** remove PNG from the nginx regex or intentionally support PNG end-to-end.

### C8RPF-10 — Admin auth screens have no semantic page heading
- **Severity / confidence:** Medium / High
- **Signal:** designer browser evidence.
- **Primary citations:** `apps/web/src/app/[locale]/admin/login-form.tsx:29-54`; `apps/web/src/app/[locale]/admin/(protected)/password/password-client.tsx:10-20`; `apps/web/src/components/ui/card.tsx:31-39`.
- **Problem:** visual card titles are not semantic headings.
- **Failure scenario:** screen-reader users cannot navigate to a primary page heading on login or password-change screens.
- **Suggested fix:** render a real `h1` for those standalone auth pages or allow the card title to render as a heading there.

### C8RPF-11 — Mobile photo info sheet opens without moving focus into the dialog
- **Severity / confidence:** Medium / High
- **Signal:** designer browser evidence.
- **Primary citations:** `apps/web/src/components/photo-viewer.tsx:259-267`; `apps/web/src/components/info-bottom-sheet.tsx:121-155,174-206`.
- **Problem:** focus remains on the launcher behind the modal after opening.
- **Failure scenario:** keyboard/screen-reader users do not get immediate dialog context and must tab to discover it.
- **Suggested fix:** autofocus a close button/drag handle with the focus trap’s initial-focus hook when the sheet opens.

### C8RPF-12 — Shared album photo detail exposes duplicate level-1 headings
- **Severity / confidence:** Medium / High
- **Signal:** designer browser evidence.
- **Primary citations:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:133-154`; `apps/web/src/components/photo-viewer.tsx:237-243`.
- **Problem:** the shared group selected-photo route supplies a visible H1 while `PhotoViewer` also emits a hidden H1 for the same title.
- **Failure scenario:** heading navigation announces two primary headings for one page.
- **Suggested fix:** allow parent pages with their own H1 to suppress the hidden `PhotoViewer` H1.

### C8RPF-13 — Admin dashboard recent-uploads table causes mobile horizontal overflow
- **Severity / confidence:** Medium / High
- **Signal:** designer browser evidence.
- **Primary citations:** `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:36-40`; `apps/web/src/components/image-manager.tsx:335-418`.
- **Problem:** the dashboard grid/table min-content behavior expands the page to desktop width on narrow screens.
- **Failure scenario:** mobile admins must pan horizontally across the dashboard to inspect recent uploads/actions.
- **Suggested fix:** add proper `min-w-0`/overflow containment or a mobile card layout/horizontal scroller with low-value columns hidden.

### C8RPF-14 — Theme bootstrap script is missing a CSP nonce
- **Severity / confidence:** Medium / High
- **Signal:** designer browser console evidence.
- **Primary citations:** `apps/web/src/app/[locale]/layout.tsx:97-108`; `apps/web/src/components/theme-provider.tsx:6-10`.
- **Problem:** `next-themes` injects an inline bootstrap script that is not nonce-authorized by the page CSP.
- **Failure scenario:** CSP console violations and possible delayed theme application until hydration.
- **Suggested fix:** pass the request nonce into `ThemeProvider` so the injected script is nonce-bearing.

### C8RPF-15 — Generated OG images use slug-derived topic labels instead of canonical topic data
- **Severity / confidence:** Medium / High
- **Signal:** architect.
- **Primary citations:** `apps/web/src/app/api/og/route.tsx`; topic lookup helpers in `apps/web/src/lib/data.ts`.
- **Problem:** `/api/og` formats the `topic` query slug directly rather than reading canonical topic labels/aliases.
- **Failure scenario:** OG previews show stale or incorrectly capitalized topic text even though the site’s topic pages use the configured label.
- **Suggested fix:** validate the slug and resolve it through canonical topic data before rendering the label.

### C8RPF-16 — Generated OG images are cacheable for an hour without invalidation
- **Severity / confidence:** Medium / High
- **Signal:** tracer; related architect OG finding.
- **Primary citations:** `apps/web/src/app/api/og/route.tsx`.
- **Problem:** OG image responses are publicly cacheable even though they derive from mutable topic/site metadata and query params with no revalidation/versioning path.
- **Failure scenario:** topic or site metadata changes while social/link previews keep serving stale OG images.
- **Suggested fix:** either version OG URLs by metadata state or mark the generated response `no-store`/short-lived until invalidation exists.

### C8RPF-17 — Photo viewer forces synchronous image decoding on the main interaction path
- **Severity / confidence:** Medium / High
- **Signal:** perf-reviewer.
- **Primary citations:** `apps/web/src/components/photo-viewer.tsx` image element with `decoding="sync"`.
- **Problem:** sync decoding can block the main thread while users navigate between large photos.
- **Failure scenario:** photo navigation/input feels janky on large images or slower devices.
- **Suggested fix:** use `decoding="async"` or omit the attribute and rely on adjacent-image preloading instead.

### C8RPF-18 — Native worker sizing can oversubscribe CPU-limited containers
- **Severity / confidence:** Medium / Medium
- **Signal:** dependency-expert, perf-reviewer.
- **Primary citations:** `apps/web/scripts/entrypoint.sh:24-31`; `apps/web/src/lib/process-image.ts:16-23`; Argon2 auth paths in `apps/web/src/app/actions/auth.ts`.
- **Problem:** `nproc`/`os.cpus()` can reflect host CPUs rather than effective container parallelism, causing too many native workers.
- **Failure scenario:** uploads and Argon2 work saturate libuv/native threads, slowing unrelated web requests.
- **Suggested fix:** prefer `os.availableParallelism()` or conservative caps for Sharp/libuv sizing.

### C8RPF-19 — Site configuration docs contradict runtime source-of-truth split
- **Severity / confidence:** Medium / High
- **Signal:** critic, document-specialist.
- **Primary citations:** `README.md`; `apps/web/src/site-config*.json`; admin SEO/settings actions and site-config readers.
- **Problem:** docs present `site-config.json` as the site configuration source, but runtime values are split between file-backed fields and DB-backed admin-managed SEO/branding fields.
- **Failure scenario:** operators edit the wrong source and assume settings were ignored or stale.
- **Suggested fix:** document the split clearly or consolidate the source of truth by setting family.

### C8RPF-20 — `parent_url` is documented but has no runtime consumer
- **Severity / confidence:** Low / High
- **Signal:** critic.
- **Primary citations:** README/site-config examples and source searches for `parent_url`.
- **Problem:** docs/config examples expose a field that the app never reads.
- **Failure scenario:** operators configure parent navigation/canonical behavior and silently get no effect.
- **Suggested fix:** remove the field from docs/examples or implement/test the intended behavior.

### C8RPF-21 — `IMAGE_BASE_URL` docs omit stricter parser/build constraints
- **Severity / confidence:** Low / High
- **Signal:** document-specialist.
- **Primary citations:** `README.md:129-145`; `apps/web/README.md:36-38`; `apps/web/.env.local.example:11-15`; `apps/web/src/lib/content-security-policy.ts:1-25`; `apps/web/next.config.ts:8-29`.
- **Problem:** docs mention absolute/HTTPS constraints but omit that credentials, query strings, and hashes are rejected.
- **Failure scenario:** an operator uses a signed CDN URL and hits a production build failure that docs did not predict.
- **Suggested fix:** add concise constraint notes to setup docs and env examples.

### C8RPF-22 — `BASE_URL`/site-config docs omit production placeholder URL build gate
- **Severity / confidence:** Medium / High
- **Signal:** document-specialist.
- **Primary citations:** `README.md:43-58,116-145,167-170`; `apps/web/README.md:15-18,36-43`; `apps/web/src/site-config.example.json`; `apps/web/scripts/ensure-site-config.mjs:4-38`; `apps/web/Dockerfile:44-48`.
- **Problem:** production builds fail fast for placeholder/missing absolute URLs, but setup docs do not state this near the copy step.
- **Failure scenario:** a deployer follows quick-start instructions and reaches a build failure after other setup work.
- **Suggested fix:** document that production requires real `BASE_URL` or non-placeholder `site-config.json.url`.

### C8RPF-23 — Proxy docs omit fail-closed same-origin behavior when Origin and Referer are both absent
- **Severity / confidence:** Low / High
- **Signal:** document-specialist.
- **Primary citations:** `README.md:148`; `apps/web/README.md:40`; `apps/web/.env.local.example:42-50`; `apps/web/src/lib/request-origin.ts:19-24,45-106`.
- **Problem:** docs explain proxy headers but not that admin same-origin checks intentionally reject requests with neither `Origin` nor `Referer`.
- **Failure scenario:** operators misdiagnose 403s from privacy tools/proxies as auth regressions.
- **Suggested fix:** add a short fail-closed provenance note.

### C8RPF-24 — Action-origin scanner docs overstate “leading JSDoc” requirement
- **Severity / confidence:** Low / High
- **Signal:** document-specialist.
- **Primary citations:** `CLAUDE.md:242-245`; `apps/web/scripts/check-action-origin.ts:100-105,228-243`; `apps/web/src/__tests__/check-action-origin.test.ts:85-95`.
- **Problem:** docs require a leading JSDoc exemption comment, while the scanner accepts any leading comment containing `@action-origin-exempt`.
- **Failure scenario:** maintainers reject valid scanner-compliant comments or misunderstand the invariant.
- **Suggested fix:** either tighten the scanner or loosen docs to “leading comment containing the marker.”

### C8RPF-25 — TypeScript 6 is outside the pinned `typescript-eslint` peer range
- **Severity / confidence:** Medium / High
- **Signal:** dependency-expert.
- **Primary citations:** `apps/web/package.json:56-70`; `package-lock.json` `@typescript-eslint/*` peer dependency ranges.
- **Problem:** the app targets TypeScript 6 while the locked lint stack declares support for `<6.0.0`.
- **Failure scenario:** clean installs or lint-stack updates produce peer warnings or parser/rule breakage as the dependency graph re-resolves.
- **Suggested fix:** pin TypeScript below 6 or upgrade the lint stack once it supports TypeScript 6.

### C8RPF-26 — Next still pulls a vulnerable PostCSS 8.4.31 copy
- **Severity / confidence:** Medium / High
- **Signal:** security-reviewer, dependency-expert.
- **Primary citations:** `apps/web/package.json` overrides; `package-lock.json` `next@16.2.3` dependency on `postcss@8.4.31`; GHSA-qx2v-qp2m-jg93.
- **Problem:** the workspace override does not remove Next’s nested vulnerable PostCSS path.
- **Failure scenario:** a build-time/server-side CSS stringify path reaching that copy remains vulnerable, even if exploitability is constrained because users cannot upload CSS.
- **Suggested fix:** upgrade to a Next/PostCSS combination that no longer pins the vulnerable copy or verify an override/lockfile strategy that removes it.

### C8RPF-27 — Historical bootstrap/session secrets and weak defaults remain exposed in git history
- **Severity / confidence:** Medium / High
- **Signal:** security-reviewer.
- **Primary citations:** git history; current warnings in `CLAUDE.md:67-70` and examples.
- **Problem:** older checked-in environment examples contained weak/live-looking values that remain recoverable from history.
- **Failure scenario:** an environment seeded from historical values keeps compromised session/admin credentials.
- **Suggested fix:** continue treating old values as compromised; rotate any environment ever seeded from them and avoid committing real secrets.

### C8RPF-28 — Reverse-proxy trust remains a deployment-critical security assumption
- **Severity / confidence:** Low / High
- **Signal:** security-reviewer, critic, tracer.
- **Primary citations:** proxy/trust docs; origin/IP code paths.
- **Problem:** correctness of same-origin checks and IP-based controls depends on proxy header overwrite and trust settings matching production topology.
- **Failure scenario:** misconfigured forwarded headers weaken rate limits or cause legitimate admin requests to fail.
- **Suggested fix:** document/validate header overwrite behavior in deployment, and fail loudly for unsupported proxy topologies where possible.

### C8RPF-29 — Database backups are plaintext at rest in the app data volume
- **Severity / confidence:** Low / Medium
- **Signal:** security-reviewer.
- **Primary citations:** backup dump/download flow under `apps/web/src/app/[locale]/admin/db-actions.ts` and `apps/web/src/app/api/admin/db/download/route.ts`.
- **Problem:** backups are auth-protected and non-public but not encrypted by the application before storage.
- **Failure scenario:** host or volume compromise exposes backup contents.
- **Suggested fix:** use encrypted storage/volume policy or add application-level encrypted backups if the threat model requires it.

### C8RPF-30 — Public gallery list over-fetches EXIF-heavy image columns
- **Severity / confidence:** High / High
- **Signal:** perf-reviewer.
- **Primary citations:** public gallery query/projection code in `apps/web/src/lib/data.ts` and public list page usage.
- **Problem:** grid pages fetch and serialize fields that cards do not render.
- **Failure scenario:** large galleries pay unnecessary DB/SSR/hydration cost for every list page.
- **Suggested fix:** add a dedicated gallery-card projection for list pages, preserving EXIF/full metadata for detail/admin/search surfaces.

### C8RPF-31 — Admin dashboard list over-fetches full admin image records
- **Severity / confidence:** High / High
- **Signal:** perf-reviewer.
- **Primary citations:** admin dashboard query and `apps/web/src/components/image-manager.tsx` row usage.
- **Problem:** the dashboard loads full admin records for rows that render a narrower subset.
- **Failure scenario:** dashboard SSR and client payload grow unnecessarily with 50-row pages.
- **Suggested fix:** add a dashboard-specific projection and keep full records for detail/edit contexts.

### C8RPF-32 — Batch delete can fan out into hundreds of full directory scans
- **Severity / confidence:** High / High
- **Signal:** perf-reviewer.
- **Primary citations:** batch deletion cleanup paths in `apps/web/src/app/actions/images.ts` and variant cleanup helpers.
- **Problem:** deleting many images can trigger repeated per-image/per-format directory scans.
- **Failure scenario:** a large batch delete saturates disk I/O and delays uploads/queue work.
- **Suggested fix:** scan each format directory once per batch and unlink matching variants with bounded concurrency.

### C8RPF-33 — CSV export materializes large exports in memory twice
- **Severity / confidence:** Medium / High
- **Signal:** perf-reviewer.
- **Primary citations:** `apps/web/src/app/[locale]/admin/db-actions.ts` CSV export flow and client Blob handling.
- **Problem:** CSV data is held as DB rows + line array + final string server-side, then as action payload + Blob client-side.
- **Failure scenario:** large exports spike memory or freeze slower browsers.
- **Suggested fix:** stream CSV from a route handler instead of returning the body through a Server Action.

### C8RPF-34 — Live search remains a leading-wildcard multi-query scan without a real search index
- **Severity / confidence:** Medium / High
- **Signal:** perf-reviewer.
- **Primary citations:** search query construction in `apps/web/src/lib/data.ts` / public search action.
- **Problem:** rate limiting mitigates abuse, not the normal cost of `%term%` scans and joins on large galleries.
- **Failure scenario:** legitimate debounced searches become expensive as data grows.
- **Suggested fix:** add FULLTEXT or a dedicated search index/table with current fallback for small datasets.

### C8RPF-35 — Queue/job concurrency can still oversubscribe CPU under default settings
- **Severity / confidence:** Medium / Medium
- **Signal:** perf-reviewer; related dependency-expert native worker sizing.
- **Primary citations:** `apps/web/src/lib/image-queue.ts`; `apps/web/src/lib/process-image.ts`.
- **Problem:** queue concurrency plus parallel format generation can multiply native image work beyond effective CPU capacity.
- **Failure scenario:** large upload batches make public/admin UI sluggish.
- **Suggested fix:** bound conversion work at the format/job level or lower weighted concurrency for expensive formats.

### C8RPF-36 — Admin dashboard rows mount many full TagInput instances/listeners
- **Severity / confidence:** Medium / High
- **Signal:** perf-reviewer.
- **Primary citations:** `apps/web/src/components/image-manager.tsx`; `apps/web/src/components/tag-input.tsx`.
- **Problem:** each dashboard row can mount an autocomplete with its own filtering/listener cost.
- **Failure scenario:** dashboard responsiveness degrades with many rows/tags.
- **Suggested fix:** lazy-open tag editing and centralize outside-click/listener handling.

### C8RPF-37 — Critical auth flows are mostly protected by source-text tests, not behavioral tests
- **Severity / confidence:** High / High
- **Signal:** test-engineer.
- **Primary citations:** auth action tests under `apps/web/src/__tests__` and `apps/web/src/app/actions/auth.ts`.
- **Problem:** tests assert source order/strings instead of executing login/logout/password-change behavior.
- **Failure scenario:** refactors preserve searched strings but break cookies, transactions, redirects, rollbacks, or session rotation.
- **Suggested fix:** add executable tests with mocked cookies/headers/db/argon2/session/rate-limit helpers.

### C8RPF-38 — Share-link mutation actions lack direct tests
- **Severity / confidence:** High / High
- **Signal:** test-engineer; related code-reviewer rate-limit rollback finding.
- **Primary citations:** `apps/web/src/app/actions/sharing.ts`; absence of `sharing*.test.ts`.
- **Problem:** retry loops, transactions, in-memory rollback, and concurrent revoke/create protections have no direct coverage.
- **Failure scenario:** stale share keys, drifted rate-limit buckets, or FK failures regress without failing tests.
- **Suggested fix:** add a dedicated sharing-actions test suite covering create/revoke/delete success and failure paths.

### C8RPF-39 — Settings and SEO admin mutations are under-tested
- **Severity / confidence:** High / High
- **Signal:** test-engineer.
- **Primary citations:** `apps/web/src/app/actions/settings.ts`; `apps/web/src/app/actions/seo.ts`; current test files.
- **Problem:** settings/SEO coverage does not execute the mutation surfaces for transactionality, sanitization, invalid keys, upload locks, or revalidation.
- **Failure scenario:** stale config persists or invalid keys slip through without tests.
- **Suggested fix:** add behavioral tests for settings and SEO actions with mocked DB/audit/revalidation.

### C8RPF-40 — Shared-group view-count buffering/backoff has no regression coverage
- **Severity / confidence:** Medium / High
- **Signal:** test-engineer.
- **Primary citations:** `apps/web/src/lib/data.ts` shared-group view-count buffer functions; absence of direct tests.
- **Problem:** buffer-cap, backoff, and failure paths are untested.
- **Failure scenario:** DB outages drop increments, leak timers, or cause runaway retry/buffer growth without a failing test.
- **Suggested fix:** add a narrow test seam or internal hooks and cover success/failure/backoff/cap behavior.

### C8RPF-41 — Search UI concurrency and keyboard-selection logic lack direct tests
- **Severity / confidence:** Medium / High
- **Signal:** test-engineer.
- **Primary citations:** search component and current E2E coverage.
- **Problem:** E2E covers open/focus/basic visibility but not stale-response suppression, debounce cleanup, arrow-key bounds, Enter activation, or scroll unlock.
- **Failure scenario:** older responses overwrite newer searches or keyboard navigation regresses while smoke tests pass.
- **Suggested fix:** add component tests with mocked `searchImagesAction`.

### C8RPF-42 — Source-inspection tests stand in for many runtime/UI behavior tests
- **Severity / confidence:** Medium / High
- **Signal:** test-engineer.
- **Primary citations:** source-contract tests in `apps/web/src/__tests__`.
- **Problem:** many tests assert `readFileSync(...).toContain()/toMatch()` rather than executing exported behavior.
- **Failure scenario:** behavior breaks while strings remain, or safe refactors create noisy false failures.
- **Suggested fix:** keep source tests only for actual static-scanner contracts; replace UI/action/runtime checks with behavioral tests over time.

### C8RPF-43 — Admin settings Playwright test can false-pass if persistence fails
- **Severity / confidence:** Medium / Medium
- **Signal:** test-engineer.
- **Primary citations:** `apps/web/e2e/admin.spec.ts` settings test.
- **Problem:** the test checks local toggle state but not persisted value after server action + reload.
- **Failure scenario:** UI state changes locally while server persistence fails; the test still passes.
- **Suggested fix:** wait for save feedback/network idle, reload settings, and verify the value persisted before restoring it.

### C8RPF-44 — Fixed 30-second DB polling in E2E upload helper is a CI-flake risk
- **Severity / confidence:** Medium / Medium
- **Signal:** test-engineer.
- **Primary citations:** `apps/web/e2e/helpers.ts` upload polling helper.
- **Problem:** slow image processing or cold CI disks can exceed the fixed timeout.
- **Failure scenario:** upload/delete workflows fail intermittently although the app is correct.
- **Suggested fix:** make timeout configurable, log observed processing duration, and prefer app/UI completion signals where feasible.

### C8RPF-45 — Visual nav checks generate artifacts rather than assertions
- **Severity / confidence:** Medium / High
- **Signal:** test-engineer.
- **Primary citations:** `apps/web/e2e/nav-visual-check.spec.ts`.
- **Problem:** screenshots are saved but not compared to baselines or asserted as visual invariants.
- **Failure scenario:** layout regressions slip through CI unless someone manually inspects generated PNGs.
- **Suggested fix:** convert to Playwright `toHaveScreenshot` with stable masking/thresholds or move to an explicit manual-review script.

### C8RPF-46 — Storage abstraction has drifted from the real local-only topology
- **Severity / confidence:** Medium / High
- **Signal:** architect; related critic.
- **Primary citations:** `CLAUDE.md` storage note; `apps/web/src/lib/storage/*`; upload/process/serve code paths.
- **Problem:** the abstraction suggests broader storage support while core image paths still directly depend on local filesystem layout.
- **Failure scenario:** future work attempts to plug in remote storage through the partial abstraction and misses upload/processing/serving/backup constraints.
- **Suggested fix:** delete or clearly quarantine the abstraction until storage is adopted end-to-end, or replace it with topology-aware domains.

### C8RPF-47 — Cross-process coordination makes single-instance a hard runtime invariant
- **Severity / confidence:** High / High
- **Signal:** architect, code-reviewer, critic, debugger.
- **Primary citations:** `CLAUDE.md` runtime topology; `apps/web/src/lib/restore-maintenance.ts`; `apps/web/src/lib/upload-tracker-state.ts`; `apps/web/src/lib/data.ts`; `apps/web/src/lib/image-queue.ts`.
- **Problem:** restore flags, upload quota claims, view-count buffers, load-more throttles, and queue state are process-local.
- **Failure scenario:** accidental scale-out or blue/green overlap causes divergent rate limits, restore guards, queue processing, and approximate analytics.
- **Suggested fix:** either enforce singleton deployment in code/ops or move coordination into shared storage before supporting multiple web instances.

### C8RPF-48 — Public rate-limiting policy drifts by surface in multi-node deployments
- **Severity / confidence:** Medium / Medium
- **Signal:** architect.
- **Primary citations:** search/load-more/public action rate-limit code.
- **Problem:** some anonymous surfaces use DB-backed limits while others remain process-local/best-effort.
- **Failure scenario:** multi-node deployments produce inconsistent throttling and abuse controls.
- **Suggested fix:** normalize public throttling strategy before permitting multi-instance deployment.

### C8RPF-49 — CDN/asset-origin support is upload-only, not asset-wide
- **Severity / confidence:** Low / Medium
- **Signal:** architect.
- **Primary citations:** `IMAGE_BASE_URL` asset URL helpers and topic/static thumbnail paths.
- **Problem:** remote asset base handling applies to uploads, while other public assets remain local-origin assumptions.
- **Failure scenario:** CDN deployments produce mixed-origin assets and confusing cache behavior.
- **Suggested fix:** make asset-origin policy explicit and shared across upload derivatives and topic/static assets.

### C8RPF-50 — Infinite load-more grows DOM/image count without windowing
- **Severity / confidence:** Medium / Medium
- **Signal:** perf-reviewer.
- **Primary citations:** public masonry/load-more components.
- **Problem:** long sessions retain all loaded cards/images in the DOM.
- **Failure scenario:** low-memory mobile browsers develop scroll jank on large galleries.
- **Suggested fix:** profile long-scroll sessions; add virtualization or rolling render window if observed.

### C8RPF-51 — Server Action upload transport carries a very large body budget
- **Severity / confidence:** Medium / Medium
- **Signal:** perf-reviewer.
- **Primary citations:** upload server action and body-size config.
- **Problem:** large uploads through Server Actions may buffer according to runtime behavior.
- **Failure scenario:** concurrent large uploads increase RSS/temp-file pressure in production.
- **Suggested fix:** validate with load tests and consider streaming route handlers if memory pressure is high.

## Aggregate recommendation

Address the bounded correctness/security/UX/cache/doc issues immediately: rate-limit bucket pinning, forwarded-client IP parsing, upload filename normalization, shared route freshness, nginx allowlist alignment, theme nonce, semantic headings/focus, OG route correctness/cache headers, and native parallelism sizing. Record larger architectural/performance/test coverage items as deferred with preserved severity/confidence and explicit exit criteria, because the repo’s own rules require small, reviewable changes and document a single-instance topology.
