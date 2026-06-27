# Tracer Report — Cycle 18

**Date:** 2026-06-27
**HEAD:** master (post-cycle-17 fixes)
**Analyst:** Tracer agent (oh-my-claudecode:tracer)

---

## Trace Report

### Observation

Four flows were nominated for evidence-driven causal tracing after cycle 17 identified one headline defect (DBG-17-1, now fixed) in the upload quota tracker. The task is to find any NEW uncovered path in Flow 1, and to fully clear or confirm Flows 2-4 which the cycle-17 aggregate marked as important-to-verify.

---

## FLOW 1 — Upload Quota Tracker Claim Lifecycle

### Observation

Cycle-17 fix (CR-17-1) wrapped the topic SELECT (`images.ts:266-279`) in try/catch+settle. The question: is there any await/return path AFTER the claim (`images.ts:226-228`) and AFTER the topic SELECT settle that escapes without rolling back the claim?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | All await paths after the claim are covered — no new uncovered path exists beyond cycle-17 fix | High | Strong (source of all callees verified) | `deleteOriginalUploadFile` is hardened; per-file try/catch wraps all remaining awaits |
| 2 | The per-file catch block's `deleteOriginalUploadFile` can throw and leak the claim | Low | Strong (function source confirmed) | Right shape for a leak, but implementation is hardened to always resolve |
| 3 | A post-loop path exists where `totalFailures === 0 && successCount === 0` bypasses both settles | Low | Moderate (edge-case analysis) | Possible if `files` is empty, but line 555 settle is still reached |

### Evidence For (Hypothesis 1 — CLEARED)

Claim site: `apps/web/src/app/actions/images.ts:226-228`

Settle points confirmed downstream of the claim:

- **Line 244**: disk check insufficient space → `settleUploadTrackerClaim(…, 0, 0)` then `return`. COVERED.
- **Line 249**: disk check `catch` → `settleUploadTrackerClaim(…, 0, 0)` then `return`. COVERED.
- **Line 273**: topic SELECT `catch` → `settleUploadTrackerClaim(…, 0, 0)` then `throw err` (cycle-17 CR-17-1 fix). COVERED.
- **Line 277**: `!topicRow` guard → `settleUploadTrackerClaim(…, 0, 0)` then `return`. COVERED.
- **Line 533**: `totalFailures > 0 && successCount === 0` after per-file loop → settle. COVERED.
- **Line 555**: main success/partial path after per-file loop → settle. COVERED.

The per-file loop (lines 294-525) wraps EACH file in its own `try/catch` (try at line 297, catch at line 507). Every exception thrown inside a file's processing is caught per-file and does not propagate to the outer `try` (line 175) whose `finally` (line 561) only releases the contract lock, never settles.

The per-file catch block at line 507 contains only:
- `console.error(…)` — never throws
- `await deleteOriginalUploadFile(savedOriginalFilename)` at line 512 — HARDENED
- `instanceof` checks and array pushes — never throw

`deleteOriginalUploadFile` source at `apps/web/src/lib/upload-paths.ts:75-80`:

```ts
export async function deleteOriginalUploadFile(filename: string) {
    await Promise.all([
        fs.unlink(path.join(UPLOAD_DIR_ORIGINAL, filename)).catch(() => {}),
        fs.unlink(path.join(LEGACY_UPLOAD_DIR_ORIGINAL, filename)).catch(() => {}),
    ]);
}
```

Both `fs.unlink` calls swallow their own errors via `.catch(() => {})`. `Promise.all` receives only resolved promises. The function ALWAYS resolves and CANNOT throw. Hypothesis 2 is disconfirmed by direct source inspection.

### Evidence Against / Gaps

**Hypothesis 3 (empty `files` edge case):** If `files` is empty, the per-file loop runs 0 times, `totalFailures === 0 && successCount === 0`, so the early-exit settle at line 533 is skipped. However, execution falls through to line 555 (the unconditional settle at the success path), which still fires. Claim is settled. CLEARED.

**Post-loop `continue` coverage:** Every `continue` path inside the per-file `try` block pushes to `failedFiles` (lines 302, 314, 333, 348, 357) or `rawRejectedFiles` (per-file catch line 519), or reaches `successCount++` (line 504). No code path exits the per-file loop without incrementing one counter, so `totalFailures + successCount > 0` after any non-empty loop.

### Rebuttal Round

