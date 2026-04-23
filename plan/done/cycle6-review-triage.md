# Cycle 6 review triage / deferred items

Source aggregate: `.context/reviews/_aggregate.md`
Raw reviews consulted: `.context/reviews/{code-reviewer,security-reviewer,critic,verifier,test-engineer,architect,debugger,designer}.md`
Purpose: capture every cycle-6 review finding that is **not** being fully implemented in `plan/cycle6-review-fixes.md`, plus map scheduled items so nothing is silently dropped.

## Repo-policy inputs consulted
- `CLAUDE.md`
- `AGENTS.md`
- `.context/reviews/_aggregate.md`
- `.context/reviews/available-agents-cycle6.txt`
- `.context/plans/README.md`
- `.cursorrules` *(missing)*
- `CONTRIBUTING.md` *(missing)*
- `docs/` policy/style files *(none present)*

## Master disposition map

| Finding | Citation | Original severity / confidence | Disposition |
| --- | --- | --- | --- |
| AGG6-02 | `apps/web/src/lib/request-origin.ts:62-80`, `apps/web/src/app/actions/auth.ts:92-95,274-277` | MEDIUM / MEDIUM | **Scheduled** in `plan/cycle6-review-fixes.md` as `C6R-01` |
| DBG6-03 | `apps/web/src/app/actions/auth.ts:342-387`, `apps/web/src/lib/auth-rate-limit.ts:66-84` | MEDIUM / HIGH | **Scheduled** in `C6R-01` |
| AGG6-03 | `apps/web/src/components/image-manager.tsx:226-243`, `apps/web/src/app/actions/images.ts:546-599` | MEDIUM / HIGH | **Scheduled** in `C6R-02` |
| AGG6-13 | `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:39-56`, `apps/web/src/app/actions/seo.ts:65-127` | LOW / HIGH | **Scheduled** in `C6R-02` |
| designer finding 3 | `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:22-172` | MEDIUM / MEDIUM | **Scheduled** for explicit validation coverage in `C6R-04` |
| AGG6-04 | `apps/web/src/app/[locale]/admin/layout.tsx:1-16`, `apps/web/src/components/admin-header.tsx:1-24`, `apps/web/src/components/admin-nav.tsx:1-33` | MEDIUM / HIGH | **Scheduled** in `C6R-03` |
| AGG6-06 | `apps/web/e2e/admin.spec.ts:6-7`, `apps/web/package.json:18` | MEDIUM / HIGH | **Scheduled** in `C6R-04` |
| AGG6-09 | `apps/web/scripts/seed-e2e.ts:57-90` | MEDIUM / HIGH | **Scheduled** in `C6R-05` |
| AGG6-12 | `apps/web/src/db/seed.ts:4-10` | LOW / HIGH | **Scheduled** in `C6R-06` |
| AGG6-01 | `apps/web/src/app/actions/public.ts:9-28`, `apps/web/src/lib/data.ts:307-335`, `apps/web/src/components/load-more.tsx:7-45` | MEDIUM / HIGH | **Deferred** below |
| AGG6-05 | `apps/web/src/components/home-client.tsx:242-243`, `apps/web/src/lib/data.ts:474-545`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:217-229` | MEDIUM / HIGH | **Deferred** below |
| AGG6-07 | `apps/web/e2e/nav-visual-check.spec.ts:5-32` | LOW / HIGH | **Deferred** below |
| AGG6-08 | `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:1-125` | MEDIUM / HIGH | **Deferred** below |
| AGG6-10 | `apps/web/src/app/[locale]/admin/db-actions.ts:41-104` | MEDIUM / HIGH | **Deferred** below |
| AGG6-11 | `apps/web/src/app/sitemap.ts:1-55`, `apps/web/src/lib/data.ts:834-844` | MEDIUM / HIGH | **Deferred** below |
| AGG6-14 | `apps/web/e2e/public.spec.ts:19-35,49-63`, `apps/web/e2e/nav-visual-check.spec.ts:15-23`, `apps/web/src/components/nav-client.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/components/photo-viewer.tsx` | LOW / HIGH | **Validation/closure** below |
| code-reviewer risk A | `apps/web/src/app/actions/{auth,images,settings,seo,sharing,tags,topics,admin-users}.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts` | MEDIUM / MEDIUM | **Deferred** below |
| security finding 1 | `git history -> d7c3279:apps/web/.env.local.example:1-11`; current warnings in `README.md`, `CLAUDE.md`, `apps/web/.env.local.example` | MEDIUM / HIGH | **Operationally closed / documented** below |
| security finding 3 | `apps/web/next.config.ts:72-75` | LOW / HIGH | **Deferred** below |
| critic finding 4 | `apps/web/src/lib/data.ts:11-108`, `apps/web/src/instrumentation.ts:8-25` | MEDIUM / HIGH | **Deferred** below |
| critic finding 5 | `apps/web/src/app/[locale]/(public)/page.tsx:32-42`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:42-52`, `apps/web/src/components/home-client.tsx:181-186` | MEDIUM / HIGH | **Deferred** below |
| architect ARCH6-02 | `apps/web/src/lib/data.ts:11-109` and related imports | MEDIUM / HIGH | **Deferred** below |
| architect ARCH6-R01 | `apps/web/docker-compose.yml:1-22`, `apps/web/src/lib/{image-queue,restore-maintenance,rate-limit}.ts` | MEDIUM / HIGH | **Deferred** below |
| test-engineer findings 2-7 | `apps/web/e2e/nav-visual-check.spec.ts`, `apps/web/src/app/actions/{auth,sharing}.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/{process-image,image-queue,storage}` | LOW/MEDIUM/HIGH as reported | **Deferred** below |
| debugger DBG6-02 | `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:39-56`, `apps/web/src/app/actions/seo.ts:65-127` | LOW / HIGH | **Scheduled** in `C6R-02` |

