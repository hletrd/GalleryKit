# Cycle 10 Aggregate Review

**Date:** 2026-04-22
**Scope:** review-plan-fix cycle 10 (`deeper`, `ultradeep comprehensive`, `find yourself and make sure to not ask again`)

## Review fan-out summary

Completed specialist notes this cycle:
- `code-reviewer`
- `security-reviewer`
- `critic` (manual file write from returned review because the spawned lane reported a read-only write constraint)
- `verifier`
- `test-engineer`
- `debugger`
- `designer`
- `dependency-expert`
- `architect` (manual fallback refresh after the spawned architect lane stalled)

Unavailable / not registered in this session:
- `perf-reviewer`
- `tracer`

## Agent failures / execution notes

- The first `verifier` attempt failed with a context-window overflow; the retry completed successfully and wrote `./.context/reviews/verifier.md`.
- The `critic` lane completed the review but could not write its file because of a read-only constraint, so I wrote `./.context/reviews/critic.md` manually from the returned content.
- The `architect` retry stalled after repeated waits, so I closed it and refreshed `./.context/reviews/architect.md` manually to preserve per-role provenance.
- The `dependency-expert` lane advanced `HEAD` to `884f53a` while recording its review trail; I kept that review commit and continued the cycle from that state.
- I performed an extra repo-wide sweep after the fan-out to honor the user’s `ultradeep comprehensive` request and to verify that no actionable findings were silently dropped.

## Confirmed findings

| ID | Severity | Confidence | Signals | Finding | Primary citations |
|---|---|---|---|---|---|
| C10-01 | HIGH | High | critic, security-reviewer, verifier, debugger, manual sweep | `getClientIp()` trusts the left-most `X-Forwarded-For` hop even though the shipped nginx config appends the real client IP, so login/share/search throttles can be spoofed. | `apps/web/src/lib/rate-limit.ts`, `apps/web/nginx/default.conf`, `apps/web/src/__tests__/rate-limit.test.ts` |
| C10-02 | HIGH | High | critic, code-reviewer | `createTopic()` never checks alias collisions, so a new topic slug can silently hijack an existing alias route. | `apps/web/src/app/actions/topics.ts`, `apps/web/src/lib/data.ts` |
| C10-03 | HIGH | High | code-reviewer, architect | Topic slug renames update children before the new parent slug exists even though the shipped FKs are `ON UPDATE no action`, so populated topics cannot be renamed safely. | `apps/web/src/app/actions/topics.ts`, `apps/web/src/db/schema.ts`, `apps/web/drizzle/0001_sync_current_schema.sql` |
| C10-04 | HIGH | High | code-reviewer, test-engineer | Tag slug collisions still map a user request onto the wrong existing tag across add/batch/upload flows instead of rejecting or skipping the collision. | `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/images.ts` |
| C10-05 | MEDIUM | High | code-reviewer, test-engineer | Single-image tag mutations can report success even when the target image disappeared before the write actually happened. | `apps/web/src/app/actions/tags.ts` |
| C10-06 | MEDIUM | High | debugger, verifier manual sweep | Successful uploads only revalidate `/` and `/admin/dashboard`, leaving the public topic page stale for up to its ISR window. | `apps/web/src/app/actions/images.ts`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx` |
| C10-07 | MEDIUM | High | critic, architect, dependency-expert | The documented host-nginx deployment story conflicts with the shipped static upload root, so operators can follow the docs and still ship `/uploads/*` 404s. | `README.md`, `apps/web/README.md`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf` |
| C10-08 | MEDIUM | High | designer | Lightbox controls auto-hide after three seconds even on touch-only devices, leaving mobile users without visible close/navigation controls. | `apps/web/src/components/lightbox.tsx` |
| C10-09 | LOW | High | designer | `TagInput` traps Tab instead of letting focus move normally, which breaks expected keyboard form navigation in admin flows. | `apps/web/src/components/tag-input.tsx` |
| C10-10 | MEDIUM | High | dependency-expert | The production image still inherits build-only toolchain packages (`python3`, `make`, `g++`) because the runner stage is based on the build base image. | `apps/web/Dockerfile` |
| C10-11 | MEDIUM | High | dependency-expert | CSV export still loads the full result set and full CSV string into memory, so large exports can spike heap usage. | `apps/web/src/app/[locale]/admin/db-actions.ts` |

## Deferred / broader follow-up items

| ID | Severity | Confidence | Source | Why deferred this cycle |
|---|---|---|---|---|
| D10-01 | HIGH | High | security-reviewer | Historical example credentials/secrets already in git history require operational secret rotation and possibly advisory/history-rewrite work outside a bounded code-only pass. |
| D10-02 | MEDIUM | High | security-reviewer | Production CSP still allows `unsafe-inline`; removing it safely still needs a broader nonce/hash rollout across the app shell and analytics surfaces. |
| D10-03 | MEDIUM | High | security-reviewer | Share URLs still do not expire by default; adding TTLs requires a schema change, route contract update, and admin UX decisions that are larger than this bounded hardening cycle. |
| D10-04 | LOW | High | security-reviewer | `/api/health` remains public because current deploy verification and health checks depend on it; tightening it safely needs a coordinated monitoring/deploy contract update. |
| D10-05 | MEDIUM | Medium | dependency-expert, critic | The shipped Playwright/runtime/deploy story still differs from standalone + nginx production, but aligning local/CI/runtime topology cleanly needs a broader test-harness update. |
| D10-06 | MEDIUM | Medium | debugger, architect, critic | Restore maintenance is still process-local/shared-state incomplete; a robust fix needs shared coordination across processes and public-read behavior decisions. |
| D10-07 | MEDIUM | High | debugger | Queue bootstrap still has a likely double-start race between import-time bootstrap and instrumentation startup; fixing it safely needs a follow-up pass through queue startup/retry behavior. |
| D10-08 | MEDIUM | High | test-engineer | The repo still lacks always-on CI enforcement and broad automated coverage for share/admin/settings/topic flows, but wiring those lanes cleanly still needs runner/env policy decisions. |
| D10-09 | LOW | Medium | designer | Additional UX polish items remain (search ARIA state, `ImageZoom` focus treatment, admin table responsiveness, infinite-scroll fallback), but they are lower priority than the confirmed correctness/security/runtime issues above. |

## Plan routing

- **Implement in Plan 191:** C10-01 through C10-06.
- **Defer in Plan 192:** D10-01 through D10-09, plus the lower-priority confirmed items C10-07 through C10-11, with preserved severity/confidence and explicit reopen criteria.

## Cross-agent agreement

- C10-01 was independently surfaced by critic/security/verifier/debugger angles, increasing confidence that the proxy/IP issue is both a security and correctness problem.
- C10-02 and C10-03 were reinforced across critic/code-reviewer/architect analysis, so the topic routing/rename boundary is the strongest shared application-layer risk this cycle.
- C10-04 and C10-05 are tightly connected and collectively show that tag mutation flows still need stronger collision/existence guarantees.
- C10-06 was the strongest grounded stale-success issue from the debugger pass and matches the extra repo-wide manual sweep.

## Aggregate conclusion

The highest-value bounded cycle-10 work is to harden real client-IP extraction against the shipped proxy chain, make topic creation/rename preserve route integrity under the current schema, stop tag mutation flows from mapping user intent onto the wrong records or claiming success after target deletion, and keep public topic pages fresh immediately after uploads. Larger operational/security/UI/runtime follow-ups remain real, but they belong in explicit deferred plans rather than being mixed into this safe hardening pass.
