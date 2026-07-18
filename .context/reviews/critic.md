# Critic — cycle 2 provenance

Target: `ba4bc60acd4bc41b29ec02f509c3455d115ba083`, 2026-07-18 KST. Review only.

## Relevant-file inventory

The challenge review covered all 939 files by inventory, then attacked the strongest assumptions across security checks, build/runtime caching, deploy success semantics, single-instance coordination, restore/backup boundaries, privacy projections, semantic-search honesty, UI source contracts, tests, and operator documentation. Recent fixes and the current aggregate/deferred register were rechecked against actual source rather than accepted by disposition.

## Findings

### CRIT-2-01 — The ownership “fix” substitutes implicit checkout trust for explicit principal trust

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed new regression in the attempted fix**
- Region: `scripts/deploy-remote.sh:61-75,94-105`; `apps/web/deploy.sh:24-38`

Failure scenario: a privileged runner in a developer-owned checkout accepts the developer-owned executable env file. The repository-owner exception makes the same lower-privilege escalation possible under a different label.

Suggested fix: current UID only by default; explicit configured trusted UID for shared mounts; behavioral cross-UID test.

### CRIT-2-02 — The sitemap fallback is treated as both failure output and cacheable truth

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed new finding**
- Region: `apps/web/src/app/sitemap.ts:4-12,36-82`; generated prerender manifest

Failure scenario: every normal DB-less build follows the exceptional catch path, yet Next caches that exceptional result for the normal one-hour freshness period. The “first runtime hit” rationale is false under the produced artifact.

Suggested fix: never store the fallback in the authoritative ISR cache; generate on first runtime demand and cache only successful DB results.

### CRIT-2-03 — Health checking after replacement is detection, not safe deployment

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed; revalidated carry-forward**
- Region: `apps/web/deploy.sh:63-89`; `apps/web/docker-compose.yml:12-17`

Failure scenario: the only healthy instance is destroyed before the candidate is proven. Failure exits with the broken release still active/restarting.

Suggested fix: candidate slot plus promotion, or automatic prior-image rollback verified healthy.

## Rejected challenges / final sweep

I tried to falsify the auth limiter fix, GeoIP diagnostic, SSR eager-image policy, mutation/origin scanners, privacy guards, restore drain, migration postconditions, and CLIP mode honesty. Evidence supported those changes. The shared background pool overlap remains a documented revalidated architectural risk, not a newly discovered critic finding. No additional issue survived the final counterargument sweep.
