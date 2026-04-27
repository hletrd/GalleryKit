# Architect — Cycle 3 Deep Review (2026-04-27)

**HEAD:** `9958152 docs(reviews): record cycle-2 fresh review findings and plan`

## Findings (New — Not in Prior Cycles)

### LOW Severity (2)

| ID | Finding | File | Confidence |
|---|---|---|---|
| C3-A01 | Rate-limit state is fragmented across 7 independent in-memory Maps (`loginRateLimit`, `passwordChangeRateLimit`, `searchRateLimit`, `loadMoreRateLimit`, `shareRateLimit`, `userCreateRateLimit`, `ogRateLimit`), each with its own prune/eviction logic. While each is individually correct, the pattern is repeated 7 times with near-identical FIFO eviction code. A shared `BoundedMap<K,V>` abstraction would reduce ~200 lines of duplicate prune logic and make it easier to add new rate-limited endpoints without copy-pasting the eviction boilerplate. | `lib/rate-limit.ts`, `lib/auth-rate-limit.ts`, `app/actions/public.ts`, `app/actions/sharing.ts`, `app/actions/admin-users.ts` | Medium |
| C3-A02 | `getImages` and `getImagesLite` have near-identical query shapes (same JOIN, GROUP BY, ORDER BY, select fields) with only the limit calculation differing. `getImagesLite` uses `LISTING_QUERY_LIMIT_PLUS_ONE` for has-more detection while `getImages` uses `LISTING_QUERY_LIMIT`. This duplication risks drift if a field or JOIN is added to one but not the other. A shared base query builder would prevent this. | `lib/data.ts:375-505` | Medium |

### INFO (1)

| ID | Finding | File | Confidence |
|---|---|---|---|
| C3-A03 | The advisory-lock naming convention uses a `gallerykit_` prefix but no instance identifier. As documented in CLAUDE.md, two GalleryKit instances pointed at the same MySQL server share the same lock namespace and will serialize each other's restores, topic renames, admin deletes, and image-processing claims across tenants. This is documented but architecturally fragile for multi-tenant co-location. | Multiple: `db-actions.ts`, `topics.ts`, `admin-users.ts`, `image-queue.ts` | Info |

## Architectural Assessment

The codebase follows a clean layered architecture:
- **Data layer** (`lib/data.ts`): Centralized with React `cache()` deduplication
- **Action layer** (`app/actions/`): Server actions with consistent auth/origin guards
- **API routes** (`app/api/`): `withAdminAuth` wrapper pattern
- **Middleware** (`proxy.ts`): i18n routing + admin cookie check
- **Queue** (`lib/image-queue.ts`): PQueue with advisory locks and retry logic

Cross-cutting concerns (auth, rate limiting, validation, sanitization) are well-modularized. The main architectural risk is the single-writer topology assumption (documented in CLAUDE.md).
