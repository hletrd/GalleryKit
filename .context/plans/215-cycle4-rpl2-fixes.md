# Plan 215 — Cycle 4 (RPL loop 2) fixes

**Source:** `.context/reviews/_aggregate-cycle4-rpl2.md` (2026-04-23)

**Scope:** Implement the 5 "should-fix" items from the aggregate. All 5 are LOW severity but several have data-integrity or defence-in-depth implications. Follow repo rules: GPG-signed fine-grained commits, conventional commit + gitmoji, no `--no-verify`, no `Co-Authored-By: Claude`.

## Tasks

### [x] C4R-RPL2-01 — Add `.catch` handler to `db/index.ts` pool-connection callback (AGG4R2-01)

**File:** `apps/web/src/db/index.ts:28-30`

Before:
```ts
poolConnection.on('connection', (connection) => {
    connection.query('SET group_concat_max_len = 65535');
});
```

After:
```ts
poolConnection.on('connection', (connection) => {
    connection.query('SET group_concat_max_len = 65535')
        .catch((err) => console.error('[db] Failed to set group_concat_max_len on pooled connection:', err));
});
```

**Why:** Flagged by 7 of 11 reviewers in cycle 4 rpl2. Silent failure truncates GROUP_CONCAT output in `exportImagesCsv` to 1024 bytes. Also prevents potential unhandled promise rejection under Node 24 strict mode.

**Test:** add `apps/web/src/__tests__/db-pool-connection-handler.test.ts` that reads `db/index.ts` source and asserts the connection-listener callback includes `.catch(` (pattern identical to `auth-rethrow.test.ts`).

**Commit message:** `fix(db): 🐛 log pool-connection SET group_concat_max_len failures (C4R-RPL2-01)`

### [x] C4R-RPL2-02 — Harden `safeJsonLd` to escape U+2028/U+2029 (AGG4R2-03)

**File:** `apps/web/src/lib/safe-json-ld.ts`

Before:
```ts
export function safeJsonLd(data: unknown): string {
    return JSON.stringify(data).replace(/</g, '\\u003c');
}
```

After:
```ts
/**
 * Serialize data for a JSON-LD `<script>` tag:
 * - `<` → `<` prevents `</script>` XSS vectors.
 * - U+2028/U+2029 → ` `/` ` keeps the output safe for historical
 *   JS parsers that treat those characters as line terminators.
 */
export function safeJsonLd(data: unknown): string {
    return JSON.stringify(data)
        .replace(/</g, '\\u003c')
        .replace(/ /g, '\\u2028')
        .replace(/ /g, '\\u2029');
}
```

**Test:** add `apps/web/src/__tests__/safe-json-ld.test.ts` with coverage of all three escapes.

**Commit message:** `fix(seo): 🛡️ escape U+2028/U+2029 in safeJsonLd (C4R-RPL2-02)`

### [x] C4R-RPL2-03 — Fix JSON-LD breadcrumb to show topic label, not slug (AGG4R2-05)

