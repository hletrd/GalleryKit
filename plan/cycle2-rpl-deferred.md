# Cycle 2 rpl — deferred items

Purpose: capture every cycle 2 rpl review finding that is **not** implemented in `plan/cycle2-rpl-review-fixes.md`, plus map scheduled items so no finding is silently dropped.

Repo-policy inputs consulted: `CLAUDE.md`, `AGENTS.md`, existing plan files under `plan/` and `.context/`. `.cursorrules` and `CONTRIBUTING.md` are absent. Relevant repo rule quoted where needed below.

## Master disposition map

| Finding | Citation | Original severity / confidence | Disposition |
|---|---|---|---|
| AGG2R-01 | `apps/web/src/app/actions/auth.ts:382` | MEDIUM / HIGH | Scheduled in C2R-01 |
| AGG2R-02 | `apps/web/src/app/actions/*.ts`; `apps/web/src/app/[locale]/admin/db-actions.ts` | MEDIUM / MEDIUM | Scheduled in C2R-02 (closes D1-02) |
| AGG2R-03 | `apps/web/src/app/[locale]/admin/db-actions.ts:260-267` | LOW / MEDIUM | Scheduled in C2R-03 |
| AGG2R-04 | `apps/web/src/components/admin-nav.tsx:27` | LOW / MEDIUM | Deferred below (D2-01) |
| AGG2R-05 | `apps/web/src/app/actions/images.ts:323-328` | LOW / HIGH | Deferred below (D2-02) |
| AGG2R-06 | `apps/web/src/app/[locale]/admin/db-actions.ts:41-105` | LOW / MEDIUM | Deferred below (D2-03) |
| AGG2R-07 | `apps/web/src/lib/rate-limit.ts`; `apps/web/src/app/actions/{sharing,admin-users,images}.ts` | LOW / MEDIUM | Deferred below (D2-04) |
| AGG2R-08 | `apps/web/src/lib/data.ts:725-831` | LOW / HIGH | Deferred below (D2-05) |
| AGG2R-09 | `apps/web/src/lib/image-queue.ts:297-315` | LOW / MEDIUM | Deferred below (D2-06) |
| AGG2R-10 | `apps/web/src/lib/session.ts:121-128` | LOW / LOW | Deferred below (D2-07) |
| AGG2R-11 | `apps/web/next.config.ts:72-85` | LOW / HIGH (original) | Deferred below (D2-08, supersedes D1-01) |
| AGG2R-12 | `apps/web/src/app/actions/auth.ts:351-376` | LOW / MEDIUM | Deferred below (D2-09) |
| AGG2R-13 | `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:83-86` | LOW / MEDIUM | Deferred below (D2-10) |
| AGG2R-14 | `plan/` directory layout | LOW / MEDIUM (informational) | Informational — not scheduled |
| AGG2R-15 | `apps/web/src/lib/data.ts:834-845` | LOW / LOW | Deferred below (D2-11) |

## Deferred items

### D2-01 — Admin mobile nav scroll affordance (supersedes D1-03)
- **Citation:** `apps/web/src/components/admin-nav.tsx:27`.
- **Original severity / confidence:** LOW / MEDIUM. Preserved.
- **Reason for deferral:** pure UX polish; admin-only surface; no regression. Repo rule (`AGENTS.md`): "keep diffs small, reviewable, and reversible" — bundling this with auth-sensitive C2R-02 would dilute review.
- **Exit criterion:** re-open during the next UI polish cycle or when admin nav layout is otherwise touched.

### D2-02 — `uploadImages` returns dead `replaced: []`
- **Citation:** `apps/web/src/app/actions/images.ts:323-328`.
- **Original severity / confidence:** LOW / HIGH (confidence the field is dead). Preserved.
- **Reason for deferral:** non-behavioral cleanup; changing the return shape ripples through TS callers and admin UI typing. Repo rule: keep diffs small — this is a separate mini-plan item.
- **Exit criterion:** re-open in a dedicated dead-code removal pass, or when the next `images.ts` change lands and the audit comes up naturally.

### D2-03 — CSV export streaming (carry-forward D6-05)
- **Citation:** `apps/web/src/app/[locale]/admin/db-actions.ts:41-105`.
- **Original severity / confidence:** LOW / MEDIUM.
- **Reason for deferral:** 50,000-row cap already in place; streaming requires an Accept/Response refactor plus an authenticated API route split from the server action. Matches the pre-existing D6-05 reasoning.
- **Exit criterion:** re-open when the CSV export hits observed OOM or when the route is redesigned.

### D2-04 — Duplicate in-memory rate-limit maps (carry-forward plan-142)
- **Citation:** `apps/web/src/lib/rate-limit.ts`, `apps/web/src/app/actions/{sharing,admin-users,images}.ts`.
- **Original severity / confidence:** LOW / MEDIUM.
- **Reason for deferral:** refactor-only; no regression. Unifying would change multiple call sites and complicate review of the cycle 2 rpl auth-sensitive changes.
- **Exit criterion:** dedicated refactor cycle; must preserve all pre-increment + rollback semantics.

