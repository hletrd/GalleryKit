# Aggregate Review — Cycle 3/100 (2026-04-24)

## Fan-out roster and status

UI/UX surface detected (`apps/web/src/app`, `apps/web/src/components`, Tailwind/Next.js). Due to the AGENTS.md max-concurrency limit, reviewers were launched in bounded concurrent batches; all selected registered review lanes completed. `perf-reviewer`, `tracer`, and `document-specialist` are not registered spawn-agent roles in this environment; `writer` covered the document-specialist lane, and `debugger` covered causal tracing.

Completed reports:
- `.context/reviews/code-reviewer.md`
- `.context/reviews/security-reviewer.md`
- `.context/reviews/critic.md`
- `.context/reviews/verifier.md`
- `.context/reviews/test-engineer.md`
- `.context/reviews/architect.md`
- `.context/reviews/debugger.md`
- `.context/reviews/designer.md`
- `.context/reviews/dependency-expert.md`
- `.context/reviews/writer-document-specialist.md`

## AGENT FAILURES

None after retry. Initial `architect` / `debugger` / `designer` spawn attempts hit the configured child-agent thread limit; each lane was retried when capacity opened and completed.

## Deduped findings

### AGG-C3-01 — Forwarded host/proto parsing trusts attacker-controlled hops
- **Severity / confidence:** MEDIUM / High (raised by code-reviewer + security-reviewer)
- **Status:** likely security issue, deployment-dependent
- **Citations:** `apps/web/src/lib/request-origin.ts:9-10,32-45,79-86`; `apps/web/src/lib/rate-limit.ts:61-87`
- **Problem:** `TRUST_PROXY=true` makes same-origin and IP decisions depend on forwarded headers; comma-separated `x-forwarded-host` / `x-forwarded-proto` currently take the first value, which can be attacker controlled in append-style proxy chains.
- **Failure scenario:** `X-Forwarded-Host: evil.example, gallery.atik.kr` plus `Origin: https://evil.example` can make the app derive `https://evil.example` as expected origin and accept privileged actions if the deployment forwards unsanitized headers.
- **Suggested fix:** Prefer the trusted/right-most hop or reject multi-valued host/proto; add regression tests.

### AGG-C3-02 — CSV export still triple-buffers large datasets
- **Severity / confidence:** MEDIUM / High
- **Status:** confirmed performance/memory issue
- **Citation:** `apps/web/src/app/[locale]/admin/db-actions.ts:51-93`
- **Problem:** export loads DB results, builds `csvLines`, then joins to `csvContent`, keeping multiple large representations live.
- **Failure scenario:** large galleries with long metadata can spike heap/OOM on concurrent exports.
- **Suggested fix:** stream or chunk export rows so memory stays bounded.

### AGG-C3-03 — SQL restore scanner misses destructive and long-boundary SQL
- **Severity / confidence:** HIGH / High (debugger confirmed destructive SQL; code-reviewer flagged long-boundary bypass)
- **Status:** confirmed data-loss/security issue
- **Citations:** `apps/web/src/lib/sql-restore-scan.ts:1-52`; `apps/web/src/app/[locale]/admin/db-actions.ts:339-359`; `apps/web/src/__tests__/sql-restore-scan.test.ts:60-89`
- **Problem:** scanner does not block `DROP TABLE`, `DELETE FROM`, or `TRUNCATE TABLE`; it also carries only a fixed 64 KiB tail and can miss dangerous patterns split by very large removable spans.
- **Failure scenario:** a hostile restore file with `DROP TABLE images;` or a split trigger/procedure statement can pass scanning and execute under `mysql --one-database`.
- **Suggested fix:** add destructive table statements to the denylist and add regression tests; longer term, replace regex scanning with a stateful SQL lexer/allowlist.

### AGG-C3-04 — Production CSP allows inline script/style execution
- **Severity / confidence:** MEDIUM / High
- **Status:** confirmed hardening gap
- **Citation:** `apps/web/next.config.ts:63-84`
- **Problem:** `script-src` and `style-src` include `'unsafe-inline'`, weakening CSP as an XSS containment layer.
- **Failure scenario:** any future HTML/script injection viewed by an authenticated admin can execute inline script despite CSP.
- **Suggested fix:** move to nonce/hash-based CSP for scripts/styles or otherwise remove inline allowances without breaking Next runtime.

