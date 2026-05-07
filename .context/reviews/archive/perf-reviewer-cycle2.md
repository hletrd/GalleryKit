# Performance Reviewer — Cycle 2/100 (2026-04-28)

## Files Reviewed

All source files under `apps/web/src/`.

## Findings

### LOW Severity

| ID | Finding | File | Confidence |
|---|---|---|---|
| C2-PR-01 | `exportImagesCsv` materializes up to 50K rows as a CSV string in memory (~15-25MB peak). The code already documents this (C3-F01 comment) and releases the results array before joining. For a personal gallery this is acceptable. The comment suggests a streaming API route for galleries approaching the 50K cap, but this is not needed at current scale. | `apps/web/src/app/[locale]/admin/db-actions.ts:33-105` | Low |
| C2-PR-02 | `searchImages` runs three sequential DB queries (main, tag, alias) when the main query doesn't fill the limit. The short-circuit optimization avoids the tag/alias queries on popular search terms. Acceptable design at personal-gallery scale. | `apps/web/src/lib/data.ts:794-901` | Low |

### INFO

- Image processing uses parallel `Promise.all` for AVIF/WebP/JPEG generation. Sharp concurrency is capped to `cpuCount - 1`.
- View-count buffer uses swap-and-drain pattern with chunked flush (C2-F01 fix). Backoff on DB outages is implemented.
- `React.cache()` wraps `getImage`, `getTopicBySlug`, `getTopicsWithAliases` for SSR deduplication.
- Masonry grid uses `useMemo` and `requestAnimationFrame` debouncing.
- Upload tracker uses pre-increment TOCTOU-safe pattern.

No new actionable performance findings.

## Convergence Note

Fourth consecutive cycle with no new medium/high performance findings.
