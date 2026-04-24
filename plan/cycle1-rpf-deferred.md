# Cycle 1 RPF — deferred / operational items

Source aggregate: `.context/reviews/_aggregate.md`.

Purpose: record every cycle-1 RPF finding not scheduled in `plan/cycle1-rpf-review-fixes.md`. Severity/confidence are preserved; no finding is silently dropped.

## Repo-policy basis for deferral

- `AGENTS.md`: “Keep diffs small, reviewable, and reversible”; “No new dependencies without explicit request.”
- `CLAUDE.md`: `.env.deploy` secrets must remain gitignored; deployment is Docker/SSH based; Node 24+ and TypeScript 6+.
- Existing `.context/**` and `plan/**`: prior cycles explicitly avoid destructive history rewrites / force-pushes in normal fix cycles and carry forward broad architecture or product decisions with preserved severity and exit criteria.

## Master disposition map

| Finding | Original severity / confidence | Disposition |
|---|---:|---|
| AGG1-01 | HIGH / High | Scheduled C1RPF-01 |
| AGG1-02 | MEDIUM / High | Scheduled C1RPF-01 |
| AGG1-03 | MEDIUM / High | Scheduled C1RPF-03 |
| AGG1-04 | LOW / Medium | Scheduled C1RPF-03 |
| AGG1-05 | LOW / Medium | Scheduled C1RPF-03 |
| AGG1-06 | MEDIUM / High | Scheduled C1RPF-02 |
| AGG1-07 | MEDIUM / High | Scheduled C1RPF-02 |
| AGG1-08 | MEDIUM / High | Scheduled C1RPF-03 |
| AGG1-09 | MEDIUM / High | Scheduled C1RPF-04 |
| AGG1-10 | LOW-MEDIUM / Medium | Scheduled C1RPF-04 |
| AGG1-11 | HIGH / Medium | Scheduled C1RPF-05 |
| AGG1-12 | HIGH / High | Scheduled C1RPF-05 |
| AGG1-13 | MEDIUM / High | Scheduled C1RPF-05 |
| AGG1-14 | HIGH / High | Scheduled C1RPF-05 |
| AGG1-15 | MEDIUM / High | Scheduled C1RPF-05 |
| AGG1-16 | HIGH / High | Scheduled C1RPF-05 |
| AGG1-17 | HIGH / High | Partially scheduled C1RPF-06; broader auth behavior expansion deferred D1-01 |
| AGG1-18 | HIGH / High | Deferred D1-02 |
| AGG1-19 | HIGH / High | Deferred D1-03 |
| AGG1-20 | MEDIUM / High | Partially scheduled C1RPF-06; broader expansion deferred D1-04 |
| AGG1-21 | MEDIUM / High | Scheduled C1RPF-07 |
| AGG1-22 | MEDIUM / High | Scheduled C1RPF-07 |
| AGG1-23 | LOW / Medium | Deferred D1-05 |
| AGG1-24 | MEDIUM / High | Scheduled C1RPF-08 |
| AGG1-25 | MEDIUM / High | Scheduled C1RPF-08 |
| AGG1-26 | LOW / High | Scheduled C1RPF-08 |
| AGG1-27 | LOW / Medium | Scheduled C1RPF-08 |
| AGG1-28 | MEDIUM / High | Scheduled C1RPF-09 |
| AGG1-29 | MEDIUM / High | Deferred D1-06 |
| AGG1-30 | MEDIUM / Medium | Deferred D1-07 |
| AGG1-31 | MEDIUM / High | Deferred D1-08 |
| AGG1-32 | MEDIUM / Medium | Deferred D1-09 |
| AGG1-33 | LOW / Medium | Covered by C1RPF-04 if retry query use remains |
| AGG1-34 | HIGH / High | Operationally closed OC1-01 |
| AGG1-35 | LOW / High | Deferred D1-10 |
| AGG1-36 | LOW / Medium | Scheduled C1RPF-10 |
| AGG1-37 | HIGH / High | Deferred D1-11 |
| AGG1-38 | MEDIUM / High | Deferred D1-12 |
| AGG1-39 | HIGH / High | Deferred D1-13 |
| AGG1-40 | MEDIUM / High | Deferred D1-14 |
| AGG1-41 | MEDIUM / Medium | Deferred D1-15 |
| AGG1-42 | MEDIUM / High | Deferred D1-16 |