### AGG-C3-05 — Public health endpoint discloses maintenance/DB state
- **Severity / confidence:** LOW / High
- **Status:** confirmed information exposure
- **Citation:** `apps/web/src/app/api/health/route.ts:7-29`
- **Problem:** unauthenticated `/api/health` reports restore maintenance and DB readiness details.
- **Failure scenario:** attackers can time nuisance traffic/probing around DB outage or restore windows.
- **Suggested fix:** keep detailed readiness internal or return generic public status.

### AGG-C3-06 — Photo detail SEO/title rendering diverges from visible UI
- **Severity / confidence:** MEDIUM / High
- **Status:** confirmed correctness/SEO issue
- **Citations:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:52-56,88-96,129-134`; `apps/web/src/lib/photo-title.ts:17-35`; `apps/web/src/components/photo-viewer.tsx:82-97`; `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:75-77,101-102`
- **Problem:** direct photo metadata/JSON-LD uses tag-preferring `getPhotoDisplayTitle()` options while visible/shared page title uses the default helper. Direct photo `publishedTime` also uses `Date.toString()` while shared pages use ISO.
- **Failure scenario:** crawlers/social previews index `#tag`/locale-date strings that do not match the hydrated visible title or ISO metadata.
- **Suggested fix:** use one shared title path and ISO timestamp formatting.

### AGG-C3-07 — `/api/og` trusts public `label` and `site` query params
- **Severity / confidence:** MEDIUM / High
- **Status:** confirmed spoofing risk
- **Citations:** `apps/web/src/app/api/og/route.tsx:29-33`; `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:57-67`
- **Problem:** public query params are rendered into domain-hosted OG cards.
- **Failure scenario:** `/api/og?...&label=Urgent%20Invoice&site=PayPal` creates a convincing branded card from this origin.
- **Suggested fix:** derive label/site server-side, sign params, or ignore untrusted params.

### AGG-C3-08 — Upload quota is process-local and IP-scoped despite multi-user admin
- **Severity / confidence:** MEDIUM / High (architect + critic agreement)
- **Status:** confirmed correctness/UX issue
- **Citations:** `apps/web/src/app/actions/images.ts:80-104,145-209`; `apps/web/src/lib/upload-tracker.ts:12-25`; `apps/web/src/db/schema.ts:106-111`
- **Problem:** cumulative upload limiter uses a local `Map` keyed by client IP only.
- **Failure scenario:** two admins behind the same NAT block each other; restarts reset quota; multi-instance deployments can bypass caps.
- **Suggested fix:** key quotas by authenticated admin identity (optionally with IP) and persist if multi-instance support is required.

### AGG-C3-09 — Gallery config can change across in-flight uploads
- **Severity / confidence:** MEDIUM / Medium-High
- **Status:** likely correctness/privacy issue
- **Citations:** `apps/web/src/app/actions/settings.ts:72-103`; `apps/web/src/app/actions/images.ts:321-370`; `apps/web/src/lib/image-queue.ts:115-117`; `apps/web/src/lib/process-image.ts:362-417`
- **Problem:** settings change gate only checks for existing images; queue jobs read active config later.
- **Failure scenario:** a batch straddles image-size or GPS-stripping changes, producing mixed derivatives or unexpectedly retained GPS metadata.
- **Suggested fix:** snapshot config at upload start or block relevant config changes while uploads are in flight.

### AGG-C3-10 — Share-link mutations lack direct regression coverage
- **Severity / confidence:** HIGH / High
- **Status:** confirmed test gap
- **Citation:** `apps/web/src/app/actions/sharing.ts:92-388`
- **Suggested fix:** add unit tests for invalid IDs, unprocessed images, rollback paths, duplicate-key exhaustion, conditional revoke, and group delete failures.

