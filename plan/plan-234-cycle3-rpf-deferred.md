# Plan 234 — Cycle 3 review-plan-fix deferred findings

Status: active / deferred
Created: 2026-04-24
Source review: `.context/reviews/_aggregate.md`

## Repo-policy inputs consulted

- `CLAUDE.md`, `AGENTS.md`, `.context/**`, root `plan/**`.
- `.cursorrules`, `CONTRIBUTING.md`, and `docs/**` style/policy files are absent.
- Repo constraints that shape deferral: AGENTS.md requires small, reviewable, reversible diffs and no new dependencies; `.context/plans/README.md` and root `plan/cycle1-rpl-deferred.md` already carry forward broad CSP hardening, visual-regression, multi-instance runtime, and broad test-surface expansion as deferred items with explicit exit criteria.

## Deferred items

### D-C3RPF-01 — Streaming/chunked full CSV export memory profile [AGG-C3-02]
- **Citation:** `apps/web/src/app/[locale]/admin/db-actions.ts:51-93`.
- **Original severity / confidence:** MEDIUM / High.
- **Reason for deferral:** Performance/memory improvement requiring export transport redesign; not a correctness/security/data-loss bug in the current capped 50k-row export. Prior `.context/plans/README.md` carries D6-05 “streaming/paged CSV full export” as an existing deferred item.
- **Exit criterion:** Re-open when CSV export format/transport is redesigned or when production memory telemetry shows export pressure.

### D-C3RPF-02 — Nonce/hash CSP without `'unsafe-inline'` [AGG-C3-04]
- **Citation:** `apps/web/next.config.ts:63-84`.
- **Original severity / confidence:** MEDIUM / High.
- **Reason for deferral:** Security hardening is already explicitly deferred in `plan/cycle1-rpl-deferred.md` D1-01: “Removing `'unsafe-inline'` requires a broader nonce/hash strategy for inline/bootstrap behavior... repo rule in AGENTS.md is to keep diffs small and reversible.” This cycle keeps the preserved severity and does not downgrade it.
- **Exit criterion:** Re-open when CSP nonce/hash implementation is prioritized and can be tested against Next.js production hydration.

### D-C3RPF-03 — Direct sharing action coverage expansion [AGG-C3-10]
- **Citation:** `apps/web/src/app/actions/sharing.ts:92-388`.
- **Original severity / confidence:** HIGH / High.
- **Reason for deferral:** Test coverage gap, not a confirmed behavior bug; existing root `plan/cycle1-rpl-deferred.md` lists “remaining broader test-surface expansions” as carry-forward D6-14. This cycle implements the confirmed quota leak in C3RPF-10 first.
- **Exit criterion:** Re-open when expanding server-action unit coverage or changing sharing mutations.

### D-C3RPF-04 — Direct backup/restore server-action test suite [AGG-C3-11]
- **Citation:** `apps/web/src/app/[locale]/admin/db-actions.ts:33-470`.
- **Original severity / confidence:** HIGH / High.
- **Reason for deferral:** Test coverage gap; this cycle implements the confirmed restore scanner data-loss fix in C3RPF-02. Broader mocked orchestration tests remain D6-14 carry-forward from `plan/cycle1-rpl-deferred.md`.
- **Exit criterion:** Re-open when backup/restore action internals are changed or when adding admin server-action integration tests.

### D-C3RPF-05 — Core process-image direct file/Sharp tests [AGG-C3-12]
- **Citation:** `apps/web/src/lib/process-image.ts:170-459`.
- **Original severity / confidence:** HIGH / High.
- **Reason for deferral:** Test coverage gap requiring extensive Sharp/temp-file mocking; no confirmed runtime failure in this cycle. Bound to existing broad test-surface deferral D6-14.
- **Exit criterion:** Re-open when touching processing internals or adding image-pipeline test harnesses.

### D-C3RPF-06 — Topic image direct file tests [AGG-C3-13]
- **Citation:** `apps/web/src/lib/process-topic-image.ts:42-106`.
- **Original severity / confidence:** MEDIUM / High.
- **Reason for deferral:** Test coverage gap; not a confirmed runtime bug. Keep for next test-hardening pass.
- **Exit criterion:** Re-open when topic-image processing changes or temp-file cleanup incidents occur.

### D-C3RPF-07 — Search async/keyboard component tests [AGG-C3-14]
- **Citation:** `apps/web/src/components/search.tsx:52-93,169-247`.
- **Original severity / confidence:** MEDIUM / Medium.
- **Reason for deferral:** Test coverage gap; C3RPF-11 fixes the confirmed ARIA semantics first.
- **Exit criterion:** Re-open when search UI behavior changes or stale-response regressions appear.

### D-C3RPF-08 — OptimisticImage retry/fallback tests [AGG-C3-15]
- **Citation:** `apps/web/src/components/optimistic-image.tsx:18-53`.
- **Original severity / confidence:** MEDIUM / Medium.
- **Reason for deferral:** Test coverage gap; no confirmed current failure.
- **Exit criterion:** Re-open when `OptimisticImage` retry behavior is changed or flaky loading reports appear.