## Deferred / carry-forward items

### D6-01 — Cursor/keyset replacement for public infinite scroll
- **Citation:** `AGG6-01`; `apps/web/src/app/actions/public.ts:9-28`, `apps/web/src/lib/data.ts:307-335`, `apps/web/src/components/load-more.tsx:7-45`
- **Original severity / confidence:** MEDIUM / HIGH
- **Reason for deferral:** A full cursor/keyset migration changes the public browsing contract across server actions, client paging state, and tests. This matches the already-open carry-forward note in `.context/plans/plan-214-deferred-cycle5-review.md` and the repo rule in `AGENTS.md` to **keep diffs small, reviewable, and reversible**.
- **Exit criterion:** Re-open when a dedicated public-gallery pagination refactor is scheduled or gallery size/live-upload pressure makes the current contract unacceptable.

### D6-02 — Scoped topic/tag photo navigation
- **Citation:** `AGG6-05`; `apps/web/src/components/home-client.tsx:242-243`, `apps/web/src/lib/data.ts:474-545`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:217-229`
- **Original severity / confidence:** MEDIUM / HIGH
- **Reason for deferral:** Preserving collection context requires cross-route contract changes (link shape/query params/data lookup/test coverage) beyond this cycle’s narrower auth/admin/test-hardening lane. Per `AGENTS.md`, this cycle prioritizes the smallest viable diff set.
- **Exit criterion:** Re-open when public-photo navigation semantics are deliberately redesigned and can be changed end-to-end in one scoped pass.

### D6-03 — Asserted visual regression workflow for nav screenshots
- **Citation:** `AGG6-07`; `apps/web/e2e/nav-visual-check.spec.ts:5-32`
- **Original severity / confidence:** LOW / HIGH
- **Reason for deferral:** This is already tracked in `.context/plans/plan-214-deferred-cycle5-review.md` (`AGG5-13`). Converting the suite to baseline assertions needs a committed snapshot-artifact policy, not just a local code tweak.
- **Exit criterion:** Re-open when the repo adopts a committed screenshot-baseline / visual-regression workflow.

### D6-04 — Public photo ISR/auth-boundary redesign
- **Citation:** `AGG6-08`; `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:1-125`
- **Original severity / confidence:** MEDIUM / HIGH
- **Reason for deferral:** Removing request-time auth from the route render path requires choosing a new product contract for admin/share affordances on public photos (dynamic island vs route-level dynamic vs separate admin affordance surface). That is a broader route-architecture change than this cycle’s narrow patch lane.
- **Exit criterion:** Re-open when the public photo page contract is intentionally redesigned or when caching/TTFB data shows this boundary is a top optimization target.

### D6-05 — CSV full-export contract
- **Citation:** `AGG6-10`; `apps/web/src/app/[locale]/admin/db-actions.ts:41-104`
- **Original severity / confidence:** MEDIUM / HIGH
- **Reason for deferral:** This is the same broader export-contract work already tracked in `.context/plans/plan-214-deferred-cycle5-review.md` (`AGG5-11`). A real full export needs a paged or streamed admin-download path instead of a server-action-returned in-memory string.
- **Exit criterion:** Re-open when admin export UX/performance is prioritized or export size pressure is observed.

### D6-06 — Sitemap partitioning / index generation
- **Citation:** `AGG6-11`; `apps/web/src/app/sitemap.ts:1-55`, `apps/web/src/lib/data.ts:834-844`
- **Original severity / confidence:** MEDIUM / HIGH
- **Reason for deferral:** This is the same broader SEO/discovery follow-up already tracked in `.context/plans/plan-214-deferred-cycle5-review.md` (`AGG5-10`). Chunked sitemap files plus an index are a larger SEO-surface change than this cycle’s bounded fixes.
- **Exit criterion:** Re-open when discovery infrastructure is the prioritized workstream or image count approaches the current cap.

### D6-07 — Broader same-origin / server-action provenance consistency audit
- **Citation:** code-reviewer risk A across `apps/web/src/app/actions/{images,settings,seo,sharing,tags,topics,admin-users}.ts` and `apps/web/src/app/[locale]/admin/db-actions.ts`
- **Original severity / confidence:** MEDIUM / MEDIUM
- **Reason for deferral:** This is a broader framework/deployment-trust audit. This cycle fixes the directly confirmed auth provenance gap first (`C6R-01`) without widening to every mutation surface in one patch.
- **Exit criterion:** Re-open when mutation-surface CSRF/origin policy is audited repo-wide or when framework/deployment assumptions change.

### D6-08 — Historical example secrets in git history
- **Citation:** security-reviewer finding 1; historical `d7c3279:apps/web/.env.local.example:1-11`; current warnings in `README.md`, `CLAUDE.md`, and `apps/web/.env.local.example`
- **Original severity / confidence:** MEDIUM / HIGH
- **Disposition:** Deferred as an operational/documented history issue, not a current-HEAD code defect.
- **Reason for deferral:** Current tracked files already use placeholders and explicit rotation warnings. Rewriting public git history is outside the scope of a normal code-fix cycle.
- **Exit criterion:** Re-open if the repo adopts a history-rewrite/security-notice process or if current-head docs regress and stop warning operators to rotate any historic values.

### D6-09 — CSP `'unsafe-inline'` hardening
- **Citation:** security-reviewer finding 3; `apps/web/next.config.ts:72-75`
- **Original severity / confidence:** LOW / HIGH
- **Reason for deferral:** Removing `'unsafe-inline'` requires a broader nonce/hash strategy for current inline/bootstrap behavior. This is low-severity hardening, not a same-cycle narrow bug fix.
- **Exit criterion:** Re-open when CSP tightening is prioritized and inline script sources can be converted to nonce/hash-based equivalents.

### D6-10 — Shared-group view counts remain intentionally lossy/approximate
- **Citation:** critic finding 4; `apps/web/src/lib/data.ts:11-108`, `apps/web/src/instrumentation.ts:8-25`
- **Original severity / confidence:** MEDIUM / HIGH
- **Reason for deferral:** This is already materially covered by `.context/plans/177-deferred-cycle2-ultradeep-review.md` (“Shared-group view counts remain intentionally lossy and process-local”). Making counts durable requires a larger storage/queue policy decision.
- **Exit criterion:** Re-open when view-count accuracy becomes a product requirement.

### D6-11 — Tag-filtered metadata uses raw slugs instead of canonical names
- **Citation:** critic finding 5; `apps/web/src/app/[locale]/(public)/page.tsx:32-42`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:42-52`, `apps/web/src/components/home-client.tsx:181-186`
- **Original severity / confidence:** MEDIUM / HIGH
- **Reason for deferral:** This is a metadata/SEO polish correctness issue, but lower priority than the current auth/admin/test-surface fixes. It also needs careful parity decisions between metadata, headings, and alias behavior.
- **Exit criterion:** Re-open when public metadata text generation is next modified.