### AGG-C3-11 — Backup/restore server actions lack direct regression coverage
- **Severity / confidence:** HIGH / High
- **Status:** confirmed test gap
- **Citation:** `apps/web/src/app/[locale]/admin/db-actions.ts:33-470`
- **Suggested fix:** add mocked tests for auth/origin, advisory lock release, maintenance/queue resume, invalid backups, CSV escaping, and temp cleanup.

### AGG-C3-12 — Core image-processing file I/O and derivative generation are untested
- **Severity / confidence:** HIGH / High
- **Status:** confirmed test gap
- **Citation:** `apps/web/src/lib/process-image.ts:170-459`
- **Suggested fix:** add temp-dir/mocked-sharp tests for extension/size checks, cleanup, ICC parsing, variant deletion, dedupe/copy fallback, and non-empty output verification.

### AGG-C3-13 — Topic-image file handling is untested
- **Severity / confidence:** MEDIUM / High
- **Status:** confirmed test gap
- **Citation:** `apps/web/src/lib/process-topic-image.ts:42-106`
- **Suggested fix:** add tests for invalid input, conversion failure cleanup, WebP output, safe delete, and orphaned temp cleanup.

### AGG-C3-14 — Search UI async/keyboard behavior lacks direct coverage
- **Severity / confidence:** MEDIUM / Medium
- **Status:** likely test gap
- **Citation:** `apps/web/src/components/search.tsx:52-93,169-247`
- **Suggested fix:** add component tests for debounce, stale-response suppression, arrow navigation, Enter selection, and empty reset.

### AGG-C3-15 — OptimisticImage retry/fallback behavior is untested
- **Severity / confidence:** MEDIUM / Medium
- **Status:** likely test gap
- **Citation:** `apps/web/src/components/optimistic-image.tsx:18-53`
- **Suggested fix:** add fake-timer tests for fallback, retry caps, timer cleanup, and terminal error.

### AGG-C3-16 — Visual-nav Playwright checks only dump screenshots
- **Severity / confidence:** MEDIUM / High
- **Status:** confirmed test gap
- **Citation:** `apps/web/e2e/nav-visual-check.spec.ts:5-39`
- **Suggested fix:** compare screenshots or add meaningful DOM/visual assertions.

### AGG-C3-17 — Playwright bootstrap can reuse stale servers and fixed polling can flake
- **Severity / confidence:** MEDIUM / Medium
- **Status:** risk/likely flake
- **Citations:** `apps/web/playwright.config.ts:54-60`; `apps/web/e2e/admin.spec.ts:61-83`; `apps/web/e2e/helpers.ts:122-149`
- **Suggested fix:** disable reuse in CI/review lanes unless explicitly requested; add seeded-data smoke; make upload polling user-visible or env-tunable with diagnostics.

### AGG-C3-18 — Image processing has no terminal failure state
- **Severity / confidence:** HIGH / High
- **Status:** confirmed correctness/operability issue
- **Citations:** `apps/web/src/db/schema.ts:16-66`; `apps/web/src/app/actions/images.ts:248-370`; `apps/web/src/lib/image-queue.ts:279-312`; `apps/web/src/components/image-manager.tsx:372-385`
- **Problem:** failed queue jobs remain `processed=false` forever with no persisted error/retry path.
- **Failure scenario:** unsupported files or transient disk errors leave endless admin spinners and hidden public images.
- **Suggested fix:** add processing state/error metadata and admin retry/delete affordances.

### AGG-C3-19 — Restore/maintenance and queue control are process-local
- **Severity / confidence:** HIGH / High
- **Status:** multi-instance architecture risk
- **Citations:** `apps/web/src/lib/restore-maintenance.ts:1-55`; `apps/web/src/lib/image-queue.ts:110-128,453-482`; `apps/web/src/app/[locale]/admin/db-actions.ts:258-311`; `apps/web/docker-compose.yml:1-22`
- **Problem:** restore maintenance/queue pause is `globalThis`-local, while only restore-vs-restore is DB-coordinated.
- **Failure scenario:** a second app instance can keep accepting uploads/mutations during another instance’s restore.
- **Suggested fix:** enforce/document single-instance runtime or move state to a shared store.

