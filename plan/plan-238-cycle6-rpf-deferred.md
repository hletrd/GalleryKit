# Plan 238 — Cycle 6 RPF deferred findings

Status: active
Created: 2026-04-25
Source aggregate: `.context/reviews/_aggregate.md`

This file records every Cycle 6 aggregate finding not scheduled in `plan/plan-237-cycle6-rpf-fixes.md`. Severity and confidence are preserved; no finding is silently dropped.

## Repo-policy basis for deferral
- `AGENTS.md`: “Keep diffs small, reviewable, and reversible”; “No new dependencies without explicit request.”
- `CLAUDE.md`: “Node.js 24+ required, TypeScript 6.0+” and the tech stack is “Next.js 16.2”; this blocks applying `npm audit`'s incompatible Next 9 downgrade suggestion.
- `CLAUDE.md`: “If you ever seeded an environment from older checked-in examples, rotate both `SESSION_SECRET` and any bootstrap/admin credentials immediately. Historical git values must be treated as compromised and must not be reused.” This treats historical secret exposure as an operational rotation requirement; rewriting git history is destructive and outside a normal code-fix cycle.
- `CLAUDE.md`: “The shipped Docker Compose deployment is a single web-instance / single-writer topology” and “Admin accounts are multiple root admins. The current schema has no role/capability model.” These explicitly document current architecture constraints.
- `CLAUDE.md`: “Storage Backend (Not Yet Integrated): The `@/lib/storage` module still exists as an internal abstraction, but the product currently supports local filesystem storage only.”
- Deferred work remains bound by repo policy when picked up: signed gitmoji commits, no force-push/destructive history edits without explicit authority, Node 24+/TypeScript 6+/Next 16 compatibility, and all configured gates.

## Deferred items

### D-C6RPF-01 — Historical committed credential material remains in git history
- **Citation:** AGG-C6-03; historical git entries for `apps/web/.env.local.example`.
- **Original severity/confidence:** Medium / High.
- **Reason for deferral:** Current-head examples are placeholders and `CLAUDE.md` explicitly instructs operators to rotate any values seeded from older checked-in examples. Rewriting git history is destructive/materially branching and requires explicit repository security process approval.
- **Exit criterion:** Re-open when the repo owner approves a history rewrite/security-notice process or current-head docs stop warning about historic values.

### D-C6RPF-02 — Transitive PostCSS advisory through Next.js dependency graph
- **Citation:** AGG-C6-04; `package-lock.json` dependency graph (`next` / `next-intl` / nested `postcss`).
- **Original severity/confidence:** Low / Medium.
- **Reason for deferral:** `npm audit --omit=dev` suggests downgrading `next` to `9.3.3`, which violates `CLAUDE.md`'s Next.js 16.2 / Node 24+ stack. No reachable attacker-controlled CSS stringify path was identified.
- **Exit criterion:** Re-open when a compatible Next.js/next-intl release resolves the nested PostCSS advisory or a reachable CSS stringify path is found.

### D-C6RPF-03 — Admin DB backup/restore action test expansion
- **Citation:** AGG-C6-08; `apps/web/src/app/[locale]/admin/db-actions.ts:33-470`.
- **Original severity/confidence:** High / High.
- **Reason for deferral:** Test coverage expansion, not a confirmed runtime defect this cycle. The current cycle schedules direct security/correctness fixes first to keep diffs small and reviewable.
- **Exit criterion:** Re-open when `db-actions.ts` behavior changes next or a dedicated backup/restore test-hardening cycle is scheduled.

### D-C6RPF-04 — Share-link action regression suite
- **Citation:** AGG-C6-09; `apps/web/src/app/actions/sharing.ts:21-389`.
- **Original severity/confidence:** High / High.
- **Reason for deferral:** Test coverage expansion only; no concrete current runtime defect was cited. Existing action logic remains unchanged in this cycle.
- **Exit criterion:** Re-open when sharing actions are next modified or a dedicated share-link test suite is scheduled.

### D-C6RPF-05 — Middleware/instrumentation direct tests
- **Citation:** AGG-C6-10; `apps/web/src/proxy.ts:13-103`, `apps/web/src/instrumentation.ts:1-37`.
- **Original severity/confidence:** High / High.
- **Reason for deferral:** Test coverage expansion only. The scanner/gate bypass that directly affects security is scheduled in C6RPF-09.
- **Exit criterion:** Re-open when proxy/instrumentation behavior changes or middleware/CSP integration tests are planned.