**Best challenge to Hypothesis 1:** Could `deleteOriginalUploadFile` inside the per-file catch block at line 512 throw if the underlying `fs.unlink` receives an unexpected argument type or if `path.join` throws?

**Answer:** `path.join` is synchronous and only throws on non-string/buffer arguments. `savedOriginalFilename` is typed `string | null` and the call is guarded by `if (savedOriginalFilename)`, so `path.join` always receives a string. `fs.unlink` errors are swallowed by `.catch(() => {})`. The function cannot throw. CLEARED.

### Convergence / Separation Notes

All three hypotheses converge: the claim lifecycle has no uncovered path beyond the cycle-17 fix. Hypothesis 2 and 3 are disconfirmed by source evidence; Hypothesis 1 stands.

### Current Best Explanation

**FLOW 1 is CLEARED.** The cycle-17 CR-17-1 fix (topic SELECT try/catch+settle) was the last uncovered await between the claim and the loop. No additional uncovered path exists. The per-file loop's catch block is hardened against throws (`deleteOriginalUploadFile` never throws), and post-loop settle coverage is exhaustive.

### Critical Unknown

None — all callees verified to source.

### Discriminating Probe

Not needed for the current state. Future guard: any new `await` added between the claim (line 226) and the loop entry (line 294) must be wrapped in `try/catch` that calls `settleUploadTrackerClaim(…, 0, 0)` before re-throwing, matching the pattern at lines 267-275.

### Uncertainty Notes

None material.

---

## FLOW 2 — Topic-slug rename fan-out

### Observation

The topic-slug rename uses delete-old-row + insert-new-row (not `ON UPDATE CASCADE`). Four stores reference `topics.slug`. The question: are all four re-pointed BEFORE the delete, and is the `contains` predicate non-remap safe?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | All stores are re-pointed before the delete in one atomic transaction; `contains` non-remap is correct | High | Strong (transaction code traced line-by-line, FK schema audited) | Confirmed by direct code and schema inspection |
| 2 | A `contains` predicate on `topic` silently stops matching after rename — data-consistency defect | Low | Moderate (semantic analysis) | Technically true but correct-by-design, documented |
| 3 | A store referencing `topics.slug` is absent from the rename transaction | Low | Strong (schema FK audit found only three FK children + one JSON store) | No additional FK children found |

### Evidence For (Hypothesis 1 — CLEARED)

The rename is performed as a single Drizzle `db.transaction` at `apps/web/src/app/actions/topics.ts:250-323`. Sequence inside the transaction:

1. **Line 276** — `tx.insert(topics)` inserts new row with `newSlug`
2. **Line 283** — `tx.update(images).set({ topic: slug })` re-points `images.topic` FK child
3. **Line 284** — `tx.update(topicAliases).set({ topicSlug: slug })` re-points `topic_aliases.topicSlug` FK child
4. **Line 292** — `tx.update(topicViews).set({ topic: slug })` re-points `topic_views.topic` FK child (cycle-16 fix)
5. **Lines 301-319** — smart collections loop: `tx.select` all, parse AST, `remapTopicSlugInQuery`, write back changed rows (cycle-16 fix)
6. **Line 321** — `tx.delete(topics).where(eq(topics.slug, cleanCurrentSlug))` deletes old row

All four stores are updated BEFORE `tx.delete`. The transaction is atomic: the `ON DELETE CASCADE` on `topic_views.topic → topics.slug` cannot fire mid-transaction because the cascade only triggers when the DELETE commits, at which point `topic_views` rows have already been re-pointed to the new slug.

**`contains` predicate analysis** — `remapTopicSlugInQuery` at `apps/web/src/lib/smart-collections.ts:414-442`:

```ts
if (ast.type === 'predicate' && ast.column === 'topic') {
    if (ast.operator === 'eq' && ast.value === oldSlug) {
        return { ast: { ...ast, value: newSlug }, changed: true };
    }
    if (ast.operator === 'in' && Array.isArray(ast.values) && ast.values.includes(oldSlug)) {
        return { ast: { ...ast, values: ast.values.map(v => v === oldSlug ? newSlug : v) }, changed: true };
    }
}
return { ast, changed: false };
```

Comment at lines 408-412 documents the intent: "`contains` (substring) / ordering operators (`gt`/`lt`/…) are NOT touched — a substring or range filter is not an identity reference and rewriting it could change the admin's intent."