### AGG-C3-20 — Storage path is split across unused abstraction, direct filesystem writes, and nginx
- **Severity / confidence:** MEDIUM / High
- **Status:** confirmed architecture risk
- **Citations:** `apps/web/src/lib/storage/index.ts:1-128`; `apps/web/src/lib/process-image.ts:47-60,362-444`; `apps/web/src/lib/serve-upload.ts:32-103`; `apps/web/nginx/default.conf:89-106`
- **Suggested fix:** delete/clearly mark the experimental abstraction or route live pipeline through one storage contract.

### AGG-C3-21 — Multi-user admin is actually flat root-admin authorization
- **Severity / confidence:** MEDIUM / High
- **Status:** confirmed design/docs mismatch
- **Citations:** `README.md:37`; `CLAUDE.md:5`; `apps/web/src/db/schema.ts:106-111`; `apps/web/src/app/actions/auth.ts:52-54`; admin actions under `apps/web/src/app/actions/*` and `apps/web/src/app/[locale]/admin/db-actions.ts`
- **Suggested fix:** add roles/capabilities or clarify docs/product language to “multiple root admins”.

### AGG-C3-22 — Several update mutations ignore `affectedRows`
- **Severity / confidence:** MEDIUM / High
- **Status:** confirmed correctness issue
- **Citations:** `apps/web/src/app/actions/tags.ts:74-90`; `apps/web/src/app/actions/topics.ts:243-257`; `apps/web/src/app/actions/images.ts:625-650`
- **Problem:** pre-read + update can return success after a concurrent delete.
- **Suggested fix:** check update result and return not-found/concurrent-write before audit/revalidation.

### AGG-C3-23 — Photo-share creation can leak quota on a delete race
- **Severity / confidence:** LOW-MEDIUM / High
- **Status:** confirmed correctness issue
- **Citation:** `apps/web/src/app/actions/sharing.ts:141-163`
- **Suggested fix:** roll back share counters when refreshed image lookup fails after pre-increment.

### AGG-C3-24 — Public gallery DB outages collapse to a generic error shell
- **Severity / confidence:** MEDIUM / High
- **Status:** confirmed UX/resilience issue
- **Citations:** `apps/web/src/app/[locale]/(public)/page.tsx:113-130`; `apps/web/src/components/nav.tsx:6-13`; `apps/web/src/app/[locale]/error.tsx:7-35`
- **Suggested fix:** keep branded shell and render localized maintenance/empty state when public data fails.

### AGG-C3-25 — Search autocomplete ARIA is incomplete
- **Severity / confidence:** MEDIUM / High
- **Status:** likely accessibility issue
- **Citation:** `apps/web/src/components/search.tsx:169-247`
- **Suggested fix:** complete combobox/listbox semantics with `role=option` and `aria-selected`.

### AGG-C3-26 — Topic thumbnails can become image-only nav pills
- **Severity / confidence:** MEDIUM / High
- **Status:** risk UX issue
- **Citation:** `apps/web/src/components/nav-client.tsx:108-135`
- **Suggested fix:** keep labels visible with thumbnails.

### AGG-C3-27 — Admin navigation and dashboard are cramped on smaller viewports
- **Severity / confidence:** MEDIUM / High
- **Status:** confirmed UX issue
- **Citations:** `apps/web/src/components/admin-nav.tsx:26-44`; `apps/web/src/components/admin-header.tsx:13-24`; `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:30-39`; `apps/web/src/components/image-manager.tsx:335-471`
- **Suggested fix:** add mobile disclosure/wrap/scroll cues; stack dashboard panels longer.

### AGG-C3-28 — Upload UX lacks focus and no-topic empty states
- **Severity / confidence:** MEDIUM / High
- **Status:** confirmed accessibility/UX issue
- **Citations:** `apps/web/src/components/upload-dropzone.tsx:29-35,246-283,381-390`
- **Suggested fix:** add `focus-visible` affordance and disable/replace upload form when no topics exist.

