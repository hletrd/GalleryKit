# Plan 100 — Cycle 7 (review-plan-fix loop) — De-duplicate `tagsString` parsing in upload action

**Created:** 2026-04-25 (Cycle 7)
**Status:** PENDING
**Source review:** `.context/reviews/_aggregate.md` (Cycle 7)
**Lineage:** C7L-FIX-01 (this plan).

---

## Findings to Address

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| C7L-FIX-01 | Single-source the `tagsString.split(',')` pass in `uploadImages` so the validate-and-count steps cannot drift | LOW | High | IMPLEMENT |
| C7L-TE-01 | Add a test for the count-mismatch path (one bad tag → batch rejected with `invalidTagNames`) | LOW | Medium | BUNDLE |
| C7L-DOC-01 | Rename `upload-tracker.ts:14` parameter `ip` → `key` to match real callers (`${userId}:${ip}`) | INFO | Medium | BUNDLE |
| C7L-TE-02 | Optional `expect(settleUploadTrackerClaimMock).toHaveBeenCalledTimes(1)` to lock the not-double-call invariant | INFO | High | OPTIONAL — bundle if cheap |

## Closed (no implementation needed)

- **AGG7R-21** — re-audited this cycle. Call sites at `images.ts:391` and `:397` are mutually exclusive (the first branch at 393 returns). Closing as not-a-bug. Recorded in `.context/reviews/_aggregate.md` and `.context/reviews/security-reviewer.md` (V-1 in `verifier.md`).

## Deferred (recorded under deferred entries; do not implement)

| ID | Reason for deferral | Exit criterion |
|----|---------------------|----------------|
| C7L-CR-04 / C7L-SEC-03 | Promoting audit-log catch sites to `console.warn` is a logging-behavior change; deserves its own dedicated cycle so log noise/PII can be triaged. | Dedicated cycle assigned with explicit log-volume budget. |
| C7L-PERF-02 | `getSharedGroupKeysForImages` JOIN-elimination — low priority; not on the critical path. | Workload measurement shows JOIN cost in p50/p95. |
| C7L-PERF-03 | Sequential per-file upload loop — large refactor. | Profile shows p95 upload latency >X seconds for batches of 20+. |
| C7L-CR-05 | Stale lineage IDs in topic.ts — cosmetic. | Lineage docs collapse becomes scheduled. |
| C7L-CRIT-02 | `withAdminMutation()` boilerplate-reduction — large refactor; not a bug. | Refactor cycle scheduled. |
| C7L-CRIT-03 | Bootstrap state-flag complexity — combinatorial complexity is not a defect. | Adding a fifth flag triggers refactor. |
| C7L-CRIT-04 / C7L-UX-02 | Partial-success upload messaging — pre-existing UX concern. | Dedicated UX-audit cycle. |
| C7L-UX-01 | Generic `invalidTagNames` error — i18n churn risk. | UX cycle assigned to error-message granularity. |
| C7L-SEC-02 | `tagsString` 1000-char cap — out of cycle scope. | Tightening becomes part of an upload-policy cycle. |
| C7L-SEC-05 | Silent drop on deep-pagination — out of scope for personal-gallery topology. | Multi-tenant or analytics cycle. |
| C7L-CR-03 | `loadMoreImages` re-reads map after set — cosmetic. | Refactor cycle. |

Repo policy: no security/correctness/data-loss findings deferred. C7L-CR-04 / C7L-SEC-03 is a logging-quality LOW (no data loss, no incorrect security boundary), and CLAUDE.md authorizes phased logging changes via the cycle protocol.

---

## C7L-FIX-01 implementation

### Step 1 — `apps/web/src/app/actions/images.ts:141-149`

Replace:

```ts
const tagNames = tagsString
    ? tagsString.split(',').map(t => t.trim()).filter(t => t.length > 0 && isValidTagName(t) && isValidTagSlug(getTagSlug(t)))
    : [];

// Since tagsString is already sanitized, compare against the pre-split count
// without re-sanitizing (defense in depth: ensures no tag names were invalid)
if (tagsString && tagNames.length !== tagsString.split(',').filter(t => t.trim().length > 0).length) {
    return { error: t('invalidTagNames') };
}
```