A `topic contains "foo"` predicate is defined as "any topic slug containing the substring 'foo'." After renaming "foo-bar" → "baz-qux," the predicate correctly stops matching "baz-qux" because the admin stated a substring constraint, not an exact identity. Rewriting `contains "foo"` to `contains "baz-qux"` would violate the admin's semantic intent. The non-remap is correct.

### Evidence Against / Gaps

**Hypothesis 3 — Missing FK children:** Schema FK children of `topics.slug` verified from `apps/web/src/db/schema.ts`:
- `images.topic` — re-pointed ✓
- `topic_aliases.topicSlug` — re-pointed ✓
- `topic_views.topic` — re-pointed ✓
- `smart_collections.query_json` (JSON, not FK) — re-pointed for `eq`/`in` ✓

No additional FK children referencing `topics.slug` exist. Hypothesis 3 disconfirmed.

### Rebuttal Round

**Best challenge:** If a `topic contains "foo"` collection exists and the admin renames "foo-bar" to "baz-qux," that collection silently stops matching the renamed topic without any admin notification. Is this a silent data-consistency defect?

**Answer:** No. The collection is defined as "topics whose slug contains 'foo'." After the rename to "baz-qux," the slug no longer contains "foo" — the collection truthfully stops matching. Silently rewriting the predicate to `contains "baz-qux"` without admin consent would change the scope of the collection (which might match other topics containing "baz-qux"). The correct behavior is to leave the substring predicate as the admin stated it. This is intentional and documented. CLEARED.

### Convergence / Separation Notes

Hypotheses 2 and 3 are disconfirmed. Hypothesis 1 stands. The cycle-17 aggregate confirms this at line 54: "Topic-slug rename: ALL 3 FK children + smart_collections `eq`/`in` rules re-pointed in ONE transaction before the old-row delete; … Only `contains` predicate intentionally not remapped (documented)."

### Current Best Explanation

**FLOW 2 is CLEARED.** All four stores (`images`, `topicAliases`, `topicViews`, `smartCollections`) are re-pointed in one atomic transaction before the old-row delete. The `ON DELETE CASCADE` on `topic_views` is protected by the transaction sequencing. The `contains` predicate non-remap is correct by semantic analysis and is intentionally documented.

### Critical Unknown

None.

### Uncertainty Notes

None material.

---

## FLOW 3 — image-queue.ts semantic search mode lifecycle

### Observation

The `ImageProcessingJob` carries `semanticSearchMode` as a snapshot (PERF-17-04 fix). The question: do both the bootstrap path (no `quality`/`imageSizes`) and the normal upload path (snapshot present) correctly resolve `semanticSearchMode` into the embedding IIFE?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | All three resolution tiers (bootstrap-resolved → job-snapshot → legacy-fetch) work correctly; PERF-17-04 fix is in place | High | Strong (lines 391-530 traced, enqueue call at images.ts:497 confirmed) | Confirmed by direct code audit |
| 2 | Bootstrap path where DB fails leaves `resolvedSemanticMode = null` with no secondary retry | Low | Strong (IIFE secondary-fetch logic verified) | The IIFE's secondary fetch covers this exactly |
| 3 | Normal upload job triggers a redundant DB fetch per image (PERF-17-04 regression) | Low | Strong (condition evaluated for normal upload case) | `job.semanticSearchMode` being defined prevents the secondary fetch |

### Evidence For (Hypothesis 1 — CLEARED)

**Bootstrap path** (`!quality && !imageSizes` — `apps/web/src/lib/image-queue.ts:392-413`):
```ts
let resolvedSemanticMode: 'disabled' | 'stub' | 'production' | null = null;
if (!quality && !imageSizes) {
    try {
        const config = await getGalleryConfig();
        resolvedSemanticMode = config.semanticSearchMode;   // set from DB
    } catch {
        // DB unavailable — stays null
    }
}
```

**Normal upload path** — `if` block skipped; `resolvedSemanticMode` stays `null`. But `job.semanticSearchMode` is set at enqueue time. Confirmed at `apps/web/src/app/actions/images.ts:497`:
```ts
semanticSearchMode: uploadConfig.semanticSearchMode,
```
This is the PERF-17-04 fix from cycle 17. Present in code.

