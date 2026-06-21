# Test Engineer Review — RUN-9 Cycle-1

**HEAD:** d3858cfc (code byte-identical to converged f63af3b9)
**Prior suite:** ~2036 tests passing / 4 skipped (CLIP-weight-gated)
**Scope:** `apps/web/src/__tests__/` (196+ test files) + `apps/web/e2e/` (5 spec files)

---

## Validated Contract Tests (All SOLID)

### `data-tag-names-sql.test.ts`
Pins the `tagNamesAgg` constant in `data.ts` via a brace-depth-walking AST parser that reads the actual `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` shape. Also pins absence of `blur_data_url` from lite query shapes. No drift risk — pins source text, not mocks.

### `sanitize-for-og-global.test.ts`
Pins: all three consumers (`api/og/route.tsx`, `api/og/photo/[id]/route.tsx`, `app/[locale]/(public)/p/[id]/page.tsx`) import `sanitizeForOg` from `@/lib/og-sanitize`; the shared module uses `stripUnicodeFormatting` (global-flag); no consumer uses the non-global `.replace(UNICODE_FORMAT_CHARS,` form; behavioral test confirms multiple-occurrence stripping. SOLID — three-way import pin prevents a future one-consumer regression.

### `privacy-fields.test.ts`
SENSITIVE_KEYS fixture (20 keys). Symmetric guard: asserts admin-only keys == EXACTLY `SENSITIVE_KEYS` (no accidental leakage and no missing field). Pins field presence in schema, membership in `adminSelectFieldKeys`, non-membership in `publicSelectFieldKeys`, and exclusion from timeline query shapes. SOLID — the symmetric check catches both additions and removals.

### `sw-template-contract.test.ts`
Pins: no forbidden Cookie header read, admin-render marker gating via `x-gk-admin-render: 1`, isSensitiveResponse semantics, 24h TTL for offline HTML, LRU head-walk eviction (no sort), delete-then-set recency upsert, touchMeta repositioning, AbortSignal.timeout HEAD revalidation bound (300ms `HEAD_REVALIDATE_TIMEOUT_MS`). Compares the template source against the generated `public/sw.js` for drift. SOLID.

### `touch-target-audit.test.ts`
Pattern coverage validated against actual component sources. The multi-line tag normalizer, `max-` lookbehind exemptions, Button/button/Link/a/select/Badge coverage, and `KNOWN_VIOLATIONS` count enforcement are all present and active. No false-negative blind spots identified for current component set. SOLID.

---

## Coverage Inventory — Lib Modules Without Dedicated Test Files

The following modules have no dedicated `__tests__/<module>.test.ts` but ARE covered via imports in other test files:

| Module | Covered via |
|--------|-------------|
| `gps-exif-strip.ts` | `strip-gps-from-original.test.ts` (direct import of all 4 strip functions) |
| `icc-extractor.ts` | `color-detection.test.ts`, `og-image-icc.test.ts` (direct imports) |
| `og-photo-fetch.ts` | `og-photo-fallback.test.ts` (behavioral runtime tests + source-grep) |
| `seo-og-url.ts` | `seo-actions.test.ts` (direct import, all branches including backslash bypass) |
| `color-pipeline-decisions.ts` | `is-p3-pipeline.test.ts` (full enum coverage + null/undefined/empty), `color-pipeline-decision-i18n.test.ts` |
| `color-primaries.ts` | `wide-gamut-primaries.test.ts` (membership + helper), `wide-gamut-predicate-wiring.test.ts` (consumer import pins) |
| `avif-support.ts` | `avif-probe-data-url.test.ts` (AVIF_PROBE_DATA_URL decodes via sharp + format/width/height check) |
| `upload-tracker-state.ts` | Partially — `upload-tracker.test.ts` covers `settleUploadTrackerClaim` (from sibling `upload-tracker.ts`); behavioral coverage of the state module itself is mock-only in `retry-failed-image-auth.test.ts` |
| `clip-model-id.ts` | Constants only, no logic |
| `analytics-data.ts` | Type-only import in `client-server-only-boundary.test.ts`; no behavioral tests |
| `action-result.ts` | Pure types |
| `bulk-edit-types.ts` | Pure types |
| `caption-constants.ts` | Constants only |
| `constants.ts` | Constants only |
| `csp-nonce.ts` | Trivial Next.js headers wrapper |
| `image-types.ts` | Types only |

