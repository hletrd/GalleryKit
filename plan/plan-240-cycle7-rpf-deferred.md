# Plan 240 — Cycle 7 RPF deferred / operational findings
Status: active-deferred

Purpose: record every Cycle 7 RPF review finding not scheduled for implementation in `plan/plan-239-cycle7-rpf-fixes.md`. Severity/confidence are preserved; no finding is silently dropped.

## Repo-policy basis for deferral

- `AGENTS.md`: “Keep diffs small, reviewable, and reversible”; “No new dependencies without explicit request.”
- `CLAUDE.md`: the shipped topology is explicitly “single web-instance / single-writer”; storage backend is not integrated and local filesystem is the only supported production backend; historical example values must be treated as compromised and rotated.
- Existing `.context/**` and `plan/**`: prior cycles already carry forward distributed coordination, storage-abstraction migration, broad coverage expansion, and historical secret-history rewrite as large operational/product decisions with preserved severity and exit criteria.
- Deferred work remains bound by repo policy when reopened: signed commits, gitmoji/conventional messages, no `--no-verify`, no force-push, Node 24+ / TypeScript 6+.

## Deferred items

### D-C7RPF-01 — Convert visual screenshot captures into asserted visual baselines
- **Finding:** AGG-C7RPF-11.
- **Citation:** `apps/web/e2e/nav-visual-check.spec.ts:5-40`.
- **Original severity / confidence:** HIGH / HIGH.
- **Reason for deferral:** test-infrastructure expansion requiring stable screenshot baselines and review of binary artifacts across local/CI rendering. Repo rule (`AGENTS.md`) requires small, reviewable diffs; this cycle prioritizes direct security/correctness issues and public-action contract fixes.
- **Exit criterion:** next UI visual-regression pass, CI baseline policy adoption, or any nav visual regression report.

### D-C7RPF-02 — Replace broad source-text regression tests with behavioral tests
- **Finding:** AGG-C7RPF-12.
- **Citation:** `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts:19-139`; `auth-rethrow.test.ts:16-52`; `client-source-contracts.test.ts:9-35`; `settings-image-sizes-lock.test.ts:10-22`; `db-pool-connection-handler.test.ts:22-67`; `images-delete-revalidation.test.ts:10-24`.
- **Original severity / confidence:** HIGH / HIGH.
- **Reason for deferral:** broad test-hardening project spanning multiple domains. No single runtime defect is cited; changing many test harnesses in the same patch would violate the repo’s small/reviewable diff rule.
- **Exit criterion:** dedicated test-hardening cycle or next modification to one of the protected flows.

### D-C7RPF-03 — Add direct behavioral tests for auth actions
- **Finding:** AGG-C7RPF-13.
- **Citation:** `apps/web/src/app/actions/auth.ts:70-267,270-428`.
- **Original severity / confidence:** HIGH / HIGH.
- **Reason for deferral:** security-critical coverage gap, but not a newly found auth bypass. Building stable mocks for Next cookies/headers, DB, Argon2, redirects, audit, and rate-limit helpers is a dedicated auth test project. Direct security/correctness findings in this cycle are scheduled in Plan 239.
- **Repo rule quoted for deferral:** `AGENTS.md` — “Keep diffs small, reviewable, and reversible.”
- **Exit criterion:** next auth-sensitive code change, dedicated auth test-hardening cycle, or escaped auth regression.

### D-C7RPF-04 — Add direct behavioral tests for sharing/settings mutations
- **Finding:** AGG-C7RPF-14.
- **Citation:** `apps/web/src/app/actions/sharing.ts:92-187,189-260+`; `apps/web/src/app/actions/settings.ts:39-163`; `apps/web/src/__tests__/settings-image-sizes-lock.test.ts:10-22`.
- **Original severity / confidence:** HIGH / HIGH.
- **Reason for deferral:** broad coverage investment rather than a confirmed runtime bug; Plan 239 covers direct contract/security findings first.
- **Repo rule quoted for deferral:** `AGENTS.md` — “Keep diffs small, reviewable, and reversible.”
- **Exit criterion:** next sharing/settings action change, dedicated behavior-test pass, or escaped mutation/regression incident.

### D-C7RPF-05 — Add coverage thresholds / unified verify script
- **Finding:** AGG-C7RPF-16.
- **Citation:** `apps/web/vitest.config.ts:4-12`; `apps/web/package.json:8-22`.
- **Original severity / confidence:** MEDIUM / HIGH.
- **Reason for deferral:** introducing coverage thresholds can require dependency/config work and an agreed coverage budget; no current gate failure is cited.
- **Exit criterion:** CI policy adopts a coverage budget or coverage erosion is observed in high-risk directories.

