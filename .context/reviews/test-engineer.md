# Test Engineer Review — Cycle 15

**Summary:** 1 broken gate (same class as cycle-14 bavail finding), 2 medium contract gaps, 1 medium scanner omission, 2 low-priority blind spots. The three cycle-14 test additions (storage-quarantine, bavail negative test, argon2 pin) are all non-vacuous and solid.

---

## Cycle-14 additions verified non-vacuous

### `storage-quarantine.test.ts` — SOLID

Uses TypeScript AST (`ts.createSourceFile`) to walk every source file and reject any static/dynamic/require import that resolves to `@/lib/storage` or a relative path inside `src/lib/storage/`. Non-vacuousness pin checks `fs.existsSync` of `src/lib/storage/index.ts`. The AST approach means comments and strings do not false-positive. No issues.

### `images-actions.test.ts` bavail negative test (lines 322-342) — NON-VACUOUS

Mock is `{ bavail: 1, bsize: 1024 }`. Reverting the production code to read `stats.bfree` makes `mock.bfree` undefined → `NaN * 1024 = NaN` → `NaN < 1024*1024*1024` is `false` → the guard does not fire → the negative test assertion of `insufficientDiskSpace` fails. The fix in cycle-14 is correctly locked. No issues.

### `client-server-only-boundary.test.ts` argon2 pin (lines 431-461) — SOLID

`hasNativeModuleImport` regex includes `argon2`; fixture checks that `import * as argon2 from 'argon2'` yields `true` and `import x from 'argon2-browser'` yields `false`. The non-vacuous pin at lines 447-461 asserts `password-hashing.ts` is recognized as server-only-equivalent via argon2 import and must NOT carry `import "server-only"`. No issues.

---

## Findings

### FINDING 1 — HIGH — Broken gate: LR upload route `stats.bavail` not locked by its fixture test

**File:** `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:195-206`

**What the test checks:**
- `statfs` is imported from `fs/promises`
- `statfs(UPLOAD_DIR_ORIGINAL)` appears before `saveOriginalAndGetMetadata`
- Source contains `1024 * 1024 * 1024`
- Source contains `status: 507`

**What the test does NOT check:** Whether the code reads `stats.bavail` (not `stats.bfree`) from the statfs result.

**Production code at risk:** `apps/web/src/app/api/admin/lr/upload/route.ts:185`
```ts
const freeBytes = stats.bavail * stats.bsize;
```

**Regression it misses:** Cycle-14 fixed the images-actions path and locked it with a behavioral negative test, but the LR upload fixture test was not extended with the parallel `stats.bavail` assertion. A future change reverting to `stats.bfree` silently passes the test suite. On ext4 with 5% root-reserved blocks, `bfree` includes blocks the non-root `node` process cannot allocate, so the pre-check passes while the actual write still fails with ENOSPC — the exact bug cycle-14 fixed in both paths but only locked in one.

**Evidence of vacuousness:** `grep "bavail\|bfree\|stats\." apps/web/src/__tests__/lr-upload-hdr-gate.test.ts` returns empty.

**Fix:** Add one line to the DEF-C4-02 test block (after the existing assertions):
```ts
expect(LR_SRC).toMatch(/stats\.bavail\b/);
```

---

### FINDING 2 — MEDIUM — No fixture test for `currentFlushPromise` shutdown-drain contract

**File:** `apps/web/src/__tests__/data-view-count-flush.test.ts`

**What cycle-14 Task 4 added to `apps/web/src/lib/data.ts`:**
- Line 70: `let currentFlushPromise: Promise<void> | null = null;`
- Line 104: `currentFlushPromise = new Promise<void>((resolve) => { resolveDrain = resolve; });` (assigned at start of each flush)
- Line 205: `currentFlushPromise = null;` (cleared in the `finally` block after `resolveDrain()`)
- Lines 222-224: `if (currentFlushPromise) { await currentFlushPromise.catch(() => {}); }` (in `flushBufferedSharedGroupViewCounts`, the shutdown flush path)

**What the existing 13 fixture cases cover:** buffer-swap pattern, chunk iteration, consecutive-failure backoff, retry-count cap, FIFO eviction. None assert the existence of `currentFlushPromise`, the Promise assignment inside `flushGroupViewCounts`, or the `await currentFlushPromise` guard in `flushBufferedSharedGroupViewCounts`.

**Regression it misses:** If `currentFlushPromise` is removed or the `await` in the shutdown flush is deleted, `flushBufferedSharedGroupViewCounts` observes the swapped-out (empty) buffer immediately after a concurrent flush swaps it, returns early without draining the in-flight DB writes, and `process.exit()` truncates those writes. This is the exact data-loss race cycle-14 Task 4 fixed. The fixture test suite passes regardless.

**Evidence:** `grep "currentFlushPromise\|resolveDrain" apps/web/src/__tests__/data-view-count-flush.test.ts` returns empty.