### D6-12 — Split mutable shared-group view buffering out of `lib/data.ts`
- **Citation:** architect `ARCH6-02`; `apps/web/src/lib/data.ts:11-109`
- **Original severity / confidence:** MEDIUM / HIGH
- **Reason for deferral:** This is an architectural cleanup/simplification pass, not a narrow defect fix. The repo already carries a similar architectural deferral in `.context/plans/177-deferred-cycle2-ultradeep-review.md` for storage/operational splits.
- **Exit criterion:** Re-open when `lib/data.ts` is next being simplified or the view-count lifecycle needs independent testing.

### D6-13 — Explicitly codify or redesign single-process runtime assumptions
- **Citation:** architect `ARCH6-R01`; `apps/web/docker-compose.yml:1-22`, `apps/web/src/lib/{image-queue,restore-maintenance,rate-limit}.ts`
- **Original severity / confidence:** MEDIUM / HIGH
- **Reason for deferral:** This is a deployment-topology / shared-state architecture decision. Similar multi-instance concerns are already tracked in `.context/plans/plan-214-deferred-cycle5-review.md` (`AGG5-12`) and `.context/plans/177-deferred-cycle2-ultradeep-review.md`.
- **Exit criterion:** Re-open before any multi-instance / multi-worker deployment support is introduced.

