# Cycle 96 Verifier Report

## Inventory reviewed

- Repo rules: `AGENTS.md:5-19`, `AGENTS.md:29-45`; `CLAUDE.md:189-232`, `CLAUDE.md:257-308`, `CLAUDE.md:596-638`, `CLAUDE.md:659-680`.
- Current release ledgers: `.context/plans/README.md:5-13`, `.context/plans/cycle-95-2026-07-01-plan.md:35-56`, `.context/reviews/_aggregate.md:3-29`.
- Cycle 95 artifacts: all files under `.context/reviews/cycle-95-2026-07-01/`, plus `.context/plans/cycle-95-2026-07-01-deferred.md:18-74`.
- Source/test claims checked: LR token actions/client/tests, LR upload route/source-contracts, admin nav/e2e, zoom/lightbox, admin dashboard/image manager, restore-maintenance writers, semantic embeddings schema/query/write path, listing count query/tests.
- Git state: clean worktree; `HEAD == origin/master == 2f22620c361304ba0408053f546f45e3c74ddfdb`. No app source changed since Cycle 95 target `750729a`.

## Confirmed findings

### C96-01 — Cycle 95 terminal ledger is stale after current pushed HEAD

- Severity: Medium
- Confidence: High
- Problem: Current `HEAD`/`origin/master` is `2f22620c361304ba0408053f546f45e3c74ddfdb`, but the committed release ledgers only record Cycle 95 as committed/pushed/deployed at parent commit `2178046587484fb301bc731f855699e44888d2e6`.
- Evidence:
  - `.context/plans/README.md:7`
  - `.context/plans/cycle-95-2026-07-01-plan.md:56`
  - `.context/reviews/_aggregate.md:29`
  - `grep` found no committed `.context` reference to `2f22620`.
- Failure scenario: A future cycle reads committed ledgers and cannot prove whether the final Cycle 95 ledger-closing commit itself was pushed/deployed/smoked, repeating the same terminal-evidence churn that Cycle 95 fixed for Cycle 94.
- Suggested fix: Update Cycle 95 plan/index/latest aggregate to record `2f22620...` as the terminal docs sync, including pull-rebase/push/deploy/smoke evidence or an explicit deploy gap.

## Confirmed carry-forward findings still valid