**Fix:** Add two fixture assertions (the file already contains an `extractFnBody` helper):
```ts
it('R14C14: currentFlushPromise is assigned at the start of flushGroupViewCounts', () => {
  const fnBody = extractFnBody(dataSource, 'async function flushGroupViewCounts');
  expect(fnBody).toBeTruthy();
  expect(fnBody!).toMatch(/currentFlushPromise\s*=\s*new Promise/);
});

it('R14C14: flushBufferedSharedGroupViewCounts awaits currentFlushPromise before flushing', () => {
  const fnBody = extractFnBody(dataSource, 'async function flushBufferedSharedGroupViewCounts');
  expect(fnBody).toBeTruthy();
  expect(fnBody!).toMatch(/if\s*\(\s*currentFlushPromise\s*\)/);
  expect(fnBody!).toMatch(/await\s+currentFlushPromise/);
});
```

---

### FINDING 3 — MEDIUM — `check-action-origin.ts` scanner omits raw `revalidatePath` / `revalidateTag`

**Files:** `apps/web/scripts/check-action-origin.ts` (MUTATING_FUNCTION_NAMES set); `apps/web/src/__tests__/check-action-origin.test.ts`

**Current MUTATING_FUNCTION_NAMES:** `logAuditEvent`, `revalidateLocalizedPaths`, `revalidateAllAppData`

**Missing:** `revalidatePath`, `revalidateTag` (raw Next.js cache invalidation calls from `next/cache`)

**Why this matters:** The scanner enforces that `requireSameOriginAdmin()` is called before any mutation. A cache-invalidation call placed before the guard is a server-side side effect that unauthenticated cross-origin POST requests could trigger. More importantly, `revalidateLocalizedPaths` is a wrapper around `revalidatePath` and is in the set — but a new action that calls raw `revalidatePath` directly bypasses detection entirely. There is no fixture test case for this pattern.

**Current live exposure:** Low — the existing codebase exclusively uses `revalidateLocalizedPaths` (confirmed by grep; the single `revalidatePath` reference in `actions/images.ts:795` is inside a comment). No pre-guard raw calls today.

**Evidence:** `grep "revalidatePath\|revalidateTag" apps/web/scripts/check-action-origin.ts` returns empty.

**Fix:**
1. Add `'revalidatePath'` and `'revalidateTag'` to `MUTATING_FUNCTION_NAMES` in `check-action-origin.ts`.
2. Add a fixture test case to `check-action-origin.test.ts` verifying that a raw `revalidatePath` call before the guard is flagged.

---

### FINDING 4 — MEDIUM — No fixture test locks SIGTERM handler wiring or `NEXT_MANUAL_SIG_HANDLE` Dockerfile env

**Files:** `apps/web/src/instrumentation.ts:73-90`; `apps/web/Dockerfile:103`

**What exists:** `queue-shutdown.test.ts` tests `drainProcessingQueueForShutdown()` in isolation (correct idempotency and state mutations). Nothing in the test suite verifies that `instrumentation.ts` actually registers `process.on('SIGTERM', ...)`, or that the Dockerfile sets `ENV NEXT_MANUAL_SIG_HANDLE=true`.

**Why both are critical together:** `NEXT_MANUAL_SIG_HANDLE=true` tells Next.js NOT to install its own SIGTERM handler, relying on the custom handler in `instrumentation.ts`. Without the env var, Next.js bypasses the queue drain. Without the `process.on('SIGTERM')` registration, SIGTERM from Docker terminates the process immediately. Either regression silently breaks graceful shutdown with no test catching it.

**Evidence:** `grep "SIGTERM\|gracefulShutdown\|NEXT_MANUAL_SIG_HANDLE" apps/web/src/__tests__/` returns no hits in test files.

**Fix:** New `__tests__/instrumentation-sigterm.test.ts`:
```ts
import * as fs from 'fs';
import * as path from 'path';

const INSTR = fs.readFileSync(
  path.resolve(__dirname, '../instrumentation.ts'), 'utf8'
);
const DOCKERFILE = fs.readFileSync(
  path.resolve(__dirname, '../../Dockerfile'), 'utf8'
);

it('instrumentation.ts registers process.on(SIGTERM) handler (not process.once)', () => {
  expect(INSTR).toMatch(/process\.on\s*\(\s*['"]SIGTERM['"]/);
});

it('Dockerfile sets NEXT_MANUAL_SIG_HANDLE=true so Next.js defers to the custom handler', () => {
  expect(DOCKERFILE).toMatch(/ENV\s+NEXT_MANUAL_SIG_HANDLE\s*=\s*true/);
});
```

---

### FINDING 5 — LOW — Touch-target audit misses scale tokens on `<Badge asChild>`

**File:** `apps/web/src/__tests__/touch-target-audit.test.ts:396-401`

**Current `<Badge asChild>` patterns** check only arbitrary `min-h-[Npx]` values where N < 44. They do NOT check scale tokens (`h-8`, `min-h-9`, `size-7`, etc.) the way the Button/button/Link/a patterns do (the latter was extended in AGG-R8c3-06 and AGG-C6-04/AGG-C7-03).