---

## NEW Findings

### TE-R9C1-01 — `upload-tracker-state.ts`: behavioral logic untested (MEDIUM)

**File:** `apps/web/src/lib/upload-tracker-state.ts`

**Untested paths:**
- `pruneUploadTracker()` — 2× grace-period expiry logic (line ~35-43), hard-cap eviction when `uploadTracker.size > UPLOAD_TRACKER_MAX_KEYS` (lines ~49-58). The prune is mocked away (`vi.mock('@/lib/upload-tracker-state', ...)`) in `retry-failed-image-auth.test.ts`.
- `resetUploadTrackerWindowIfExpired()` — window-reset path when `now - entry.windowStart > UPLOAD_TRACKING_WINDOW_MS`. Also mocked away in the only consumer test.
- `hasActiveUploadClaims()` — the composite function that calls `pruneUploadTracker` + iterates entries with `resetUploadTrackerWindowIfExpired`. Only usage is in `settings.ts` (`changesUploadProcessingContract && hasActiveUploadClaims()`), but the settings test (`settings-image-sizes-lock.test.ts`) is source-grep only; it never exercises the runtime path.

**Concrete failure scenario:** A developer changes the grace-period multiplier from 2× to 1× (making active uploads falsely appear expired) or changes the eviction order for the `UPLOAD_TRACKER_MAX_KEYS` cap. The change would silently ship because nothing exercises these branches. The `hasActiveUploadClaims` guard is the only thing preventing a live `image_sizes` or `strip_gps_on_upload` change from firing mid-upload — a false-negative (reports no active claims when there are) would drop the safety lock.

**Specific tests to add** (`__tests__/upload-tracker-state.test.ts`):
1. `pruneUploadTracker` evicts entries older than 2× `UPLOAD_TRACKING_WINDOW_MS`, keeps entries within the window
2. `pruneUploadTracker` enforces `UPLOAD_TRACKER_MAX_KEYS` by evicting the oldest entries first when over the cap
3. `resetUploadTrackerWindowIfExpired` resets count/bytes/windowStart when window has elapsed
4. `resetUploadTrackerWindowIfExpired` leaves an unexpired entry unchanged
5. `hasActiveUploadClaims` returns `false` for an empty tracker
6. `hasActiveUploadClaims` returns `true` when a non-expired entry has count > 0
7. `hasActiveUploadClaims` returns `false` after window expiry resets count to 0

**Confidence:** HIGH — the logic has real if-branch complexity and the only consumer test is source-grep, not behavioral.

---

### TE-R9C1-02 — `acquireUploadProcessingContractLock`: BigInt branch untested (LOW)

**File:** `apps/web/src/lib/upload-processing-contract-lock.ts:34`

**Untested path:** The BigInt comparison `acquired === BigInt(1)` in `lockAcquired = acquired === 1 || acquired === BigInt(1)` (line ~34). The `restore-upload-lock.test.ts` is source-grep only — it reads `db-actions.ts` to verify call ordering, not the lock module's runtime behavior. No test exercises the module with a mock DB that returns a BigInt row.

Additionally untested: the `catch` branch at line ~59 (query failure after connection acquisition — verifies the `conn.release()` fallback runs without throwing), and the idempotent `release()` guard (`if (released) return`).

**Concrete failure scenario:** mysql2 driver version upgrade returns `GET_LOCK` results as BigInt (mysql2 v3+ switched some integer columns to BigInt under certain configurations). Without the BigInt branch test, a driver upgrade that makes the numeric-1 check always false would silently make `acquireUploadProcessingContractLock` return `null` on EVERY call — settings changes that require the upload-contract lock would get a spurious `uploadSettingsLocked` error on every attempt.