**IIFE resolution** (`apps/web/src/lib/image-queue.ts:521-530`):
```ts
let semanticMode: 'disabled' | 'stub' | 'production' =
    resolvedSemanticMode ?? job.semanticSearchMode ?? 'disabled';
if (resolvedSemanticMode === null && job.semanticSearchMode === undefined) {
    try {
        const cfg = await getGalleryConfig();
        semanticMode = cfg.semanticSearchMode;
    } catch { /* skip */ }
}
```

Resolution tier analysis:

| Job type | `resolvedSemanticMode` | `job.semanticSearchMode` | Initial `semanticMode` | Secondary fetch? |
|---|---|---|---|---|
| Bootstrap (DB ok) | 'production' | undefined | 'production' ✓ | No |
| Bootstrap (DB fail) | null | undefined | 'disabled' | YES — condition true |
| Normal upload | null | 'production' (snapshot) | 'production' ✓ | No — `job.semanticSearchMode` defined → condition false |
| Legacy (no snapshot) | null | undefined | 'disabled' | YES — condition true |

### Evidence Against / Gaps

**Hypothesis 2 (bootstrap DB fail):** For bootstrap-with-DB-fail, `resolvedSemanticMode === null && job.semanticSearchMode === undefined` evaluates to `true`, so the secondary fetch fires in the IIFE. If the second fetch also fails, `semanticMode` stays `'disabled'` and embedding is silently skipped — the documented safe-default behavior. CLEARED.

**Hypothesis 3 (redundant DB fetch on normal upload):** The secondary-fetch condition evaluates `null === null && 'production' === undefined` = `true && false` = `false`. No secondary fetch on normal upload jobs. The PERF-17-04 fix is working as intended. CLEARED.

### Rebuttal Round

**Best challenge:** What if `uploadConfig.semanticSearchMode` is `undefined` at enqueue time, causing the job snapshot to be absent?

**Answer:** `uploadConfig.semanticSearchMode` is typed as `'disabled' | 'stub' | 'production'` in the gallery config schema — never `undefined`. TypeScript prevents a normal upload from setting the field to `undefined`. If the type ever drifts, the fallback `?? 'disabled'` in the IIFE prevents any unsafe mode from reaching the encoder. CLEARED.

### Convergence / Separation Notes

Hypotheses 2 and 3 are disconfirmed. Hypothesis 1 stands. The three-tier resolution is correct and complete.

### Current Best Explanation

**FLOW 3 is CLEARED.** Both paths resolve `semanticSearchMode` correctly. The PERF-17-04 fix (snapshotting `semanticSearchMode` on the job at enqueue) is present and functioning. The three-tier fallback (bootstrap-resolve → job-snapshot → legacy-fetch) handles all cases including DB failure.

### Critical Unknown

None.

### Uncertainty Notes

The bootstrap-with-DB-fail path issues two `getGalleryConfig()` calls (one in the bootstrap gate that fails, one in the IIFE that may succeed). If the DB recovers between the two calls, embedding proceeds. This is correct safe behavior.

---

## FLOW 4 — Public search enrichment PII

### Observation

Both `api/search/semantic/route.ts` and `api/search/similar/[id]/route.ts` use explicit enrichment selects that bypass the `publicSelectFields` / `_PrivacySensitiveKeys` compile-time guard. The question: do `latitude`, `longitude`, `filename_original`, or `user_filename` appear in the enrichment selects?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | No PII reaches the public JSON — all four PII columns are absent from both enrichment selects | High | Strong (both route files traced column-by-column) | Confirmed by direct code audit |
| 2 | The enrichment selects bypass `_PrivacySensitiveKeys` creating structural risk of future PII drift | Medium | Strong (aggregate A2 confirms; no compile-time guard on these paths) | Real structural smell; not a live defect |

### Evidence For (Hypothesis 1 — CLEARED)

**Semantic route** (`apps/web/src/app/api/search/semantic/route.ts:293-315`) enrichment columns:
`id`, `title`, `description`, `filename_jpeg`, `width`, `height`, `topic`, `topic_label` (topics JOIN), `camera_model`, `lens_model`, `capture_date`

**Similar route** (`apps/web/src/app/api/search/similar/[id]/route.ts:195-215`) enrichment columns:
Identical to semantic: `id`, `title`, `description`, `filename_jpeg`, `width`, `height`, `topic`, `topic_label`, `camera_model`, `lens_model`, `capture_date`

PII field check:
- `latitude` — NOT selected in either route ✓
- `longitude` — NOT selected in either route ✓
- `filename_original` — NOT selected in either route ✓
- `user_filename` — NOT selected in either route ✓