### D6-14 — Remaining broader test-surface expansions
- **Citation:** test-engineer findings 2-7 across `apps/web/e2e/nav-visual-check.spec.ts`, `apps/web/src/app/actions/{auth,sharing}.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/{process-image,image-queue,storage}`
- **Original severity / confidence:** As reported in `test-engineer.md` (LOW→HIGH, High/Medium confidence)
- **Reason for deferral:** These broader auth/share/backup/upload/storage test expansions are already covered by carry-forward plans such as `.context/plans/plan-214-deferred-cycle5-review.md` and `.context/plans/177-deferred-cycle2-ultradeep-review.md`. This cycle adds only the narrower admin-lane/toggle coverage in `C6R-04`.
- **Exit criterion:** Re-open when those respective surfaces are next modified or a dedicated test-expansion cycle is scheduled.

## Validation / stale finding closures

### V6-01 — Public controls “inert after click” report is stale on current HEAD
- **Original review source:** designer finding 1
- **Original citation:** `apps/web/src/components/nav-client.tsx:65-154`, `apps/web/src/components/search.tsx:20-205`, `apps/web/src/components/tag-filter.tsx:9-87`, `apps/web/src/components/photo-viewer.tsx:248-321`
- **Original severity / confidence:** MEDIUM / HIGH
- **Current-head verification evidence:**
  - `apps/web/e2e/public.spec.ts:19-35` — search dialog opens and traps focus.
  - `apps/web/e2e/public.spec.ts:49-63` — photo lightbox opens/closes.
  - `apps/web/e2e/nav-visual-check.spec.ts:15-23` — mobile nav expand button reveals the search control.
- **Disposition:** Invalidated/stale review output; no product-code implementation required.
- **Exit criterion:** Re-open only if the interaction regressions can be reproduced on current HEAD in a fresh Playwright or browser trace.
