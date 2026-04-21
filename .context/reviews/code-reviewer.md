# Code Quality / Logic / Maintainability Review

## Scope
Entire repository review for `gallerykit`, with emphasis on the runnable app under `apps/web`, its server actions/routes, data layer, image pipeline, admin tooling, and cross-file interactions.

## Inventory Built First

### Repo / workspace
- `package.json`
- `README.md`
- `scripts/deploy-remote.sh`

### App / config / deploy
- `apps/web/package.json`
- `apps/web/next.config.ts`
- `apps/web/playwright.config.ts`
- `apps/web/eslint.config.mjs`
- `apps/web/tsconfig.json`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/nginx/default.conf`
- `apps/web/messages/{en,ko}.json`

### Core app code reviewed
- `apps/web/src/app/**`
- `apps/web/src/components/**`
- `apps/web/src/db/**`
- `apps/web/src/lib/**`
- `apps/web/src/i18n/**`
- `apps/web/src/proxy.ts`

### Supporting code reviewed
- `apps/web/scripts/**`
- `apps/web/src/__tests__/**`
- `apps/web/e2e/**`

## Verification / diagnostics run
- `git diff` → only prior review artifact changes in `.context/reviews/security-reviewer.md`; no product-code diff in working tree
- `npm run lint --workspace=apps/web` → passed
- `npx tsc --noEmit -p apps/web/tsconfig.json` → passed
- `npm test --workspace=apps/web` → passed (`21` test files, `128` tests)
- Grep sweeps for: TODO/FIXME/HACK, `console.*`, `dangerouslySetInnerHTML`, child-process use, rate-limit maps, storage backend wiring, pagination patterns
- Note: `omx_code_intel` MCP calls failed with `Transport closed`, so diagnostics/search fell back to shell + source inspection

## Findings Summary
- Confirmed issues: 4
- Likely issues: 1
- Risks needing manual validation: 2
- Total findings: 7

---

## Confirmed issues

### 1. Group share creation can silently succeed with a partial or empty image set under concurrent deletes
- **Type:** Confirmed issue
- **Severity:** MEDIUM
- **Confidence:** High
- **File / region:** `apps/web/src/app/actions/sharing.ts:200-245`

**Problem**
`createGroupShareLink()` validates the selected image IDs first, but inside the transaction it inserts `sharedGroupImages` with `.ignore()`. If an image disappears between the validation query and the insert, the FK failure is silently dropped and the function still returns success.

**Concrete failure scenario**
Admin A selects 10 images and clicks “share”. Admin B deletes 3 of those images just after the pre-check at lines 200-210. The transaction at lines 216-233 creates the group row, silently ignores the 3 failed `sharedGroupImages` rows, and returns a share key that exposes only 7 images. In the worst case, the group row can be created with zero linked images.

**Suggested fix**
Inside the transaction, verify the inserted association count matches `uniqueImageIds.length`; otherwise throw and roll back. Better yet, remove `.ignore()` here and fail loudly on FK violations, or re-select the candidate image IDs under the transaction before inserting.

---

### 2. Canonical topic redirect drops active tag filters
- **Type:** Confirmed issue
- **Severity:** MEDIUM
- **Confidence:** High
- **File / region:** `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:95-103`

**Problem**
When a topic alias is resolved to its canonical slug, the page redirects with `redirect(localizePath(locale, \`/${topicData.slug}\`))` and discards the current query string.

**Concrete failure scenario**
A user opens `/en/my-alias?tags=portrait,travel`. The alias resolves, but the redirect sends them to `/en/canonical-slug` without `?tags=...`. The page content changes from filtered results to the full topic gallery, which is both confusing and inconsistent with the metadata path that already parsed the tag filter.

**Suggested fix**
Preserve `searchParams` during canonicalization, e.g. rebuild the destination URL with the existing query string before calling `redirect()`.

---

### 3. Infinite-scroll pagination is unstable under concurrent uploads/deletes
- **Type:** Confirmed issue
- **Severity:** MEDIUM
- **Confidence:** High
- **Files / region:**
  - `apps/web/src/lib/data.ts:315-331`
  - `apps/web/src/components/load-more.tsx:20-43`
  - `apps/web/src/app/actions/public.ts:10-22`

**Problem**
The public gallery uses offset-based pagination over a mutable sort order (`capture_date DESC, created_at DESC, id DESC`). `LoadMore` advances `offset` by the number of rows received, and `loadMoreImages()` re-runs the query with that offset.

**Concrete failure scenario**
A visitor loads page 1 (`offset=0`, 30 rows). Before they scroll farther, an admin uploads a new photo or deletes one near the top of the feed. The next request uses `offset=30` against a changed ordering, so the visitor can see duplicates or skip rows entirely.

**Suggested fix**
Switch gallery pagination to keyset/cursor pagination using the same sort tuple (`capture_date`, `created_at`, `id`) instead of `offset`, and have the client pass the last visible row as the cursor.

---

### 4. CSV export still materializes the full export in memory despite the “incremental” comment
- **Type:** Confirmed issue
- **Severity:** LOW
- **Confidence:** High
- **File / region:** `apps/web/src/app/[locale]/admin/db-actions.ts:51-92`

**Problem**
The code comment says the CSV is built incrementally to avoid holding both DB results and the full CSV in memory, but the implementation still:
1. loads up to 50,000 rows into `results`,
2. stores every rendered CSV line in `csvLines`, and then
3. builds one large `csvContent` string with `join("\n")`.

That is still a full in-memory materialization with an extra large intermediate array.

**Concrete failure scenario**
On a large gallery with long titles/descriptions/tags, exporting CSV can spike heap usage much higher than expected. The misleading comment makes this easy to miss during future maintenance because the implementation looks “already optimized”.

**Suggested fix**
Either stream CSV rows directly to the response/download target, or at minimum correct the comment and explicitly document that the current implementation is capped-but-still-buffered.

---

## Likely issue

### 5. Public search likely misses user-visible topic names and aliases
- **Type:** Likely issue
- **Severity:** LOW
- **Confidence:** Medium
- **File / region:** `apps/web/src/lib/data.ts:683-691` and `apps/web/src/lib/data.ts:612-645`

**Problem**
`searchImages()` searches `images.topic`, which stores the canonical topic slug, not the human-facing topic label or any alias values. The topic system explicitly supports labels plus alias routing, but the search query only matches raw slugs.

**Concrete failure scenario**
If a topic’s canonical slug is `seoul-night` and its visible label is `Seoul Night` (or it has a CJK/emoji alias), searching for the label/alias may return no results even though the gallery visibly presents that term elsewhere.

**Suggested fix**
If topic-name search is intended, join/search against `topics.label` and optionally `topic_aliases.alias`, or maintain a denormalized searchable field that includes canonical slug + label + aliases.

---

## Risks needing manual validation

### 6. Restore-maintenance safety is process-local, not deployment-wide
- **Type:** Risk needing manual validation
- **Severity:** MEDIUM if multiple app instances/processes exist
- **Confidence:** High
- **Files / region:**
  - `apps/web/src/lib/restore-maintenance.ts:1-55`
  - callers across server actions, e.g. `apps/web/src/app/actions/images.ts:86-89`, `apps/web/src/app/actions/tags.ts:46-47`, `apps/web/src/app/actions/topics.ts:37-38`, `apps/web/src/app/actions/settings.ts:39-40`

**Why this matters**
The restore gate is a `globalThis` boolean. That protects only the current Node process. If the app is ever run with multiple instances/processes, one instance can enter restore mode while others continue accepting writes.

**Concrete failure scenario**
Instance A starts a restore and flips its in-process flag. Instance B, which has its own memory, keeps accepting uploads/settings/tag/topic mutations. The restore can then finish with a database state that no longer matches those concurrent writes.

**Suggested validation / fix**
If deployment is guaranteed single-process, document that assumption explicitly. Otherwise move restore-maintenance state to a shared store (DB flag, advisory lock, Redis, etc.) and have all mutation paths read the shared state.

---

### 7. Multiple abuse-control paths still rely on process-local Maps and assume single-instance behavior
- **Type:** Risk needing manual validation
- **Severity:** LOW to MEDIUM depending on deployment topology
- **Confidence:** High
- **Files / region:**
  - `apps/web/src/lib/rate-limit.ts:22-27`
  - `apps/web/src/app/actions/public.ts:32-99`
  - `apps/web/src/app/actions/images.ts:54-79,117-171`
  - `apps/web/src/app/actions/sharing.ts:20-60`
  - `apps/web/src/app/actions/admin-users.ts:18-54`

**Why this matters**
There is DB-backed protection in several paths, but important fast-path logic and upload/share tracking still depend on in-memory Maps. In a single-instance deployment that is acceptable. In a scaled or multi-process deployment, these protections become inconsistent per instance.

**Concrete failure scenario**
One instance sees a user as over limit while another instance still has an empty in-memory map; or upload/share tracking claims are split across instances, letting a client exceed intended per-window limits by hopping between workers.

**Suggested validation / fix**
Confirm the app is intentionally deployed as a single writable instance. If not, consolidate these counters/claims into shared storage or clearly downgrade the in-memory Maps to best-effort caches layered on top of authoritative shared state.

---

## Missed-issues sweep
I did a final sweep over:
- public routes and page loaders
- admin routes and server actions
- auth/session/rate-limit helpers
- upload/serve/image processing pipeline
- share-link flows
- DB backup/restore tooling
- deployment/config/docs/test inventory

### What held up well
- Lint, typecheck, and test suites are clean.
- Public/private field separation in `lib/data.ts` is explicit and well-defended.
- File serving/download routes have solid path-containment and symlink checks.
- Backup/restore flows show strong defensive thinking overall.
- Topic/tag mutation paths are generally better race-aware than typical CRUD code.

### Final sweep result
I did **not** find additional confirmed high-severity logic or maintainability defects beyond the seven findings above.
