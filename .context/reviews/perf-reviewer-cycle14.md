# Perf Reviewer — Cycle 14 (current run)

**Reviewer:** perf-reviewer (CPU/memory/UI responsiveness, concurrency)
**Scope:** Hot paths in image processing, data layer, queue, UI render path.

## Methodology

Re-checked the previously-flagged hot spots:
- Image processing pipeline (Sharp configuration, parallel format generation, atomic rename).
- DB query plans (composite indexes, GROUP_CONCAT scalar subquery vs JOIN, COUNT(*) OVER pagination).
- Rate-limit Maps (insertion-order eviction, pruning cadence).
- View-count buffering and exponential backoff.
- Photo viewer effect dependencies and memo coverage.
- Queue concurrency / GET_LOCK retry escalation.
- nginx upstream keepalive, sendfile, and gzip configuration.

## Findings

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| (none) | Cycle 14 found no perf regressions. The optimizations introduced over cycles 1–13 are all still in effect. | — | — | — |

### Re-checks vs deferred items

- **C13-F05 (`batchUpdateImageTags` N+1).** Still per-name iteration in a transaction. Deferral rationale (max 100 tags, atomicity required) remains valid.
- **C13-F06 (photo-viewer keyboard effect re-registration).** Still depends on `[navigate, showLightbox]`. Cosmetic — adding/removing a single listener has no measurable cost. Deferred.
- **`searchImagesAction` short-circuit.** `apps/web/src/lib/data.ts:762-764` still skips the tag and alias queries when the main results already fill `effectiveLimit`.
- **`getImage` Promise.all.** `apps/web/src/lib/data.ts:465-535` still parallelizes tags + prev + next.
- **Queue concurrency.** Reads `QUEUE_CONCURRENCY` env var (default 2). Sharp threads bounded to `cpuCount - 1`.

### nginx + reverse-proxy

- `keepalive 32` on the upstream + `proxy_set_header Connection ""` retains connection reuse.
- `gzip` enabled with `gzip_min_length 256` for HTML/CSS/JS/JSON/SVG/text only.
- Static images served via root + rewrite (sendfile path) bypassing Next.js entirely.
- Cache-Control `public, max-age=31536000, immutable` on `/uploads/(jpeg|webp|avif)`.

## Verdict

No perf findings. Convergence holds.