### D-C7RPF-06 — Enforce or externalize singleton runtime coordination
- **Finding:** AGG-C7RPF-17.
- **Citation:** `apps/web/src/lib/restore-maintenance.ts:1-55`; `apps/web/src/app/[locale]/admin/db-actions.ts:271-311`; `apps/web/src/lib/image-queue.ts:67-132,382-489`; `apps/web/src/lib/upload-tracker-state.ts:7-21,52-61`; `apps/web/src/app/actions/settings.ts:74-78`; `apps/web/src/app/api/health/route.ts:7-16`; `README.md:145-146`.
- **Original severity / confidence:** HIGH / HIGH.
- **Reason for deferral:** data-loss/correctness architecture risk, but current repo policy and docs explicitly define a single web-instance / single-writer deployment. Implementing real enforcement/shared coordination requires a larger migration (DB/Redis lease, queue ownership, upload claims) and is already a carried-forward architecture decision.
- **Repo rule quoted for deferral:** `CLAUDE.md` Runtime topology — “The shipped Docker Compose deployment is a single web-instance / single-writer topology. Restore maintenance flags, upload quota tracking, and image queue state are process-local; do not horizontally scale the web service unless those coordination states are moved to a shared store.”
- **Exit criterion:** any deployment target adds multiple web replicas, worker split, load-balancer topology, or product requirement for horizontal scaling.

### D-C7RPF-07 — Delete/quarantine or finish storage backend abstraction
- **Finding:** AGG-C7RPF-18.
- **Citation:** `apps/web/src/lib/storage/index.ts:4-12`; `apps/web/src/lib/storage/types.ts:4-15`; `apps/web/src/app/actions/images.ts:7-8,202-245,301-316`; `apps/web/src/lib/process-image.ts:12,45-60,224-253`; `apps/web/src/lib/image-queue.ts:236-285`; `apps/web/src/lib/serve-upload.ts:6,32-115`.
- **Original severity / confidence:** MEDIUM / HIGH.
- **Reason for deferral:** architecture/product scope. CLAUDE explicitly says local filesystem is the only supported product backend and the storage abstraction is not integrated end-to-end.
- **Repo rule quoted for deferral:** `CLAUDE.md` Key Files & Patterns — “Storage Backend (Not Yet Integrated): The `@/lib/storage` module still exists as an internal abstraction, but the product currently supports local filesystem storage only. Do not document or expose S3/MinIO switching as a supported admin feature until the upload/processing/serving pipeline is wired end-to-end.”
- **Exit criterion:** object storage support becomes a product goal, or a live runtime path starts depending on `getStorage()` for uploads/serving.

### D-C7RPF-08 — Historical example secrets in git history
- **Finding:** AGG-C7RPF-21.
- **Citation:** historical commit `d7c3279:apps/web/.env.local.example`; warnings in `README.md`, `CLAUDE.md`, `apps/web/.env.local.example`.
- **Original severity / confidence:** MEDIUM / HIGH.
- **Reason for deferral / operational closure:** current HEAD contains placeholders and explicit rotation warnings. Rewriting published git history or issuing an operator rotation campaign is a destructive operational decision outside a normal code-fix cycle.
- **Repo rule quoted for deferral:** `CLAUDE.md` Environment Variables — “If you ever seeded an environment from older checked-in examples, rotate both `SESSION_SECRET` and any bootstrap/admin credentials immediately. Historical git values must be treated as compromised and must not be reused.”
- **Exit criterion:** repo owner approves a coordinated history rewrite/security notice process, or current-head docs regress and stop warning operators.


### D-C7RPF-09 — Nested PostCSS advisory remains blocked by upstream Next dependency
- **Finding:** AGG-C7RPF-10.
- **Citation:** `package.json:7-10`; `apps/web/package.json:45-66`; `package-lock.json` entries for `node_modules/next/node_modules/postcss`.
- **Original severity / confidence:** MEDIUM / HIGH.
- **Reason for deferral:** security dependency risk, but no compatible Next 16 release currently removes the vulnerable nested PostCSS copy. Verified on 2026-04-25: `npm view next version` returned `16.2.4` and `npm view next@latest dependencies.postcss` returned `8.4.31`; `npm view next@canary version dependencies.postcss --json` returned `16.3.0-canary.2` with `postcss` `8.4.31`. `npm audit fix --force` suggests downgrading `next` to `9.3.3`, which violates the repo's documented Next.js 16 App Router baseline in `CLAUDE.md` and would be a breaking framework migration rather than a security patch.
- **Repo rule quoted for deferral:** `CLAUDE.md` Tech Stack — “Framework: Next.js 16.2 (App Router, React 19, TypeScript 6)”; `AGENTS.md` — “No new dependencies without explicit request” and “Keep diffs small, reviewable, and reversible.”
- **Exit criterion:** a compatible Next 16 release or documented npm override path removes/patches the nested PostCSS subtree without downgrading the framework; re-run `npm audit --omit=dev` and close when clean.