### D2-05 — `searchImages` sequential round-trips
- **Citation:** `apps/web/src/lib/data.ts:725-831`.
- **Original severity / confidence:** LOW / HIGH.
- **Reason for deferral:** fix would require a UNION rewrite that changes ranking ordering; regression risk on SEO-relevant search results. Not a user-blocking perf issue today.
- **Exit criterion:** re-open when search latency is observed >300ms under real load.

### D2-06 — `bootstrapImageProcessingQueue` unpaginated pending SELECT
- **Citation:** `apps/web/src/lib/image-queue.ts:297-315`.
- **Original severity / confidence:** LOW / MEDIUM.
- **Reason for deferral:** minimal column set selected; would only matter with thousands of backlog rows on cold boot. No observed incident.
- **Exit criterion:** re-open if backlog-recovery operations are documented for production or OOM is observed at boot.

### D2-07 — Session clock-drift lower bound
- **Citation:** `apps/web/src/lib/session.ts:121-128`.
- **Original severity / confidence:** LOW / LOW.
- **Reason for deferral:** requires infra assumption (NTP-synced host). Not a primary attack surface.
- **Exit criterion:** re-open if multiple admins report unexpected logouts.

### D2-08 — CSP `'unsafe-inline'` hardening (supersedes D1-01)
- **Citation:** `apps/web/next.config.ts:72-85`.
- **Original severity / confidence:** LOW / HIGH. Preserved (not downgraded).
- **Reason for deferral:** removing `'unsafe-inline'` requires a broader nonce/hash strategy for inline/bootstrap scripts. Repo rule (`AGENTS.md`): "keep diffs small, reviewable, and reversible" — this is low-severity hardening, not a same-cycle narrow bug fix.
- **Exit criterion:** re-open when CSP tightening is prioritized and inline script sources can be converted to nonce/hash equivalents.

### D2-09 — No concurrent regression test for `updatePassword` rate-limit ordering
- **Citation:** `apps/web/src/app/actions/auth.ts:351-376`.
- **Original severity / confidence:** LOW / MEDIUM.
- **Reason for deferral:** concurrent-ordering is fussy to test reliably; the ordering is locked by code review today. Adding a brittle test would be net-negative.
- **Exit criterion:** re-open when a concurrent testing harness (e.g., deterministic scheduling) is introduced for related flows.

### D2-10 — `aria-busy` missing on save buttons
- **Citation:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:83-86`.
- **Original severity / confidence:** LOW / MEDIUM.
- **Reason for deferral:** pure AT polish; `disabled` attr already communicates state visually. Repo rule: small diffs reviewed separately.
- **Exit criterion:** next UI polish cycle.

### D2-11 — `getImageIdsForSitemap` deterministic ordering
- **Citation:** `apps/web/src/lib/data.ts:834-845`.
- **Original severity / confidence:** LOW / LOW.
- **Reason for deferral:** non-deterministic only when two rows share the same `created_at` second; not user-visible; not SEO-impacting.
- **Exit criterion:** re-open if sitemap regeneration diffs become noisy.

## Carry-forward items still active from prior cycles
The following pre-existing deferrals from `plan/cycle1-rpl-deferred.md` and earlier remain open and are NOT reopened here:

- D6-02 (scoped topic/tag photo navigation)
- D6-03 (asserted visual regression workflow)
- D6-04 (public photo ISR/auth-boundary redesign)
- D6-06 (sitemap partitioning / index generation)
- D6-07 (broader server-action provenance audit) — subsumed by D1-02 which is now CLOSED via C2R-02.
- D6-08 (historical example secrets — also OC1-01) — operationally closed.
- D6-10 (durable shared-group view counts)
- D6-11 (tag-filtered metadata uses canonical names)
- D6-12 (split mutable shared-group view buffering out of `lib/data.ts`)
- D6-13 (codify or redesign single-process runtime assumptions)
- D6-14 (remaining broader test-surface expansions)

D6-01 (cursor/keyset public infinite scroll) remains deferred.

D1-02 (broader same-origin / server-action provenance audit) — **closed via C2R-02**. Retired from the deferred register.

## Notes on repo policy compliance for deferrals
- No security, correctness, or data-loss finding is deferred without the quoted repo rule that permits it. AGG2R-01 (correctness/bug) is NOT deferred — scheduled in C2R-01. AGG2R-02 (security/DiD) is NOT deferred — scheduled in C2R-02. AGG2R-03 (minor consistency/robustness) is NOT deferred — scheduled in C2R-03.
- Deferred work, when eventually picked up, remains bound by repo policy: GPG-signed commits, conventional-commit + gitmoji messages, no `--no-verify`, no force-push to protected branches, and the required language/toolchain versions recorded in `CLAUDE.md`.
