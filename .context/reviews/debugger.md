# Latent Bug Review — Cycle 6 / Debugger

Scope: full repository sweep with emphasis on latent failure modes, regressions, stale-state bugs, race conditions, cleanup/rollback failures, and hidden assumptions.

## Inventory / coverage notes
Reviewed the repo’s primary application surface, including:
- `apps/web/src/app/**` routes, pages, server actions, and API routes
- `apps/web/src/components/**` client components
- `apps/web/src/lib/**` core helpers, validation, storage, queue, restore, and security helpers
- `apps/web/src/db/**` schema/connection wiring
- `apps/web/src/__tests__/**` for intended behavior and regression clues
- top-level docs: `README.md`, `apps/web/README.md`, `package.json`, `apps/web/package.json`, `CLAUDE.md`

## Findings

### 1) Partial-success uploads do not refresh the dashboard data
- **File/region:** `apps/web/src/components/upload-dropzone.tsx:270-294`
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Failure scenario:** A mixed upload batch where some files succeed and some fail shows a partial-success toast, but the server-rendered dashboard list is not refreshed. The successful uploads can remain invisible until a manual refresh or another unrelated action causes revalidation.
- **Why this is a bug:** The success path calls `router.refresh()`, but the partial-success path only updates local file state and resets progress. The server-side list of recent uploads is stale even though the upload action succeeded for at least one file.
- **Concrete fix:** Call `router.refresh()` in the partial-success branch as well, or otherwise trigger the same revalidation/update that the full-success branch uses after a successful upload action.

### 2) Infinite-scroll observer is never reattached after query resets
- **File/region:** `apps/web/src/components/load-more.tsx:60-83` (with the reset logic at `60-66`)
- **Severity:** Medium
- **Confidence:** Medium
- **Status:** Likely / manual-validation risk
- **Failure scenario:** If the gallery query changes while the `LoadMore` component instance stays mounted, or if `hasMore` toggles from `false` to `true`, the sentinel DOM node is replaced but the `IntersectionObserver` still watches the original node. Infinite scroll can silently stop working for the new result set, leaving only the manual button path.
- **Why this is a bug:** The component explicitly resets query-derived state when `queryKey` changes, which means it expects prop-driven updates without a full remount. But the observer effect is `[]`, so it never re-observes a newly rendered sentinel.
- **Concrete fix:** Re-run the observer setup when the sentinel/query state changes, or use a callback ref that disconnects/reconnects as the sentinel element mounts and unmounts.

### 3) Trusted-proxy IP selection falls back to the least trustworthy IP when the chain is shorter than expected
- **File/region:** `apps/web/src/lib/rate-limit.ts:69-89`
- **Severity:** Medium
- **Confidence:** Medium
- **Status:** Likely / manual-validation risk
- **Failure scenario:** With `TRUST_PROXY=true` and `TRUSTED_PROXY_HOPS` set higher than the actual `X-Forwarded-For` chain length, the code falls back to `validParts[0]` — the left-most value, which is the easiest one for a direct client to spoof. That can weaken IP-based login/search/share throttling and corrupt audit attribution whenever a proxy hop is missing, bypassed, or stripped.
- **Why this is a bug:** The code comment says the right-most trusted hop should be used so a client cannot spoof the left-most chain value. The fallback contradicts that threat model by trusting the first valid entry precisely when the chain is too short to validate the configured hop count.
- **Concrete fix:** Fail closed when the forwarded chain is shorter than the configured trusted hop count, or fall back to a clearly untrusted placeholder / `x-real-ip` only if that is explicitly validated by the deployment model.

## Final sweep notes
- I did not find additional high-confidence latent bugs in the other reviewed routes/components after checking the core upload, auth/origin, queue, restore, sharing, tag/topic, and admin flows.
- The remaining observations were either intentional behavior, already guarded by tests, or too deployment-specific to count as a confirmed issue.