| ID | Severity / confidence | Evidence | Problem / failure scenario | Suggested fix |
|---|---:|---|---|---|
| C94-04 / C93-05 | Medium / High | LR route branches at `apps/web/src/app/api/admin/lr/upload/route.ts:84-127`, `178-199`, `396-423`, `434-440`, `500-509`, `583-586`; existing test admits source-contract-only coverage at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:7-15`. | Multipart PAT upload has many auth/status/cleanup outcomes but no route-level behavior harness. A regression can pass source-string tests while returning wrong statuses or leaking cleanup failures. | Add mocked multipart route-level tests for auth/scope, maintenance `503`, content-length limits, parsed file too large, success shape, and post-save cleanup failure. |
| C94-05 / C93-06 | Medium / High | Admin nav has ten links at `apps/web/src/components/admin-nav.tsx:15-25`; Playwright nav covers only categories/tags/users/password/db at `apps/web/e2e/admin.spec.ts:20-42`, plus settings toggle at `apps/web/e2e/admin.spec.ts:73-80`; metadata source contracts at `apps/web/src/__tests__/client-source-contracts.test.ts:57-68` are not browser navigation. | SEO, tokens, analytics, and first-class page landmarks can break without E2E detection. | Extend admin E2E to visit every `AdminNav` destination and assert one stable page-specific landmark/control. |
| C94-06 / C93-09 | Medium / High | Zoom keyboard toggles only Enter/Space at `apps/web/src/components/image-zoom.tsx:201-208`, `362-365`; Escape reset only at `apps/web/src/components/image-zoom.tsx:328-337`; lightbox arrows navigate slides at `apps/web/src/components/lightbox.tsx:340-343`. | Keyboard users can enter zoom but cannot pan; arrow-key pan design conflicts with lightbox navigation. | Design/implement keyboard panning while zoomed, suppress slide navigation during active pan mode, and add focused a11y tests. |
| C94-07 / C93-10 | Medium / High | Header wraps nav at `apps/web/src/components/admin-header.tsx:13-24`; nav renders ten inline wrapping links at `apps/web/src/components/admin-nav.tsx:15-29`. | Mobile admin remains a long wrapped link header, increasing navigation friction and focus/scan cost. | Replace with compact accessible mobile nav pattern with `aria-current`, focus restoration, and responsive evidence. |
| C94-08 / C93-11 | Medium / High | Dashboard embeds `ImageManager` in overflow container at `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-144`; `ImageManager` is a table-first layout at `apps/web/src/components/image-manager.tsx:424-551`. | Mobile image management depends on horizontal table scrolling rather than a mobile-appropriate card/list flow. | Add responsive admin image-management layout and verify labels/actions/44px targets. |
| C94-09 / C77-ARCH-01 | High / High | Restore begins maintenance at `apps/web/src/app/[locale]/admin/db-actions.ts:449-453`; foreground actions precheck once before later writes, e.g. settings `apps/web/src/app/actions/settings.ts:41-47`, writes at `163-175`; tags `apps/web/src/app/actions/tags.ts:42-49`, writes at `83-95`; sharing `apps/web/src/app/actions/sharing.ts:91-99`, writes at `145-156`. | A mutation that passes the early precheck can still write after restore maintenance begins. | Add shared foreground admin-write barrier/recheck around application-table writers with representative race tests. |
| C94-10 / C88-03 | Medium / High | Embeddings primary key is image-only at `apps/web/drizzle/0012_image_embeddings.sql:5-11` and `apps/web/src/db/schema.ts:284-290`; queue overwrites via `onDuplicateKeyUpdate` at `apps/web/src/lib/image-queue.ts:379-389`; routes filter one model version at `apps/web/src/app/api/search/semantic/route.ts:270-279` and `apps/web/src/app/api/search/similar/[id]/route.ts:135-144`. | New model embeddings overwrite prior rows, preventing staged rollout/rollback across model versions. | Migrate to `(image_id, model_version)` storage and update Drizzle/reconcile/backfill/search tests. |
| C94-11 | Medium / High | Public listing queries use `COUNT(*) OVER()` with grouped tag joins at `apps/web/src/lib/data.ts:911-926` and `1495-1510`; UI consumes exact count at `apps/web/src/components/home-client.tsx:267-269`; test locks the window function at `apps/web/src/__tests__/data-tag-names-sql.test.ts:107-116`. | First-page listing can force expensive exact counts through grouped joins. | Decide product count policy, remove/replace exact grouped count where acceptable, and update source-contract tests. |

## Likely issues

None newly identified beyond the confirmed current ledger issue and the confirmed carry-forward register above.

## Manual-validation risks

- Live production deployment/smoke for `2f22620` is not proven by committed ledgers; this is the core C96-01 evidence gap.
- Build/test gates were not re-run because this was a review-only/no-write task; committed Cycle 95 evidence claims full gates passed at `.context/plans/cycle-95-2026-07-01-plan.md:48-56`.
- GPG trust verification could not be completed in this sandbox; `git cat-file -p HEAD` shows a `gpgsig`, but local keybox access failed.

## Missed-issue sweep / coverage statement

- Checked all files changed since Cycle 95 target `750729a`; there were no app source changes, only `.context` artifacts and `.gitignore`.
- Checked all Cycle 95 confirmed and carry-forward claims; no subset-only sampling.
- Searched latest ledgers for active/incomplete markers; none besides the missing `2f22620` terminal evidence.
- Searched for Cycle 96 artifacts; none existed at review time.
- Worktree remained clean; no files modified.