### D-C3RPF-09 — Asserted visual-nav regression baselines [AGG-C3-16]
- **Citation:** `apps/web/e2e/nav-visual-check.spec.ts:5-39`.
- **Original severity / confidence:** MEDIUM / High.
- **Reason for deferral:** Existing `.context/plans/README.md` carry-forward includes “D6-03 (asserted visual regression workflow)”; baseline image generation/review is a workflow decision and outside this code-fix patch.
- **Exit criterion:** Re-open when visual snapshot baselines are accepted into repo workflow.

### D-C3RPF-10 — Playwright stale-server and upload polling hardening [AGG-C3-17]
- **Citation:** `apps/web/playwright.config.ts:54-60`; `apps/web/e2e/admin.spec.ts:61-83`; `apps/web/e2e/helpers.ts:122-149`.
- **Original severity / confidence:** MEDIUM / Medium.
- **Reason for deferral:** Flake-risk/harness hardening; this environment's E2E gate is DB-dependent and must be handled without destabilizing local developer reuse semantics in the same broad patch.
- **Exit criterion:** Re-open when CI flake evidence appears or when e2e bootstrap policy is updated.

### D-C3RPF-11 — Persistent image-processing failure state machine [AGG-C3-18]
- **Citation:** `apps/web/src/db/schema.ts:16-66`; `apps/web/src/app/actions/images.ts:248-370`; `apps/web/src/lib/image-queue.ts:279-312`; `apps/web/src/components/image-manager.tsx:372-385`.
- **Original severity / confidence:** HIGH / High.
- **Reason for deferral:** Confirmed correctness/operability issue, but it requires schema migration, queue lifecycle migration, admin UI retry/delete states, and e2e coverage. Existing `.context/plans/README.md` carries broad queue/runtime/test expansions as deferred; AGENTS.md requires small reversible diffs, so this must be a dedicated migration plan rather than mixed into proxy/restore/UX fixes.
- **Exit criterion:** Re-open immediately for a dedicated schema-backed processing-state plan, or if any production uploads become stuck as `processed=false`.

### D-C3RPF-12 — Distributed restore/queue maintenance state [AGG-C3-19]
- **Citation:** `apps/web/src/lib/restore-maintenance.ts:1-55`; `apps/web/src/lib/image-queue.ts:110-128,453-482`; `apps/web/src/app/[locale]/admin/db-actions.ts:258-311`; `apps/web/docker-compose.yml:1-22`.
- **Original severity / confidence:** HIGH / High.
- **Reason for deferral:** Existing `.context/plans/README.md` carries “D6-13 (codify or redesign single-process runtime assumptions).” This cycle schedules C3RPF-08 to codify/support-boundary docs; shared-state implementation remains deferred until multi-instance support is a product goal.
- **Exit criterion:** Re-open before scaling above one web instance or co-locating multiple GalleryKit writers.

### D-C3RPF-13 — Unify/delete storage abstraction [AGG-C3-20]
- **Citation:** `apps/web/src/lib/storage/index.ts:1-128`; `apps/web/src/lib/process-image.ts:47-60,362-444`; `apps/web/src/lib/serve-upload.ts:32-103`; `apps/web/nginx/default.conf:89-106`.
- **Original severity / confidence:** MEDIUM / High.
- **Reason for deferral:** Architecture cleanup; `CLAUDE.md` already says storage backend is not integrated and C3RPF-08 reinforces docs. No new dependencies or abstractions should be introduced in this cycle.
- **Exit criterion:** Re-open when storage backends are actually wired or when deleting the abstraction is approved.

### D-C3RPF-14 — Gallery-specific public maintenance shell [AGG-C3-24]
- **Citation:** `apps/web/src/app/[locale]/(public)/page.tsx:113-130`; `apps/web/src/components/nav.tsx:6-13`; `apps/web/src/app/[locale]/error.tsx:7-35`.
- **Original severity / confidence:** MEDIUM / High.
- **Reason for deferral:** UX resilience improvement requiring error-boundary/data-fetch redesign; not a confirmed data-corruption/security bug.
- **Exit criterion:** Re-open during public shell/error-state redesign or if outage UX becomes a product priority.

### D-C3RPF-15 — Localized dialog/sheet primitive close labels [AGG-C3-30]
- **Citation:** `apps/web/src/components/ui/dialog.tsx:69-76`; `apps/web/src/components/ui/sheet.tsx:75-78`.
- **Original severity / confidence:** LOW / High.
- **Reason for deferral:** Low-severity i18n polish across shared primitives; no known regression.
- **Exit criterion:** Re-open when shared overlay primitives are next touched.

### D-C3RPF-16 — RTL direction support [AGG-C3-31]
- **Citation:** `apps/web/src/app/[locale]/layout.tsx:79-84`.
- **Original severity / confidence:** LOW / High.
- **Reason for deferral:** Future-locale readiness; current supported locales are English and Korean, both LTR.
- **Exit criterion:** Re-open before adding any RTL locale.

### D-C3RPF-17 — Real per-image blur placeholders [AGG-C3-33]
- **Citation:** `apps/web/src/components/home-client.tsx:219-229`.
- **Original severity / confidence:** LOW / High.
- **Reason for deferral:** Perceived-performance enhancement requiring ingest/schema/data-path work; not a correctness bug.
- **Exit criterion:** Re-open when image metadata schema or processing pipeline is changed.

## Deferred work policy reminder

Deferred work remains bound by repo policy when picked up: signed commits, gitmoji, no bypassing verification hooks, no force-push to protected branches, Node/TypeScript versions from `CLAUDE.md`, and no new dependencies without explicit approval.
