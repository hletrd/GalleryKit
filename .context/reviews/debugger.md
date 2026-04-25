# Debugger Review — Cycle 6

Scope: core routes, actions, components, storage/queue/restore helpers, schema, and tests. Final sweep found three latent issues.

## Findings

### DBG6-01 — Partial-success uploads do not refresh the dashboard
- **Location:** `apps/web/src/components/upload-dropzone.tsx:270-294`
- **Severity/confidence:** Medium / High
- **Status:** Confirmed.
- **Failure scenario:** A batch with some successes and some failures shows a partial-success toast but does not refresh the server-rendered recent-upload list.
- **Suggested fix:** Call `router.refresh()` in the partial-success branch too.

### DBG6-02 — Infinite-scroll observer is not reattached after query resets
- **Location:** `apps/web/src/components/load-more.tsx:60-83`
- **Severity/confidence:** Medium / Medium
- **Status:** Likely / manual-validation risk.
- **Failure scenario:** If gallery query changes while component stays mounted or `hasMore` flips false then true, the observer can stay attached to the old sentinel and infinite scroll silently stops.
- **Suggested fix:** Recreate the observer on sentinel/query changes or use a callback ref that disconnects/reconnects.

### DBG6-03 — Trusted-proxy IP selection falls back to least trustworthy address when chain is shorter than expected
- **Location:** `apps/web/src/lib/rate-limit.ts:69-89`
- **Severity/confidence:** Medium / Medium
- **Status:** Likely / manual-validation risk.
- **Failure scenario:** With `TRUST_PROXY=true` and `TRUSTED_PROXY_HOPS` too high, client-controlled left-most XFF can weaken rate limits/audit attribution.
- **Suggested fix:** Fail closed when the forwarded chain is shorter than configured hop count.
