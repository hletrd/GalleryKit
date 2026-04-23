# Plan 207 — Deferred Review Findings (Cycle 3)

**Status:** TODO / DEFERRED
**Source review:** `.context/reviews/_aggregate.md`
**Purpose:** Track current-cycle findings that remain real but are explicitly deferred because this bounded cycle is constrained by repo policy or documented deployment/runtime contracts.

## Deferred findings

### AGG3-05 — Public gallery routes still pay exact `count(*)` cost on every request
- **Original severity:** MEDIUM
- **Original confidence:** MEDIUM
- **Citation:** `apps/web/src/lib/data.ts:247-269`, `apps/web/src/app/[locale]/(public)/page.tsx:108-113`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:118-123`
- **Reason for deferral:** Replacing exact counts with `PAGE_SIZE + 1` or cached counts changes current public-page data contracts (`totalCount`, header copy, pagination semantics). The repo rule **"Keep diffs small, reviewable, and reversible"** means this broader public-contract performance change should be isolated to its own cycle.
- **Exit criterion to reopen:** A follow-up cycle is scoped specifically for public pagination/count-contract changes and can update UI text, data helpers, and regression coverage together.

### AGG3-06 — Restore mode behavior for concurrent public readers is operationally ambiguous
- **Original severity:** MEDIUM
- **Original confidence:** MEDIUM
- **Citation:** `apps/web/src/app/[locale]/admin/db-actions.ts:248-289`, `apps/web/src/lib/restore-maintenance.ts:1-26`, public reads under `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/public.ts`
- **Reason for deferral:** Forcing a maintenance response on all public readers is a correctness/availability contract change that touches multiple routes. The repo rule **"Keep diffs small, reviewable, and reversible"** permits deferring this broader operational behavior until a dedicated cycle can make and validate the product/ops decision.
- **Exit criterion to reopen:** Stage a restore-under-traffic validation pass and decide explicitly between (a) public maintenance mode during restore or (b) documented degraded-read behavior with monitoring.

### AGG3-07 — Production CSP still allows `unsafe-inline`, weakening XSS containment
- **Original severity:** MEDIUM
- **Original confidence:** MEDIUM
- **Citation:** `apps/web/next.config.ts:50-71`
- **Reason for deferral:** A real fix likely requires a framework-wide nonce/hash rollout across Next.js app-router scripts and existing analytics wiring. The repo rules **"Keep diffs small, reviewable, and reversible"** and **"No new dependencies without explicit request"** permit deferring this broader CSP architecture change from the current bounded cycle.
- **Exit criterion to reopen:** Scope a dedicated CSP-hardening cycle that validates nonce/hash support against current Next.js runtime behavior and Google Analytics integration.

### AGG3-08 — `/api/health` publicly exposes DB-readiness state
- **Original severity:** LOW
- **Original confidence:** HIGH
- **Citation:** `apps/web/src/app/api/health/route.ts:1-18`, `README.md:163`, `CLAUDE.md:206`
- **Reason for deferral:** Repo documentation currently defines `/api/health` as the DB-aware readiness/diagnostics signal for diagnostics and external monitoring. Changing its auth/public contract without a deployment decision would contradict current documented behavior.
- **Repo rule permitting deferral:** `CLAUDE.md` states: **"Docker liveness should probe `/api/live`; `/api/health` is DB-aware readiness/diagnostics and can legitimately return `503` during DB outages or restore work"** and `README.md` states: **"The container liveness probe now uses `/api/live`, while `/api/health` remains the DB-aware readiness signal for diagnostics and external monitoring."**
- **Exit criterion to reopen:** Confirm whether external monitoring still needs public access; if not, add a protected-monitor contract (header/token/internal-only) and update docs/deploy tooling together.

### AGG3-10 — Proxy misconfiguration can collapse rate limiting to the shared `unknown` bucket
- **Original severity:** MEDIUM
- **Original confidence:** HIGH
- **Citation:** `apps/web/src/lib/rate-limit.ts:61-86`, `apps/web/.env.local.example:29-34`, `README.md:127-132`
- **Reason for deferral:** The documented deployment already requires `TRUST_PROXY=true`, so the remaining risk is a deployment-policy mismatch rather than a current code defect in the documented path. A fail-closed runtime change could break existing non-documented topologies and should be isolated.
- **Repo rule permitting deferral:** `README.md` states: **"The shipped `apps/web/docker-compose.yml` already forces `TRUST_PROXY=true` and binds the standalone server to `127.0.0.1` when you use the documented host-network + nginx deployment. Keep those protections if you adapt the compose file."** and `CLAUDE.md` states: **"Access the app through your reverse proxy; the documented host-network compose file binds the app to localhost and enables `TRUST_PROXY=true`"**.
- **Exit criterion to reopen:** If supporting additional reverse-proxy topologies becomes a goal, add explicit production fail-closed behavior and matching deployment validation/tests.
