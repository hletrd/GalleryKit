# Deferred Review Coverage — Cycle 2 (Deeper Review)

**Created:** 2026-04-20
**Status:** TODO
**Purpose:** Preserve the remaining cycle-2 deeper-review findings that were not fixed in this pass.

| Finding / risk | Citation / source | Original severity / confidence | Reason for deferral | Exit criterion |
| --- | --- | --- | --- | --- |
| Broad test-signal weakness across default CI/E2E/privacy surfaces | `.context/reviews/critic.md` finding 4 | MEDIUM / High | This cycle fixed the concrete deterministic local E2E problems already in-flight, but making Playwright seeding/default CI/privacy query assertions comprehensive is a wider test-program change. | Re-open in a test-focused cycle that can add seeded E2E setup and true query-level privacy assertions without conflating it with current correctness/security fixes. |
| CSP `unsafe-inline` removal / nonce-hash migration | `.context/reviews/security-reviewer.md` finding 2 | MEDIUM / High | A direct removal broke the browser runtime under the Playwright gate because the current Next runtime still emits inline scripts. A safe nonce/hash migration requires a broader framework-compatible CSP rollout. | Re-open when a nonce/hash CSP migration is scheduled and validated end-to-end against the App Router runtime. |
| Public `/api/health` DB detail exposure | `.context/reviews/security-reviewer.md` risk 4 | LOW / High | Operationally useful and currently relied upon for health checks; changing it needs a deployment/monitoring decision. | Re-open when health checks are restricted behind internal networking or a separate auth-protected probe path. |
| `TRUST_PROXY=true` deployment misuse risk | `.context/reviews/security-reviewer.md` risk 5 | MEDIUM / Medium | The documented host-network deployment remains safe, but guarding against all custom misconfigurations requires deployment-topology detection or more opinionated startup policy. | Re-open when deployment guardrails are expanded for non-standard topologies. |
| Non-integrated storage backend subsystem remains architectural drag | `.context/reviews/critic.md` risk 5 | MEDIUM / Medium | The codebase still carries the storage abstraction, but removing or fully integrating it is a broader architectural project beyond this cycle’s confirmed runtime/security fixes. | Re-open when a storage-architecture cleanup or true remote-backend integration cycle is scheduled. |