### D-C6RPF-06 — Visual screenshot assertions
- **Citation:** AGG-C6-12; `apps/web/e2e/nav-visual-check.spec.ts:4-40`.
- **Original severity/confidence:** Medium / High.
- **Reason for deferral:** Requires deciding a committed screenshot-baseline policy and stabilizing masks; not a current runtime bug.
- **Exit criterion:** Re-open when the repo adopts visual-regression baselines or the nav visual spec is next touched.

### D-C6RPF-07 — Real Sharp/image-processing integration tests
- **Citation:** AGG-C6-13; `apps/web/src/lib/process-image.ts:224-589`, `apps/web/src/lib/process-topic-image.ts:42-106`.
- **Original severity/confidence:** Medium / High.
- **Reason for deferral:** Fixture-backed integration coverage expansion; no current image-processing regression was reported.
- **Exit criterion:** Re-open when image processing code changes or a fixture-based media test lane is added.

### D-C6RPF-08 — Discoverability/metadata route coverage expansion
- **Citation:** AGG-C6-14; `apps/web/src/app/api/og/route.tsx`, `sitemap.ts`, `robots.ts`, `manifest.ts`, icon routes, `global-error.tsx`, `vitest.config.ts`.
- **Original severity/confidence:** Medium / High.
- **Reason for deferral:** Broad test coverage expansion. The confirmed inert `seo_locale` and stale caching docs are scheduled in the fix plan.
- **Exit criterion:** Re-open when metadata/discoverability routes are next modified or jsdom/route-level coverage is introduced.

### D-C6RPF-09 — Schema authority split between migrations and runtime reconciler
- **Citation:** AGG-C6-20; `apps/web/drizzle/**`, `apps/web/scripts/migrate.js:244-494`, `apps/web/scripts/init-db.ts:24-31`.
- **Original severity/confidence:** High / High.
- **Reason for deferral:** Architecture migration/upgrade-path redesign that could affect existing installations. Per `AGENTS.md`, keep this cycle's diffs small and reversible.
- **Exit criterion:** Re-open when migration strategy is explicitly prioritized or schema drift is observed.

### D-C6RPF-10 — Admin role/capability model
- **Citation:** AGG-C6-21; `README.md:37`, `CLAUDE.md:5,158-159`, `apps/web/src/db/schema.ts:106-111`, admin nav/actions.
- **Original severity/confidence:** High / High.
- **Reason for deferral:** `CLAUDE.md` explicitly documents the current model as multiple root admins with no role/capability separation. Implementing roles is a product/schema migration, not a narrow bug fix.
- **Exit criterion:** Re-open before adding more privileged admin features or when the product trust model changes.

### D-C6RPF-11 — Process-local coordination / single-writer topology
- **Citation:** AGG-C6-22; `README.md:146`, `CLAUDE.md:158`, restore/upload/view-count/queue state files.
- **Original severity/confidence:** Medium / High.
- **Reason for deferral:** `CLAUDE.md` explicitly says the shipped topology is single web-instance / single-writer and warns not to horizontally scale until coordination moves to shared storage.
- **Exit criterion:** Re-open before any multi-instance/rolling deployment support is introduced.

### D-C6RPF-12 — Configuration ownership fragmentation
- **Citation:** AGG-C6-23; `README.md:41-58`, `apps/web/src/lib/data.ts:870-891`, layout/footer/constants/admin_settings.
- **Original severity/confidence:** Medium / High.
- **Reason for deferral:** Broad configuration-domain redesign; this cycle schedules the concrete false-control `seo_locale` fix only.
- **Exit criterion:** Re-open when config schema/ownership is intentionally redesigned.

### D-C6RPF-13 — Storage abstraction not wired into live storage architecture
- **Citation:** AGG-C6-24; `apps/web/src/lib/storage/index.ts:4-12`, direct filesystem call sites, `CLAUDE.md:99`, stale storage messages.
- **Original severity/confidence:** Medium / High.
- **Reason for deferral:** `CLAUDE.md` explicitly states storage switching is not supported; deleting or fully integrating the abstraction is a separate architecture cleanup/product decision.
- **Exit criterion:** Re-open when storage backend work resumes or a dead-code cleanup pass targets storage.

### D-C6RPF-14 — RTL support beyond current LTR locales
- **Citation:** AGG-C6-28; `apps/web/src/app/[locale]/layout.tsx:83-88`, `apps/web/src/lib/constants.ts:1-4`.
- **Original severity/confidence:** Low / Medium.
- **Reason for deferral:** Current supported locales (`en`, `ko`) are LTR. This is a future-locale readiness gap, not a current shipped-locale bug.
- **Exit criterion:** Re-open before adding any RTL locale.
