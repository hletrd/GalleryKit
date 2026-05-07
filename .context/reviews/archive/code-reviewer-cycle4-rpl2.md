# Code Reviewer — Cycle 4 RPL (2026-04-23, loop 2)

Reviewer focus: code quality, logic, SOLID, maintainability. Full-repo deep pass.

## Inventory

- 9 server-action modules under `apps/web/src/app/actions/**` plus the legacy barrel in `apps/web/src/app/actions.ts`.
- Library surface in `apps/web/src/lib/**`, including `data.ts` (894 lines), `process-image.ts` (589), `rate-limit.ts`, `session.ts`, `sanitize.ts`, `sql-restore-scan.ts`.
- Routes: `[locale]/(public)/**`, `[locale]/admin/**`, `api/admin/db/download/route.ts`, `api/health`, `api/live`, `api/og`.
- DB schema at `db/schema.ts`.
- Components under `components/**`.
- Tests at `__tests__/**` and `e2e/**`.

## Findings

### C4R-RPL2-CQ-01 — `poolConnection.on('connection')` callback drops query errors [LOW] [HIGH]
**File:** `apps/web/src/db/index.ts:28-30`

```ts
poolConnection.on('connection', (connection) => {
    connection.query('SET group_concat_max_len = 65535');
});
```

`connection.query(...)` returns a Promise. No `.catch` handler means a transient failure surfaces as an unhandled promise rejection. In Node 24 defaults, an unhandled rejection can terminate the process (strict mode on by default). Even if the process continues, the `SET group_concat_max_len` may silently fail, after which `exportImagesCsv` can start truncating the GROUP_CONCAT tag column back to 1024 bytes without any signal.

**Fix:** Attach `.catch((err) => console.error(...))` so the warning is logged and no UHR is raised:

```ts
poolConnection.on('connection', (connection) => {
    connection.query('SET group_concat_max_len = 65535')
        .catch((err) => console.error('[db] Failed to set group_concat_max_len on pooled connection:', err));
});
```

### C4R-RPL2-CQ-02 — `settings.ts` actions not re-exported from `@/app/actions` barrel [LOW] [MEDIUM]
**File:** `apps/web/src/app/actions.ts`

The barrel re-exports `getSeoSettingsAdmin`/`updateSeoSettings` (seo) but **omits** `getGallerySettingsAdmin`/`updateGallerySettings` from `./actions/settings`. The admin settings page currently imports directly from `@/app/actions/settings`, which works fine — but the inconsistency is confusing: the barrel purports to be a facade, and a new contributor might re-export `settings` without noticing the existing module-level import. Either remove the barrel (prefer direct imports) or include settings for consistency.

**Fix:** Either:
1. Add `export { getGallerySettingsAdmin, updateGallerySettings } from './actions/settings';` to `actions.ts`, or
2. Document the intentional exclusion at the top of `actions.ts`.

### C4R-RPL2-CQ-03 — `safeJsonLd` doesn't escape U+2028/U+2029 [LOW] [MEDIUM]
**File:** `apps/web/src/lib/safe-json-ld.ts:2-4`

```ts
export function safeJsonLd(data: unknown): string {
    return JSON.stringify(data).replace(/</g, '\\u003c');
}
```

`JSON.stringify` does not escape U+2028 (LINE SEPARATOR) or U+2029 (PARAGRAPH SEPARATOR). These are valid JSON but are **illegal line terminators in JavaScript** (pre-ES2019 loose parsers) and used historically to break inline JSON-LD scripts. While modern browsers parse `<script type="application/ld+json">` as data (not JS), a defense-in-depth fix is a 1-line change and matches the broader hardening posture of this repo.

Additionally, `&` is not escaped — in rare edge cases with `</script` split across tokenization boundaries, adding `&` for `&` is cheap insurance. Lower-priority but trivially fixed.

**Fix:**

```ts
export function safeJsonLd(data: unknown): string {
    return JSON.stringify(data)
        .replace(/</g, '\\u003c')
        .replace(/ /g, '\\u2028')
        .replace(/ /g, '\\u2029');
}
```

### C4R-RPL2-CQ-04 — `updateTopic` throws bare `'TOPIC_NOT_FOUND'` and `'SLUG_CONFLICTS_WITH_ROUTE'` sentinel strings [LOW] [MEDIUM]
**File:** `apps/web/src/app/actions/topics.ts:225, 213`

The function throws plain `new Error('TOPIC_NOT_FOUND')` and relies on `e instanceof Error && e.message === 'TOPIC_NOT_FOUND'` in the outer catch. This is a recognized pattern elsewhere in the repo, but the use of ad-hoc string sentinels is fragile: a renamed constant in the throw that the catch doesn't know about will silently fall through to the generic "failed to update" branch. A named error class (`class TopicNotFoundError extends Error`) with a static-property `kind` would make the relationship type-checkable. **Not blocking** given the reproducible test surface, but worth tracking as a tech-debt item.

### C4R-RPL2-CQ-05 — `searchImages` re-used search term string logic is duplicated across 3 query branches [LOW] [LOW]
**File:** `apps/web/src/lib/data.ts:725-832`

The main query, tag query, and alias query repeat the `leftJoin(topics, ...)` + `select(searchFields)` boilerplate. Extracting a helper `buildSearchQueryBase()` would reduce duplication by ~40 lines. Refactor risk is high because the query shape matters for the `.having` clauses; leave for a future tech-debt plan.

### C4R-RPL2-CQ-06 — `saveOriginalAndGetMetadata` comment claims "no readdir" but `deleteImageVariants` still does one in the unknown-sizes branch [LOW] [LOW]
**File:** `apps/web/src/lib/process-image.ts:170-204`

Docs say "Avoids expensive readdir on directories with thousands of files." The branch at line 183 still calls `fs.opendir(dir)` (equivalent to readdir) when no sizes are provided. The comment is accurate because the sized branch (with explicit sizes array) skips the scan, but the code reads as inconsistent. Tighten the comment to "Scans only when sizes are unknown — used for legacy variants from an old sizes config" (already in the code, just clarify the claim).

## Positives

- Consistent sanitize-before-validate pattern across every mutating server action (`auth.ts`, `images.ts`, `topics.ts`, `tags.ts`, `admin-users.ts`, `seo.ts`, `settings.ts`, `sharing.ts`).
- `unstable_rethrow` correctly placed as the first statement of every outer `catch` in `auth.ts` with a test asserting it.
- Compile-time privacy guard in `data.ts` (_SensitiveKeysInPublic) is a strong defense.
- Pre-increment TOCTOU-safe pattern consistently applied to rate-limit buckets (login, password-change, search, share, user-create).
- DB advisory locks correctly used for serialized critical sections (topic-route mutation, admin-user deletion, DB restore, image-processing claim).
- SQL restore scanner handles conditional comments, hex/binary literals, and multi-chunk streaming.

## Confidence Summary

- All findings above are low-severity quality/consistency items. No high-severity code-quality issue found on this cycle.