**Specific tests to add** (`__tests__/upload-processing-contract-lock.test.ts`):
1. Returns a lock object when the mock connection's `GET_LOCK` returns numeric `1`
2. Returns a lock object when the mock connection's `GET_LOCK` returns `BigInt(1)` (the variant branch)
3. Returns `null` when `GET_LOCK` returns `0` (lock held by another)
4. Returns `null` when `connection.getConnection()` throws
5. `release()` is idempotent (second call is a no-op, does not call `RELEASE_LOCK` twice)
6. Returns `null` when the `GET_LOCK` query itself throws after connection acquisition

**Confidence:** MEDIUM — the BigInt path is a real defensive branch that has no test coverage. The concrete failure mode (driver upgrade silently returning BigInt) is plausible given mysql2 history.

---

### TE-R9C1-03 — `getGamutFamily` has no behavioral test (INFO)

**File:** `apps/web/src/lib/color-primaries.ts:72-84`

`getGamutFamily` maps primaries strings to 6-bucket `GamutFamily` values. It is used in `wide-gamut-hint.tsx` to derive the dismiss-key for the hint (R13-M2). `wide-gamut-primaries.test.ts` covers `WIDE_GAMUT_PRIMARIES` membership and `isWideGamutPrimary` but does not touch `getGamutFamily`. The function is purely deterministic (no I/O, no DB); the risk is LOW — a rename/removal of a branch would cause a type error that `typecheck` catches.

**No immediate action needed.** If `getGamutFamily` gains more callers or the GamutFamily enum expands (e.g. WI-09 adds `rec2100`), adding behavioral coverage in `wide-gamut-primaries.test.ts` is trivial.

---

### TE-R9C1-04 — `analytics-data.ts` `windowStart()` function untested (INFO)

**File:** `apps/web/src/lib/analytics-data.ts:~1-30`

`windowStart(window: TimeWindow): Date | null` branches on `'30d'`, `'90d'`, and `'all'`. An off-by-one on the date subtraction (e.g. `subDays(now, 29)` instead of `30`) would produce analytics windows shifted by 1 day. The rest of the functions in this module are pure DB-query wrappers with no interesting branching.

**Assessment:** ADMIN-ONLY display surface. A wrong window value would cause visual undercount in analytics charts, not a security or data-integrity issue. The risk is LOW: a wrong constant is self-evident from chart inspection, and the pattern is identical for 30d and 90d (`subDays`). No test needed at this time.

---

## Carried-Forward Deferrals (Not Re-Raised)

- **TE-R7C2-03** — semantic route malformed-embedding row-skip: still tracked, no new evidence
- **TE-R7C2-04** — `logAuditEvent` metadata truncation untested: still tracked, no new evidence
- **TE-R7C2-05** — embeddings action has no dedicated test: still tracked, no new evidence
- **TE-R7C2-02** — CLOSED-OBSOLETE (Stripe webhook route deleted): not re-filed

---

## Flaky Test Risk Assessment

No timing-dependent tests identified. All tests that involve time-sensitive logic use injected `now` parameters (`pruneUploadTracker(now)`, `resetUploadTrackerWindowIfExpired(entry, now)`) — deterministic by design. The `fetch` mock in `og-photo-fallback.test.ts` uses `afterEach` to restore the real `fetch`, preventing cross-test state leakage. `sw-template-contract.test.ts` reads files synchronously with no async race. No flaky tests found.

---

## Summary

**2 new findings (1 MEDIUM, 1 LOW).** The test surface is largely solid: 196+ test files with strong contract-test coverage on the correctness-critical paths, all 5 named contract tests verified and sound, and no timing/ordering flakiness found.

The two actionable gaps are both in lock-adjacent state modules that have behavioral logic (expiry windows, BigInt comparison) exercised only via mocks or source-grep in their consumer tests. Neither is security-critical but both are correctness-critical for the upload-contract guard that prevents mid-upload settings changes.

The 2 INFO findings (`getGamutFamily`, `analytics-data.ts windowStart`) are not worth actioning now — one is covered by the type system and the other is a display-only calculation on an admin-only surface.