Additional verification for non-obvious fields:
- `filename_jpeg` — UUID-based derived filename, not user-controlled. Per CLAUDE.md: "Filename sanitization: UUIDs via `crypto.randomUUID()` (no user-controlled filenames on disk)." Safe.
- `camera_model`, `lens_model`, `capture_date` — public EXIF metadata, already in keyword-search public response. Not in `_PrivacySensitiveKeys`. Safe.
- `description`, `title` — admin-authored, intentionally public (shown on all photo pages). Safe.

### Evidence For (Hypothesis 2 — structural smell, not live defect)

`apps/web/src/lib/data.ts` `publicSelectFields` / `_PrivacySensitiveKeys` system provides compile-time enforcement that PII columns are omitted from public responses. The search enrichment selects at both routes construct `db.select({…})` directly against `images.*` column references, bypassing this system. If a developer adds a PII column to these selects in the future, the `_PrivacySensitiveKeys` guard will NOT catch it.

The cycle-16 regex denylist fixture is the only guard on this path (cycle-17 aggregate A2: "cycle-16 added a regex denylist fixture (band-aid)"). Denylist coverage gap: a new PII column not added to the denylist would silently reach the response.

### Evidence Against / Gaps

No PII column is present in the current enrichment selects. Hypothesis 1 is fully supported for the current state. Hypothesis 2 is a future risk, not a current defect.

### Rebuttal Round

**Best challenge:** Could admin-authored `description` or `title` fields contain GPS coordinates or personal data that a photographer typed in, making them de-facto PII?

**Answer:** These are admin-controlled free-text fields that appear on public-facing photo pages regardless of the search API. If an admin includes sensitive data in a description, it is public by design everywhere — not a search-API-specific leak. The privacy controls in GalleryKit protect structured PII (DB columns `latitude`/`longitude`/`filename_original`/`user_filename`), not free-text the admin deliberately places in public fields. Out of scope for the structural PII guard. CLEARED.

### Convergence / Separation Notes

Hypothesis 1 and Hypothesis 2 address different timeframes: Hypothesis 1 is about the current state (CLEARED), Hypothesis 2 is about future drift risk (ACKNOWLEDGED, deferred per aggregate A2).

### Current Best Explanation

**FLOW 4 is CLEARED** (no live defect). Neither `latitude`, `longitude`, `filename_original`, nor `user_filename` appears in the enrichment select of either public search route. The structural smell (enrichment selects bypass `_PrivacySensitiveKeys`) is real and documented as A2, but it is not a current defect.

### Critical Unknown

Whether a future new PII column would be caught by the cycle-16 regex denylist before it leaks.

### Discriminating Probe

`grep -rn "latitude\|longitude\|filename_original\|user_filename" apps/web/src/app/api/search/` — any hit is a new PII leak. Run this as part of any search-route change review.

### Uncertainty Notes

The fix for A2 (restructure enrichment selects to use `publicSelectFields`) is deferred. Until done, the regex denylist is the only guard against future PII drift in these two routes.

---

## Cross-Flow Verdict Summary

| Flow | Verdict | Confidence | Key Evidence Anchor |
|------|---------|------------|---------------------|
| FLOW 1 — upload tracker lifecycle | **CLEARED** | High | `deleteOriginalUploadFile` hardened (`upload-paths.ts:76-79`); per-file try/catch at `images.ts:297-524` wraps all remaining awaits; post-loop settles at `:533`/`:555` cover all exits |
| FLOW 2 — topic-slug rename fan-out | **CLEARED** | High | All 4 stores re-pointed at `topics.ts:283,284,292,301-319` before `tx.delete` at `:321` inside one atomic transaction; `contains` non-remap correct by semantics |
| FLOW 3 — image-queue semantic mode | **CLEARED** | High | PERF-17-04 snapshot confirmed at `images.ts:497`; three-tier IIFE fallback at `image-queue.ts:521-530` correct for all cases |
| FLOW 4 — public search PII | **CLEARED** | High | Neither route selects `latitude`, `longitude`, `filename_original`, or `user_filename`; structural A2 smell acknowledged, deferred |

**No new CONFIRMED-DEFECT findings.** All four flows are CLEARED against the specific defect hypotheses. The one residual architectural risk (A2) was already documented in the cycle-17 aggregate and is deferred.