**File:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:189-193`

Before:
```ts
image.topic && {
    '@type': 'ListItem',
    position: 2,
    name: image.topic,
    item: localizeUrl(seo.url, locale, `/${image.topic}`),
},
```

After:
```ts
image.topic && {
    '@type': 'ListItem',
    position: 2,
    name: image.topic_label || image.topic,
    item: localizeUrl(seo.url, locale, `/${image.topic}`),
},
```

**Why:** `image.topic` is the url-slug (e.g. `family-vacation-2024`); `image.topic_label` is the human-facing label (e.g. `Family Vacation 2024`). Already available from `data.ts:450` via the topics leftJoin. SEO breadcrumbs should use the human label.

**Commit message:** `fix(seo): 🩹 use topic label not slug in photo breadcrumb (C4R-RPL2-03)`

### [x] C4R-RPL2-04 — Complete the `@/app/actions` barrel with settings exports (AGG4R2-02)

**File:** `apps/web/src/app/actions.ts`

Add after line 20 (Public/SEO blocks):
```ts
// Settings
export { getGallerySettingsAdmin, updateGallerySettings } from './actions/settings';
```

**Why:** The barrel is inconsistent today — `settings` is the only action module not re-exported. A new contributor importing `from '@/app/actions'` should see the full API surface.

**Commit message:** `refactor(actions): ♻️ export settings actions from barrel (C4R-RPL2-04)`

### [x] C4R-RPL2-05 — Add `CREATE DATABASE` to SQL restore dangerous-patterns list (AGG4R2-07)

**File:** `apps/web/src/lib/sql-restore-scan.ts`

Add a pattern between the existing `DROP DATABASE` entry and the next pattern:
```ts
/\bCREATE\s+DATABASE\b/i,
```

**Why:** Defence-in-depth. `--one-database` filters out statements targeting other databases, but a malformed dump containing `CREATE DATABASE x; USE x;` followed by data writes could surprise operators. The app's DB user typically lacks the privilege anyway, but blocking at the scanner level is cheap.

**Test:** extend `apps/web/src/__tests__/sql-restore-scan.test.ts` with a `CREATE DATABASE` test case.

**Commit message:** `fix(security): 🛡️ block CREATE DATABASE in SQL restore scanner (C4R-RPL2-05)`

## Gate order

After implementing each commit:
1. Run `npm run lint --workspace=apps/web`
2. Run `npm test --workspace=apps/web` (vitest)
3. Run `npm run lint:api-auth --workspace=apps/web`
4. Run `npm run lint:action-origin --workspace=apps/web`
5. Run `npm run build --workspace=apps/web` (tsc type-check)
6. Run `npm run test:e2e --workspace=apps/web` — Playwright (after all commits; expensive)
7. `npm run deploy` (per-cycle deploy per orchestrator config)

## Progress tracking

- [x] C4R-RPL2-01 (db pool handler `.catch`) — initial `0000000e73557ac8d340e070e975481b8fd2dfc5` + hotfixes `00000005bae44d89cdddcef4ed6f221d2e7d981d` (seed-breaking bug) and `0000000f676913916f6f11025826aec327c390d2` (type-safe `.promise()` cast)
- [x] C4R-RPL2-02 (safeJsonLd U+2028/U+2029) — commit `00000003f2e40f8ef5d51f7e8889623511a36ac6`
- [x] C4R-RPL2-03 (JSON-LD breadcrumb label) — commit `00000003ac5a77fd7167118f9ea265d4cacfcb1b`
- [x] C4R-RPL2-04 (actions barrel settings) — commit `0000000ca9d8df1791bc477e45753082706c87fa`
- [x] C4R-RPL2-05 (SQL scanner CREATE DATABASE) — commit `0000000ecdf5e61f264b71aa9277567fa193a239`
- [x] Gates green — eslint clean; lint:api-auth OK; lint:action-origin OK; vitest 232/232; next build OK; Playwright 17/17
- [x] Deploy complete — `npm run deploy` succeeded; `gallerykit-web` container recreated and running

## Lessons learned

The initial C4R-RPL2-01 commit `0000000e73...` broke the E2E seed
because mysql2's `'connection'` event hands out the **callback-style**
Connection even when the pool was created via `mysql2/promise`.
Chaining `.catch` on a callback-style `.query(...)` (which returns
`undefined`) triggered the mysql2 runtime guard. Two follow-up commits
iterated to the correct fix:

1. `00000005b` — switched to callback form `(err) => {...}`. Unblocked
   the seed but failed `next build` type-check because the type of
   `.query(...)` on `mysql2/promise`'s `PoolConnection` only exposes
   the Promise overload.
2. `0000000f6` — cast the runtime connection through
   `mysql2.PoolConnection` (callback-style type) to access `.promise()`,
   then call `.query()` on the returned PromiseConnection so `.catch()`
   is both type-safe AND actually chained on a real Promise.

Take-away for future cycles: when touching mysql2 pool event listeners,
remember that the event-arg types from `mysql2/promise` are misleading
— the runtime value is the base callback-style Connection, and you
need `.promise()` to adapt.