**Current live exposure:** No `<Badge asChild>` instances exist in any scanned directory (`grep "Badge.*asChild\|asChild.*Badge" src/components src/app --include="*.tsx"` returns empty outside `ui/`). Risk is theoretical today.

**Fix:** Add scale-token FORBIDDEN pattern for `<Badge asChild>` mirroring the Button pattern, alongside the existing arbitrary-value patterns.

---

### FINDING 6 — LOW — `csv-escape.test.ts` missing test for U+FFF9-FFFB interlinear anchors

**File:** `apps/web/src/__tests__/csv-escape.test.ts`

**What is missing:** No test for U+FFF9 (interlinear annotation anchor), U+FFFA, U+FFFB. The `csv-escape.ts` comment and CLAUDE.md both document these as stripped. `validation.test.ts:118` and `:184` do test them via `containsUnicodeFormatting`.

**Current live exposure:** Very low — both files use the same `UNICODE_FORMAT_CHARS` regex which includes `￹-￻`. If the regex were narrowed, `validation.test.ts` would catch it first.

**Fix:**
```ts
it('strips U+FFF9-FFFB (interlinear annotation anchors)', () => {
  expect(escapeCsvField('a￹b￺c￻d')).toBe('"abcd"');
});
```

---

## Adequacy confirmation of remaining test surface

The following areas were explicitly cross-referenced and found to have no new gaps:

- **privacy-fields.test.ts**: Symmetric guard with 27-key SENSITIVE_KEYS list and compile-time `_SensitiveKeysInPublic` guard. SOLID.
- **check-api-auth.test.ts**: 10 fixture cases; wrapped/unwrapped handlers, function declarations, aliased exports, no-handler files, type assertions, extension variants. SOLID.
- **check-action-origin.test.ts**: 30+ cases; arrow functions, function expressions, dead branches, pre-guard mutations, getter exemptions, star re-exports. Gap at FINDING 3 only.
- **view-retention.test.ts**: vi.useFakeTimers; 395-day default, positive override, negative guard. SOLID.
- **queue-shutdown.test.ts**: Tests `drainProcessingQueueForShutdown` idempotency (same promise on repeated calls), state mutations. SOLID for the utility; FINDING 4 covers the missing wiring test.
- **sw-template-contract.test.ts**: Template vs `sw.js` drift, AbortSignal timeout, LRU constants. SOLID.
- **data-tag-names-sql.test.ts**: `tagNamesAgg` constant locked. SOLID.
- **og-sanitize.test.ts / sanitize-for-og-global.test.ts**: Both OG routes and JSON-LD page import shared `sanitizeForOg`. SOLID.
- **backfill-color-pipeline.test.ts**: Column set and delete-during-reencode race. SOLID.
- **admin-backfill-runner-detection-failure.test.ts**: No version bump on detection failure. SOLID.
- **images-action-blur-wiring.test.ts / process-image-blur-wiring.test.ts**: Producer-side wrap locked. SOLID.
- **check-public-route-rate-limit.test.ts**: Public mutating POST routes locked. SOLID.
- **touch-target-audit.test.ts**: Button/button/Badge/select/Link/a/raw-checkbox covered. FINDING 5 is the only new asymmetry (theoretical, no live violation).
- **csv-escape.test.ts**: All CLAUDE.md-documented strips covered except FINDING 6 (FFF9-FFFB, very low risk shared regex).
- **validation.test.ts**: `isValidTopicAlias`, `isValidTagName`, `containsUnicodeFormatting` all tested including interlinear anchors. SOLID.
- **storage-quarantine.test.ts**: Non-vacuous AST-based quarantine gate. SOLID (cycle-14 addition verified above).

---

## Prioritized fix list

| Priority | Finding | File(s) to change | Change |
|----------|---------|-------------------|--------|
| HIGH | LR upload `stats.bavail` not asserted | `__tests__/lr-upload-hdr-gate.test.ts` | Add `expect(LR_SRC).toMatch(/stats\.bavail\b/)` in DEF-C4-02 block |
| MEDIUM | `currentFlushPromise` contract untested | `__tests__/data-view-count-flush.test.ts` | Two new `it()` cases using existing `extractFnBody` helper |
| MEDIUM | `revalidatePath`/`revalidateTag` absent from scanner | `scripts/check-action-origin.ts` + `__tests__/check-action-origin.test.ts` | Add to MUTATING_FUNCTION_NAMES; add fixture test case |
| MEDIUM | SIGTERM wiring and Dockerfile env untested | New `__tests__/instrumentation-sigterm.test.ts` | Two source-scan assertions |
| LOW | `<Badge asChild>` scale-token blind spot | `__tests__/touch-target-audit.test.ts` | Add scale-token FORBIDDEN pattern for Badge asChild |
| LOW | `csv-escape.test.ts` missing FFF9-FFFB test | `__tests__/csv-escape.test.ts` | Add one `it()` for interlinear anchors |
