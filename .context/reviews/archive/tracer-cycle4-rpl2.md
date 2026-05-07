# Tracer — Cycle 4 RPL (2026-04-23, loop 2)

Reviewer focus: causal tracing of suspicious flows, competing hypotheses.

## Suspicious flow: CSV export silently truncated

### Hypothesis A: `SET group_concat_max_len = 65535` silently fails

**Flow:** `exportImagesCsv()` (db-actions.ts:43-110) relies on a MySQL session variable set in `db/index.ts:28-30`. If `connection.query(...)` fails (fire-and-forget with no catch), the connection uses the default 1024-byte limit. `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name SEPARATOR ', ')` is then truncated silently at 1024 bytes.

**Evidence:**
- `db/index.ts:28-30` does not chain `.catch`.
- `db-actions.ts:56-59` comment says the SET is already applied.
- No runtime assertion verifies the variable was actually set.

**Verdict:** Hypothesis A is plausible. The window is narrow (a transient DB hiccup at connection open), but under load or DB restart this would silently corrupt a subset of admin exports.

**Fix path:** add `.catch((err) => console.error(...))` in `db/index.ts:29` so at least the failure is logged.

### Hypothesis B: view-count flush backoff produces over/undercounts

**Flow:** `bufferGroupViewCount` debounces writes. Under DB outage, `consecutiveFlushFailures` grows, timer interval escalates to 5 minutes, buffer approaches `MAX_VIEW_COUNT_BUFFER_SIZE = 1000`.

**Evidence:**
- `data.ts:32-36` — when buffer is at capacity and the new group is not already in the buffer, increment is dropped with a warning.
- Groups already in the buffer continue to accumulate — no upper bound on count per group.

**Verdict:** This is already a known carry-forward (D6-10 — durable shared-group view counts). The in-memory buffer can lose increments and is not crash-safe. No change this cycle.

### Hypothesis C: session-secret race in dev fallback

**Flow:** Two concurrent requests hit `getSessionSecret()` with empty `SESSION_SECRET`. Both enter the fallback branch.

**Evidence:**
- `session.ts:38-40` — `sessionSecretPromise` guards against concurrent entry.
- `session.ts:60-62` — `INSERT IGNORE` + re-fetch handles the persistence race across multiple processes.

**Verdict:** Looks correct. The promise memoization + IGNORE + re-fetch pattern is sound.

## Confidence Summary

- 1 plausible-cause trace (Hypothesis A → maps to CQ-01/SEC-02).
- 2 known/already-deferred flows (Hypotheses B, C).
