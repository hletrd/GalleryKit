# Code reviewer — cycle 4 provenance

Review target: `01d39653` (`master`), 2026-07-18 KST. Review only; no source or plan file was changed.

## Complete inventory and method

I enumerated the entire working tree before reviewing. Excluding generated/dependency/cache/history artifacts, the maintained product surface comprises 635 `apps/web/src` files (81 App Router files, 115 libraries, 61 components, 3 DB files, and 369 unit-test files), 12 Playwright files, 29 scripts, 31 migration SQL files plus the Drizzle journal/reconcile implementation, build/package/CI configuration, Docker/Compose/nginx/deploy assets, PWA assets, and the governing `AGENTS.md`, full `CLAUDE.md`, current plans, current reviews, and deferred registers. I reviewed every file changed from the Cycle 3 review target `afa11cf4` through HEAD and traced every changed symbol through callers, tests, server-rendered output, and production-visible behavior. The final whole-repository sweep covered routes/actions, auth/rate-limit/mutation barriers, DB/filesystem lifecycles, queues/locks, migrations, privacy projections, color/HDR, image delivery, caches, build/runtime configuration, deployment, and suppressions.

Evidence: API-auth lint, action-origin/mutation-barrier lint, public-route-rate-limit lint, full typecheck, focused 42-test Vitest run, and `git diff --check` passed. `master == origin/master`; all five post-review commits report good GPG signatures. The live home document contains the new `group-open:flex` disclosure fix, the two-id nav control relationship, 30 masonry cards, and exactly one eager image, confirming the current release reached production.

## New findings

### CR-C4-01 — Cycle 3 is pushed and deployed but its authoritative plan still says both operations are pending

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed** current-head provenance defect
- Regions: `.context/plans/cycle-3-2026-07-18-plan.md:5,45-48,56-65`; `.context/plans/README.md:34-38`

The plan's status, unchecked terminal work package, and progress list still say signed push and deploy are pending. In current repository state, `master` and `origin/master` are both `01d39653`; commits `2d9060de`, `235e8cb8`, `d2ef7817`, `54418100`, and `01d39653` all have good signatures. The production HTML contains the shipped Cycle 3 tag-disclosure, nav, and one-eager-card output, so deploy is also complete. The index nevertheless keeps Cycle 3 under active plans without terminal evidence.

Concrete failure: a recovery agent trusts the authoritative plan, repeats a deploy or release audit, or starts Cycle 4 from a false release frontier. This is the same failure class Cycle 3 fixed for Cycle 2, so leaving it open immediately recreates the recently closed operational ambiguity.

Suggested fix: mark the plan complete, record the signed terminal frontier and production proof, check the push/deploy boxes, archive the plan, and advance the active-plan index to Cycle 4.

### CR-C4-02 — The masonry fix left obsolete first-row preload contracts beside the corrected code

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed** maintainability defect; runtime behavior is currently correct
- Regions: `apps/web/src/components/home-client.tsx:26-49,127-145,247-262,344-345`; `apps/web/src/components/masonry-card.tsx:23-33`

The implementation now correctly marks only DOM index 0 eager/high, but `useColumnCount` still says media-qualified preloads cover desktop first-row cards and that column-count tracking exists so 4/5 first-row images receive eager/high. Those preloads were deleted. `MasonryCardProps` likewise still defines `isAboveFold` as the first N cards and says `shouldEagerLoad` may be wider for a five-column first row. The two derivation helpers are now identical predicates and retain ignored `columnCount` / `hasMeasuredViewport` parameters solely from the removed policy.

Concrete failure: the next performance change follows the adjacent comments/interface contract and reintroduces first-N priority or media preloads, recreating the CSS-column defect just fixed in `d2ef7817`. At minimum, reviewers must reverse-engineer whether comments or code are authoritative.

Suggested fix: update the comments and prop documentation to the universal-first-card contract. Then collapse the two identical derivations into one explicit priority predicate (or pass direct `index === 0`) and remove parameters that no longer participate, while retaining `useColumnCount` only for intrinsic-size/layout estimation.

## Revalidated carry-forward, not new

- **CR-C4-R1 — failed deployment health has no rollback transition** — Medium / High / confirmed carry-forward; `apps/web/deploy.sh:63-89`. The fixed-name service is replaced before health passes, and failure exits without restoring the prior release.
- **CR-C4-R2 — DB restore does not restore the matching mutable file generation** — Medium / High / confirmed documented boundary; `apps/web/src/app/[locale]/admin/db-actions.ts:789-1098`, `apps/web/docker-compose.yml:24-32`.

## Final missed-issue sweep

The closing sweep rechecked every changed file plus sibling implementations, all action/route exports, raw SQL/child processes, path construction and cleanup, migration journal/reconcile parity, privacy guards, image/CLIP queues, render/cache ownership, event/timer cleanup, and current historical findings. The tag and nav fixes match their runtime ownership, and the one-card masonry policy is correct. No other new correctness defect survived validation; established topology, restore, map/vector-scale, and deploy-recovery items remain carry-forward rather than being relabeled.
