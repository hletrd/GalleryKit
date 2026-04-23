# Tracer -- Cycle 6 (Round 3, 2026-04-20)

## Scope
Causal tracing of suspicious flows, competing hypotheses. Mature codebase with 46+ prior cycles.

## Findings

### T6R3-01: Trace: stripControlChars on delete operations -- silent target change flow [MEDIUM] [HIGH confidence]
**Hypothesis:** If a client sends a delete request with control characters in the slug parameter, the function could operate on a different entity than intended.
**Trace:**
1. Client calls `deleteTopic(slug)` with `slug = "my\x00-topic"`
2. Line 192: `cleanSlug = stripControlChars(slug)` produces `"my-topic"`
3. Line 193: `isValidSlug("my-topic")` returns true
4. Line 201-209: Transaction deletes topic with slug `"my-topic"`
5. **Result:** Topic "my-topic" is deleted, even though the client sent "my\x00-topic"

**Competing hypothesis:** No client would legitimately send a slug with control characters, so this is purely theoretical.
**Resolution:** While the competing hypothesis is practically correct, the defense-in-depth principle says: for destructive operations, reject malformed input. The code should check `slug === cleanSlug` and reject if they differ.

**Cross-reviewer agreement:** SR6R3-01, CR6R3-01, V6R3-01, C6R3-01 all flag this same concern.

### T6R3-02: Trace: topic image temp file lifecycle on crash [MEDIUM] [MEDIUM confidence]
**Hypothesis:** If the process crashes during `processTopicImage`, temp files persist and are never cleaned up.
**Trace:**
1. Line 64: `const tempPath = path.join(RESOURCES_DIR, \`tmp-${id}\`);`
2. Line 68: File written to `tempPath` via `pipeline`
3. Line 70-73: Sharp processes `tempPath` to `outputPath`
4. Line 75: On success, `tempPath` deleted
5. Lines 77-78: On error, both `tempPath` and `outputPath` deleted
6. **Crash scenario:** Process killed between line 68 and 75 — `tempPath` persists

**Comparison with main pipeline:** `image-queue.ts` has `cleanOrphanedTmpFiles()` that scans for `.tmp` files in webp/avif/jpeg dirs on startup. Topic images use `tmp-*` pattern in `RESOURCES_DIR` — no cleanup exists.

**Resolution:** Confirmed. Need startup cleanup for topic image temp files or use `os.tmpdir()`.

## Summary

Two findings with causal traces. T6R3-01 has strong cross-reviewer agreement. T6R3-02 has moderate agreement (also flagged by DB6R3-02, CR6R3-02, C6R3-03).