## Deferred items

### D1-01 — Broader auth behavior tests beyond touched branches
- **Citation:** AGG1-17; `apps/web/src/app/actions/auth.ts`.
- **Original severity / confidence:** HIGH / High.
- **Reason:** This cycle schedules same-origin/logout posture and rollback branches directly touched by code fixes. A full auth behavior suite with mocked cookies/headers/Argon2/session invalidation is a larger testing project and would expand the diff beyond reviewable scope.
- **Exit criterion:** next auth-sensitive change or dedicated auth test-hardening cycle.

### D1-02 — Full settings-action behavior suite
- **Citation:** AGG1-18; `apps/web/src/app/actions/settings.ts:16-136`.
- **Original severity / confidence:** HIGH / High.
- **Reason:** Test coverage gap only; no concrete runtime bug was cited. The touched code this cycle does not modify settings behavior. Deferring avoids speculative tests not tied to a fix.
- **Exit criterion:** next settings action change or dedicated coverage cycle.

### D1-03 — Full sharing-action behavior suite
- **Citation:** AGG1-19; `apps/web/src/app/actions/sharing.ts:18-388`.
- **Original severity / confidence:** HIGH / High.
- **Reason:** Test coverage gap only; no concrete runtime bug was cited in this cycle. Existing prior cycles fixed sharing rollback paths; full coverage belongs in a dedicated test-hardening pass.
- **Exit criterion:** next sharing action change or dedicated coverage cycle.

### D1-04 — Broader admin-user behavior suite beyond over-limit rollback
- **Citation:** AGG1-20; `apps/web/src/app/actions/admin-users.ts`.
- **Original severity / confidence:** MEDIUM / High.
- **Reason:** This cycle schedules the confirmed DB rollback leak. Broader unauthorized/success/audit branches are useful but not required to fix the confirmed leak.
- **Exit criterion:** next admin-user action change or coverage pass.

### D1-05 — Manual load-more fallback
- **Citation:** AGG1-23; `apps/web/src/components/load-more.tsx:20-94`.
- **Original severity / confidence:** LOW / Medium.
- **Reason:** UX enhancement, not a confirmed broken path in the current tested browsers. Keep this separate from the blocking correctness/security gates.
- **Exit criterion:** user reports infinite-scroll stall, a11y testing requests explicit pagination, or next gallery UX pass.

### D1-06 — Global server-action body limit architecture
- **Citation:** AGG1-29; `apps/web/next.config.ts:100-106`, `apps/web/src/lib/upload-limits.ts`.
- **Original severity / confidence:** MEDIUM / High.
- **Reason:** Fix requires moving uploads to a dedicated route or product decision about global body caps. Changing the cap blindly risks breaking current upload behavior.
- **Exit criterion:** upload endpoint redesign or explicit body-limit policy decision.

### D1-07 — Queue startup replay/fan-out backpressure
- **Citation:** AGG1-30; `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`.
- **Original severity / confidence:** MEDIUM / Medium.
- **Reason:** Performance design requiring benchmarking and operational tuning. This cycle fixes correctness/security issues in the same queue without changing throughput semantics.
- **Exit criterion:** measured CPU/memory saturation, large backlog incidents, or dedicated perf plan.

### D1-08 — Public nav/search bundle split
- **Citation:** AGG1-31; public layout/nav/search files.
- **Original severity / confidence:** MEDIUM / High.
- **Reason:** Bundle optimization needs before/after bundle analysis and route-splitting design. Not a correctness/security blocker.
- **Exit criterion:** mobile TTI budget violation or dedicated bundle-size pass.

### D1-09 — Photo viewer route bundle split
- **Citation:** AGG1-32; photo/share route and viewer files.
- **Original severity / confidence:** MEDIUM / Medium.
- **Reason:** Broader UX/performance architecture; defer to bundle pass.
- **Exit criterion:** measured route payload issue or viewer refactor plan.

### D1-10 — CSP `unsafe-inline` hardening
- **Citation:** AGG1-35; `apps/web/next.config.ts` CSP.
- **Original severity / confidence:** LOW / High.
- **Reason:** Requires nonce/hash strategy and framework integration. Prior cycles already carry this as a security hardening item; no active XSS bug was found.
- **Exit criterion:** dedicated CSP nonce/hash implementation plan.