with:

```ts
// Single split: derive both the validated tag list AND the count of
// non-empty candidates from the same source so the validate / count steps
// cannot drift if the parse rule changes (C7L-FIX-01). Earlier shape ran
// `tagsString.split(',')` twice, which silently created a maintenance
// hazard: changing the separator in the validate pass without updating the
// count pass would have made every batch fail with `invalidTagNames`.
const candidateTags = tagsString
    ? tagsString.split(',').map(t => t.trim()).filter(t => t.length > 0)
    : [];
const tagNames = candidateTags.filter(t => isValidTagName(t) && isValidTagSlug(getTagSlug(t)));

// If any candidate tag failed validation, abort the whole batch.
// Defense in depth: a single bad tag aborts so admins can correct
// before persistence.
if (candidateTags.length !== tagNames.length) {
    return { error: t('invalidTagNames') };
}
```

Note: with the rewrite, the empty-tagsString case yields `candidateTags = []` and `tagNames = []`, so the truthiness guard `if (tagsString && ...)` from the prior shape is no longer needed — equal-length arrays skip the error branch.

### Step 2 — `apps/web/src/lib/upload-tracker.ts:12-26` (C7L-DOC-01)

Rename the parameter `ip` to `key` so the function self-documents that it accepts any string key (real callers pass `${userId}:${ip}`). Update the docstring above the function to mention the key shape.

```ts
export function settleUploadTrackerClaim(
    tracker: Map<string, UploadTrackerEntry>,
    key: string, // Composite key like "${userId}:${ip}", not a bare IP.
    claimedCount: number,
    claimedBytes: number,
    successCount: number,
    uploadedBytes: number,
) {
    const currentEntry = tracker.get(key);
    if (!currentEntry) return;

    currentEntry.count = Math.max(0, currentEntry.count + (successCount - claimedCount));
    currentEntry.bytes = Math.max(0, currentEntry.bytes + (uploadedBytes - claimedBytes));
    tracker.set(key, currentEntry);
}
```

The existing test file `apps/web/src/__tests__/upload-tracker.test.ts` passes `'ip'` as a literal — no test changes required since the parameter name change is signature-compatible.

### Step 3 — `apps/web/src/__tests__/images-actions.test.ts` (C7L-TE-01)

Add a test:

```ts
it('rejects the upload batch when any tag fails validation', async () => {
    // Build a FormData with two tags; one contains '<' which `isValidTagName` rejects.
    const fd = new FormData();
    fd.append('topic', 'sample-topic');
    fd.append('tags', 'good-tag, ba<d-tag');
    // ... append a minimum valid file (existing test fixtures should expose a helper)
    const result = await uploadImages(fd);
    expect(result).toEqual({ error: expect.stringContaining('invalidTagNames') });
});
```

Adapt to the test file's existing harness (mocks already exist for auth, contract lock, settle).

### Step 4 — `apps/web/src/__tests__/images-actions.test.ts` (C7L-TE-02, optional)

Within the existing happy-path test, add:

```ts
expect(settleUploadTrackerClaimMock).toHaveBeenCalledTimes(1);
```

This locks the AGG7R-21 invariant that `settleUploadTrackerClaim` is called exactly once per `uploadImages` invocation.

---

## Acceptance criteria

1. `npm run lint --workspace=apps/web` clean.
2. `tsc --noEmit -p apps/web/tsconfig.json` clean.
3. `npm run lint:api-auth --workspace=apps/web` clean.
4. `npm run lint:action-origin --workspace=apps/web` clean.
5. `npm test --workspace=apps/web` passing — vitest count ≥ baseline + 1 net case (C7L-TE-01).
6. `npm run build --workspace=apps/web` clean.
7. Deploy: `npm run deploy` exit 0.

---

## Out of scope (this cycle)

- Any code beyond `images.ts`, `upload-tracker.ts`, and the corresponding test files.
- Audit-log logging-level promotion (deferred).
- Sequential upload-loop refactor (deferred).
- Bootstrap state-flag refactor (deferred).
