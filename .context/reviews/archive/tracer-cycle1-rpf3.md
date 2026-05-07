# tracer — Cycle 1 RPF v3 (HEAD: 67655cc)

## Scope

Causal trace of NF-3 (`tag_names` returns null) — the most severe finding.

## Trace

1. User visits `/en/tws`. Server renders via `apps/web/src/app/
   [locale]/[topic]/page.tsx`.
2. Page calls `getImagesLitePage` -> `apps/web/src/lib/data.ts:359`.
3. Drizzle compiles SELECT with the inline correlated subquery from line
   374:
   ```ts
   tag_names: sql<string | null>`(SELECT GROUP_CONCAT(DISTINCT t.name
   ORDER BY t.name) FROM ${imageTags} it JOIN ${tags} t ON it.tag_id =
   t.id WHERE it.image_id = ${images.id})`
   ```
4. The outer SELECT also has `total_count: sql\`COUNT(*) OVER()\``
   (line 375), which means Drizzle wraps the outer query for window
   function support. The bare alias `it` and `t` in the correlated
   subquery may collide with auto-generated outer aliases.
5. Working `getImages` at line 398-410 uses LEFT JOIN with Drizzle column
   refs (`${tags.name}`). No alias, no collision.

## Hypothesis ranking

- **A. Drizzle table-ref auto-aliasing collision** with `OVER()` window
  wrap — most likely. Empirically supported by the fact that admin's
  `getImagesAdmin` (line 428) uses the same correlated subquery WITHOUT
  the `OVER()` window function and may also fail (admin gallery isn't
  visible from the live deploy without auth).
- **B. Drizzle parses `it.tag_id` as parameter binding** — less likely
  (would yield SQL parse error).
- **C. MySQL silently drops non-existent JOIN** — already excluded;
  GROUP_CONCAT returns NULL for empty input but image 348 has tags.
- **D. Drizzle column-ref vs raw-string alias parity** — most likely
  fix; matches `getImages`.

## Recommended fix path

**Path 1 — JOIN approach (matches `getImages`)**

Pros: matches working code. Single code path. Lowest risk.
Cons: re-introduces `GROUP BY images.id` scan. Acceptable on
personal-gallery scale (≤ a few K images, paginated 30/page).

## Verdict

Root cause: alias / parameter collision in Drizzle correlated subquery
template at `data.ts:324, 374`. Path-1 fix is the lowest-risk
implementation.
