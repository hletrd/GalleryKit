# Aggregate Review — Cycle 13 (2026-04-30)

## Review agents that returned

1. **code-reviewer** (`c13-code-reviewer.md`) — 5 findings
2. **security-reviewer** (`c13-security-reviewer.md`) — 6 findings
3. **perf-reviewer** (`c13-perf-reviewer.md`) — 5 findings
4. **test-engineer** (`c13-test-engineer.md`) — 4 findings
5. **architect-debugger** (`c13-architect-debugger.md`) — 5 findings
6. **designer-critic** (`c13-designer-critic.md`) — 6 findings
7. **verifier** (`c13-verifier.md`) — 5 findings
8. **document-specialist** (`c13-document-specialist.md`) — 3 findings

## AGENT FAILURES

None — all review agents completed successfully.

---

## Deduplicated findings (sorted by severity, then by cross-agent agreement)

### MEDIUM severity

#### C13-MED-01: `sanitizeAdminString` returns non-null `value` for C0 control character rejection
- **Sources**: C13-VF-05 (Medium/High), C13-TE-03 (Medium/Medium)
- **2 agents agree**
- **File+line**: `apps/web/src/lib/sanitize.ts:172-173`
- **Issue**: When Unicode formatting characters (bidi, zero-width) are detected, `sanitizeAdminString` returns `{ value: null, rejected: true }` (line 169). But when only C0 control characters are present, it returns `{ value: stripped, rejected: true }` (line 173) — a non-null stripped value with `rejected: true`. The comment on lines 163-167 states "return null when rejected=true so callers cannot accidentally persist a stripped value that looks visually identical to the original." C0 control characters can also produce visually-identical stripped strings (e.g., `hello\x01world` → `helloworld`). This creates a contract inconsistency: some `rejected: true` paths return null (safe) and others return a non-null value (potentially unsafe if a caller only checks `rejected` but then uses `value`).
- **Fix**: Return `value: null` on ALL `rejected: true` paths for consistency. The test at line 60-62 in `sanitize-admin-string.test.ts` expects `value: 'helloworld'` for C0-only rejection and would need to be updated to `value: null`.
- **Confidence**: High

### LOW severity

#### C13-LOW-01: `exportImagesCsv` `results = [] as typeof results` pattern is misleading
- **Sources**: C13-CR-01 (Low/Low), also C12-LOW-02
- **File+line**: `apps/web/src/app/[locale]/admin/db-actions.ts:98`
- **Issue**: The type-asserted reassignment for GC hint. A block scope or `results.length = 0` would be clearer.
- **Fix**: Cosmetic — consider scoping or `length = 0`.
- **Confidence**: Low

#### C13-LOW-02: `bootstrapContinuationScheduled` flag could remain set if PQueue `onIdle` never resolves
- **Sources**: C13-AD-03 (Low/Low), also C12-LOW-03
- **File+line**: `apps/web/src/lib/image-queue.ts:423-437`
- **Issue**: Theoretical risk at personal-gallery scale. `onIdle()` catch resets the flag. The `bootstrapRetryTimer` provides a partial fallback.
- **Fix**: Already deferred.
- **Confidence**: Low

#### C13-LOW-03: Admin navigation does not indicate active page
- **Sources**: C13-DC-02 (Low/Low), also C11-LOW-06, C12-LOW-06
- **File+line**: `apps/web/src/components/admin-nav.tsx`
- **Issue**: Already deferred.
- **Fix**: Already deferred.

#### C13-LOW-04: Photo viewer info sidebar collapse clips content without fade
- **Sources**: C13-DC-03 (Low/Low), also C11-LOW-05, C12-LOW-05
- **File+line**: `apps/web/src/components/photo-viewer.tsx:426-429`
- **Issue**: Already deferred.
- **Fix**: Already deferred.

#### C13-LOW-05: `proxy.ts` middleware cookie format check accepts 3-part tokens with empty fields
- **Sources**: C13-SR-01 (Low/Low), also C11-LOW-01, C12-LOW-04
- **File+line**: `apps/web/src/proxy.ts:87`
- **Issue**: Already deferred. No security impact.
- **Fix**: Already deferred.

## Verified-as-correct (no action needed)

- C13-VF-01: `restoreDatabase` `endRestoreMaintenance()` in finally — correct (6 agents agreed in C12)
- C13-VF-02: `enqueueImageProcessing` skips permanently-failed — correct
- C13-VF-03: `uploadImages` validates topic existence — correct
- C13-VF-04: `buildCursorCondition` isNotNull guards — correct
- C13-SR-03: UNICODE_FORMAT_CHARS non-`/g` for .test() — correct
- C13-SR-05: searchImages LIKE wildcard escaping — correct
- C13-PR-02: getSharedGroup batched tag query — correct
- C13-DC-01: Lightbox alt text uses getConcisePhotoAltText — FIXED in cycle 12
- C13-DC-04: Lightbox focus trap returns focus on close — correct
- C13-DC-05: Photo viewer navigate guards — correct
- C13-DC-06: Lightbox ARIA attributes — correct
- C13-AD-02: viewCountBuffer swap-then-drain — correct
- C13-AD-05: createAdminUser username vs password sanitization asymmetry — intentional
- C13-DS-01: CLAUDE.md advisory lock documentation — accurate
- C13-DS-03: UPLOAD_MAX_TOTAL_BYTES env var name — matches code (FALSE POSITIVE)

## Previously fixed findings (confirmed still fixed from cycles 1-12)

All previously fixed items remain fixed (same as C12 aggregate).

## Deferred items carried forward (no change)

All items from plan-370 (cycle 11 deferred) and plan-372 (cycle 12 deferred) remain deferred. No new deferrals this cycle beyond C13-MED-01 which should be implemented.

## Summary statistics

- Total findings across all agents: 39 (before dedup)
- Deduplicated new findings: 1 MEDIUM + 4 carried-forward LOW
- MEDIUM severity: 1 (C13-MED-01 — sanitizeAdminString null-on-rejected contract gap)
- Cross-agent agreement (2+ agents): 1 finding (C13-MED-01)
