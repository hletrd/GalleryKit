# perf-reviewer — Cycle 1 RPF v3 (HEAD: 67655cc)

## Scope

Verify the perf characteristics of the NF-3 fix candidate (correlated
subquery -> LEFT JOIN + GROUP_CONCAT) and surface any adjacent perf concerns.

## Findings

### PR-1 (Medium, High confidence) — Correlated subquery in `getImagesLite` is functionally broken AND was perf-motivated

- **File:** `apps/web/src/lib/data.ts:324, 374`
- **Context:** The comment at line 309-313 documents the design intent:
  > Lightweight image listing — uses a scalar subquery for tag_names instead
  > of LEFT JOIN + GROUP BY.
- **Tension:** The documented motivation is to avoid `GROUP BY images.id`
  on the listing page so MySQL can use the
  `(processed, capture_date, created_at)` composite index for ORDER BY.
  Switching to LEFT JOIN + GROUP_CONCAT (the `getImages` pattern at line
  398-410) re-introduces the GROUP BY scan.
- **Decision:** The correctness regression (NF-3) is severity-High, while
  the perf cost on a personal gallery (a few thousand images, paginated 30
  at a time) is small. Recommendation: take the JOIN-based fix; the same
  pattern proven in `getImages` returns tags reliably and the perf delta
  on this scale is acceptable.
- **Alternative low-cost fix:** Switch the raw string aliases (`it`, `t`,
  `it.tag_id`, `it.image_id`, `t.id`, `t.name`) to Drizzle column refs.
- **Failure scenario for current code:** Confirmed in production by
  designer-v2's RSC payload inspection.
- **Fix recommendation:** Take the JOIN approach for cycle 1.

### PR-2 (Low, High confidence) — Touch-target class additions have zero perf cost

`min-h-[44px]`, `h-11`, `w-11` are static Tailwind utility classes — no
JS, no runtime evaluation, no layout-thrash penalty.

### PR-3 (Low, High confidence) — `loadMore` IntersectionObserver setup churn already mitigated

`loadMoreRef.current = loadMore;` (line 65-66) avoids re-observing the
sentinel on every state change. Bumping the button height does not
interact with this logic.

## Verdict

PR-1 is the only material perf concern. Even there, the correctness fix
takes priority and the JOIN re-introduces a GROUP BY that's acceptable at
personal-gallery scale.