### D1-11 — Durable multi-process restore maintenance state
- **Citation:** AGG1-37; `apps/web/src/lib/restore-maintenance.ts`, restore actions, health route.
- **Original severity / confidence:** HIGH / High.
- **Reason:** Requires schema/infra design and multi-instance deployment assumptions. This repo currently documents a host-network Docker deployment; changing the maintenance coordinator is broad and not a safe incidental patch.
- **Exit criterion:** deployment moves to multi-replica/multi-process, or a schema-backed maintenance plan is approved.

### D1-12 — Durable shared-group view counts
- **Citation:** AGG1-38; `apps/web/src/lib/data.ts:11-108,660-664`.
- **Original severity / confidence:** MEDIUM / High.
- **Reason:** Product/ops decision: view counts are analytics-like, not critical writes. Durable queue/table design needs separate migration and backpressure policy.
- **Exit criterion:** analytics accuracy becomes product-critical or loss is observed.

### D1-13 — Split migration/init from container startup
- **Citation:** AGG1-39; `apps/web/Dockerfile`, `apps/web/scripts/migrate.js`.
- **Original severity / confidence:** HIGH / High.
- **Reason:** Deployment lifecycle change with operational risk. Current deployment checklist expects automatic startup migrations. Needs explicit deploy redesign.
- **Exit criterion:** adoption of one-off migration jobs or multi-replica deploy architecture.

### D1-14 — Complete or remove unused storage abstraction boundary
- **Citation:** AGG1-40; `apps/web/src/lib/storage/*`, upload/process/serve paths.
- **Original severity / confidence:** MEDIUM / High.
- **Reason:** Large storage architecture refactor. This cycle only fixes the concrete empty-key safety issue.
- **Exit criterion:** S3/MinIO backend work resumes or storage abstraction becomes active runtime boundary.

### D1-15 — Config ownership split
- **Citation:** AGG1-41; SEO/footer/nav/robots/sitemap config call sites.
- **Original severity / confidence:** MEDIUM / Medium.
- **Reason:** Product configuration-domain decision, not a localized bug.
- **Exit criterion:** admin-editable config is expanded or public config inconsistency is reported.

### D1-16 — Service extraction and gallery query redesign
- **Citation:** AGG1-42; large server actions and `apps/web/src/lib/data.ts` list query hot paths.
- **Original severity / confidence:** MEDIUM / High.
- **Reason:** Broad architecture/performance refactor crossing many files. Requires benchmarks and API/service boundary design.
- **Exit criterion:** measured query latency/coupling incidents or dedicated architecture pass.

## Operationally closed

### OC1-01 — Historical real secret / weak examples in git history
- **Citation:** AGG1-34; git history only, current tree scan found no active tracked secrets.
- **Original severity / confidence:** HIGH / High.
- **Reason:** Current tracked files already use placeholders/rotation warnings. Removing history requires destructive rewrite/force-push, which existing project practice avoids for normal fix cycles and would disrupt collaborators. Operators must rotate any secret ever copied from history.
- **Exit criterion:** explicit security incident response authorizes history rewrite and coordinated force-push, or current HEAD regresses by adding real secrets again.

### D1-17 — Next.js edge-runtime static-generation build warning
- **Citation:** `npm run build --workspaces` and `npm run test:e2e --workspace=apps/web` webServer build output: “Using edge runtime on a page currently disables static generation for that page”.
- **Original severity / confidence:** LOW gate warning / High.
- **Reason:** The warning is emitted by the framework for the current edge-runtime/middleware posture; fixing it cleanly requires an architectural decision about static generation versus edge request handling, not a localized correctness patch. The build exits successfully and all runtime E2E checks pass.
- **Exit criterion:** a dedicated rendering/static-generation plan is approved, or the warning becomes an error in the Next.js build gate.

## Cycle 1 implementation status

Scheduled findings AGG1-01 through AGG1-16, AGG1-21, AGG1-22, AGG1-24 through AGG1-28, AGG1-33, and AGG1-36 were implemented in `plan/done/cycle1-rpf-review-fixes.md`. Deferred review findings remain open with original severity/confidence preserved.