### AGG-C3-29 — Loading/progress states are inconsistently announced
- **Severity / confidence:** LOW-MEDIUM / High
- **Status:** confirmed accessibility issue
- **Citations:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:16-18`; `apps/web/src/components/optimistic-image.tsx:70-79`; `apps/web/src/components/image-manager.tsx:380-384`
- **Suggested fix:** use shared localized `role=status` / `aria-live=polite` primitive.

### AGG-C3-30 — Shared dialog/sheet close labels are hardcoded English
- **Severity / confidence:** LOW / High
- **Status:** confirmed i18n issue
- **Citations:** `apps/web/src/components/ui/dialog.tsx:69-76`; `apps/web/src/components/ui/sheet.tsx:75-78`
- **Suggested fix:** pass localized close labels or wrap primitives at localized call sites.

### AGG-C3-31 — RTL support is explicitly not ready
- **Severity / confidence:** LOW / High
- **Status:** risk/future i18n debt
- **Citation:** `apps/web/src/app/[locale]/layout.tsx:79-84`
- **Suggested fix:** add locale direction map and use logical placement before adding RTL locales.

### AGG-C3-32 — Photo-viewer shortcuts are undiscoverable
- **Severity / confidence:** LOW-MEDIUM / High
- **Status:** confirmed UX issue
- **Citations:** `apps/web/src/components/photo-viewer.tsx:165-177`; `apps/web/src/components/lightbox.tsx:38-44,179-202`
- **Suggested fix:** add visible hints/tooltips and `aria-keyshortcuts`.

### AGG-C3-33 — Blur placeholder is a transparent no-op
- **Severity / confidence:** LOW / High
- **Status:** confirmed perceived-performance issue
- **Citation:** `apps/web/src/components/home-client.tsx:219-229`
- **Suggested fix:** generate/store real per-image low-res blur.

### AGG-C3-34 — Docker build-time env and runtime env drift
- **Severity / confidence:** HIGH / High
- **Status:** confirmed deployment correctness issue
- **Citations:** `apps/web/Dockerfile:21-44`; `apps/web/docker-compose.yml:13-17`; `apps/web/.dockerignore:1-8`; `apps/web/next.config.ts:1-96`
- **Problem:** `IMAGE_BASE_URL` and `UPLOAD_MAX_TOTAL_BYTES` are read at build time but only passed to runtime via `.env.local`.
- **Suggested fix:** add compose `build.args` and Docker `ARG`/`ENV` threading, or fail prebuild when build-time settings are missing.

### AGG-C3-35 — `GROUP_CONCAT` session initialization can race fresh pool queries
- **Severity / confidence:** MEDIUM / High
- **Status:** confirmed correctness issue
- **Citations:** `apps/web/src/db/index.ts:28-67`; `apps/web/src/lib/data.ts:398-417`; `apps/web/src/app/[locale]/admin/db-actions.ts:33-99`
- **Problem:** async pool `connection` hook may not finish before Drizzle/pool query paths use a fresh connection.
- **Failure scenario:** long tag lists silently truncate at MySQL default 1024 bytes.
- **Suggested fix:** await session bootstrap for all query paths or avoid `GROUP_CONCAT` dependence.

### AGG-C3-36 — Documentation mismatches image sizes and init secrets
- **Severity / confidence:** LOW / High
- **Status:** confirmed docs mismatch
- **Citations:** `CLAUDE.md:167-173`; `README.md:116-118`; `apps/web/src/lib/gallery-config-shared.ts:38-105`; `apps/web/scripts/init-db.ts:24-30`; `apps/web/scripts/migrate.js:511-521`; `apps/web/src/lib/session.ts:19-45`
- **Suggested fix:** document configurable image sizes and split init-time vs runtime secret requirements.

## Cross-agent agreement

- Proxy/forwarded-header risk: code-reviewer + security-reviewer.
- Upload quota: architect + critic.
- Restore scanner: code-reviewer + debugger (different bypass classes).
- Test gaps around sharing/restore/image processing: test-engineer + debugger/code-reviewer context.
- UI search behavior: test-engineer + designer.

## Review count

Deduped new findings this cycle: **36**.
