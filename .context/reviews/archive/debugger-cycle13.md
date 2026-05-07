# Debugger - Cycle 13 (current run, 2026-04-23)

Note: Earlier cycle-13 file `debugger-cycle13-historical-2026-04-19.md` is preserved for provenance; its DBG-13-01 (unsorted imageSizes) was fixed in plan-122 by replacing inline parse with `parseImageSizes()` and DBG-13-02 tightened the input pattern.

## Probes

1. **`dumpDatabase` spawn stderr chatter obscuring real error** — `dump.stderr.on('data', ...)` logs to `console.error` but doesn't affect the resolver. Informational only. Not a bug.
2. **`restoreDatabase` temp-file cleanup on early return** — `cleanupOriginalIfRestoreMaintenanceBegan` gates and cleans up. Safe.
3. **Rate-limit `decrementRateLimit` when row missing** — `UPDATE ... GREATEST(count - 1, 0) WHERE ...` matches zero rows (no-op); subsequent `DELETE WHERE count <= 0` also no-op. Safe.
4. **`normalizeIp` crash path** — IPv6 bracket match + IPv4 port strip, then `isIP()`. Unknown return is `null`, not thrown.
5. **`getSessionSecret` in production with missing env** — throws explicit error with remediation hint. Not a silent failure.
6. **Middleware admin-cookie format check** — only validates three-part split; full verification happens in server actions. Low-risk bypass (only shows UI chrome).
7. **`uploadImages` DB unavailable path** — `getGalleryConfig` catch defaults to `stripGpsOnUpload=true` (privacy-safe).
8. **`processImageFormats` size-sort defensive** — belt-and-suspenders sort at line 373, even though `parseImageSizes` already sorts.
9. **Backup file empty after mysqldump exit 0** — `stats.size === 0` check in `dumpDatabase` logs error and cleans up.
10. **writeStream flush race** — `dumpDatabase` waits for `writeStream.writableFinished` before resolving; checks `writeStreamHadError` flag.

## Findings

No new CRITICAL, HIGH, MEDIUM, or LOW findings.

## Confidence: High
