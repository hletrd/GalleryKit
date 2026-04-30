# Tracer Review — tracer (Cycle 8)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Causal tracing of suspicious flows

### Trace 1: `sanitizeAdminString` stateful regex — bidi override bypass path

**Hypothesis H1**: The `/g` flag on `UNICODE_FORMAT_CHARS_RE` causes `sanitizeAdminString` to intermittently accept strings containing bidi overrides.

**Trace**:
1. `createTopic` (topics.ts:84) calls `sanitizeAdminString(formData.get('label')?.toString())`.
2. `sanitizeAdminString` (sanitize.ts:136) calls `UNICODE_FORMAT_CHARS_RE.test(input)`.
3. If a previous call to `sanitizeAdminString` has already called `.test()` on the same regex, `lastIndex` was left at the match position.
4. The second `.test()` call starts searching from `lastIndex`, which is past the bidi character.
5. `.test()` returns `false`, so `sanitizeAdminString` returns `{ value: stripped, rejected: false }`.
6. The caller proceeds to store the value. However, `stripControlChars` (line 18) does correctly remove the bidi character because `.replace()` always starts from the beginning. So the stored value will NOT contain the bidi character, but the caller will NOT return an error — the admin gets no feedback that their input contained a rejected character.

**Wait — deeper trace**: `stripControlChars` at line 18 calls `.replace(UNICODE_FORMAT_CHARS_RE, '')`. The `.replace()` method always starts from the beginning regardless of `lastIndex`, so it correctly removes bidi characters. But after `.replace()`, `lastIndex` is NOT updated (`.replace()` does not modify `lastIndex`). However, if `.test()` was called BEFORE `.replace()` (which it is — line 136 tests first, then line 138 strips), then:

- Line 136: `UNICODE_FORMAT_CHARS_RE.test(input)` — if this is the second call, `lastIndex` from a previous invocation makes `.test()` return `false`.
- Line 138: `stripControlChars(input)` — calls `.replace()` which DOES find and remove the bidi characters (`.replace()` ignores `lastIndex`).

So the actual behavior is: the bidi character IS removed from the stored value, but the admin gets NO error feedback. The `rejected: false` return means the caller proceeds normally. This is a data-integrity issue (silent data mutation without admin awareness) rather than a stored-XSS issue (the bidi character is stripped before storage).

**Revised verdict**: The impact is slightly lower than initially assessed — bidi characters are stripped before storage, so they do not persist. But the admin gets no feedback that their input was modified, which violates the design intent of `sanitizeAdminString` (reject, don't silently strip). The function was specifically designed to return `rejected: true` so callers can inform the admin.

**Verdict H1**: CONFIRMED — `sanitizeAdminString` alternates between `rejected: true` and `rejected: false` on the same input, but the stored value is always clean (bidi chars are stripped regardless). The real impact is: (1) admin gets no error feedback on the `rejected: false` path, violating the C7-AGG7R-03 design intent, and (2) the `requireCleanInput` fallback path (which returns `rejected: true` when stripped !== input) would catch it on the second call, creating inconsistent behavior.

### Trace 2: `countCodePoints` not applied to topics.ts / seo.ts

**Hypothesis H2**: The AGG7R-02 fix was intentionally scoped only to `updateImageMetadata` because topic labels and SEO fields are less likely to contain emoji.

**Trace**: The plan-158 doc explicitly says "Scan other admin string validations: `seo.ts` (MAX_TITLE_LENGTH=200, etc.), `topics.ts` (label.length > 100), `tags.ts` (trimmedName.length, slug length). These use shorter limits where emoji-heavy inputs are less likely, but should be consistent." The fix was implemented only for `images.ts` — the follow-up scan was not done.

**Verdict H2**: NOT intentional — it's an incomplete fix.

## New Findings

### C8-TR-01 (Medium / Medium). Stateful `/g` regex in `sanitizeAdminString` — bidi rejection alternates between rejecting and silently-accepting-with-stripping on repeated calls

- Location: `apps/web/src/lib/sanitize.ts:13,136`
- Same root cause as C8-SEC-01 / C8-CR-01 / C8-V-01, but with refined impact assessment. The bidi characters ARE stripped before storage (`.replace()` always works correctly), but the `rejected` flag alternates between `true` and `false`. On the `false` path, the admin gets no error feedback, which violates the design intent of `sanitizeAdminString`.
- The severity is Medium (not High) because: (1) bidi characters are stripped regardless, so no stored XSS, and (2) the `requireCleanInput` fallback at line 142 (`rejected: stripped !== input`) would catch the case when the input was modified by stripping. But `requireCleanInput` logic is only in the `else` branch (when `UNICODE_FORMAT_CHARS_RE.test()` returns false), so on the second call, it would return `rejected: true` if the stripped value differs from the input.

### C8-TR-02 (Low / Medium). `countCodePoints()` not applied to topics.ts / seo.ts — incomplete fix from C7-AGG7R-02

- Location: `apps/web/src/app/actions/topics.ts:103,202` and `apps/web/src/app/actions/seo.ts:94-112`
- Same finding as C8-CR-02 / C8-V-02. The plan explicitly called for a scan of other admin string validations but the follow-up was not completed.
